"""Load frozen batch unit costs from cache/batch-unit-cost.json into PostgreSQL (idempotent).
Run: python manage.py backfill_cache"""
import json

from django.core.management.base import BaseCommand

from analytics.config import CACHE_DIR
from analytics.cost.rules import RULE_VERSION
from analytics.models import BatchUnitCost
from analytics.persist import upsert_batch_unit_costs


class Command(BaseCommand):
    help = 'Backfill BatchUnitCost table from cache/batch-unit-cost.json (idempotent).'

    def handle(self, *args, **opts):
        cache_file = CACHE_DIR / 'batch-unit-cost.json'
        if not cache_file.exists():
            self.stdout.write(self.style.WARNING('cache/batch-unit-cost.json not found — nothing to backfill.'))
            return

        store = json.loads(cache_file.read_text(encoding='utf-8'))
        cached_version = store.get('ruleVersion', '')
        if cached_version != RULE_VERSION:
            self.stdout.write(self.style.WARNING(
                f'Cache rule version mismatch:\n  cache:   {cached_version}\n  current: {RULE_VERSION}\n'
                'These entries were computed under different cost rules and will not be loaded.'
            ))
            return

        entries = store.get('entries', {})
        if not entries:
            self.stdout.write('No entries in cache — nothing to backfill.')
            return

        self.stdout.write(f'Cache has {len(entries)} entries ({sum(1 for v in entries.values() if v.get("final"))} final).')

        frozen_list = [{'batch': k, **v} for k, v in entries.items()]
        before = BatchUnitCost.objects.count()
        upsert_batch_unit_costs(frozen_list)
        after = BatchUnitCost.objects.count()

        self.stdout.write(self.style.SUCCESS(
            f'Run 1: {before} → {after} rows ({after - before} new, {len(frozen_list) - (after - before)} updated).'
        ))

        # Idempotency: second run must not change the count
        before2 = BatchUnitCost.objects.count()
        upsert_batch_unit_costs(frozen_list)
        after2 = BatchUnitCost.objects.count()
        if before2 == after2:
            self.stdout.write('Idempotency check: row count unchanged on second run. ✓')
        else:
            self.stderr.write(self.style.ERROR(f'FAIL: count changed on second run ({before2} → {after2}).'))

        final = BatchUnitCost.objects.filter(is_final=True).count()
        prov = BatchUnitCost.objects.filter(is_final=False).count()
        self.stdout.write(f'\nReconciliation — BatchUnitCost: {BatchUnitCost.objects.count()} total ({final} final, {prov} provisional)')
