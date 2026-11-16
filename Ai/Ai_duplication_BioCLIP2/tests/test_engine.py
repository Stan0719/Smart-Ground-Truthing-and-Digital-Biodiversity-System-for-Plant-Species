from contextlib import contextmanager
import shutil
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock

import numpy as np

from engine import BioCLIPSearch, rank_matches, scan_images


@contextmanager
def temporary_folder():
    # Default directory permissions also work under restricted Windows runners.
    folder = Path(__file__).resolve().parent.parent / f"test-{uuid.uuid4().hex}"
    folder.mkdir()
    try:
        yield folder
    finally:
        shutil.rmtree(folder)


class RetrievalTests(unittest.TestCase):
    def test_ranking_excludes_query_and_retains_weak_matches(self):
        paths = [Path("query.jpg"), Path("weak.jpg"), Path("match.jpg")]
        results = rank_matches([1, 0], paths, [[1, 0], [0, 1], [2, 1]],
                               query_path="query.jpg", top_k=5)
        self.assertEqual([Path(p).name for p, _ in results], ["match.jpg", "weak.jpg"])
        self.assertAlmostEqual(results[0][1], 2 / np.sqrt(5), places=6)
        self.assertEqual(results[1][1], 0)

    def test_invalid_features_are_rejected(self):
        with self.assertRaises(ValueError):
            rank_matches([0, 0], ["a.jpg"], [[1, 0]])

    def test_recursive_scan_and_empty_search(self):
        with temporary_folder() as directory:
            nested = Path(directory) / "nested"
            nested.mkdir()
            photo = nested / "plant.JPG"
            photo.touch()
            (nested / "notes.txt").touch()
            self.assertEqual(scan_images(directory), [photo.resolve()])
        self.assertEqual(rank_matches([1, 0], [], []), [])

    def test_cache_hit_and_changed_photo_invalidation_without_model(self):
        with temporary_folder() as directory:
            base = Path(directory)
            image = base / "plant.jpg"
            image.write_bytes(b"first")
            search = BioCLIPSearch.__new__(BioCLIPSearch)
            search.cache_dir = base
            search.log = Mock()
            import hashlib
            from engine import MODEL
            stat = image.stat()
            identity = f"{MODEL}:exif-rgb-v1:{image.resolve()}:{stat.st_size}:{stat.st_mtime_ns}"
            key = hashlib.sha256(identity.encode()).hexdigest()
            np.save(base / f"{key}.npy", [1., 0.])
            np.testing.assert_array_equal(search.embed(image), [1., 0.])
            image.write_bytes(b"changed photo")
            # Invalid new image must be read instead of returning stale cached features.
            with self.assertRaises(OSError):
                search.embed(image)


if __name__ == "__main__":
    unittest.main()
