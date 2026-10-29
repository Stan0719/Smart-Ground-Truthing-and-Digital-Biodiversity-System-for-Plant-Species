"""Pure mocks only: no persistence, network or biometric models."""
import unittest
from account_service import AccountService, mobile_user
from core import AuthError

class TemporaryPasswordContract(unittest.TestCase):
    def setUp(self):
        self.user = dict(id='dummy', name='Dummy Botanist', email='dummy@example.invalid', role='Botanist', status='Active', mustChangePassword=True)
        self.service = object.__new__(AccountService)
        self.service.request = lambda operation, body: dict(token='a'*64, user=self.user)

    def test_password_accepts_temporary_but_normal_session_rejects_it(self):
        self.assertTrue(self.service.password_login('dummy@example.invalid', 'dummy temporary password')['user']['mustChangePassword'])
        with self.assertRaises(AuthError): self.service.session('a'*64)
        with self.assertRaises(AuthError): self.service.issue('dummy')

    def test_permanent_session_and_face_issue_are_preserved(self):
        self.user['mustChangePassword'] = False
        self.assertEqual(self.service.session('a'*64)['role'], 'botanist')
        self.assertEqual(self.service.issue('dummy')['token'], 'a'*64)

    def test_disabled_and_wrong_roles_remain_rejected(self):
        self.user['status'] = 'Inactive'
        with self.assertRaises(AuthError): self.service.password_login('dummy@example.invalid', 'dummy')
        self.user.update(status='Active', role='Administrator')
        with self.assertRaises(AuthError): mobile_user(self.user, allow_temporary=True)

if __name__ == '__main__': unittest.main()
