"""Compare labelled same-plant/different-plant pairs without fitting thresholds."""

import argparse
import base64
from bisect import bisect_left, bisect_right
import csv
from datetime import datetime, timezone
import gc
import hashlib
import html
from io import BytesIO
import json
import math
from pathlib import Path
import statistics
import time

from PIL import Image, ImageOps

from engine import EXTENSIONS, MODEL

HERE = Path(__file__).resolve().parent
MODELS = {
    "clip": ("ViT-B-32", "openai"),
    "bioclip": (MODEL, None),
}


def load_pairs(root):
    """Folder names are human-supplied ground truth, never model predictions."""
    root = Path(root).resolve()
    pairs, seen = [], {}
    for group, same in (("duplicate", True), ("non_duplicate", False)):
        folder = root / group
        if not folder.is_dir():
            raise ValueError(f"Missing folder: {folder}")
        if any(p.is_file() and p.suffix.lower() in EXTENSIONS for p in folder.iterdir()):
            raise ValueError(f"Put photos inside separate pair subfolders under {folder}.")
        for case in sorted(p for p in folder.iterdir() if p.is_dir()):
            photos = sorted(p.resolve() for p in case.rglob("*")
                            if p.is_file() and p.suffix.lower() in EXTENSIONS)
            if not photos:
                continue
            if len(photos) != 2:
                raise ValueError(f"{case}: expected exactly 2 photos, found {len(photos)}.")
            hashes = []
            for photo in photos:
                with Image.open(photo) as opened:
                    opened.verify()
                hashes.append(hashlib.sha256(photo.read_bytes()).hexdigest())
            if hashes[0] == hashes[1]:
                raise ValueError(f"{case}: identical files. Use separately captured photos.")
            identity = tuple(sorted(hashes))
            if identity in seen:
                raise ValueError(f"{case}: this photo pair already appears in {seen[identity]}.")
            seen[identity] = str(case)
            pairs.append({"pair": f"{group}/{case.name}", "same_plant": same,
                          "photos": photos, "sha256": hashes})
    if not any(p["same_plant"] for p in pairs) or not any(not p["same_plant"] for p in pairs):
        raise ValueError("Add at least one labelled pair to EACH group. Empty example folders are ignored.")
    return pairs


def auc(positive, negative):
    """Probability a positive scores above a negative; ties count as one half."""
    if not positive or not negative:
        raise ValueError("Both classes are needed for AUC.")
    if not all(math.isfinite(x) for x in [*positive, *negative]):
        raise ValueError("Scores must be finite.")
    ordered = sorted(negative)
    wins = sum((bisect_left(ordered, p) + bisect_right(ordered, p)) / 2 for p in positive)
    return wins / (len(positive) * len(negative))


def metrics(pairs, scores):
    if len(scores) != len(pairs) or not all(math.isfinite(s) for s in scores):
        raise ValueError("Every pair needs one finite score.")
    positive = [s for p, s in zip(pairs, scores) if p["same_plant"]]
    negative = [s for p, s in zip(pairs, scores) if not p["same_plant"]]
    return {"duplicate_pairs": len(positive), "non_duplicate_pairs": len(negative),
            "mean_duplicate_similarity": statistics.mean(positive),
            "mean_non_duplicate_similarity": statistics.mean(negative),
            "roc_auc": auc(positive, negative)}


def evaluate(pairs, model_key, device):
    # Heavy imports and weight downloads happen only after dataset validation.
    import numpy as np
    import open_clip
    import torch

    name, pretrained = MODELS[model_key]
    options = {"device": device, "cache_dir": str(HERE / ".cache" / "weights")}
    if pretrained:
        options["pretrained"] = pretrained
    print(f"Loading {model_key}: {name}, pretrained={pretrained}, device={device}", flush=True)
    model, _, preprocess = open_clip.create_model_and_transforms(name, **options)
    model.eval()
    paths = sorted({photo for pair in pairs for photo in pair["photos"]})
    vectors = {}
    started = time.perf_counter()
    try:
        with torch.inference_mode():
            for number, path in enumerate(paths, 1):
                with Image.open(path) as photo:
                    batch = preprocess(ImageOps.exif_transpose(photo).convert("RGB")).unsqueeze(0).to(device)
                vector = model.encode_image(batch, normalize=True)[0].float().cpu().numpy()
                norm = np.linalg.norm(vector)
                if not np.isfinite(vector).all() or not np.isfinite(norm) or norm <= 0:
                    raise ValueError(f"Invalid embedding: {path}")
                vectors[path] = vector / norm
                print(f"  {model_key}: {number}/{len(paths)} photos", flush=True)
        scores = [float(np.clip(np.dot(vectors[p["photos"][0]], vectors[p["photos"][1]]), -1, 1))
                  for p in pairs]
        details = metrics(pairs, scores)
        details.update(model=name, pretrained=pretrained, device=device,
                       unique_photo_paths=len(paths),
                       encoding_and_scoring_seconds=time.perf_counter() - started)
        return scores, details
    finally:
        del model
        gc.collect()
        if device == "cuda":
            torch.cuda.empty_cache()


