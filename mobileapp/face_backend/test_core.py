import base64
import unittest
from core import Auth, AuthError

class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.auth = Auth(':memory:', lambda data: [1., 0.] if data == b'face-a' else [0., 1.])
        self.auth.provision('a@example.com', 'a-long-password', 'A')
        self.image = base64.b64encode(b'face-a').decode()

    def tearDown(self):
        self.auth.db.close()

    def test_enrollment_requires_password_session(self):
        with self.assertRaises(AuthError):
            self.auth.enroll('forged', self.image)
        with self.assertRaises(AuthError):
            self.auth.password_login('a@example.com', 'wrong')
        session = self.auth.password_login('a@example.com', 'a-long-password')
        self.auth.enroll(session['token'], self.image)
        result = self.auth.face_login(self.auth.challenge()['challenge'], self.image)
        self.assertEqual(self.auth.session(result['token'])['email'], 'a@example.com')

    def test_existing_enrollment_preserved_without_rescanning(self):
        session = self.auth.password_login('a@example.com', 'a-long-password')
        self.auth.enroll(session['token'], self.image)
        before = self.auth.db.execute('SELECT * FROM accounts').fetchall()
        self.auth.embed = lambda _: self.fail('Must not scan existing enrollment')
        with self.assertRaises(AuthError) as caught:
            self.auth.enroll(session['token'], self.image)
        self.assertEqual(caught.exception.code, 'already_enrolled')
        self.assertTrue(self.auth.enrollment_status(session['token'])['enrolled'])
        with self.assertRaises(AuthError):
            self.auth.enrollment_status('forged')
        self.auth.embed = lambda _: [1., 0.]
        result = self.auth.face_login(self.auth.challenge()['challenge'], self.image)
        self.assertEqual(self.auth.session(result['token']), session['user'])
        self.assertEqual(self.auth.db.execute('SELECT * FROM accounts').fetchall(), before)

    def test_attempt_is_single_use_even_after_failure(self):
        session = self.auth.password_login('a@example.com', 'a-long-password')
        self.auth.enroll(session['token'], self.image)
        challenge = self.auth.challenge()['challenge']
        with self.assertRaises(AuthError):
            self.auth.face_login(challenge, base64.b64encode(b'other').decode())
        with self.assertRaises(AuthError):
            self.auth.face_login(challenge, self.image)

    def test_deletion_revokes_sessions_and_matching(self):
        session = self.auth.password_login('a@example.com', 'a-long-password')
        self.auth.enroll(session['token'], self.image)
        self.auth.delete_face(session['token'])
        with self.assertRaises(AuthError):
            self.auth.session(session['token'])
        with self.assertRaises(AuthError):
            self.auth.face_login(self.auth.challenge()['challenge'], self.image)

    def test_spoof_rejection_never_issues_session(self):
        def reject(_):
            raise AuthError('spoof')
        self.auth.embed = reject
        with self.assertRaises(AuthError):
            self.auth.face_login(self.auth.challenge()['challenge'], self.image)
        self.assertEqual(self.auth.db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0], 0)

    def test_ambiguous_matches_and_expired_sessions(self):
        import json
        session=self.auth.password_login('a@example.com','a-long-password')
        self.auth.enroll(session['token'],self.image)
        self.auth.provision('b@example.com','b-long-password','B')
        # Simulate a legacy/corrupt index with two matching templates.
        self.auth.db.execute('UPDATE accounts SET template=? WHERE email=?',(json.dumps([1.,0.]),'b@example.com'))
        with self.assertRaises(AuthError):
            self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.auth.db.execute('UPDATE sessions SET expires=0')
        with self.assertRaises(AuthError): self.auth.session(session['token'])

    def test_expired_attempt_and_ambiguous_identity(self):
        challenge = self.auth.challenge()['challenge']
        self.auth.db.execute('UPDATE challenges SET expires=0')
        with self.assertRaises(AuthError):
            self.auth.face_login(challenge, self.image)
        session = self.auth.password_login('a@example.com', 'a-long-password')
        self.auth.enroll(session['token'], self.image)
        self.auth.provision('b@example.com', 'b-long-password', 'B')
        other = self.auth.password_login('b@example.com', 'b-long-password')
        with self.assertRaises(AuthError):
            self.auth.enroll(other['token'], self.image)

if __name__ == '__main__':
    unittest.main()
