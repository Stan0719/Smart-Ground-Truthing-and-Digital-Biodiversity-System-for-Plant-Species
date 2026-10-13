"""Non-biometric model provenance for NEW templates. Legacy data stays untouched."""
from functools import lru_cache
import hashlib
from importlib.metadata import version, PackageNotFoundError
import os
from pathlib import Path

@lru_cache(maxsize=1)
def pipeline_identity():
    identity={'model':'SFace','dimensions':128,'detector':'opencv','align':True,
              'normalization':'base','antiSpoofing':True,'version':2,
              'inputColorOrder':'BGR','inputDtype':'uint8','exifTranspose':True,
              'resizeMaxEdge':1600,'resizePreservesAspect':True,
              'orientationRetry':'detection_failure_only'}
    for package in ('deepface','opencv-contrib-python-headless','Pillow','numpy'):
        try: identity[package]=version(package)
        except PackageNotFoundError: identity[package]='unavailable'
    weights=Path(os.environ.get('DEEPFACE_HOME',str(Path.home())))/'.deepface'/'weights'
    path=weights/'face_recognition_sface_2021dec.onnx'
    if path.is_file():
        digest=hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
        identity['weightsSha256']=digest.hexdigest()
    else: identity['weightsSha256']='unavailable'
    return identity
