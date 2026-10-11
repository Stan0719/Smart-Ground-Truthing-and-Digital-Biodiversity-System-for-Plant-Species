import unittest
from types import SimpleNamespace
from unittest.mock import Mock

import torch

from duplicate_images.ml.feature_extractor import FeatureExtractor


class FeatureOutputCompatibilityTests(unittest.TestCase):
    def test_tensor_and_model_output_return_projected_embeddings(self):
        expected = torch.tensor([[3.0, 4.0]])
        inputs = {"pixel_values": torch.zeros(1, 3, 32, 32)}
        for output in (expected, SimpleNamespace(pooler_output=expected)):
            with self.subTest(output_type=type(output).__name__):
                extractor = FeatureExtractor.__new__(FeatureExtractor)
                extractor.model = Mock()
                extractor.model.get_image_features.return_value = output

                actual = extractor._get_image_features(inputs)

                self.assertIs(actual, expected)
                normalized = actual / actual.norm(dim=-1, keepdim=True)
                torch.testing.assert_close(normalized, torch.tensor([[0.6, 0.8]]))
                extractor.model.get_image_features.assert_called_once_with(**inputs)
