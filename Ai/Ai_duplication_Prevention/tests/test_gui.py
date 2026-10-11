import tempfile
import time
import tkinter as tk
import unittest
from pathlib import Path
from unittest.mock import patch

from duplicate_images.gui import DuplicateImagesApp


class DesktopScanTests(unittest.TestCase):
    def test_scan_previews_export_and_empty_folder(self):
        root = tk.Tk()
        root.withdraw()
        app = DuplicateImagesApp(root)
        errors = []
        try:
            with patch("duplicate_images.gui.messagebox.showerror", side_effect=lambda *args: errors.append(args)):
                app.folder.set(str(Path("Plants").resolve()))
                app.start_scan()
                self.wait_for_scan(root, app)
                self.assertEqual(errors, [])
                self.assertEqual(len(app.groups), 1)
                root.update()
                app.show_group()
                self.assertEqual(len(app.photos), 2)
                with tempfile.TemporaryDirectory(dir=Path.cwd()) as folder:
                    output = Path(folder) / "results.json"
                    with patch("duplicate_images.gui.filedialog.asksaveasfilename", return_value=str(output)):
                        app.export()
                    self.assertIn('"average_similarity"', output.read_text())
                    output.unlink()
                    app.folder.set(folder)
                    app.start_scan()
                    self.wait_for_scan(root, app)
                    self.assertEqual(app.groups, [])
                    self.assertEqual(errors, [])
        finally:
            root.destroy()

    def wait_for_scan(self, root, app):
        deadline = time.monotonic() + 90
        while app.scanning and time.monotonic() < deadline:
            root.update()
            time.sleep(0.02)
        self.assertFalse(app.scanning, "Scan did not complete")
