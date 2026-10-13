import contextlib
import io
import json
import os
import unittest
from unittest.mock import patch
from matching_diagnostics import matching_diagnostic


class MatchingDiagnosticsTests(unittest.TestCase):
    def test_closest_distance_is_rounded_opt_in_server_metadata(self):
        output=io.StringIO()
        with patch.dict(os.environ,{'FACE_IMAGE_DEBUG':'1'}),contextlib.redirect_stdout(output):
            matching_diagnostic([.512345,.363812],threshold=.3,matchedAccounts=0)
        data=json.loads(output.getvalue())
        self.assertEqual(data['closestDistance'],.3638)
        self.assertEqual(data['comparedTemplates'],2)
        self.assertEqual(set(data),{'event','reference','metric','closestDistance','comparedTemplates','threshold','matchedAccounts'})
        with patch.dict(os.environ,{'FACE_IMAGE_DEBUG':'0'}),contextlib.redirect_stdout(io.StringIO()) as silent:
            matching_diagnostic([.3])
        self.assertEqual(silent.getvalue(),'')

    def test_empty_gallery_has_no_invented_distance(self):
        with patch.dict(os.environ,{'FACE_IMAGE_DEBUG':'1'}),contextlib.redirect_stdout(io.StringIO()) as output:
            matching_diagnostic([])
        self.assertIsNone(json.loads(output.getvalue())['closestDistance'])
