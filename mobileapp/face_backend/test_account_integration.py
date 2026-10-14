"""Real Node/Python HTTP integration; isolated accounts/database/key, fake matcher.
Optional actual-model check uses only the public portrait fixture.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from core import Auth, AuthError
from account_service import AccountService
from authoritative_auth import AuthoritativeFaceAuth

WEB = Path(__file__).resolve().parents[2]/'web'

class AccountIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        directory = Path(cls.directory.name)
        key = directory/'service.key';key.write_bytes(os.urandom(32));key.chmod(0o600)
        cls.key_file=str(key)
        code = '''
import { createAuth } from './server/auth.mjs';
const auth=await createAuth(process.env.AUTH_DB);
for(const [email,role,status,temporary] of [
 ['botanist@example.invalid','Botanist','Active',false],
 ['officer@example.invalid','Conservation Officer','Suspended',false],
 ['temporary@example.invalid','Botanist','Active',true],
 ['other@example.invalid','Botanist','Active',false]]) {
 const user=await auth.createUser({name:'Fixture',email,role,password:'isolated-account-password',mustChangePassword:temporary});
 if(status!=='Active')auth.setStatus(user.id,status,'fixture','fixture');
}
auth.db.close();await import('./server/index.mjs');
'''
        cls.child=subprocess.Popen(['node','--input-type=module','-e',code],cwd=WEB,
            env={**os.environ,'AUTH_DB':str(directory/'real.sqlite'),'FACE_ACCOUNT_SERVICE_KEY_FILE':str(key),'PORT':'0','AUTH_RECOVERY_DELIVERY_DISABLED':'1'},
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        for _ in range(10):
            line=cls.child.stdout.readline()
            if 'Authentication API running on port' in line:
                cls.url='http://127.0.0.1:'+line.strip().split()[-1];break
        else: raise RuntimeError('Isolated account service did not start')

    @classmethod
    def tearDownClass(cls):
        cls.child.terminate();cls.child.wait(timeout=10)
        cls.child.stdout.close();cls.child.stderr.close();cls.directory.cleanup()

    def setUp(self):
        self.authority=AccountService(self.url,self.key_file)
        self.prototype=Auth(':memory:',lambda _: [1.,0.])
        self.auth=AuthoritativeFaceAuth(self.prototype,self.authority)
        self.session=self.authority.password_login('botanist@example.invalid','isolated-account-password')
        self.image=base64.b64encode(b'controlled-fake-matcher').decode()

    def tearDown(self):
        self.prototype.db.close()
        self.authority.logout(self.session['token'])

    def test_visitor_registration_and_password_use_same_real_account(self):
        import secrets
        email='visitor-'+secrets.token_hex(4)+'@example.invalid'
        created=self.authority.register('Visitor fixture',email,'visitor-test-password')
        self.assertEqual(created['user']['role'],'visitor')
        session=self.authority.password_login(email,'visitor-test-password')
        self.assertEqual(self.authority.session(session['token'])['id'],created['user']['id'])
        self.assertEqual(self.authority.session(session['token'])['role'],'visitor')
        self.authority.logout(session['token'])

    def test_mobile_http_register_password_me_and_recovery_configuration(self):
        import http.client, threading, secrets
        from server import create_server
        server=create_server(self.auth,port=0)
        def call(path,body,token=None):
            outcome=[]
            def client():
                connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=10)
                headers={'Content-Type':'application/json'}
                if token: headers['Authorization']='Bearer '+token
                connection.request('POST',path,json.dumps(body),headers)
                response=connection.getresponse();outcome.append((response.status,json.loads(response.read())));connection.close()
            worker=threading.Thread(target=client);worker.start();server.handle_request();worker.join(10)
            self.assertEqual(len(outcome),1)
            return outcome[0]
        try:
            email='mobile-'+secrets.token_hex(4)+'@example.invalid'
            status,created=call('/register',{'name':'Mobile fixture','email':email,'password':'mobile-fixture-password'})
            self.assertEqual(status,200);self.assertEqual(created['user']['role'],'visitor')
            status,session=call('/password',{'email':email,'password':'mobile-fixture-password'})
            self.assertEqual(status,200)
            status,verified=call('/me',{},session['token'])
            self.assertEqual(status,200);self.assertEqual(verified['user']['id'],created['user']['id'])
            self.assertEqual(call('/password',{'email':email,'password':'incorrect'})[0],401)
            self.assertEqual(call('/recovery/request',{'email':email})[0],503)
            self.assertEqual(call('/logout',{},session['token'])[0],200)
            self.assertEqual(call('/me',{},session['token'])[0],401)
        finally: server.server_close()

    def test_mobile_http_legacy_recovery_and_real_session(self):
        import http.client, threading
        from server import create_server
        self.legacy_fixture()
        server=create_server(self.auth,port=0)
        def call(path,body,token=None):
            result=[]
            def client():
                connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=10)
                headers={'Content-Type':'application/json'}
                if token: headers['Authorization']='Bearer '+token
                connection.request('POST',path,json.dumps(body),headers)
                response=connection.getresponse();result.append((response.status,json.loads(response.read())));connection.close()
            worker=threading.Thread(target=client);worker.start();server.handle_request();worker.join(10)
            self.assertEqual(len(result),1)
            return result[0]
        body={'legacyEmail':'legacy@example.invalid','legacyPassword':'legacy-password-value',
              'realPassword':'isolated-account-password','consent':True,'image':self.image}
        try:
            self.assertEqual(call('/legacy-reenroll',body)[0],401)
            self.assertEqual(call('/legacy-reenroll',{**body,'consent':False},self.session['token'])[0],403)
            self.assertEqual(call('/legacy-reenroll',{**body,'image':None},self.session['token'])[0],422)
            status,enrolled=call('/legacy-reenroll',body,self.session['token'])
            self.assertEqual(status,200);self.assertTrue(enrolled['legacyPreserved'])
            self.assertNotIn('closestDistance',enrolled)
            for _ in range(2):
                challenge=call('/challenge',{})[1]['challenge']
                status,session=call('/face-login',{'image':self.image,'challenge':challenge})
                self.assertEqual(status,200)
                self.assertNotIn('closestDistance',session)
                status,verified=call('/me',{},session['token'])
                self.assertEqual(status,200);self.assertEqual(verified['user']['id'],self.session['user']['id'])
                self.assertEqual(call('/logout',{},session['token'])[0],200)
                self.assertEqual(call('/me',{},session['token'])[0],401)
        finally: server.server_close()

    def test_real_account_session_matching_and_revocation(self):
        self.auth.enroll(self.session['token'],self.image)
        result=self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(result['user']['id'],self.session['user']['id'])
        self.assertEqual(self.auth.session(result['token'])['role'],'botanist')
        self.assertEqual(self.prototype.db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],0)
        self.auth.logout(result['token'])
        with self.assertRaises(AuthError): self.auth.session(result['token'])

    def test_officer_and_temporary_accounts_never_grant_botanist_access(self):
        for email in ('officer@example.invalid','temporary@example.invalid'):
            with self.assertRaises(AuthError): self.authority.password_login(email,'isolated-account-password')
        with self.assertRaises(AuthError): self.authority.issue('nonexistent-subject')

    def test_unlinked_legacy_cannot_authenticate_real_account(self):
        self.prototype.embed=lambda _: [1.,0.]+[0.]*126
        self.prototype.provision('legacy@example.invalid','legacy-password-value','Legacy')
        local=self.prototype.password_login('legacy@example.invalid','legacy-password-value')
        self.prototype.enroll(local['token'],self.image)
        before=self.prototype.db.execute('SELECT template FROM accounts').fetchone()[0]
        with self.assertRaises(AuthError) as caught: self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(caught.exception.code,'account_not_linked')
        with self.assertRaises(AuthError): self.auth.link_legacy(local['token'],self.session['token'],False)
        with self.assertRaises(AuthError): self.auth.link_legacy(local['token'],self.session['token'],True)
        self.auth.recover_legacy(self.session['token'],'isolated-account-password','legacy@example.invalid','legacy-password-value',True)
        result=self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(self.auth.session(result['token'])['id'],self.session['user']['id'])
        self.assertEqual(self.prototype.db.execute('SELECT template FROM accounts').fetchone()[0],before)

    def test_model_provenance_mismatch_requires_authorized_reenrollment(self):
        self.auth.enroll(self.session['token'],self.image)
        self.prototype.db.execute('UPDATE real_face_templates SET pipeline=?',(json.dumps({'model':'different'}),))
        self.prototype.db.commit()
        with self.assertRaises(AuthError) as caught:
            self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(caught.exception.code,'template_incompatible')
        self.assertEqual(self.prototype.db.execute('SELECT COUNT(*) FROM real_face_templates').fetchone()[0],1)

    def legacy_fixture(self, vector=None):
        self.prototype.embed=lambda _: [1.,0.]+[0.]*126
        self.prototype.provision('legacy@example.invalid','legacy-password-value','Legacy')
        self.prototype.db.execute('UPDATE accounts SET template=?',(json.dumps((vector or [0.,1.])+[0.]*126),))
        self.prototype.db.commit()
        return self.prototype.db.execute('SELECT template FROM accounts').fetchone()[0]

    def recover(self, image=None, **overrides):
        values=dict(real_token=self.session['token'],real_password='isolated-account-password',
                    legacy_email='legacy@example.invalid',legacy_password='legacy-password-value',consent=True,image=image)
        return self.auth.recover_legacy(**{**values,**overrides})

    def test_explicit_reenrollment_preserves_legacy_and_repeated_real_login(self):
        before=self.legacy_fixture()
        result=self.recover(self.image)
        self.assertTrue(result['legacyPreserved'])
        self.assertEqual(self.prototype.db.execute('SELECT template FROM accounts').fetchone()[0],before)
        self.assertEqual(self.prototype.db.execute('SELECT COUNT(*) FROM legacy_face_replacements').fetchone()[0],1)
        for _ in range(2):
            session=self.auth.face_login(self.auth.challenge()['challenge'],self.image)
            self.assertEqual(self.auth.session(session['token'])['id'],self.session['user']['id'])
            self.auth.logout(session['token'])
            with self.assertRaises(AuthError): self.auth.session(session['token'])
        # The preserved historical vector no longer expands the active acceptance gallery.
        self.prototype.embed=lambda _: [0.,1.]+[0.]*126
        with self.assertRaises(AuthError) as error:
            self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(error.exception.code,'face_not_matched')

    def test_recovery_requires_consent_both_passwords_and_never_overwrites(self):
        before=self.legacy_fixture()
        for overrides in ({'consent':False},{'real_password':'wrong'},{'legacy_password':'wrong'}):
            with self.assertRaises(AuthError): self.recover(self.image,**overrides)
            self.assertEqual(self.prototype.db.execute('SELECT COUNT(*) FROM face_account_links').fetchone()[0],0)
        self.recover(self.image)
        with self.assertRaises(AuthError) as error: self.recover(self.image)
        self.assertEqual(error.exception.code,'already_enrolled')
        self.assertEqual(self.prototype.db.execute('SELECT template FROM accounts').fetchone()[0],before)

    def test_recovery_liveness_failure_and_other_identity_duplicates_leave_no_changes(self):
        self.legacy_fixture()
        def reject(_): raise AuthError('Rejected',422,'liveness_rejected')
        self.prototype.embed=reject
        with self.assertRaises(AuthError) as error: self.recover(self.image)
        self.assertEqual(error.exception.code,'liveness_rejected')
        self.assertEqual(self.prototype.db.execute('SELECT COUNT(*) FROM face_account_links').fetchone()[0],0)
        self.prototype.provision('other-legacy@example.invalid','another-legacy-password','Other')
        self.prototype.db.execute('UPDATE accounts SET template=? WHERE email=?',(json.dumps([1.,0.]+[0.]*126),'other-legacy@example.invalid'));self.prototype.db.commit()
        self.prototype.embed=lambda _: [1.,0.]+[0.]*126
        with self.assertRaises(AuthError) as error: self.recover(self.image)
        self.assertEqual(error.exception.code,'duplicate_face')
        self.assertEqual(self.prototype.db.execute('SELECT COUNT(*) FROM real_face_templates').fetchone()[0],0)

    def test_password_verified_link_preserves_unknown_provenance_and_checks_account(self):
        before=self.legacy_fixture([1.,0.])
        result=self.recover()
        self.assertEqual(result['legacyProvenance'],'unknown')
        self.assertEqual(self.prototype.db.execute('SELECT template FROM accounts').fetchone()[0],before)
        session=self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(self.auth.session(session['token'])['id'],self.session['user']['id'])
        self.auth.logout(session['token'])
        self.assertEqual(self.prototype.db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],0)

    @unittest.skipUnless(os.environ.get('FACE_TEST_SECOND_PORTRAIT'),'Set second distinct public genuine fixture.')
    def test_actual_distinct_genuine_capture_obeys_threshold(self):
        from server import embed, initialize_models
        from core import distance, MATCH_THRESHOLD
        from PIL import Image
        import io
        initialize_models()
        images=[]
        for path in (os.environ['FACE_TEST_PORTRAIT'],os.environ['FACE_TEST_SECOND_PORTRAIT']):
            with Image.open(path) as source:
                photo=source.convert('RGB');photo.thumbnail((1600,1600));buffer=io.BytesIO();photo.save(buffer,format='JPEG',quality=85)
            images.append(base64.b64encode(buffer.getvalue()).decode())
        self.prototype.embed=embed
        self.auth.enroll(self.session['token'],images[0])
        stored=json.loads(self.prototype.db.execute('SELECT template FROM real_face_templates').fetchone()[0])
        measured=distance(stored,self.prototype.image(images[1]))
        print('Public distinct genuine pair cosine distance:',round(measured,4))
        if measured < MATCH_THRESHOLD:
            session=self.auth.face_login(self.auth.challenge()['challenge'],images[1])
            self.assertEqual(self.auth.session(session['token'])['id'],self.session['user']['id'])
            self.auth.logout(session['token'])
        else:
            with self.assertRaises(AuthError) as error:
                self.auth.face_login(self.auth.challenge()['challenge'],images[1])
            self.assertEqual(error.exception.code,'face_not_matched')

    def test_unknown_and_ambiguous_faces_rejected(self):
        self.auth.enroll(self.session['token'],self.image)
        self.prototype.embed=lambda _: [0.,1.]
        with self.assertRaises(AuthError) as caught: self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(caught.exception.code,'face_not_matched')
        self.prototype.embed=lambda _: [1.,0.]
        self.prototype.provision('unlinked@example.invalid','legacy-password-value','Unlinked')
        self.prototype.db.execute('UPDATE accounts SET template=?',(json.dumps([1.,0.]),));self.prototype.db.commit()
        with self.assertRaises(AuthError) as caught: self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(caught.exception.code,'ambiguous_face')

    @unittest.skipUnless(os.environ.get('FACE_TEST_PORTRAIT'),'Set public portrait fixture for actual models.')
    def test_actual_models_issue_and_validate_real_service_session(self):
        from server import embed
        from PIL import Image
        import io
        with Image.open(os.environ['FACE_TEST_PORTRAIT']) as source:
            photo=source.convert('RGB');photo.thumbnail((1600,1600));buffer=io.BytesIO();photo.save(buffer,format='JPEG',quality=85)
        image=base64.b64encode(buffer.getvalue()).decode()
        self.prototype.embed=embed
        self.auth.enroll(self.session['token'],image)
        result=self.auth.face_login(self.auth.challenge()['challenge'],image)
        self.assertEqual(self.auth.session(result['token'])['id'],self.session['user']['id'])
