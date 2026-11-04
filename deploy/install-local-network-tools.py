"""Approved local tools only; official HTTPS downloads, SHA-256 verification.
Does not enroll a VPN, start listeners, or change shell/system configuration.
"""
import hashlib, io, json, os, platform, re, tarfile, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
TOOLS=ROOT/'.local-tools'
if platform.system()!='Linux' or platform.machine() not in ('x86_64','amd64'):
    raise SystemExit('This verified installer is for Linux amd64 only.')
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Niah-local-tools-setup'}),timeout=120) as r:
        return r.read(150_000_000)
def sha(data):return hashlib.sha256(data).hexdigest()
def extract(data,name):
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
        matches=[m for m in archive.getmembers() if m.isfile() and Path(m.name).name==name]
        if len(matches)!=1:raise RuntimeError('Unexpected binary archive members')
        return archive.extractfile(matches[0]).read()
TOOLS.mkdir(mode=0o700,exist_ok=True)
bin_dir=TOOLS/'bin';bin_dir.mkdir(mode=0o700,exist_ok=True)
manifest=[]
release=json.loads(get('https://api.github.com/repos/caddyserver/caddy/releases/tags/v2.11.7'))
asset=next(a for a in release['assets'] if a['name']=='caddy_2.11.7_linux_amd64.tar.gz')
checks=next(a for a in release['assets'] if a['name']=='caddy_2.11.7_checksums.txt')
check_data=get(checks['browser_download_url'])
if checks.get('digest')!='sha256:'+sha(check_data):raise RuntimeError('Caddy checksum manifest digest mismatch')
data=get(asset['browser_download_url']);digest=sha(data)
expected=next(line.split()[0] for line in check_data.decode().splitlines() if line.split()[-1].lstrip('*')==asset['name'])
if hashlib.sha512(data).hexdigest()!=expected or asset.get('digest')!='sha256:'+digest:raise RuntimeError('Caddy archive checksum mismatch')
(binary:=bin_dir/'caddy').write_bytes(extract(data,'caddy'));binary.chmod(0o755)
manifest.append({'name':'caddy','version':'2.11.7','source':asset['browser_download_url'],'sha256':digest})
url='https://pkgs.tailscale.com/stable/tailscale_1.104.2_amd64.tgz'
expected=get(url+'.sha256').decode().split()[0]
if not re.fullmatch('[a-fA-F0-9]{64}',expected):raise RuntimeError('Unexpected Tailscale checksum format')
data=get(url);digest=sha(data)
if digest.lower()!=expected.lower():raise RuntimeError('Tailscale archive checksum mismatch')
for name in ['tailscale','tailscaled']:
    (binary:=bin_dir/name).write_bytes(extract(data,name));binary.chmod(0o755)
manifest.append({'name':'tailscale','version':'1.104.2','source':url,'sha256':digest})
(TOOLS/'network-tools-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Installed checksum-verified Caddy and Tailscale binaries into .local-tools/bin. No VPN enrollment or listeners started.')
