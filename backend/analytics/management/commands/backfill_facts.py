"""Persist the sales pipeline dataset to PostgreSQL (idempotent).
Loads from: --fixture <path>, AIF_FIXTURE_DATASET env var, validation/dataset.json, or
the default spreadsheet files in backend/data/.

Run: python manage.py backfill_facts [--source api|spreadsheet|both] [--fixture path/to/dataset.json]"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from analytics.config import FIXTURE_DATASET, VALIDATION_DIR
from analytics.models import BillingLine, BatchUnitCost, Material, Customer, SyncRun
from analytics.persist import persist_api_dataset, persist_spreadsheet_dataset


class Command(BaseCommand):
    help = 'Backfill BillingLine and master data from the current dataset (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument('--source', choices=['api', 'spreadsheet', 'both'], default='both',
                            help='Which source to backfill (default: both).')
        parser.add_argument('--fixture', default=None, metavar='PATH',
                            help='Path to a dataset JSON file for the API source.')

    def handle(self, *args, **opts):
        src = opts['source']
        if src in ('api', 'both'):
            self._backfill_api(opts.get('fixture'))
        if src in ('spreadsheet', 'both'):
            self._backfill_spreadsheet()

    # ------------------------------------------------------------------------------------------------------------------

    def _backfill_api(self, fixture_override):
        data, src_path = self._find_api_data(fixture_override)
        if data is None:
            self.stdout.write(self.style.WARNING(
                'No API dataset found. Options:\n'
                '  • Run a live SAP refresh first (sets validation/dataset.json)\n'
                '  • Pass --fixture path/to/dataset.json\n'
                '  • Set AIF_FIXTURE_DATASET in your .env\n'
                'Skipping API backfill.'
            ))
            return

        lines = data.get('lines', [])
        frozen = data.get('frozen', [])
        self.stdout.write(f'API source: {src_path}')
        self.stdout.write(f'  {len(lines)} lines, {len(frozen)} batch cost entries')

        run = SyncRun.objects.create(source='api', status='RUNNING')
        try:
            before_lines = BillingLine.objects.filter(source='api').count()
            before_buc = BatchUnitCost.objects.count()

            counts = persist_api_dataset(data, sync_run=run)

            after_lines = BillingLine.objects.filter(source='api').count()
            after_buc = BatchUnitCost.objects.count()
            run.status = 'DONE'
            run.rows_upserted = after_lines
            run.finished_at = timezone.now()
            run.save(update_fields=['status', 'rows_upserted', 'finished_at'])
        except Exception as e:
            run.status = 'FAILED'
            run.error_message = str(e)
            run.finished_at = timezone.now()
            run.save(update_fields=['status', 'error_message', 'finished_at'])
            raise

        self._report('API', {
            'BillingLine (api)': (before_lines, after_lines),
            'BatchUnitCost': (before_buc, after_buc),
            'Material': (None, counts['materials']),
            'Customer': (None, counts['customers']),
        })

        # Idempotency
        counts2 = persist_api_dataset(data, sync_run=run)
        after2 = BillingLine.objects.filter(source='api').count()
        if after_lines == after2:
            self.stdout.write('Idempotency check: row count unchanged on second run. ✓')
        else:
            self.stderr.write(self.style.ERROR(f'FAIL: BillingLine count changed on second run ({after_lines} → {after2}).'))

    def _backfill_spreadsheet(self):
        from analytics.pipeline.spreadsheet import build_from_files
        from analytics.state import DEFAULT_SPREADSHEETS
        import os

        from analytics.config import BASE_DIR
        found = {}
        for name in DEFAULT_SPREADSHEETS:
            for d in (os.environ.get('AIF_SPREADSHEET_DIR'), BASE_DIR / 'data'):
                if d and (Path(d) / name).exists():
                    found[name] = str(Path(d) / name)
                    break

        if not found:
            self.stdout.write(self.style.WARNING(
                'No default spreadsheet files found in AIF_SPREADSHEET_DIR or backend/data/. '
                'Skipping spreadsheet backfill.'
            ))
            return

        li_path = next((p for n, p in found.items() if 'Line' in n), None)
        sv_path = next((p for n, p in found.items() if '2CCSDREVNFRMINVCQ' in n or 'sales' in n.lower()), None)

        self.stdout.write(f'Spreadsheet source: {list(found.keys())}')
        try:
            data = build_from_files(li_path, sv_path)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'Failed to parse spreadsheet files: {e}'))
            return

        lines = data.get('lines', [])
        self.stdout.write(f'  {len(lines)} lines parsed')

        before = BillingLine.objects.filter(source='spreadsheet').count()
        counts = persist_spreadsheet_dataset(data)
        after = BillingLine.objects.filter(source='spreadsheet').count()

        self._report('Spreadsheet', {
            'BillingLine (spreadsheet)': (before, after),
            'Material': (None, counts['materials']),
            'Customer': (None, counts['customers']),
        })

        # Idempotency
        persist_spreadsheet_dataset(data)
        after2 = BillingLine.objects.filter(source='spreadsheet').count()
        if after == after2:
            self.stdout.write('Idempotency check: row count unchanged on second run. ✓')
        else:
            self.stderr.write(self.style.ERROR(f'FAIL: BillingLine count changed on second run ({after} → {after2}).'))

    # ------------------------------------------------------------------------------------------------------------------

    def _find_api_data(self, fixture_override):
        for path in filter(None, [
            fixture_override,
            str(FIXTURE_DATASET) if FIXTURE_DATASET else None,
            str(VALIDATION_DIR / 'dataset.json'),
        ]):
            p = Path(path)
            if p.exists():
                try:
                    return json.loads(p.read_text(encoding='utf-8')), str(p)
                except Exception as e:
                    self.stderr.write(f'Could not read {path}: {e}')
        return None, None

    def _report(self, label, table_counts):
        self.stdout.write(self.style.SUCCESS(f'\n{label} backfill complete:'))
        for table, (before, after) in table_counts.items():
            if before is None:
                self.stdout.write(f'  {table}: {after} total')
            else:
                self.stdout.write(f'  {table}: {before} → {after} (new: {after - before})')
        self.stdout.write('')
