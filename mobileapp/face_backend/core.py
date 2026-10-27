"""Local prototype authentication. Facial templates remain on this computer."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time


MATCH_THRESHOLD = 0.30


class AuthError(Exception):
    def __init__(self, message, status=401, code='verification_rejected'):
        super().__init__(message)
        self.status = status
        self.code = code


class Auth:
    def __init__(self, filename, embed):
        self.db = sqlite3.connect(filename)
        if str(filename) != ":memory:":
            os.chmod(filename, 0o600)
        self.embed = embed
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS accounts(email TEXT PRIMARY KEY,name TEXT,role TEXT,salt TEXT,password TEXT,template TEXT);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,email TEXT,expires REAL);
        CREATE TABLE IF NOT EXISTS challenges(token TEXT PRIMARY KEY,expires REAL);
        ''')

    def provision(self, email, password, name, role='botanist'):
        if role not in ('botanist', 'visitor') or len(password) < 12:
            raise AuthError('Use a valid role and password with at least 12 characters.')
        salt = secrets.token_hex(16)
        encoded = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
        self.db.execute('INSERT INTO accounts VALUES(?,?,?,?,?,NULL)',
                        (email.strip().lower(), name, role, salt, encoded))
        self.db.commit()

    def user(self, email):
        row = self.db.execute('SELECT email,name,role FROM accounts WHERE email=?', (email,)).fetchone()
        if not row:
            raise AuthError('Account unavailable.')
        return dict(id=row[0], email=row[0], name=row[1], role=row[2])

    def issue(self, email):
        token = secrets.token_hex(32)
        self.db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), email, time.time()+28800))
        self.db.commit()
        return dict(token=token, user=self.user(email))

    def session(self, token):
        row = self.db.execute('SELECT email FROM sessions WHERE token=? AND expires>?',
                              (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        if not row:
            raise AuthError('Please sign in with your password again.')
        return self.user(row[0])

    def password_login(self, email, password):
        row = self.db.execute('SELECT email,salt,password FROM accounts WHERE email=?', (email.strip().lower(),)).fetchone()
        salt = row[1] if row else 'dummy-salt'
        encoded = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()
        if not row or not hmac.compare_digest(encoded, row[2]):
            raise AuthError('Invalid email or password.')
        return self.issue(row[0])

    def image(self, value):
        if not isinstance(value, str) or len(value) > 2800000:
            raise AuthError('Image is missing or too large.', 422, 'invalid_image')
        try:
            data = base64.b64decode(value, validate=True)
        except ValueError:
            raise AuthError('Invalid image.', 422, 'invalid_image') from None
        if not data or len(data) > 2000000:
            raise AuthError('Invalid image size.', 422, 'invalid_image')
        from image_pipeline import diagnostic
        diagnostic("image_payload", encodedCharacters=len(value), decodedBytes=len(data))
        return self.embed(data)

    def enrollment_status(self, token):
        user = self.session(token)
        stored = self.db.execute('SELECT template FROM accounts WHERE email=?', (user['email'],)).fetchone()[0]
        return dict(user=user, enrolled=stored is not None)

    def enroll(self, token, image):
        user = self.session(token)
        if self.db.execute('SELECT template FROM accounts WHERE email=?', (user['email'],)).fetchone()[0]:
            raise AuthError('Your face is already registered. You can now use Face Login.', 409, 'already_enrolled')
        embedding = self.image(image)
        # Avoid ambiguity between different accounts.
        for (stored,) in self.db.execute('SELECT template FROM accounts WHERE template IS NOT NULL'):
            if distance(embedding, json.loads(stored)) < MATCH_THRESHOLD:
                raise AuthError('This face is already registered to another account.', 409, 'duplicate_face')
        self.db.execute('UPDATE accounts SET template=? WHERE email=?', (json.dumps(embedding), user['email']))
        self.db.commit()
        return dict(user=user, enrolled=True)

    def challenge(self):
        self.db.execute('DELETE FROM challenges WHERE expires<?', (time.time(),))
        token = secrets.token_hex(32)
        self.db.execute('INSERT INTO challenges VALUES(?,?)', (hashlib.sha256(token.encode()).hexdigest(), time.time()+120))
        self.db.commit()
        return dict(challenge=token)

    def face_login(self, challenge, image):
        from image_pipeline import diagnostic
        diagnostic("face_login_received")
        key = hashlib.sha256(challenge.encode()).hexdigest()
        row = self.db.execute('SELECT expires FROM challenges WHERE token=?', (key,)).fetchone()
        self.db.execute('DELETE FROM challenges WHERE token=?', (key,))
        self.db.commit()
        if not row or row[0] < time.time():
            diagnostic('challenge_rejected')
            raise AuthError('Face attempt expired. Please try again.', 401, 'challenge_expired')
        diagnostic("challenge_validated")
        embedding = self.image(image)
        measured = [(email,distance(embedding,json.loads(template))) for email, template in self.db.execute('SELECT email,template FROM accounts WHERE template IS NOT NULL')]
        matches = [email for email,value in measured if value < MATCH_THRESHOLD]
        registered = self.db.execute('SELECT COUNT(*) FROM accounts WHERE template IS NOT NULL').fetchone()[0]
        from matching_diagnostics import matching_diagnostic
        matching_diagnostic([value for _,value in measured], result='accepted' if len(matches) == 1 else 'rejected',
                   enrolledAccounts=registered, matchedAccounts=len(matches), threshold=MATCH_THRESHOLD)
        if not matches:
            raise AuthError('Your capture did not match a registered face. Use your password or retry in good lighting.', 401, 'face_not_matched')
        if len(matches) != 1:
            raise AuthError('Face matched multiple accounts. Use your password.', 401, 'ambiguous_face')
        result = self.issue(matches[0])
        diagnostic('session_created', success=True)
        return result

    def logout(self, token):
        self.db.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(token.encode()).hexdigest(),))
        self.db.commit()
        return {}

    def delete_face(self, token):
        user = self.session(token)
        self.db.execute('UPDATE accounts SET template=NULL WHERE email=?', (user['email'],))
        self.db.execute('DELETE FROM sessions WHERE email=?', (user['email'],))
        self.db.commit()
        return {}


def distance(a, b):
    import math
    if len(a) != len(b) or not a:
        raise AuthError('Invalid face template.')
    denominator = math.sqrt(sum(v*v for v in a)*sum(v*v for v in b))
    if not denominator or not all(math.isfinite(v) for v in a+b):
        raise AuthError('Invalid face template.')
    return 1-sum(x*y for x, y in zip(a, b))/denominator
