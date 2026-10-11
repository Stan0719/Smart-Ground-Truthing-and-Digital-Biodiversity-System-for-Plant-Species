"""Default configuration for duplicate image detection."""

import os
from pathlib import Path

# Default cache directory
DEFAULT_CACHE_DIR = os.path.expanduser("~/.cache/duplicate-images")

# Default configuration dictionary
DEFAULT_CONFIG = {
    "model": {
        "name": "clip",  # Model type: clip, resnet50, efficientnet
        "variant": "openai/clip-vit-base-patch32",  # HuggingFace model name
        "device": "auto",  # Device: auto, cpu, cuda, mps
    },
    "similarity": {
        "threshold": 0.90,  # Similarity threshold (0-1)
        "metric": "cosine",  # Similarity metric: cosine, euclidean
    },
    "cache": {
        "enabled": True,  # Enable embedding caching
        "directory": DEFAULT_CACHE_DIR,  # Cache directory path
    },
    "processing": {
        "batch_size": 32,  # Batch size for feature extraction
        "num_workers": 4,  # Number of worker threads for data loading
        "image_size": 224,  # Input image size for model
    },
    "output": {
        "format": "table",  # Output format: table, json, csv
        "verbose": True,  # Verbose output
    },
    "image_extensions": [
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp",
        ".JPG", ".JPEG", ".PNG", ".GIF", ".BMP", ".TIFF", ".TIF", ".WEBP",
    ],
}


def get_cache_dir() -> Path:
    """Get the cache directory path, creating it if necessary."""
    cache_dir = Path(DEFAULT_CACHE_DIR)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def get_embeddings_cache_dir() -> Path:
    """Get the embeddings cache directory path."""
    embeddings_dir = get_cache_dir() / "embeddings"
    embeddings_dir.mkdir(parents=True, exist_ok=True)
    return embeddings_dir


def get_models_cache_dir() -> Path:
    """Get the models cache directory path."""
    models_dir = get_cache_dir() / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    return models_dir
