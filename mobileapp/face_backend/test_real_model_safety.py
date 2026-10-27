"""Optional negative check using a generated blank image, never a person's data."""
import os
import io
import unittest

@unittest.skipUnless(os.environ.get('FACE_TEST_REAL_MODELS') == '1', 'Enable real-model negative inference explicitly.')
class RealModelSafetyTests(unittest.TestCase):
    def test_blank_image_cannot_authenticate(self):
        from PIL import Image
        from server import embed
        from core import AuthError
        data=io.BytesIO()
        Image.new('RGB',(320,320),'white').save(data,format='JPEG')
        with self.assertRaises(AuthError):
            embed(data.getvalue())
