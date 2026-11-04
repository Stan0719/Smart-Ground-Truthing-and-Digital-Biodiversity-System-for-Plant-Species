"""Synthetic-only regression tests. No original module imports or service access."""
import ast
import hashlib
import itertools
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BASELINE = json.loads((HERE / 'baseline.json').read_text())
ORIGINAL = ROOT / BASELINE['source']


class AuthError(Exception):
    def __init__(self, message, status=401, code='unauthorized'):
        super().__init__(message)
        self.status, self.code = status, code


PIPELINE = {'model': 'synthetic-only', 'version': 2}
def row(user, compatible=True):
    return (user, '[1.0, 0.0]', json.dumps(PIPELINE if compatible else {'version': 1}))


class Database:
    def __init__(self, rows=(), legacy=()):
        self.rows, self.legacy = list(rows), list(legacy)
        self.calls = []

    def execute(self, sql, values=()):
        self.calls.append(sql)
        if not sql.startswith('SELECT '):
            raise AssertionError('Only synthetic SELECTs permitted')
        if 'FROM real_face_templates' in sql:
            return iter(self.rows)
        if 'FROM face_account_links' in sql:
            return iter(self.legacy)
        if 'FROM accounts' in sql:
            return iter([])
        raise AssertionError('Unexpected SQL')


def load_class(path):
    # Execute ONLY the inspected class definition. Never import its dependencies,
    # initialize its database, read configuration, or construct model objects.
    tree = ast.parse(path.read_text(encoding='utf-8'))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'AuthoritativeFaceAuth')
    ns = {'json': json, 'AuthError': AuthError, 'MATCH_THRESHOLD': 0.5,
          'distance': lambda a, b: sum((x-y)**2 for x, y in zip(a, b))}
    exec(compile(ast.Module(body=[cls], type_ignores=[]), str(path), 'exec'), ns)
    return ns['AuthoritativeFaceAuth'], cls


Proposed, PROPOSED_AST = load_class(HERE / 'authoritative_auth.proposed.py')
Original, ORIGINAL_AST = load_class(ORIGINAL)


def fixture(rows=(), legacy=(), cls=Proposed):
    obj = object.__new__(cls)
    obj.pipeline, obj.db = PIPELINE, Database(rows, legacy)
    obj.authority = Mock()
    obj.authority.session.return_value = {'id': 'owner', 'email': 'owner@example.invalid'}
    obj.prototype = Mock()
    obj.prototype.image.return_value = [1., 0.]
    return obj


class Regression(unittest.TestCase):
    def assert_incompatible(self, operation):
        with self.assertRaises(AuthError) as caught:
            operation()
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'template_incompatible'))

    def test_A_compatible_owner(self):
        self.assertTrue(fixture([row('owner')]).enrollment_status('token')['enrolled'])

    def test_B_unrelated_incompatible_owner_absent(self):
        self.assertFalse(fixture([row('other', False)]).enrollment_status('token')['enrolled'])

    def test_B_unrelated_incompatible_owner_present(self):
        self.assertTrue(fixture([row('other', False), row('owner')]).enrollment_status('token')['enrolled'])

    def test_C_incompatible_owner(self):
        self.assert_incompatible(lambda: fixture([row('owner', False)]).enrollment_status('token'))

    def test_D_order_independent(self):
        for owner_compatible in (True, False):
            for rows in itertools.permutations([row('owner', owner_compatible), row('other', False), row('third')]):
                with self.subTest(compatible=owner_compatible, order=[r[0] for r in rows]):
                    subject = fixture(rows)
                    if owner_compatible:
                        self.assertTrue(subject.enrollment_status('token')['enrolled'])
                    else:
                        self.assert_incompatible(lambda: subject.enrollment_status('token'))

    def test_E_compatible_status_contract_unchanged(self):
        for rows in ([], [row('owner')], [row('other')]):
            self.assertEqual(fixture(rows).enrollment_status('token'), fixture(rows, cls=Original).enrollment_status('token'))

    def test_E_compatible_matching_candidates_unchanged(self):
        rows = [row('owner'), row('other')]
        self.assertEqual(list(fixture(rows)._templates()), list(fixture(rows, cls=Original)._templates()))

    def test_F_original_reproduction_and_proposed_resolution(self):
        rows = [row('other', False), row('owner')]
        self.assert_incompatible(lambda: fixture(rows, cls=Original).enrollment_status('token'))
        self.assertTrue(fixture(rows).enrollment_status('token')['enrolled'])

    def test_G_authorization_failure_precedes_database(self):
        subject = fixture([row('owner')])
        subject.authority.session.side_effect = AuthError('Denied', 403, 'forbidden')
        with self.assertRaises(AuthError) as caught:
            subject.enrollment_status('invalid')
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(subject.db.calls, [])

    def test_G_unscoped_checks_remain_strict_in_all_orders(self):
        for rows in itertools.permutations([row('owner'), row('other', False)]):
            self.assert_incompatible(lambda: list(fixture(rows)._templates()))

    def test_G_new_enrollment_still_rejects_incompatible_other(self):
        subject = fixture([row('other', False)])
        self.assert_incompatible(lambda: subject.enroll('token', 'synthetic-photo-placeholder'))
        self.assertTrue(all(sql.startswith('SELECT ') for sql in subject.db.calls))

    def test_G_existing_enrollment_not_replaced(self):
        subject = fixture([row('owner')])
        with self.assertRaises(AuthError) as caught:
            subject.enroll('token', 'synthetic-photo-placeholder')
        self.assertEqual(caught.exception.code, 'already_enrolled')
        subject.prototype.image.assert_not_called()

    def test_G_legacy_owner_scope_preserved(self):
        self.assertTrue(fixture(legacy=[('owner', '[1,0]')]).enrollment_status('token')['enrolled'])
        self.assertFalse(fixture(legacy=[('other', '[1,0]')]).enrollment_status('token')['enrolled'])

    def test_G_security_methods_structurally_unchanged(self):
        old = {n.name: ast.dump(n) for n in ORIGINAL_AST.body if isinstance(n, ast.FunctionDef)}
        new = {n.name: ast.dump(n) for n in PROPOSED_AST.body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(old.keys(), new.keys())
        self.assertEqual({k for k in old if old[k] != new[k]}, {'_templates', 'enrollment_status'})
        # Includes face_login, enroll, session, recovery and delete_face.

    def test_H_original_bytes_unchanged(self):
        self.assertEqual(hashlib.sha256(ORIGINAL.read_bytes()).hexdigest(), BASELINE['sha256'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
