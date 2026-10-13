import io
import os
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
from core import AuthError
from image_pipeline import decode_image, represent_oriented

class MissingFace(ValueError): pass
class Spoof(ValueError): pass

class ImagePipelineTests(unittest.TestCase):
    def encode(self,image,format='JPEG',orientation=1):
        buffer=io.BytesIO();exif=Image.Exif();exif[274]=orientation
        image.save(buffer,format=format,exif=exif,quality=90)
        return buffer.getvalue()

    def test_all_exif_orientations_and_bgr_conversion(self):
        rgb=np.zeros((80,120,3),dtype=np.uint8)
        rgb[:40,:60]=[255,0,0];rgb[40:,60:]=[0,0,255]
        for orientation in range(1,9):
            data=self.encode(Image.fromarray(rgb),'PNG',orientation)
            with Image.open(io.BytesIO(data)) as source:
                expected=np.asarray(ImageOps.exif_transpose(source).convert('RGB'))[:,:,::-1]
            np.testing.assert_array_equal(decode_image(data),expected)

    def test_decode_invalid_and_empty(self):
        for data in (b'',b'not-an-image',self.encode(Image.new('RGB',(10,10)))):
            with self.assertRaises(AuthError):decode_image(data)

    def test_resizing_preserves_aspect_and_does_not_crop(self):
        image=decode_image(self.encode(Image.new('RGB',(3000,2000))))
        self.assertEqual(image.shape[1],1600)
        self.assertLess(abs(image.shape[1]/image.shape[0]-1.5),.01)

    def test_rotates_only_after_no_face_and_keeps_security_flags(self):
        attempts=[]
        def represent(**kwargs):
            self.assertTrue(kwargs['anti_spoofing']);self.assertTrue(kwargs['enforce_detection'])
            self.assertTrue(kwargs['align']);self.assertEqual(kwargs['normalization'],'base')
            attempts.append(kwargs['img_path'].shape)
            if len(attempts)==1:raise MissingFace()
            return [{'embedding':[1.,0.]}]
        represent_oriented(np.zeros((80,120,3),dtype=np.uint8),represent,MissingFace)
        self.assertEqual(attempts,[(80,120,3),(120,80,3)])

    def test_spoof_rejection_is_not_retried(self):
        calls=[]
        def reject(**kwargs):calls.append(1);raise Spoof()
        with self.assertRaises(Spoof):represent_oriented(np.zeros((80,120,3)),reject,MissingFace)
        self.assertEqual(len(calls),1)

    def test_no_face_and_multiple_faces(self):
        def missing(**kwargs):raise MissingFace()
        with self.assertRaises(AuthError) as error:represent_oriented(np.zeros((80,120,3)),missing,MissingFace)
        self.assertEqual(error.exception.code,'no_face')
        with self.assertRaises(AuthError) as error:
            represent_oriented(np.zeros((80,120,3)),lambda **_: [{},{}],MissingFace)
        self.assertEqual(error.exception.code,'multiple_faces')

@unittest.skipUnless(os.environ.get('FACE_TEST_PORTRAIT'),'Set FACE_TEST_PORTRAIT to a controlled public portrait for real-model tests.')
class RealPortraitTests(unittest.TestCase):
    def test_real_portrait_rotated_and_mirrored(self):
        from server import embed
        with Image.open(os.environ['FACE_TEST_PORTRAIT']) as source: portrait=source.convert('RGB')
        cases={'upright':portrait,'pixels90':portrait.rotate(90,expand=True),
               'pixels180':portrait.rotate(180,expand=True),'pixels270':portrait.rotate(270,expand=True),
               'mirrored':ImageOps.mirror(portrait)}
        for name,image in cases.items():
            with self.subTest(name=name):
                buffer=io.BytesIO();image.save(buffer,format='JPEG',quality=90)
                self.assertEqual(len(embed(buffer.getvalue())),128)
        buffer=io.BytesIO();exif=Image.Exif();exif[274]=6
        portrait.rotate(90,expand=True).save(buffer,format='JPEG',exif=exif,quality=90)
        self.assertEqual(len(embed(buffer.getvalue())),128)

    def test_real_rotated_jpeg_enrollment_over_http(self):
        import base64,json,threading,http.client
        from core import Auth
        from server import create_server,embed
        event=threading.Event();state={}
        def run():
            auth=Auth(':memory:',embed)
            auth.provision('rotation@example.invalid','rotation-password','Rotation test')
            server=create_server(auth,port=0);state['server']=server;event.set()
            try:server.serve_forever()
            finally:server.server_close();auth.db.close()
        thread=threading.Thread(target=run,daemon=True);thread.start();self.assertTrue(event.wait(5))
        def call(path,body,token=None):
            connection=http.client.HTTPConnection('127.0.0.1',state['server'].server_port,timeout=60)
            headers={'Content-Type':'application/json'}
            if token:headers['Authorization']='Bearer '+token
            connection.request('POST',path,json.dumps(body),headers)
            response=connection.getresponse();result=json.loads(response.read());connection.close()
            self.assertEqual(response.status,200)
            return result
        try:
            session=call('/password',{'email':'rotation@example.invalid','password':'rotation-password'})
            with Image.open(os.environ['FACE_TEST_PORTRAIT']) as source:
                buffer=io.BytesIO();source.convert('RGB').rotate(90,expand=True).save(buffer,format='JPEG',quality=90)
            result=call('/enroll',{'image':base64.b64encode(buffer.getvalue()).decode(),'consent':True},session['token'])
            self.assertTrue(result['enrolled'])
        finally:state['server'].shutdown();thread.join(5)

    def test_instrumented_actual_model_keyword_interface(self):
        from server import embed, initialize_models
        initialize_models() # Exercise the startup instrumentation, not only lazy model loading.
        with Image.open(os.environ['FACE_TEST_PORTRAIT']) as source:
            buffer=io.BytesIO();photo=source.convert('RGB');photo.thumbnail((1600,1600));photo.save(buffer,format='JPEG',quality=85)
        self.assertEqual(len(embed(buffer.getvalue())),128)

    @unittest.skipUnless(os.environ.get('FACE_TEST_NEGATIVE_PORTRAIT'), 'Set public fixture for observed real-model rejection.')
    def test_instrumented_actual_model_still_rejects_public_fixture(self):
        from server import embed, initialize_models
        initialize_models()
        with Image.open(os.environ['FACE_TEST_NEGATIVE_PORTRAIT']) as source:
            buffer=io.BytesIO();photo=source.convert('RGB');photo.thumbnail((1600,1600));photo.save(buffer,format='JPEG',quality=85)
        with self.assertRaises(AuthError) as caught: embed(buffer.getvalue())
        self.assertEqual(caught.exception.code,'liveness_rejected')

    def test_real_no_face_photo(self):
        from server import embed
        buffer=io.BytesIO();Image.new('RGB',(512,512),(120,120,120)).save(buffer,format='JPEG')
        with self.assertRaises(AuthError) as error:embed(buffer.getvalue())
        self.assertEqual(error.exception.code,'no_face')

if __name__ == '__main__':unittest.main()
