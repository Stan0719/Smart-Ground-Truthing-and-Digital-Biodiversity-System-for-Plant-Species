import csv
from pathlib import Path
import unittest

from PIL import Image

from compare_models import auc, load_pairs, metrics, write_report
from test_engine import temporary_folder


HERE = Path(__file__).resolve().parent.parent


def photo(path, color):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (20, 20), color).save(path)


def dataset(root):
    for group, colors in (("duplicate", ("red", "green")),
                          ("non_duplicate", ("blue", "yellow"))):
        for name, color in zip(("a.png", "b.png"), colors):
            photo(root / group / "case" / name, color)


class PairComparisonTests(unittest.TestCase):
    def test_auc_counts_ties_and_ordering_without_a_threshold(self):
        self.assertEqual(auc([0.8, 0.9], [0.1, 0.2]), 1)
        self.assertEqual(auc([0.1, 0.2], [0.8, 0.9]), 0)
        self.assertEqual(auc([0.5], [0.5]), 0.5)
        self.assertEqual(auc([0.5, 0.9], [0.1, 0.5]), 0.875)
        for positive, negative in (([], [1]), ([1], []), ([float("nan")], [0])):
            with self.assertRaises(ValueError):
                auc(positive, negative)

    def test_labels_come_from_folders_and_empty_examples_are_ignored(self):
        with temporary_folder() as temporary:
            root = Path(temporary)
            dataset(root)
            (root / "duplicate" / "empty-example").mkdir()
            for group in ("needs_review", "image_copy_examples"):
                for index, color in enumerate(("purple", "orange", "black")):
                    photo(root / group / "excluded" / f"{index}.png", color)
            pairs = load_pairs(root)
            self.assertEqual([p["same_plant"] for p in pairs], [True, False])
            result = metrics(pairs, [0.9, 0.2])
            self.assertEqual(result["roc_auc"], 1)
            self.assertEqual(result["duplicate_pairs"], 1)
            with self.assertRaises(ValueError):
                metrics(pairs, [0.9])

    def test_pair_needs_two_readable_photos(self):
        with temporary_folder() as temporary:
            root = Path(temporary)
            dataset(root)
            photo(root / "duplicate" / "case" / "third.png", "black")
            with self.assertRaisesRegex(ValueError, "exactly 2"):
                load_pairs(root)

    def test_identical_files_and_repeated_pairs_are_rejected(self):
        with temporary_folder() as temporary:
            root = Path(temporary)
            dataset(root)
            first = root / "duplicate" / "case" / "a.png"
            second = root / "duplicate" / "case" / "b.png"
            second.write_bytes(first.read_bytes())
            with self.assertRaisesRegex(ValueError, "identical files"):
                load_pairs(root)
            photo(second, "green")
            for source, target in ((first, "b.png"), (second, "a.png")):
                (root / "non_duplicate" / "case" / target).write_bytes(source.read_bytes())
            with self.assertRaisesRegex(ValueError, "already appears"):
                load_pairs(root)

    def test_both_label_groups_are_required(self):
        with temporary_folder() as temporary:
            root = Path(temporary)
            dataset(root)
            for item in (root / "non_duplicate" / "case").iterdir():
                item.unlink()
            with self.assertRaisesRegex(ValueError, "EACH group"):
                load_pairs(root)

    def test_report_contains_portable_photos_and_preserves_both_models(self):
        with temporary_folder() as temporary:
            root = Path(temporary)
            dataset(root)
            pairs = load_pairs(root)
            pairs[0]["pair"] = 'duplicate/<script>alert("x")</script>'
            scores = {"clip": [0.9, 0.1], "bioclip": [0.2, 0.8]}
            summary = {name: metrics(pairs, values) for name, values in scores.items()}
            summary["created_at"] = "synthetic unit test"
            summary["label_provenance"] = {
                "status": "partially_user_confirmed", "note": "Provisional labels <not confirmed>",
                "pairs": [{"pair": pairs[0]["pair"], "label_status": "user_confirmed"},
                          {"pair": pairs[1]["pair"], "label_status": "provisional_visual_review"}]}
            output = root / "results"
            write_report(output, root, pairs, scores, summary)
            report = (output / "report.html").read_text(encoding="utf-8")
            self.assertIn("data:image/jpeg;base64,", report)
            self.assertIn("&lt;script&gt;", report)
            self.assertIn("Provisional labels &lt;not confirmed&gt;", report)
            self.assertNotIn('<script>alert("x")</script>', report)
            self.assertIn("0.0000", report)
            self.assertIn("1.0000", report)
            self.assertTrue((output / "pair_scores.csv").is_file())
            self.assertIn("provisional_visual_review", (output / "pair_scores.csv").read_text(encoding="utf-8-sig"))
            with (output / "pair_scores.csv").open(encoding="utf-8-sig", newline="") as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual([row["label_status"] for row in rows], ["user_confirmed", "provisional_visual_review"])
            self.assertIn("Label status: user_confirmed", report)
            self.assertIn("Label status: provisional_visual_review", report)
            self.assertTrue((output / "summary.json").is_file())


if __name__ == "__main__":
    unittest.main()
