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
        if os.name == 'nt':
            # Apply the production key-permission requirements to this temporary key.
            subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', r'''
$ErrorActionPreference='Stop'
$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner($sid)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))
Set-Acl -LiteralPath $env:FACE_TEST_KEY_FILE -AclObject $acl
'''], env={**os.environ, 'FACE_TEST_KEY_FILE': str(key)}, check=True,
                capture_output=True, timeout=15)
        cls.key_file=str(key)
        code = '''
import { createTestAuth } from './server/test-postgres.mjs';
import { createAuthServer } from './server/http.mjs';
import { readFileSync } from 'node:fs';
// In-memory PGlite fixture only. Never import index.mjs or load project .env files.
const auth=await createTestAuth();
for(const [email,role,status,temporary] of [
 ['botanist@example.invalid','Botanist','Active',false],
 ['officer@example.invalid','Conservation Officer','Suspended',false],
 ['temporary@example.invalid','Botanist','Active',true],
 ['first-login@example.invalid','Botanist','Active',true],
 ['other@example.invalid','Botanist','Active',false]]) {
 const user=await auth.createUser({name:'Fixture',email,role,password:'isolated-account-password',mustChangePassword:temporary});
 if(status!=='Active')await auth.setStatus(user.id,status,'fixture','fixture');
}
const server=createAuthServer({auth,key:readFileSync(process.env.FACE_TEST_KEY_FILE),env:{}});
server.listen(0,'127.0.0.1',()=>console.log('Authentication API running on port '+server.address().port));
// Reset only this in-memory fixture's request history between independent tests.
process.stdin.on('data',async()=>{
 await auth.db.prepare('DELETE FROM auth_events').run();
 console.log('Fixture request history reset');
});
'''
        cls.child=subprocess.Popen(['node','--input-type=module','-e',code],cwd=WEB,
            env={**os.environ,'FACE_TEST_KEY_FILE':str(key)},
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        import queue, threading
        output=queue.Queue();cls.output=output
        threading.Thread(target=lambda: [output.put(line) for line in cls.child.stdout], daemon=True).start()
        try:
            line=output.get(timeout=30)
            if 'Authentication API running on port' not in line:
                raise RuntimeError('Isolated account service did not report readiness')
            cls.url='http://127.0.0.1:'+line.strip().split()[-1]
        except Exception:
            cls.child.terminate();cls.child.wait(timeout=10)
            cls.child.stdin.close();cls.child.stdout.close();cls.child.stderr.close();cls.directory.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.child.terminate();cls.child.wait(timeout=10)
        cls.child.stdin.close()
        cls.child.stdout.close();cls.child.stderr.close();cls.directory.cleanup()

    def setUp(self):
        self.child.stdin.write('reset\n');self.child.stdin.flush()
        self.assertEqual(self.output.get(timeout=10).strip(),'Fixture request history reset')
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
        with self.assertRaises(AuthError):
            self.authority.password_login('officer@example.invalid','isolated-account-password')
        pending=self.authority.password_login('temporary@example.invalid','isolated-account-password')
        self.assertTrue(pending['user']['mustChangePassword'])
        with self.assertRaises(AuthError): self.authority.session(pending['token'])
        with self.assertRaises(AuthError): self.authority.issue(pending['user']['id'])
        with self.assertRaises(AuthError): self.auth.enroll(pending['token'],self.image)
        self.authority.logout(pending['token'])
        with self.assertRaises(AuthError): self.authority.issue('nonexistent-subject')

    def test_mobile_temporary_password_change_then_face_login_same_identity(self):
        import urllib.request, urllib.error
        def mobile(path, body, token=None):
            headers={'Content-Type':'application/json'}
            if token: headers['Authorization']='Bearer '+token
            request=urllib.request.Request(self.url+'/api/mobile'+path,
                data=json.dumps(body).encode(),headers=headers,method='POST')
            try:
                response=urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=10)
            except urllib.error.HTTPError as error:
                response=error
            with response:
                return response.status,json.load(response)
        email='first-login@example.invalid'
        status,pending=mobile('/password',{'email':email,'password':'isolated-account-password'})
        self.assertEqual(status,200)
        self.assertTrue(pending['user']['mustChangePassword'])
        self.assertEqual(mobile('/me',{},pending['token'])[0],403)
        with self.assertRaises(AuthError): self.auth.enroll(pending['token'],self.image)
        replacement='isolated-replacement-password'
        status,changed=mobile('/change-password',{'password':replacement},pending['token'])
        self.assertEqual(status,200)
        self.assertTrue(changed['changed'])
        self.assertEqual(mobile('/password',{'email':email,'password':'isolated-account-password'})[0],401)
        status,session=mobile('/password',{'email':email,'password':replacement})
        self.assertEqual(status,200)
        self.assertFalse(session['user']['mustChangePassword'])
        self.assertEqual(session['user']['id'],pending['user']['id'])
        self.auth.enroll(session['token'],self.image)
        recognized=self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(recognized['user']['id'],pending['user']['id'])
        self.auth.logout(recognized['token'])
        self.authority.logout(session['token'])

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

    @unittest.skipUnless(os.environ.get('FACE_TEST_PORTRAIT') and os.environ.get('FACE_TEST_SECOND_PORTRAIT'),'Set both consented portrait fixtures for genuine-pair tests.')
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

    def test_empty_gallery_directs_to_password_and_enrollment(self):
        with self.assertRaises(AuthError) as caught:
            self.auth.face_login(self.auth.challenge()['challenge'],self.image)
        self.assertEqual(caught.exception.code,'not_enrolled')
        self.assertEqual(caught.exception.status,409)
        self.assertIn('Sign in with your password',str(caught.exception))
        self.assertFalse(self.auth.enrollment_status(self.session['token'])['enrolled'])
        self.assertEqual(self.prototype.db.execute('SELECT COUNT(*) FROM real_face_templates').fetchone()[0],0)

    def test_other_new_account_is_not_enrolled_just_because_gallery_contains_a_template(self):
        saved=self.auth.enroll(self.session['token'],self.image)
        other=self.authority.password_login('other@example.invalid','isolated-account-password')
        try:
            self.assertTrue(self.auth.enrollment_status(self.session['token'])['enrolled'])
            self.assertFalse(self.auth.enrollment_status(other['token'])['enrolled'])
            self.assertEqual(saved['user']['id'],self.session['user']['id'])
            self.assertNotEqual(saved['user']['id'],other['user']['id'])
            recognized=self.auth.face_login(self.auth.challenge()['challenge'],self.image)
            self.assertEqual(recognized['user']['id'],self.session['user']['id'])
            self.assertNotEqual(recognized['user']['id'],other['user']['id'])
            self.auth.logout(recognized['token'])
        finally:
            self.authority.logout(other['token'])

    def test_two_botanists_persist_independent_faces_and_login_from_the_entire_gallery(self):
        second=self.authority.password_login('other@example.invalid','isolated-account-password')
        first_image=base64.b64encode(b'first-user-face').decode()
        second_image=base64.b64encode(b'second-user-face').decode()
        unknown_image=base64.b64encode(b'unknown-face').decode()
        def matcher(data):
            if data==b'first-user-face': return [1.,0.,0.]+[0.]*125
            if data==b'second-user-face': return [0.,1.,0.]+[0.]*125
            return [0.,0.,1.]+[0.]*125
        try:
            with tempfile.TemporaryDirectory() as directory:
                path=str(Path(directory)/'multi-user-fixture.sqlite')
                store=Auth(path,matcher)
                try:
                    face=AuthoritativeFaceAuth(store,self.authority)
                    first=face.enroll(self.session['token'],first_image)
                    original=store.db.execute('SELECT template FROM real_face_templates WHERE user_id=?',(self.session['user']['id'],)).fetchone()[0]
                    added=face.enroll(second['token'],second_image)
                    self.assertEqual(first['user']['id'],self.session['user']['id'])
                    self.assertEqual(added['user']['id'],second['user']['id'])
                    self.assertEqual(store.db.execute('SELECT COUNT(*) FROM real_face_templates').fetchone()[0],2)
                    self.assertEqual(store.db.execute('SELECT template FROM real_face_templates WHERE user_id=?',(self.session['user']['id'],)).fetchone()[0],original)
                finally:
                    store.db.close()
                restored=Auth(path,matcher)
                try:
                    face=AuthoritativeFaceAuth(restored,self.authority)
                    self.assertTrue(face.enrollment_status(self.session['token'])['enrolled'])
                    self.assertTrue(face.enrollment_status(second['token'])['enrolled'])
                    # Match the second row first: recognition must not stop at the first enrollment.
                    for image,expected in [(second_image,second),(first_image,self.session),(second_image,second)]:
                        result=face.face_login(face.challenge()['challenge'],image)
                        self.assertEqual(result['user']['id'],expected['user']['id'])
                        face.logout(result['token'])
                    with self.assertRaises(AuthError) as caught:
                        face.face_login(face.challenge()['challenge'],unknown_image)
                    self.assertEqual(caught.exception.code,'face_not_matched')
                finally:
                    restored.db.close()
        finally:
            self.authority.logout(second['token'])

    def test_same_face_cannot_be_copied_to_another_botanist_account(self):
        self.auth.enroll(self.session['token'],self.image)
        before=self.prototype.db.execute('SELECT user_id,template FROM real_face_templates').fetchall()
        second=self.authority.password_login('other@example.invalid','isolated-account-password')
        try:
            with self.assertRaises(AuthError) as caught:
                self.auth.enroll(second['token'],self.image)
            self.assertEqual(caught.exception.code,'existing_face_requires_link')
            self.assertEqual(self.prototype.db.execute('SELECT user_id,template FROM real_face_templates').fetchall(),before)
            self.assertFalse(self.auth.enrollment_status(second['token'])['enrolled'])
        finally:
            self.authority.logout(second['token'])

    def test_enrollment_survives_face_store_reopen_and_issues_same_account(self):
        with tempfile.TemporaryDirectory() as directory:
            path=str(Path(directory)/'isolated-face.sqlite')
            store=Auth(path,lambda _: [1.,0.])
            try:
                face=AuthoritativeFaceAuth(store,self.authority)
                result=face.enroll(self.session['token'],self.image)
                self.assertTrue(result['enrolled'])
                self.assertEqual(result['user']['id'],self.session['user']['id'])
            finally:
                store.db.close()
            restored=Auth(path,lambda _: [1.,0.])
            try:
                face=AuthoritativeFaceAuth(restored,self.authority)
                self.assertTrue(face.enrollment_status(self.session['token'])['enrolled'])
                recognized=face.face_login(face.challenge()['challenge'],self.image)
                self.assertEqual(recognized['user']['id'],self.session['user']['id'])
                face.logout(recognized['token'])
            finally:
                restored.db.close()

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
