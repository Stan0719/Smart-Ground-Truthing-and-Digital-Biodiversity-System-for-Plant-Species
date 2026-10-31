import pathlib
import subprocess
import unittest
from unittest.mock import patch
from account_service import require_private_key


class KeyPermissionsTests(unittest.TestCase):
    def test_windows_uses_acl_validation_not_posix_mode_bits(self):
        path=pathlib.Path(__file__)
        with patch('account_service.os.name', 'nt'), patch('account_service.subprocess.run') as run:
            require_private_key(path)
            self.assertIn('AreAccessRulesProtected', run.call_args.args[0][-1])
            self.assertTrue(run.call_args.kwargs['check'])

    def test_windows_acl_validation_failure_rejects_key(self):
        path=pathlib.Path(__file__)
        with patch('account_service.os.name', 'nt'), patch('account_service.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'acl')):
            with self.assertRaisesRegex(ValueError, 'private Windows ACL'):
                require_private_key(path)


if __name__ == '__main__':
    unittest.main()
