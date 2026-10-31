"""Face matching is a factor; the real account service owns identity and sessions.
Legacy templates are preserved and cannot grant access until explicitly linked.
"""
import json
import time
from core import AuthError, distance, MATCH_THRESHOLD
from image_pipeline import diagnostic

from pipeline_identity import pipeline_identity
from matching_diagnostics import matching_diagnostic, matching_outcome


class AuthoritativeFaceAuth:
    def __init__(self, prototype, authority):
        self.prototype, self.authority, self.db = prototype, authority, prototype.db
        self.pipeline = pipeline_identity()
        if getattr(self.db, 'dialect', None) != 'postgresql':
            self.db.executescript('''
        CREATE TABLE IF NOT EXISTS real_face_templates(user_id TEXT PRIMARY KEY,template TEXT NOT NULL,pipeline TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS face_account_links(prototype_email TEXT PRIMARY KEY,real_user_id TEXT UNIQUE NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS legacy_face_replacements(prototype_email TEXT PRIMARY KEY,real_user_id TEXT NOT NULL,created REAL NOT NULL);
        ''')

    def health(self):
        try:
            healthy=self.authority.request('health',{}).get('accountService')=='niah-web-auth'
        except AuthError:
            healthy=False
        return {'accountService':'authoritative','accountServiceReady':healthy,'ready':healthy}

    def register(self, name, email, password):
        return self.authority.register(name,email,password)

    def password_login(self, email, password):
        return self.authority.password_login(email, password)

    def session(self, token):
        return self.authority.session(token)

    def challenge(self):
        return self.prototype.challenge()

    def _templates(self):
        for user_id, template, pipeline in self.db.execute('SELECT user_id,template,pipeline FROM real_face_templates'):
            if json.loads(pipeline) != self.pipeline:
                raise AuthError('Face template pipeline differs from the current model. Authorized re-enrollment is required.', 409, 'template_incompatible')
            yield user_id, json.loads(template)
        for user_id, template in self.db.execute('SELECT l.real_user_id,a.template FROM face_account_links l JOIN accounts a ON a.email=l.prototype_email WHERE a.template IS NOT NULL AND NOT EXISTS (SELECT 1 FROM legacy_face_replacements r WHERE r.prototype_email=a.email)'):
            yield user_id, json.loads(template)

    def recover_legacy(self, real_token, real_password, legacy_email, legacy_password, consent, image=None):
        """Fresh proof of both accounts. Preserve old bytes; never transfer an existing link."""
        if consent is not True:
            raise AuthError('Explicit legacy recovery consent is required.',403,'consent_required')
        user = self.session(real_token)  # Rechecks current authoritative eligibility.
        real = self.authority.password_login(user['email'], real_password)
        try:
            if real['user']['id'] != user['id']:
                raise AuthError('Password authentication belongs to another account.',403,'account_mismatch')
            legacy = self.prototype.password_login(legacy_email, legacy_password)
            try:
                old_email = legacy['user']['email']
                row = self.db.execute('SELECT template FROM accounts WHERE email=?',(old_email,)).fetchone()
                if not row or row[0] is None:
                    raise AuthError('No legacy enrollment is available.',409,'not_enrolled')
                # Validate vector structure, but never assert unknown historical provenance.
                old = json.loads(row[0])
                if len(old) != 128:
                    raise AuthError('Legacy template has an unsupported shape.',409,'template_incompatible')
                distance(old, old)
                link = self.db.execute('SELECT real_user_id FROM face_account_links WHERE prototype_email=?',(old_email,)).fetchone()
                if link and link[0] != user['id']:
                    raise AuthError('Existing enrollment belongs to another linked account.',409,'already_linked')
                replacement = self.db.execute('SELECT real_user_id FROM legacy_face_replacements WHERE prototype_email=?',(old_email,)).fetchone()
                if replacement and replacement[0] != user['id']:
                    raise AuthError('Preserved enrollment belongs to another account.',409,'already_linked')
                if self.db.execute('SELECT 1 FROM real_face_templates WHERE user_id=?',(user['id'],)).fetchone():
                    raise AuthError('A current enrollment already exists. It was not replaced.',409,'already_enrolled')
                other = self.db.execute('SELECT prototype_email FROM face_account_links WHERE real_user_id=?',(user['id'],)).fetchone()
                if other and other[0] != old_email:
                    raise AuthError('This account already has another linked enrollment.',409,'already_linked')
                fresh = self.prototype.image(image) if image is not None else None
                if fresh is not None:
                    # Exempt only the explicitly authenticated owner's old enrollment.
                    stored = [json.loads(t) for (t,) in self.db.execute('SELECT template FROM accounts WHERE email<>? AND template IS NOT NULL',(old_email,))]
                    stored += [json.loads(t) for (t,) in self.db.execute('SELECT template FROM real_face_templates')]
                    if any(distance(fresh,t) < MATCH_THRESHOLD for t in stored):
                        raise AuthError('This face belongs to another enrollment.',409,'duplicate_face')
                # Session might have been restricted during inference: recheck before committing.
                self.session(real_token)
                with self.db:
                    if not link:
                        self.db.execute('INSERT INTO face_account_links VALUES(?,?,?)',(old_email,user['id'],time.time()))
                    if fresh is not None:
                        self.db.execute('INSERT INTO real_face_templates VALUES(?,?,?,?)',(user['id'],json.dumps(fresh),json.dumps(self.pipeline),time.time()))
                        self.db.execute('INSERT INTO legacy_face_replacements VALUES(?,?,?) ON CONFLICT(prototype_email) DO UPDATE SET created=excluded.created',(old_email,user['id'],time.time()))
                diagnostic('legacy_recovery_completed', legacyPreserved=True,
                           operation='fresh_enrollment' if fresh is not None else 'link',
                           legacyProvenance='unknown')
                return {'user':user,'enrolled':True,'legacyPreserved':True,'legacyProvenance':'unknown'}
            finally:
                self.prototype.logout(legacy['token'])
        finally:
            self.authority.logout(real['token'])

    def enrollment_status(self, token):
        user = self.session(token)
        enrolled = any(subject == user['id'] for subject, _ in self._templates())
        return {'user':user, 'enrolled':enrolled}

    def enroll(self, token, image):
        user = self.session(token)
        if self.enrollment_status(token)['enrolled']:
            raise AuthError('Your face is already registered. You can now use Face Login.',409,'already_enrolled')
        embedding = self.prototype.image(image)
        # Include unlinked legacy templates: never silently copy an existing face to a new account.
        stored = [template for _,template in self._templates()]
        stored += [json.loads(t) for (t,) in self.db.execute('SELECT template FROM accounts WHERE template IS NOT NULL')]
        if any(distance(embedding,template) < MATCH_THRESHOLD for template in stored):
            raise AuthError('An existing facial enrollment must be securely linked before using this account.',409,'existing_face_requires_link')
        self.db.execute('INSERT INTO real_face_templates VALUES(?,?,?,?)',(user['id'],json.dumps(embedding),json.dumps(self.pipeline),time.time()))
        self.db.commit()
        return {'user':user,'enrolled':True}

    def link_legacy(self, prototype_token, real_token, consent):
        # Session tokens alone do not prove that password authentication was recent.
        raise AuthError('Fresh passwords for both accounts and explicit consent are required. Use legacy recovery.',403,'password_proof_required')

    def face_login(self, challenge, image):
        diagnostic("face_login_received", accountService="authoritative")
        # Reuse single-use challenge validation but never issue a prototype session.
        import hashlib
        key=hashlib.sha256(challenge.encode()).hexdigest()
        row=self.db.execute('DELETE FROM challenges WHERE token=? RETURNING expires',(key,)).fetchone()
        self.db.commit()
        if not row or row[0] < time.time():
            raise AuthError('Face attempt expired. Please try again.',401,'challenge_expired')
        diagnostic('challenge_validated', accountService='authoritative')
        embedding=self.prototype.image(image)
        # Include every legacy match in ambiguity checks, including unlinked accounts.
        matches=set()
        distances=[]
        for subject,template in self._templates():
            measured=distance(embedding,template);distances.append(measured)
            if measured < MATCH_THRESHOLD: matches.add(('real',subject))
        for email,template in self.db.execute('SELECT email,template FROM accounts WHERE template IS NOT NULL AND NOT EXISTS (SELECT 1 FROM legacy_face_replacements r WHERE r.prototype_email=accounts.email)'):
            measured=distance(embedding,json.loads(template));distances.append(measured)
            if measured < MATCH_THRESHOLD:
                link=self.db.execute('SELECT real_user_id FROM face_account_links WHERE prototype_email=?',(email,)).fetchone()
                matches.add(('real',link[0]) if link else ('unlinked',email))
        matching_diagnostic(distances, matchedAccounts=len(matches), result='accepted' if len(matches)==1 else 'rejected', threshold=MATCH_THRESHOLD, accountService='authoritative', legacyProvenance='unknown')
        matching_outcome(len(distances), len(matches))
        if not distances:
            raise AuthError('No face enrollment is available on this server. Sign in with your password, complete any required password change, then register your face.',409,'not_enrolled')
        if not matches: raise AuthError('Your capture did not match a registered face.',401,'face_not_matched')
        if len(matches)!=1: raise AuthError('Face matched multiple accounts. Use your password.',401,'ambiguous_face')
        kind,subject=next(iter(matches))
        if kind!='real': raise AuthError('Your existing face enrollment is not linked to an eligible real Botanist account.',401,'account_not_linked')
        try:
            result=self.authority.issue(subject) # Authority rechecks current role/status/password policy.
        except AuthError as error:
            diagnostic('authoritative_session_rejected', code=error.code)
            raise
        diagnostic('session_created', success=True, accountService='authoritative')
        return result

    def logout(self, token):
        return self.authority.logout(token)

    def delete_face(self, token):
        user=self.session(token)
        self.authority.revoke(token)
        self.db.execute('DELETE FROM real_face_templates WHERE user_id=?',(user['id'],))
        self.db.execute('DELETE FROM face_account_links WHERE real_user_id=?',(user['id'],))
        self.db.commit()
        return {} # Legacy prototype templates stay intact.
