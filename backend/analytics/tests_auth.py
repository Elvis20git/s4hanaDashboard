"""Authentication, authorisation and user-administration tests (run: python backend/manage.py test analytics)."""
import json
import os
import tempfile
from datetime import timedelta
from unittest import mock

os.environ.setdefault('AIF_NO_WARMUP', '1')

from django.core import mail  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.test import Client, TestCase, override_settings  # noqa: E402
from django.utils import timezone  # noqa: E402

from .auth import ratelimit, security  # noqa: E402
from .auth.permissions import DASHBOARD_KEYS  # noqa: E402
from .models import PasswordResetToken, User  # noqa: E402
from .state import state  # noqa: E402
from .tests import _line  # noqa: E402

PW = 'Str0ng!Passw0rd'
H = {'HTTP_X_AIF_CLIENT': 'web'}


def make(username, role='ANALYST', dashboards=('sales',), steward=False, status='ACTIVE', password=PW, must_change=False):
    return User.objects.create(
        username=username, email=f'{username}@example.com', password_hash=security.hash_password(password), display_name=username.title(),
        role=role, is_data_steward=steward, allowed_dashboards=list(dashboards), status=status, must_change_password=must_change)


def login(username=None, password=PW, remember=False, client=None):
    c = client or Client(**H)
    r = c.post('/api/auth/login', json.dumps({'username_or_email': username, 'password': password, 'remember': remember}), content_type='application/json')
    return c, r


def post(c, path, body=None):
    return c.post(path, json.dumps(body or {}), content_type='application/json')


def put(c, path, body):
    return c.put(path, json.dumps(body), content_type='application/json')


@override_settings(JWT_SECRET='test-jwt-secret-0123456789abcdef0123456789abcdef', DEBUG=True)   # the runner forces DEBUG off; tests need dev behaviour
class Base(TestCase):
    def setUp(self):
        ratelimit.reset_all()
        state['api']['data'] = {'source': 'api', 'asOf': '2026-03-31', 'from': '2026-01-01', 'builtAt': 'x', 'controls': None, 'frozen': [], 'orderCost': {},
                                'lines': [_line('1', '01.2026', '11000001', 'C1', 1000.0, 1000, 700.0)]}
        state['api']['error'] = None


