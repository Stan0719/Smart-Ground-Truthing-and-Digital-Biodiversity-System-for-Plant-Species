"""Normalize images in memory. Never persist or log pixels/EXIF contents."""
from contextvars import ContextVar
import io
import json
import os
from core import AuthError

request_reference = ContextVar('face_request_reference', default='local-check')

def diagnostic(stage, **values):
    if os.environ.get('FACE_IMAGE_DEBUG') == '1':
        print(json.dumps({'event': stage, 'reference': request_reference.get(), **values}), flush=True)


def decode_image(data):
    import numpy as np
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        with Image.open(io.BytesIO(data)) as source:
            width, height = source.size
            if min(width, height) < 64 or width*height > 16000000:
                raise AuthError('Image dimensions are invalid or too large.',422,'invalid_image')
            if source.format not in ('JPEG','PNG'):
                raise AuthError('Send a JPEG or PNG photo.',422,'invalid_image_format')
            orientation = source.getexif().get(274,1)
            diagnostic('image_decoded',format=source.format,width=width,height=height,
                       decodedBytes=len(data),exifOrientation=orientation)
            # Handles all 8 EXIF orientations, including mirrored rotations.
            normalized = ImageOps.exif_transpose(source).convert('RGB')
            normalized.thumbnail((1600,1600), Image.Resampling.LANCZOS)
            diagnostic('image_normalized',width=normalized.width,height=normalized.height,
                       exifApplied=orientation in range(2,9),colorOrder='BGR',cropped=False)
            return np.ascontiguousarray(np.asarray(normalized)[:,:,::-1])
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        raise AuthError('The captured image could not be decoded as a valid JPEG or PNG.',422,'invalid_image') from None


def represent_oriented(image, represent, no_face_exception):
    import numpy as np
    # Retry ONLY detection failure. Never retry liveness rejection to find an accepting angle.
    for turns in (0,1,2,3):
        candidate = np.ascontiguousarray(np.rot90(image,turns)) if turns else image
        diagnostic('detection_started',detector='opencv',rotationDegrees=turns*90,
                   width=candidate.shape[1],height=candidate.shape[0],antiSpoofing=True)
        try:
            result = represent(img_path=candidate,model_name='SFace',detector_backend='opencv',
                               enforce_detection=True,anti_spoofing=True,align=True,normalization='base')
        except no_face_exception:
            diagnostic('detection_failed',detector='opencv',rotationDegrees=turns*90,exception='FaceNotDetected')
            continue
        if len(result) != 1:
            raise AuthError('Show exactly one face.',422,'multiple_faces')
        diagnostic('detection_completed',detector='opencv',rotationDegrees=turns*90,faces=1)
        area = result[0].get('facial_area', {})
        width, height = area.get('w', 0), area.get('h', 0)
        diagnostic('capture_quality', faceAreaFraction=round(width*height/(candidate.shape[0]*candidate.shape[1]), 3),
                   eyesLocated=bool(area.get('left_eye') and area.get('right_eye')),
                   alignmentEnabled=True, model='SFace', normalization='base')
        diagnostic('anti_spoofing_completed', result='passed', enabled=True)
        return result
    raise AuthError('No face detected after orientation normalization. Keep your entire face inside the guide and retry.',422,'no_face')
