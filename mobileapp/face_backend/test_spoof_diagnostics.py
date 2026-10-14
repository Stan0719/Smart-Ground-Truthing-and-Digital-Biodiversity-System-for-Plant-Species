import unittest
import numpy as np
from spoof_diagnostics import instrument_spoof_model

class SpoofDiagnosticTests(unittest.TestCase):
    def test_exact_deepface_keyword_call_preserves_rejection_and_does_not_retry(self):
        class Model:
            calls = 0
            def analyze(self, img, facial_area):
                self.calls += 1
                self.image = img
                self.area = facial_area
                return False, 0.9
        model = Model()
        instrument_spoof_model(model)
        instrument_spoof_model(model)
        image = np.zeros((100, 120, 3), dtype=np.uint8)
        self.assertEqual(model.analyze(img=image, facial_area=(10, 10, 40, 40)), (False, 0.9))
        self.assertIs(model.image, image)
        self.assertEqual(model.area, (10, 10, 40, 40))
        self.assertEqual(model.calls, 1)

    def test_acceptance_is_also_unchanged(self):
        class Model:
            def analyze(self, img, facial_area): return True, 0.7
        model = instrument_spoof_model(Model())
        self.assertEqual(model.analyze(img=np.zeros((100, 100, 3),dtype=np.uint8),facial_area=(5,5,40,40)),(True,0.7))

    def test_internal_exception_is_not_changed_to_a_model_decision(self):
        class Model:
            def analyze(self, img, facial_area): raise TypeError('controlled integration failure')
        model = instrument_spoof_model(Model())
        with self.assertRaises(TypeError): model.analyze(img=np.zeros((100,100,3),dtype=np.uint8),facial_area=(5,5,40,40))