class AccessControl(Base):
    def test_analyst_with_only_sales_sees_sales_and_gets_403_everywhere_else(self):
        make('ann')
        c, r = login('ann')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['user']['allowed_dashboards'], ['sales'])
        for path in ('/api/data?source=api', '/api/lines?source=api', '/api/status'):
            self.assertEqual(c.get(path).status_code, 200, path)
        self.assertEqual(post(c, '/api/chat', {'message': 'revenue'}).status_code, 200)
        for path in ('/api/validation?source=api', '/api/load-history', '/api/connection-test', '/api/export/validation.csv', '/api/admin/users'):
            r = c.get(path)
            self.assertEqual(r.status_code, 403, path)
        self.assertEqual(c.get('/api/validation?source=api').json()['message'], 'You do not have access to this dashboard.')
        self.assertEqual(post(c, '/api/refresh').status_code, 403)
        self.assertEqual(post(c, '/api/spreadsheet/load', {'files': []}).status_code, 403)

    def test_shared_status_endpoint_is_trimmed_for_users_without_data_management(self):
        make('ann')
        c, _ = login('ann')
        s = c.get('/api/status').json()
        self.assertEqual(s['cache'], {})
        self.assertIsNone(s['sapCalls'])
        self.assertEqual(set(s['connection']), {'ok'})
        self.assertEqual(s['sources']['api']['log'], [])

    def test_chat_withholds_validation_answers_without_data_management(self):
        make('ann')
        c, _ = login('ann')
        r = post(c, '/api/chat', {'message': 'any closure breaches?'}).json()
        self.assertIn("doesn't have access", r['reply'])

    def test_user_without_sales_cannot_read_sales_data(self):
        make('dee', dashboards=('inventory',))
        c, _ = login('dee')
        for path in ('/api/data?source=api', '/api/lines?source=api', '/api/batch/X', '/api/order/X'):
            self.assertEqual(c.get(path).status_code, 403, path)
        self.assertEqual(post(c, '/api/chat', {'message': 'hi'}).status_code, 403)

    def test_viewer_cannot_export_and_non_steward_cannot_modify(self):
        make('vic', role='VIEWER', dashboards=('sales', 'data_management'))
        c, _ = login('vic')
        self.assertEqual(c.get('/api/validation?source=api').status_code, 200)
        self.assertEqual(c.get('/api/export/validation.csv').status_code, 403)
        self.assertEqual(post(c, '/api/refresh').status_code, 403)
        make('stu', dashboards=('sales', 'data_management'), steward=True)
        c2, _ = login('stu')
        with mock.patch('analytics.views.refresh_api', return_value={'error': None, 'lastRefresh': 'x', 'log': []}):
            self.assertEqual(post(c2, '/api/refresh').status_code, 200)
        make('nina', dashboards=('sales', 'data_management'))
        c3, _ = login('nina')
        self.assertEqual(post(c3, '/api/refresh').status_code, 403)       # access to the dashboard alone is not enough
        make('sam', dashboards=('sales',), steward=True)
        c4, _ = login('sam')
        self.assertEqual(post(c4, '/api/refresh').status_code, 403)       # a steward still needs the dashboard

    def test_non_superuser_gets_403_on_all_admin_routes(self):
        a = make('ann')
        c, _ = login('ann')
        for method, path in (('get', '/api/admin/users'), ('post', '/api/admin/users'), ('put', f'/api/admin/users/{a.id}'),
                             ('delete', f'/api/admin/users/{a.id}'), ('post', f'/api/admin/users/{a.id}/activate'),
                             ('post', f'/api/admin/users/{a.id}/reset-password')):
            r = getattr(c, method)(path, '{}', content_type='application/json') if method != 'get' else c.get(path)
            self.assertEqual(r.status_code, 403, (method, path))

    def test_unauthenticated_requests_get_401(self):
        c = Client(**H)
        for path in ('/api/data', '/api/status', '/api/auth/me', '/api/admin/users', '/api/load-history'):
            self.assertEqual(c.get(path).status_code, 401, path)

    def test_superuser_reaches_every_data_endpoint(self):
        make('root', role='SUPERUSER', dashboards=(), steward=False)
        c, r = login('root')
        self.assertEqual(r.json()['user']['allowed_dashboards'], DASHBOARD_KEYS)
        for path in ('/api/data?source=api', '/api/lines?source=api', '/api/validation?source=api', '/api/load-history', '/api/status', '/api/admin/users'):
            self.assertEqual(c.get(path).status_code, 200, path)
        self.assertEqual(c.get('/api/status').json()['sources']['api']['log'], [])      # real log is empty in the test, but not trimmed

    def test_revoking_a_dashboard_or_deactivating_applies_on_the_next_request(self):
        u = make('ann', dashboards=('sales', 'tax'))
        c, _ = login('ann')
        self.assertEqual(c.get('/api/data?source=api').status_code, 200)
        u.allowed_dashboards = ['tax']
        u.save()
        self.assertEqual(c.get('/api/data?source=api').status_code, 403)
        u.status = 'INACTIVE'
        u.save()
        self.assertEqual(c.get('/api/status').status_code, 401)

    def test_security_headers_and_state_changing_requests_need_the_client_header(self):
        make('ann')
        c, r = login('ann')
        self.assertEqual(r['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(r['Cache-Control'], 'no-store')
        self.assertEqual(r['X-Frame-Options'], 'DENY')
        self.assertEqual(Client().post('/api/auth/login', '{}', content_type='application/json').status_code, 403)
        cookie = r.cookies['aif_session']
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Strict')

    def test_disallowed_origin_is_rejected_for_state_changing_requests(self):
        r = Client(**H).post('/api/auth/login', '{}', content_type='application/json', HTTP_ORIGIN='https://evil.example')
        self.assertEqual(r.status_code, 403)


class LoginFlow(Base):
    def test_case_insensitive_username_or_email_and_generic_401(self):
        make('Ann')
        self.assertEqual(login('ANN')[1].status_code, 200)
        self.assertEqual(login('ann@EXAMPLE.com')[1].status_code, 200)
        for who, pw in (('ann', 'wrong'), ('nobody', PW)):
            r = login(who, pw)[1]
            self.assertEqual((r.status_code, r.json()), (401, {'success': False, 'message': 'Invalid username or password'}))
        make('gone', status='INACTIVE')
        r = login('gone')[1]
        self.assertEqual((r.status_code, r.json()['message']), (401, 'Invalid username or password'))

    def test_login_updates_last_login_and_me_returns_the_same_shape(self):
        make('ann')
        c, r = login('ann')
        self.assertIsNotNone(User.objects.get(username='ann').last_login)
        me = c.get('/api/auth/me').json()['user']
        self.assertEqual(me, r.json()['user'])
        self.assertNotIn('password_hash', json.dumps(me))

    def test_rate_limit_after_five_failures(self):
        make('ann')
        for _ in range(5):
            self.assertEqual(login('ann', 'bad')[1].status_code, 401)
        self.assertEqual(login('ann')[1].status_code, 429)        # even the right password is refused while limited

    def test_remember_device_issues_a_longer_lived_cookie(self):
        make('ann')
        short = login('ann')[1].cookies['aif_session']
        long = login('ann', remember=True)[1].cookies['aif_session']
        self.assertEqual(short['max-age'], '')                    # session cookie
        self.assertEqual(int(long['max-age']), 7 * 86400)

    def test_logout_clears_the_session_cookie(self):
        make('ann')
        c, _ = login('ann')
        r = post(c, '/api/auth/logout')
        self.assertEqual(r.cookies['aif_session'].value, '')

    def test_a_token_issued_before_a_password_change_is_rejected(self):
        u = make('ann')
        c, _ = login('ann')
        old = c.cookies['aif_session'].value
        post(c, '/api/auth/change-password', {'current_password': PW, 'new_password': 'N3w!Passw0rd'})
        r = Client(**H, HTTP_AUTHORIZATION='Bearer ' + old).get('/api/status')
        self.assertEqual(r.status_code, 401)
        self.assertEqual(c.get('/api/status').status_code, 200)      # the fresh cookie issued by the change works
        self.assertTrue(security.verify_password('N3w!Passw0rd', User.objects.get(id=u.id).password_hash))


class ForcedPasswordChange(Base):
    def test_forced_change_blocks_every_endpoint_until_the_password_is_changed(self):
        make('ann', role='SUPERUSER', dashboards=(), must_change=True, password='123')
        c, r = login('ann', '123')
        self.assertTrue(r.json()['must_change_password'])
        for path in ('/api/data?source=api', '/api/status', '/api/admin/users', '/api/validation'):
            g = c.get(path)
            self.assertEqual((g.status_code, g.json()['code']), (403, 'PASSWORD_CHANGE_REQUIRED'), path)
        self.assertEqual(c.get('/api/auth/me').status_code, 200)
        weak = post(c, '/api/auth/change-password', {'current_password': '123', 'new_password': 'weak'})
        self.assertEqual(weak.status_code, 400)
        same = post(c, '/api/auth/change-password', {'current_password': '123', 'new_password': '123'})
        self.assertEqual(same.status_code, 400)
        wrong = post(c, '/api/auth/change-password', {'current_password': 'nope', 'new_password': PW})
        self.assertEqual(wrong.status_code, 400)
        ok = post(c, '/api/auth/change-password', {'current_password': '123', 'new_password': PW})
        self.assertEqual(ok.status_code, 200)
        self.assertFalse(User.objects.get(username='ann').must_change_password)
        self.assertEqual(c.get('/api/data?source=api').status_code, 200)
        self.assertEqual(c.get('/api/admin/users').status_code, 200)

    def test_new_password_must_meet_the_policy(self):
        for bad in ('short1!', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoDigits!!', 'NoSpecial123'):
            self.assertTrue(security.password_problems(bad), bad)
        self.assertEqual(security.password_problems(PW), [])


class PasswordReset(Base):
    def _forgot(self, ident):
        return post(Client(**H), '/api/auth/forgot-password', {'identifier': ident})

    def test_forgot_password_answers_identically_for_existing_and_unknown_accounts(self):
        make('ann')
        a, b, c = self._forgot('ann'), self._forgot('ann@example.com'), self._forgot('nobody@example.com')
        for r in (a, b, c):
            self.assertEqual((r.status_code, r.json()), (200, {'success': True, 'message': 'If an account exists, reset instructions have been sent.'}))
        self.assertEqual(len(mail.outbox), 2)                    # only the real account got mail
        ratelimit.reset_all()
        make('gone', status='INACTIVE')
        self.assertEqual(self._forgot('gone').json()['success'], True)
        self.assertEqual(len(mail.outbox), 2)

    def test_forgot_password_is_rate_limited(self):
        make('ann')
        for _ in range(3):
            self.assertEqual(self._forgot('ann').status_code, 200)
        self.assertEqual(self._forgot('ann').status_code, 429)

    def test_token_and_code_are_stored_hashed_and_the_link_resets_once(self):
        u = make('ann')
        self._forgot('ann')
        body = mail.outbox[0].body
        token = body.split('token=')[1].split()[0]
        code = body.split('code on the reset page: ')[1].split()[0]
        rec = PasswordResetToken.objects.get(user=u)
        self.assertEqual(rec.token_hash, security.sha256(token))
        self.assertNotEqual(rec.token_hash, token)
        self.assertEqual(rec.code_hash, security.sha256(code))
        self.assertGreater(rec.expires_at - timezone.now(), timedelta(minutes=14))
        c = Client(**H)
        weak = post(c, '/api/auth/reset-password', {'token': token, 'new_password': 'weak'})
        self.assertEqual(weak.status_code, 400)
        ok = post(c, '/api/auth/reset-password', {'token': token, 'new_password': 'Res3t!Passw0rd'})
        self.assertEqual((ok.status_code, ok.json()['message']), (200, 'Password successfully updated.'))
        again = post(c, '/api/auth/reset-password', {'token': token, 'new_password': 'Res3t!Passw0rd2'})
        self.assertEqual((again.status_code, again.json()), (400, {'success': False, 'message': 'Invalid or expired token.'}))
        self.assertEqual(login('ann', 'Res3t!Passw0rd')[1].status_code, 200)

    def test_reset_clears_the_forced_change_flag_and_ends_old_sessions(self):
        u = make('ann', must_change=True)
        c, _ = login('ann')
        old = c.cookies['aif_session'].value
        self._forgot('ann')
        token = mail.outbox[0].body.split('token=')[1].split()[0]
        post(Client(**H), '/api/auth/reset-password', {'token': token, 'new_password': 'Res3t!Passw0rd'})
        self.assertFalse(User.objects.get(id=u.id).must_change_password)
        self.assertEqual(Client(**H, HTTP_AUTHORIZATION='Bearer ' + old).get('/api/auth/me').status_code, 401)

    def test_expired_token_is_refused(self):
        u = make('ann')
        self._forgot('ann')
        token = mail.outbox[0].body.split('token=')[1].split()[0]
        PasswordResetToken.objects.filter(user=u).update(expires_at=timezone.now() - timedelta(seconds=1))
        r = post(Client(**H), '/api/auth/reset-password', {'token': token, 'new_password': 'Res3t!Passw0rd'})
        self.assertEqual(r.status_code, 400)

    def test_code_flow_allows_five_wrong_attempts_then_invalidates(self):
        make('ann')
        self._forgot('ann')
        code = mail.outbox[0].body.split('code on the reset page: ')[1].split()[0]
        wrong = '000000' if code != '000000' else '111111'
        c = Client(**H)
        for _ in range(5):
            self.assertEqual(post(c, '/api/auth/reset-password', {'identifier': 'ann', 'code': wrong, 'new_password': 'Res3t!Passw0rd'}).status_code, 400)
        r = post(c, '/api/auth/reset-password', {'identifier': 'ann', 'code': code, 'new_password': 'Res3t!Passw0rd'})
        self.assertEqual(r.status_code, 400)                                 # the right code no longer works: the token is dead

    def test_a_new_request_invalidates_the_earlier_token(self):
        make('ann')
        self._forgot('ann')
        first = mail.outbox[0].body.split('token=')[1].split()[0]
        self._forgot('ann@example.com')
        r = post(Client(**H), '/api/auth/reset-password', {'token': first, 'new_password': 'Res3t!Passw0rd'})
        self.assertEqual(r.status_code, 400)

    def test_code_flow_success(self):
        make('ann')
        self._forgot('ann')
        code = mail.outbox[0].body.split('code on the reset page: ')[1].split()[0]
        r = post(Client(**H), '/api/auth/reset-password', {'identifier': 'ann@example.com', 'code': code, 'new_password': 'Res3t!Passw0rd'})
        self.assertEqual(r.status_code, 200)


class AdminApi(Base):
    def setUp(self):
        super().setUp()
        self.root = make('root', role='SUPERUSER', dashboards=())
        self.c, _ = login('root')

    def create(self, **kw):
        body = {'username': 'newbie', 'password': PW, 'email': 'newbie@example.com', 'display_name': 'New B', 'role': 'ANALYST',
                'allowed_dashboards': ['sales', 'sales', 'tax']}
        body.update(kw)
        return post(self.c, '/api/admin/users', body)

    def test_list_summary_and_no_password_hash(self):
        make('ann')
        make('off', status='INACTIVE')
        d = self.c.get('/api/admin/users').json()
        self.assertEqual(d['summary'], {'total_members': 3, 'active_members': 2, 'total_dashboards': 7})
        self.assertNotIn('password_hash', json.dumps(d))

    def test_create_validates_and_dedupes(self):
        r = self.create()
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['user']['allowed_dashboards'], ['sales', 'tax'])
        self.assertEqual(self.create(username='NEWBIE', email='other@example.com').status_code, 409)
        self.assertEqual(self.create(username='x1', email='NEWBIE@example.com').json()['field'], 'email')
        self.assertEqual(self.create(username='x2', email='x2@example.com', password='weak').status_code, 400)
        self.assertEqual(self.create(username='x3', email='not-an-email').status_code, 400)
        self.assertEqual(self.create(username='x4', email='x4@example.com', allowed_dashboards=['admin']).status_code, 400)
        self.assertEqual(self.create(username='x5', email='x5@example.com', role='GOD').status_code, 400)
        self.assertEqual(self.create(username='', email='x6@example.com').status_code, 400)
        su = self.create(username='su', email='su@example.com', role='SUPERUSER', allowed_dashboards=[]).json()['user']
        self.assertEqual(su['allowed_dashboards'], DASHBOARD_KEYS)

    def test_edit_role_steward_dashboards_and_username_is_read_only(self):
        u = make('ann')
        r = put(self.c, f'/api/admin/users/{u.id}', {'username': 'hacker', 'role': 'VIEWER', 'is_data_steward': True, 'allowed_dashboards': ['tax']})
        self.assertEqual(r.status_code, 200)
        u.refresh_from_db()
        self.assertEqual((u.username, u.role, u.is_data_steward, u.allowed_dashboards), ('ann', 'VIEWER', True, ['tax']))

    def test_soft_delete_and_activate(self):
        u = make('ann')
        self.assertEqual(self.c.delete(f'/api/admin/users/{u.id}').status_code, 200)
        u.refresh_from_db()
        self.assertEqual(u.status, 'INACTIVE')
        self.assertTrue(User.objects.filter(id=u.id).exists())
        self.assertEqual(post(self.c, f'/api/admin/users/{u.id}/activate').status_code, 200)
        u.refresh_from_db()
        self.assertEqual(u.status, 'ACTIVE')

    def test_lockout_guards(self):
        me = self.root
        self.assertEqual(self.c.delete(f'/api/admin/users/{me.id}').status_code, 400)                      # self-deactivation
        self.assertEqual(put(self.c, f'/api/admin/users/{me.id}', {'role': 'ANALYST'}).status_code, 400)  # self-demotion
        other = make('boss2', role='SUPERUSER', dashboards=())
        # with two superusers, the other one can be demoted, but then root is the last one and cannot be touched via another superuser
        self.assertEqual(put(self.c, f'/api/admin/users/{other.id}', {'role': 'VIEWER'}).status_code, 200)
        make('last', role='SUPERUSER', dashboards=())
        c2, _ = login('last')
        # root is now one of two active superusers; 'last' deactivates root OK, then 'last' is the only one left
        self.assertEqual(c2.delete(f'/api/admin/users/{me.id}').status_code, 200)
        last = User.objects.get(username='last')
        self.assertEqual(c2.delete(f'/api/admin/users/{last.id}').status_code, 400)
        self.assertEqual(put(c2, f'/api/admin/users/{last.id}', {'role': 'ANALYST'}).status_code, 400)
        # a different superuser cannot remove the last active one either
        self.assertEqual(User.objects.filter(role='SUPERUSER', status='ACTIVE').count(), 1)

    def test_admin_triggered_reset_sends_mail_and_the_link_really_resets(self):
        u = make('ann')
        r = post(self.c, f'/api/admin/users/{u.id}/reset-password')
        d = r.json()
        self.assertEqual((r.status_code, d['delivered'], d['outcome']), (200, True, 'sent'))
        self.assertIn(u.email, d['message'])
        self.assertEqual(mail.outbox[-1].to, [u.email])
        token = mail.outbox[-1].body.split('token=')[1].split()[0]
        self.assertEqual(post(Client(**H), '/api/auth/reset-password', {'token': token, 'new_password': 'Res3t!Passw0rd'}).status_code, 200)
        self.assertEqual(login('ann', 'Res3t!Passw0rd')[1].status_code, 200)         # the emailed link led to a working new password
        self.assertEqual(login('ann', PW)[1].status_code, 401)
        off = make('off', status='INACTIVE')
        self.assertEqual(post(self.c, f'/api/admin/users/{off.id}/reset-password').status_code, 400)

    def test_reset_outcome_is_reported_honestly_when_nothing_was_emailed(self):
        import contextlib
        import io
        u = make('ann')
        with self.settings(EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend'), contextlib.redirect_stdout(io.StringIO()) as out:
            d = post(self.c, f'/api/admin/users/{u.id}/reset-password').json()
        self.assertEqual((d['success'], d['delivered'], d['outcome']), (True, False, 'console'))     # development: printed, not emailed
        self.assertIn('server console', d['message'])
        self.assertIn('/reset-password?token=', out.getvalue())
        with self.settings(EMAIL_BACKEND='django.core.mail.backends.dummy.EmailBackend'):
            r = post(self.c, f'/api/admin/users/{u.id}/reset-password')
        self.assertEqual((r.status_code, r.json()['outcome'], r.json()['delivered']), (502, 'none', False))
        self.assertIn('SMTP_HOST', r.json()['message'])
        with mock.patch('analytics.auth.mail.send_mail', side_effect=OSError('connection refused')):
            r = post(self.c, f'/api/admin/users/{u.id}/reset-password')
        self.assertEqual((r.status_code, r.json()['outcome']), (502, 'failed'))

    def test_unknown_user_is_404(self):
        self.assertEqual(self.c.delete('/api/admin/users/nope').status_code, 404)


class Seed(Base):
    def run_seed(self, rows):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump({'users': rows}, f)
        try:
            call_command('seed_users', '--file', f.name, stdout=mock.MagicMock())
        finally:
            os.unlink(f.name)

    ROWS = [
        {'username': 'derrick-a', 'password': '123', 'email': 'derrick.sano@africaimprovedfoods.com', 'display_name': 'Derrick S',
         'job_title': 'IT Director', 'department': 'IT', 'role': 'SUPERUSER', 'is_data_steward': True},
        {'username': 'eric-a', 'password': '123', 'email': 'eric.nkurunziza@africaimprovedfoods.com', 'display_name': 'Eric N',
         'job_title': 'ERP Lead', 'department': 'IT', 'role': 'SUPERUSER', 'is_data_steward': True},
        {'username': 'elvis2-a', 'password': '123', 'email': 'elvis.murengerantwari@africaimprovedfoods.com', 'display_name': 'Elvis M',
         'job_title': 'Senior Dev', 'department': 'Dev', 'role': 'SUPERUSER', 'is_data_steward': True},
    ]

    def test_seed_is_idempotent_updates_derrick_in_place_and_leaves_other_users_alone(self):
        old = make('Derrick-a', role='ADMIN' if False else 'ANALYST', dashboards=('ar_ap_aging', 'sales'), steward=True, password=PW)
        old.last_login = timezone.now()
        old.save()
        elvis = make('Elvis-a', role='SUPERUSER', dashboards=())
        before_elvis = (elvis.id, elvis.email, elvis.role, elvis.password_hash)
        self.run_seed(self.ROWS)
        self.run_seed(self.ROWS)
        for name in ('derrick-a', 'eric-a', 'elvis2-a'):
            self.assertEqual(User.objects.filter(username__iexact=name).count(), 1, name)
        d = User.objects.get(username__iexact='derrick-a')
        self.assertEqual((d.id, d.username, d.role, d.email, d.last_login is not None), (old.id, 'derrick-a', 'SUPERUSER', 'derrick.sano@africaimprovedfoods.com', True))
        e = User.objects.get(username='Elvis-a')
        self.assertEqual((e.id, e.email, e.role, e.password_hash), before_elvis)
        self.assertNotEqual(User.objects.get(username='elvis2-a').id, e.id)
        self.assertNotIn('123', User.objects.get(username='eric-a').password_hash)       # stored hashed

    def test_seeded_users_must_change_the_password_then_see_everything(self):
        self.run_seed(self.ROWS)
        for name in ('derrick-a', 'eric-a', 'elvis2-a'):
            c, r = login(name, '123')
            self.assertEqual(r.status_code, 200)
            self.assertTrue(r.json()['must_change_password'])
            self.assertEqual(c.get('/api/data?source=api').json()['code'], 'PASSWORD_CHANGE_REQUIRED')
            self.assertEqual(post(c, '/api/auth/change-password', {'current_password': '123', 'new_password': PW}).status_code, 200)
            self.assertEqual(c.get('/api/auth/me').json()['user']['allowed_dashboards'], DASHBOARD_KEYS)
            self.assertEqual(c.get('/api/data?source=api').status_code, 200)
            self.assertEqual(c.get('/api/admin/users').status_code, 200)

    def test_re_running_the_seed_keeps_a_password_the_user_already_changed(self):
        self.run_seed(self.ROWS)
        c, _ = login('eric-a', '123')
        post(c, '/api/auth/change-password', {'current_password': '123', 'new_password': PW})
        self.run_seed(self.ROWS)
        self.assertEqual(login('eric-a', PW)[1].status_code, 200)
        self.assertEqual(login('eric-a', '123')[1].status_code, 401)

    def test_weak_seed_passwords_are_refused_in_production_without_override(self):
        from django.core.management.base import CommandError
        with self.settings(DEBUG=False):
            with self.assertRaises(CommandError):
                self.run_seed(self.ROWS)
            with mock.patch.dict(os.environ, {'ALLOW_WEAK_SEED': 'true'}):
                self.run_seed(self.ROWS)
        self.assertTrue(User.objects.filter(username='eric-a').exists())

    def test_legacy_users_json_is_imported_without_demoting_anyone(self):
        call_command('seed_users', '--file', os.devnull if False else __file__ + '.none', stdout=mock.MagicMock())
        names = set(User.objects.values_list('username', flat=True))
        self.assertTrue({'Derrick-a', 'Elvis-a', 'viewer'} <= names)
        self.assertEqual(User.objects.get(username='viewer').role, 'VIEWER')
        self.assertEqual(User.objects.get(username='Elvis-a').role, 'SUPERUSER')
