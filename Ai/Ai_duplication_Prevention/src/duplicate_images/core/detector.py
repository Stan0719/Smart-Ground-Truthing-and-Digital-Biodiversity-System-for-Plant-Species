"""Main duplicate detection orchestrator."""

from typing import List, Optional
from pathlib import Path

from ..ml.feature_extractor import FeatureExtractor
from ..ml.similarity_engine import SimilarityEngine, DuplicateGroup
from ..ml.cache import EmbeddingCache
from ..core.scanner import ImageScanner
from ..config.defaults import DEFAULT_CONFIG


class DuplicateDetector:
    """Main orchestrator for duplicate image detection."""

    def __init__(
        self,
        model_name: str = "openai/clip-vit-base-patch32",
        device: Optional[str] = None,
        cache_enabled: bool = True,
        cache_dir: Optional[Path] = None,
    ):
        """
        Initialize the duplicate detector.

        Args:
            model_name: HuggingFace model name for feature extraction
            device: Device to use (auto, cpu, cuda, mps)
            cache_enabled: Whether to enable embedding caching
            cache_dir: Directory for caching embeddings
        """
        print("Initializing Duplicate Detector...")

        # Initialize components
        self.scanner = ImageScanner()
        self.feature_extractor = FeatureExtractor(model_name=model_name, device=device)
        self.similarity_engine = SimilarityEngine(metric="cosine")
        self.cache = EmbeddingCache(cache_dir=cache_dir, enabled=cache_enabled)

        print("Initialization complete!")

    def detect(
        self,
        directory: str,
        threshold: float = 0.90,
        recursive: bool = True,
        batch_size: int = 32,
    ) -> List[DuplicateGroup]:
        """
        Detect duplicate images in a directory.

        Args:
            directory: Directory path to scan
            threshold: Similarity threshold (0-1)
            recursive: Whether to scan subdirectories
            batch_size: Batch size for feature extraction

        Returns:
            List of DuplicateGroup objects
        """
        print(f"\n{'='*60}")
        print(f"Scanning directory: {directory}")
        print(f"Similarity threshold: {threshold}")
        print(f"{'='*60}\n")

        # Step 1: Scan for images
        print("Step 1/4: Scanning for images...")
        image_paths = self.scanner.scan(directory, recursive=recursive)
        print(f"Found {len(image_paths)} images\n")

        if len(image_paths) == 0:
            print("No images found!")
            return []

        # Step 2: Extract embeddings (with caching)
        print("Step 2/4: Extracting image embeddings...")
        embeddings = self._extract_embeddings_with_cache(image_paths, batch_size)
        print(f"Extracted embeddings for {len(embeddings)} images\n")

        if len(embeddings) < 2:
            print("Not enough images to find duplicates!")
            return []

        # Step 3: Build similarity index
        print("Step 3/4: Building similarity index...")
        self.similarity_engine.build_index(embeddings)
        print("Index built successfully\n")

        # Step 4: Find duplicates
        print("Step 4/4: Finding duplicate groups...")
        duplicate_groups = self.similarity_engine.find_duplicates(threshold=threshold)
        print(f"Found {len(duplicate_groups)} duplicate groups\n")

        return duplicate_groups

    def _extract_embeddings_with_cache(
        self, image_paths: List[str], batch_size: int
    ) -> dict:
        """
        Extract embeddings using cache when possible.

        Args:
            image_paths: List of image paths
            batch_size: Batch size for feature extraction

        Returns:
            Dictionary mapping image paths to embeddings
        """
        embeddings = {}
        images_to_process = []

        # Check cache first
        cache_hits = 0
        for path in image_paths:
            cached_embedding = self.cache.get(path)
            if cached_embedding is not None:
                embeddings[path] = cached_embedding
                cache_hits += 1
            else:
                images_to_process.append(path)

        if cache_hits > 0:
            print(f"  Loaded {cache_hits} embeddings from cache")

        # Extract embeddings for uncached images
        if images_to_process:
            print(f"  Extracting embeddings for {len(images_to_process)} new images...")
            new_embeddings = self.feature_extractor.extract_batch(
                images_to_process, batch_size=batch_size, show_progress=True
            )

            # Add to cache and results
            for path, embedding in new_embeddings.items():
                self.cache.set(path, embedding)
                embeddings[path] = embedding

        return embeddings

    def find_similar_to_image(
        self, query_image: str, search_directory: str, threshold: float = 0.85, top_k: int = 10
    ) -> List[tuple]:
        """
        Find images similar to a specific query image.

        Args:
            query_image: Path to the query image
            search_directory: Directory to search in
            threshold: Minimum similarity threshold
            top_k: Maximum number of results

        Returns:
            List of (image_path, similarity_score) tuples
        """
        print(f"\nSearching for images similar to: {query_image}")
        print(f"Search directory: {search_directory}")
        print(f"Threshold: {threshold}\n")

        # Extract query embedding
        print("Extracting query image features...")
        query_embedding = self.feature_extractor.extract_single(query_image)
        if query_embedding is None:
            raise ValueError(f"Failed to extract features from query image: {query_image}")

        # Scan search directory
        print("Scanning search directory...")
        image_paths = self.scanner.scan(search_directory, recursive=True)
        print(f"Found {len(image_paths)} images")

        # Extract embeddings
        print("Extracting embeddings...")
        embeddings = self._extract_embeddings_with_cache(
            image_paths, batch_size=DEFAULT_CONFIG["processing"]["batch_size"]
        )

        # Build index
        print("Building search index...")
        self.similarity_engine.build_index(embeddings)

        # Find similar images
        print(f"Finding top {top_k} similar images...")
        results = self.similarity_engine.find_similar(
            query_embedding, threshold=threshold, k=top_k
        )

        print(f"\nFound {len(results)} similar images")
        return results

    def get_cache_stats(self) -> dict:
        """Get cache statistics."""
        return self.cache.get_cache_stats()

    def clear_cache(self):
        """Clear the embedding cache."""
        self.cache.clear()
