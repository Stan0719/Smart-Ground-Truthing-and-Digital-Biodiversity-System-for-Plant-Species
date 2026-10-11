"""Embedding cache for storing and retrieving image embeddings."""

import os
import hashlib
import pickle
from pathlib import Path
from typing import Optional, Dict
import numpy as np

from ..config.defaults import get_embeddings_cache_dir


class EmbeddingCache:
    """Cache for storing image embeddings to avoid recomputation."""

    def __init__(self, cache_dir: Optional[Path] = None, enabled: bool = True):
        """
        Initialize the embedding cache.

        Args:
            cache_dir: Directory to store cached embeddings
            enabled: Whether caching is enabled
        """
        self.enabled = enabled
        if cache_dir is None:
            cache_dir = get_embeddings_cache_dir()
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._cache_index = self._load_cache_index()

    def _load_cache_index(self) -> Dict[str, dict]:
        """Load the cache index from disk."""
        index_file = self.cache_dir / "cache_index.pkl"
        if index_file.exists():
            try:
                with open(index_file, "rb") as f:
                    return pickle.load(f)
            except Exception as e:
                print(f"Warning: Failed to load cache index: {e}")
                return {}
        return {}

    def _save_cache_index(self):
        """Save the cache index to disk."""
        index_file = self.cache_dir / "cache_index.pkl"
        try:
            with open(index_file, "wb") as f:
                pickle.dump(self._cache_index, f)
        except Exception as e:
            print(f"Warning: Failed to save cache index: {e}")

    def _generate_cache_key(self, image_path: str) -> str:
        """
        Generate a cache key for an image based on path and file metadata.

        Args:
            image_path: Path to the image file

        Returns:
            Cache key (hash string)
        """
        try:
            # Get file stats
            stat = os.stat(image_path)
            # Combine path, size, and modification time
            key_data = f"{image_path}:{stat.st_size}:{stat.st_mtime}"
            # Generate hash
            cache_key = hashlib.sha256(key_data.encode()).hexdigest()
            return cache_key
        except Exception as e:
            print(f"Warning: Failed to generate cache key for {image_path}: {e}")
            # Fallback to path-only hash
            return hashlib.sha256(image_path.encode()).hexdigest()

    def _get_cache_file_path(self, cache_key: str) -> Path:
        """Get the file path for a cached embedding."""
        # Use first 2 chars of hash for subdirectory (better filesystem performance)
        subdir = self.cache_dir / cache_key[:2]
        subdir.mkdir(exist_ok=True)
        return subdir / f"{cache_key}.npz"

    def get(self, image_path: str) -> Optional[np.ndarray]:
        """
        Retrieve cached embedding for an image.

        Args:
            image_path: Path to the image file

        Returns:
            Cached embedding (numpy array) or None if not found/invalid
        """
        if not self.enabled:
            return None

        try:
            # Generate cache key
            cache_key = self._generate_cache_key(image_path)

            # Check if cached
            if cache_key not in self._cache_index:
                return None

            # Load from disk
            cache_file = self._get_cache_file_path(cache_key)
            if not cache_file.exists():
                # Cache index out of sync
                del self._cache_index[cache_key]
                return None

            # Load embedding
            data = np.load(cache_file)
            embedding = data["embedding"]

            # Verify the cached image path matches (handle moves/renames)
            cached_path = self._cache_index[cache_key].get("path")
            if cached_path != image_path:
                # Path changed, update index
                self._cache_index[cache_key]["path"] = image_path
                self._save_cache_index()

            return embedding

        except Exception as e:
            print(f"Warning: Failed to load cached embedding for {image_path}: {e}")
            return None

    def set(self, image_path: str, embedding: np.ndarray):
        """
        Store an embedding in the cache.

        Args:
            image_path: Path to the image file
            embedding: Image embedding (numpy array)
        """
        if not self.enabled:
            return

        try:
            # Generate cache key
            cache_key = self._generate_cache_key(image_path)

            # Save embedding to disk
            cache_file = self._get_cache_file_path(cache_key)
            np.savez_compressed(cache_file, embedding=embedding)

            # Update index
            self._cache_index[cache_key] = {
                "path": image_path,
                "shape": embedding.shape,
            }

            # Save index periodically (every 100 entries)
            if len(self._cache_index) % 100 == 0:
                self._save_cache_index()

        except Exception as e:
            print(f"Warning: Failed to cache embedding for {image_path}: {e}")

    def clear(self):
        """Clear all cached embeddings."""
        try:
            # Remove all cache files
            for cache_file in self.cache_dir.rglob("*.npz"):
                cache_file.unlink()

            # Clear index
            self._cache_index = {}
            self._save_cache_index()

            print(f"Cache cleared: {self.cache_dir}")
        except Exception as e:
            print(f"Warning: Failed to clear cache: {e}")

    def get_cache_stats(self) -> dict:
        """Get statistics about the cache."""
        total_files = len(self._cache_index)
        total_size = sum(
            f.stat().st_size for f in self.cache_dir.rglob("*.npz") if f.is_file()
        )

        return {
            "total_cached_images": total_files,
            "total_size_bytes": total_size,
            "total_size_mb": total_size / (1024 * 1024),
            "cache_directory": str(self.cache_dir),
        }

    def __del__(self):
        """Save cache index when object is destroyed."""
        if hasattr(self, "_cache_index"):
            self._save_cache_index()
