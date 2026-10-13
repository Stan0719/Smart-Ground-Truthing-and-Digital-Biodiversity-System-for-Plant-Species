"""Explicit link with fresh passwords for BOTH accounts. No template is replaced."""
import getpass
import os
from pathlib import Path
from core import Auth
from account_service import AccountService
from authoritative_auth import AuthoritativeFaceAuth

if __name__ == '__main__':
    authority = AccountService(os.environ['FACE_ACCOUNT_SERVICE_URL'], os.environ['FACE_ACCOUNT_SERVICE_KEY_FILE'])
    prototype = Auth(str(Path(__file__).parent/'data/auth.sqlite'), lambda _: (_ for _ in ()).throw(RuntimeError('Linking never scans')))
    real_token = None
    try:
        legacy_email = input('Existing prototype enrollment email: ')
        legacy_password = getpass.getpass('Existing prototype password: ')
        real_email = input('Eligible real Visitor/Botanist email: ')
        real_password = getpass.getpass('Real account password: ')
        real = authority.password_login(real_email, real_password)
        real_token = real['token']
        consent = input('Type LINK to confirm you own both accounts and link this face without replacing its template: ') == 'LINK'
        AuthoritativeFaceAuth(prototype,authority).recover_legacy(real_token,real_password,legacy_email,legacy_password,consent)
        print('Existing template linked. Historical compatibility remains unknown; Face Login must still pass matching.')
    finally:
        if real_token: authority.logout(real_token)
        prototype.db.close()
