"""Offline evaluation of pinned PUBLIC fixtures. Never load application templates.
No embeddings/images are written; output contains aggregate public-fixture metrics.
"""
import argparse
import contextlib
import io
import json
from pathlib import Path
from PIL import Image, ImageOps
from core import AuthError, distance, MATCH_THRESHOLD
from image_pipeline import decode_image, represent_oriented

PAIRS = [(1,2,True),(5,6,True),(6,7,True),(8,9,True),(1,11,True),(2,11,True),
         (1,3,False),(2,3,False),(6,8,False),(6,9,False)]


def measure(directory):
    from deepface import DeepFace
    from deepface.modules.exceptions import FaceNotDetected
    variants = ('aligned','unaligned','mirrored','exif6')
    results = {}
    for variant in variants:
        embeddings, rejected = {}, {}
        for number in sorted({n for a,b,_ in PAIRS for n in (a,b)}):
            with Image.open(directory/f'img{number}.jpg') as source:
                photo=source.convert('RGB');photo.thumbnail((1600,1600))
            if variant=='mirrored': photo=ImageOps.mirror(photo)
            exif=Image.Exif()
            if variant=='exif6': photo=photo.rotate(90,expand=True);exif[274]=6
            buffer=io.BytesIO();photo.save(buffer,format='JPEG',quality=85,exif=exif)
            def represent(**options):
                # Offline ablation only. Production always enables alignment.
                options['align']=variant!='unaligned'
                return DeepFace.represent(**options)
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    face=represent_oriented(decode_image(buffer.getvalue()),represent,FaceNotDetected)[0]
                embeddings[number]=face['embedding']
            except Exception as error:
                rejected[number]=error.code if isinstance(error,AuthError) else type(error).__name__
        metrics=[]
        for threshold in (MATCH_THRESHOLD,0.4,0.5,0.593):
            genuine=impostor=fr=fa=genuine_eligible=impostor_eligible=fr_eligible=0
            for a,b,same in PAIRS:
                eligible=a in embeddings and b in embeddings
                accepted=eligible and distance(embeddings[a],embeddings[b])<threshold
                if same:
                    genuine+=1;fr+=not accepted
                    genuine_eligible+=eligible;fr_eligible+=eligible and not accepted
                else:
                    impostor+=1;fa+=accepted;impostor_eligible+=eligible
            metrics.append(dict(threshold=threshold,genuinePairs=genuine,impostorPairs=impostor,
                falseRejections=fr,falseAcceptances=fa,endToEndFRR=fr/genuine,endToEndFAR=fa/impostor,
                eligibleGenuinePairs=genuine_eligible,eligibleImpostorPairs=impostor_eligible,
                conditionalFRR=fr_eligible/genuine_eligible if genuine_eligible else None,
                conditionalFAR=fa/impostor_eligible if impostor_eligible else None))
        results[variant]=dict(processed=len(embeddings),rejectedFixtures=rejected,metrics=metrics)
    return dict(source='DeepFace v0.0.93 tests/test_verify.py labels',publicFixturesOnly=True,
        pairs=len(PAIRS),identities=4,independentCalibration=False,
        decision='No production threshold change; small correlated development sample cannot establish FAR.',variants=results)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    result=measure(args.fixtures)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
