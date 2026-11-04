"""Build an isolated proposal; never write to the original project files."""
from pathlib import Path
import difflib
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SOURCE = ROOT / 'mobileapp/face_backend/authoritative_auth.py'
original = SOURCE.read_text(encoding='utf-8')
changes = [
    ('    def _templates(self):', '    def _templates(self, subject_id=None):'),
    ("        for user_id, template, pipeline in self.db.execute('SELECT user_id,template,pipeline FROM real_face_templates'):\n",
     "        for user_id, template, pipeline in self.db.execute('SELECT user_id,template,pipeline FROM real_face_templates'):\n            if subject_id is not None and user_id != subject_id:\n                continue\n"),
    ('            yield user_id, json.loads(template)\n\n    def recover_legacy',
     '            if subject_id is None or user_id == subject_id:\n                yield user_id, json.loads(template)\n\n    def recover_legacy'),
    ("enrolled = any(subject == user['id'] for subject, _ in self._templates())",
     "enrolled = any(subject == user['id'] for subject, _ in self._templates(subject_id=user['id']))"),
]
proposed = original
for before, after in changes:
    if proposed.count(before) != 1:
        raise SystemExit('Source differs from inspected baseline; review required.')
    proposed = proposed.replace(before, after, 1)
outputs = {
    'authoritative_auth.proposed.py': proposed,
    'enrollment-status.patch': ''.join(difflib.unified_diff(
        original.splitlines(True), proposed.splitlines(True),
        fromfile='a/mobileapp/face_backend/authoritative_auth.py',
        tofile='b/mobileapp/face_backend/authoritative_auth.py')),
    'baseline.json': json.dumps({'source': str(SOURCE.relative_to(ROOT)),
        'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest()}, indent=2) + '\n',
}
for name, content in outputs.items():
    target = HERE / name
    if target.exists():
        raise SystemExit(f'Refusing to overwrite {name}')
for name, content in outputs.items():
    (HERE / name).write_text(content, encoding='utf-8')
print('Proposal and patch created inside face-id-android-fix only.')