def thumbnail(path):
    with Image.open(path) as photo:
        picture = ImageOps.exif_transpose(photo).convert("RGB")
        picture.thumbnail((280, 200))
        buffer = BytesIO()
        picture.save(buffer, format="JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def write_report(output, root, pairs, scores, summary):
    output.mkdir(parents=True, exist_ok=False)
    provenance = summary.get("label_provenance", {})
    pair_labels = {entry["pair"]: entry for entry in provenance.get("pairs", [])}
    with (output / "pair_scores.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(["pair", "same_plant", "photo_a", "photo_b", "sha256_a", "sha256_b",
                         "clip_cosine", "bioclip_cosine", "label_status"])
        for i, pair in enumerate(pairs):
            writer.writerow([pair["pair"], int(pair["same_plant"]),
                             *(str(p.relative_to(root)) for p in pair["photos"]),
                             *pair["sha256"], scores["clip"][i], scores["bioclip"][i],
                             pair_labels.get(pair["pair"], {}).get("label_status",
                                 provenance.get("status", "folder_labels"))])
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    model_rows = "".join(
        f"<tr><td>{name}</td><td>{summary[name]['roc_auc']:.4f}</td>"
        f"<td>{summary[name]['mean_duplicate_similarity']:.4f}</td>"
        f"<td>{summary[name]['mean_non_duplicate_similarity']:.4f}</td></tr>"
        for name in MODELS)
    label_note = provenance.get("note", "Labels were supplied through the pair folders.")
    cases = []
    for i, pair in enumerate(pairs):
        pictures = "".join(f'<img src="{thumbnail(p)}" alt="{html.escape(p.name, quote=True)}">'
                           for p in pair["photos"])
        label_status = pair_labels.get(pair["pair"], {}).get("label_status", provenance.get("status", "folder_labels"))
        cases.append(f"<article><h2>{html.escape(pair['pair'])}</h2>"
                     f"<p>Folder label: {'same physical plant' if pair['same_plant'] else 'different physical plants'}</p>"
                     f"<p>Label status: {html.escape(label_status)}</p>"
                     f"<div>{pictures}</div><p>CLIP cosine: {scores['clip'][i]:.4f} | "
                     f"BioCLIP 2 cosine: {scores['bioclip'][i]:.4f}</p></article>")
    report = f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plant pair model comparison</title>
<style>body{{font:16px system-ui;max-width:1000px;margin:32px auto;padding:0 20px;background:#f4f7f4;color:#17291e}}
table{{border-collapse:collapse;background:white}}td,th{{border:1px solid #becbbb;padding:10px;text-align:left}}
article{{background:white;padding:18px;margin:20px 0;border:1px solid #becbbb;border-radius:8px}}
img{{max-width:45%;height:200px;object-fit:contain;margin-right:12px}}h2{{font-size:18px}}</style>
<h1>CLIP and BioCLIP 2: labelled plant pairs</h1>
<p>{len(pairs)} labelled pairs. Created {html.escape(summary['created_at'])}.</p>
<p><strong>Label provenance:</strong> {html.escape(label_note)}</p>
<p>AUC measures whether same-plant pairs score above different-plant pairs within each model.
1.0 means perfect separation on these examples; 0.5 means chance-level ordering.
It is not duplicate-detection accuracy. No decision threshold was fitted.</p>
<table><tr><th>Model</th><th>ROC AUC</th><th>Mean same-plant score</th><th>Mean different-plant score</th></tr>{model_rows}</table>
<p>Compare AUC across models. Raw cosine scales are model-specific; a higher cosine alone does not mean a better result.</p>
<p>This is a descriptive pair-comparison experiment, not a top-five gallery retrieval test or proof of general superiority.
Results depend on correct human labels and representative, sufficiently independent examples.
The CLIP baseline is OpenAI ViT-B/32 loaded through OpenCLIP; BioCLIP 2 uses ViT-L/14.
Differences cannot be attributed solely to biological training.</p>
{''.join(cases)}</html>"""
    (output / "report.html").write_text(report, encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=HERE / "evaluation_photos")
    parser.add_argument("--check", action="store_true", help="Validate labels/files without loading models")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    args = parser.parse_args(argv)
    try:
        root = args.data.resolve()
        pairs = load_pairs(root)
        provenance_file = root / "label_provenance.json"
        provenance = json.loads(provenance_file.read_text(encoding="utf-8")) if provenance_file.exists() else {}
        if not isinstance(provenance, dict) or not isinstance(provenance.get("note", ""), str):
            raise ValueError("Invalid label_provenance.json: expected an object with a text note.")
        same = sum(p["same_plant"] for p in pairs)
        print(f"Validated {same} same-plant pairs and {len(pairs) - same} different-plant pairs.")
        if provenance.get("note"):
            print("Label provenance: " + provenance["note"])
        if min(same, len(pairs) - same) < 20:
            print("Small demonstration set: aim for at least 20 varied pairs per group for a preliminary study.")
        if args.check:
            return 0
        import torch
        import open_clip
        device = ("cuda" if torch.cuda.is_available() else "cpu") if args.device == "auto" else args.device
        summary = {"created_at": datetime.now(timezone.utc).isoformat(), "data_root": str(root),
                   "torch_version": torch.__version__, "open_clip_version": open_clip.__version__,
                   "threshold_fitted": False, "experiment": "labelled plant pair separation",
                   "label_provenance": provenance}
        scores = {}
        for name in MODELS:
            scores[name], summary[name] = evaluate(pairs, name, device)
            print(f"{name} AUC: {summary[name]['roc_auc']:.4f}", flush=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
        output = HERE / "comparison_results" / stamp
        write_report(output, root, pairs, scores, summary)
        print(f"Open report: {output / 'report.html'}")
        print("CSV and JSON are saved alongside the report. Both models are reported regardless of the winner.")
        return 0
    except (OSError, ValueError, ImportError, RuntimeError) as error:
        print(f"Comparison stopped: {error}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
