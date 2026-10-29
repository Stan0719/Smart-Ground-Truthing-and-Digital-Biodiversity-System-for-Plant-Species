"""Authenticated loopback adapter to the existing web account service.
The shared key stays server-side. No credentials or service keys enter Expo config.
"""
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from core import AuthError


def mobile_user(user, allow_temporary=False):
    if not isinstance(user, dict) or user.get('role') not in ('Botanist','Visitor') or user.get('status') != 'Active' or (user.get('mustChangePassword') is not False and not (allow_temporary and user.get('mustChangePassword') is True)):
        raise AuthError('An active Botanist or Visitor account with its permanent password is required.', 401, 'account_restricted')
    if not all(isinstance(user.get(field), str) and user[field] for field in ('id','email','name')):
        raise AuthError('Invalid authoritative account.', 503, 'account_service_invalid')
    return {**user, 'role': 'botanist' if user['role']=='Botanist' else 'visitor'}


class AccountService:
    def __init__(self, url, key_file):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.path not in ('','/') or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('Account service must use an explicit http://127.0.0.1 loopback URL.')
        self.url = url.rstrip('/')
        if Path(key_file).stat().st_mode & 0o077:
            raise ValueError('Service key file permissions must be 600.')
        self.key = Path(key_file).read_bytes()
        if len(self.key) < 32:
            raise ValueError('Face account service key must contain at least 32 bytes.')

    def request(self, operation, body):
        path = '/internal/face/'+operation
        raw = json.dumps(body, separators=(',', ':')).encode()
        timestamp, nonce = str(int(time.time())), secrets.token_hex(16)
        signature = hmac.new(self.key, timestamp.encode()+b'\n'+nonce.encode()+b'\n'+path.encode()+b'\n'+raw, hashlib.sha256).hexdigest()
        from image_pipeline import request_reference
        request = urllib.request.Request(self.url+path, raw, headers={'Content-Type':'application/json',
            'X-Face-Request-ID':request_reference.get(),'X-Face-Timestamp':timestamp,'X-Face-Nonce':nonce,'X-Face-Signature':signature}, method='POST')
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=15) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            status=error.code if error.code in (400,401,403,409,429,503) else 503
            message='Authoritative account service rejected this authentication. Check credentials and account eligibility.'
            if status in (400,409,429,503):
                try: message=json.load(error).get('error',message)
                except (ValueError,OSError): pass
            raise AuthError(message,status,'account_service_rejected') from None
        except (OSError, ValueError):
            raise AuthError('Authoritative account service is unavailable.', 503, 'account_service_unavailable') from None
        if not isinstance(result, dict):
            raise AuthError('Invalid account service response.', 503, 'account_service_invalid')
        return result

    def register(self, name, email, password):
        return {'user':mobile_user(self.request('register', {'name':name,'email':email,'password':password}).get('user'))}

    def session(self, token):
        return mobile_user(self.request('me', {'token':token}).get('user'))

    def issue(self, user_id):
        return self._session_result(self.request('issue', {'userId':user_id}))

    def password_login(self, email, password):
        return self._session_result(self.request('password', {'email':email, 'password':password}), allow_temporary=True)

    def _session_result(self, result, allow_temporary=False):
        token = result.get('token')
        if not isinstance(token, str) or len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
            raise AuthError('Invalid authoritative session.', 503, 'account_service_invalid')
        return {'token':token, 'user':mobile_user(result.get('user'), allow_temporary=allow_temporary)}

    def logout(self, token):
        return self.request('logout', {'token':token})

    def revoke(self, token):
        return self.request('revoke', {'token':token})
