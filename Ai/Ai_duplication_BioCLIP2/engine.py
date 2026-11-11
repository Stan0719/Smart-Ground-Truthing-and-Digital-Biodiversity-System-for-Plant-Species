"""Pretrained BioCLIP 2 image retrieval; no training or original-project imports."""

import hashlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

MODEL = "hf-hub:imageomics/bioclip-2"
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif"}


def scan_images(folder):
    folder = Path(folder).resolve()
    if not folder.is_dir():
        raise ValueError("Choose an existing reference photo folder.")
    return sorted(p.resolve() for p in folder.rglob("*")
                  if p.is_file() and p.suffix.lower() in EXTENSIONS)


def rank_matches(query, paths, features, query_path=None, top_k=5):
    """Cosine ranking with self-exclusion; scores are not probabilities."""
    if top_k < 1:
        raise ValueError("Top K must be at least 1.")
    if not paths:
        return []
    matrix = np.asarray(features, dtype=np.float32)
    vector = np.asarray(query, dtype=np.float32).reshape(-1)
    if matrix.ndim != 2 or matrix.shape != (len(paths), vector.size):
        raise ValueError("Image features do not have matching dimensions.")
    norms = np.linalg.norm(matrix, axis=1)
    query_norm = np.linalg.norm(vector)
    if (not np.isfinite(matrix).all() or not np.isfinite(vector).all()
            or query_norm == 0 or np.any(norms == 0)):
        raise ValueError("Invalid image features; rebuild the reference index.")
    scores = np.clip((matrix @ vector) / (norms * query_norm), -1, 1)
    query_path = Path(query_path).resolve() if query_path else None
    indices = np.argsort(-scores, kind="stable")
    return [(str(paths[i]), float(scores[i])) for i in indices
            if query_path is None or Path(paths[i]).resolve() != query_path][:top_k]


class BioCLIPSearch:
    def __init__(self, cache_dir, log=print):
        # Loading is deferred until the GUI's worker thread starts indexing.
        import torch
        import open_clip

        self.torch = torch
        self.log = log
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        log(f"Loading {MODEL} on {self.device}. First run downloads pretrained weights.")
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            MODEL, device=self.device, cache_dir=str(self.cache_dir / "weights"))
        self.model.eval()
        self.paths = []
        self.features = []

    def embed(self, path):
        path = Path(path).resolve()
        stat = path.stat()
        identity = f"{MODEL}:exif-rgb-v1:{path}:{stat.st_size}:{stat.st_mtime_ns}"
        key = hashlib.sha256(identity.encode()).hexdigest()
        cache_file = self.cache_dir / f"{key}.npy"
        if cache_file.exists():
            try:
                vector = np.load(cache_file, allow_pickle=False)
                if (vector.ndim == 1 and np.isfinite(vector).all()
                        and np.linalg.norm(vector) > 0):
                    return vector
            except (OSError, ValueError):
                pass
        with Image.open(path) as original:
            image = ImageOps.exif_transpose(original).convert("RGB")
            batch = self.preprocess(image).unsqueeze(0).to(self.device)
        with self.torch.inference_mode():
            vector = self.model.encode_image(batch, normalize=True)
        vector = vector[0].float().cpu().numpy()
        # A failed cache write should not prevent retrieval.
        try:
            np.save(cache_file, vector, allow_pickle=False)
        except OSError as error:
            self.log(f"Could not cache {path.name}: {error}")
        return vector

    def index(self, folder):
        paths = scan_images(folder)
        if not paths:
            raise ValueError("No supported images were found in that folder.")
        self.paths, self.features = [], []
        for number, path in enumerate(paths, 1):
            try:
                vector = self.embed(path)
            except (OSError, ValueError) as error:
                self.log(f"Skipped {path.name}: {error}")
                continue
            self.paths.append(path)
            self.features.append(vector)
            self.log(f"Indexed {number}/{len(paths)}: {path.name}")
        if not self.paths:
            raise ValueError("None of the reference images could be processed.")
        return self.paths

    def search(self, query_path, top_k=5):
        if not self.paths:
            raise ValueError("Index the reference folder first.")
        return rank_matches(self.embed(query_path), self.paths, self.features,
                            query_path=query_path, top_k=top_k)
