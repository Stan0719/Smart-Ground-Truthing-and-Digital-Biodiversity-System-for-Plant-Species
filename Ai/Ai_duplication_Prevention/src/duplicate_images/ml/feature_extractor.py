"""Feature extraction using CLIP model for semantic image embeddings."""

import os
from typing import List, Optional, Union
from pathlib import Path

import torch
import numpy as np
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
from tqdm import tqdm

from ..config.defaults import DEFAULT_CONFIG


class FeatureExtractor:
    """Extract image embeddings using CLIP model for semantic similarity."""

    def __init__(
        self,
        model_name: str = "openai/clip-vit-base-patch32",
        device: Optional[str] = None,
    ):
        """
        Initialize the feature extractor.

        Args:
            model_name: HuggingFace model name (default: CLIP ViT-B/32)
            device: Device to use (auto, cpu, cuda, mps). If None, auto-detect.
        """
        self.model_name = model_name
        self.device = self._get_device(device)

        print(f"Loading CLIP model '{model_name}' on device '{self.device}'...")
        self.model = CLIPModel.from_pretrained(model_name).to(self.device)
        self.processor = CLIPProcessor.from_pretrained(model_name)
        self.model.eval()  # Set to evaluation mode

        print(f"Model loaded successfully on {self.device}")

    def _get_device(self, device: Optional[str]) -> str:
        """Determine which device to use for inference."""
        if device and device != "auto":
            return device

        # Auto-detect device
        if torch.cuda.is_available():
            return "cuda"
        elif torch.backends.mps.is_available():
            return "mps"
        else:
            return "cpu"

    def _load_image(self, image_path: Union[str, Path]) -> Optional[Image.Image]:
        """
        Load an image from disk.

        Args:
            image_path: Path to the image file

        Returns:
            PIL Image or None if loading fails
        """
        try:
            image = Image.open(image_path).convert("RGB")
            return image
        except Exception as e:
            print(f"Warning: Failed to load image {image_path}: {e}")
            return None

    def extract_single(self, image_path: Union[str, Path]) -> Optional[np.ndarray]:
        """
        Extract features from a single image.

        Args:
            image_path: Path to the image file

        Returns:
            Normalized feature vector (numpy array) or None if extraction fails
        """
        image = self._load_image(image_path)
        if image is None:
            return None

        try:
            # Preprocess image
            inputs = self.processor(images=image, return_tensors="pt")
            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            # Extract features
            with torch.no_grad():
                image_features = self._get_image_features(inputs)

            # Normalize for cosine similarity
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)

            # Convert to numpy
            embedding = image_features.cpu().numpy().squeeze()
            return embedding

        except Exception as e:
            print(f"Warning: Failed to extract features from {image_path}: {e}")
            return None

    def _get_image_features(self, inputs: dict) -> torch.Tensor:
        features = self.model.get_image_features(**inputs)
        # Transformers 5 returns a model output containing the projected features.
        if not isinstance(features, torch.Tensor):
            features = features.pooler_output
        return features

    def extract_batch(
        self,
        image_paths: List[Union[str, Path]],
        batch_size: int = 32,
        show_progress: bool = True,
    ) -> dict:
        """
        Extract features from a batch of images.

        Args:
            image_paths: List of image file paths
            batch_size: Number of images to process at once
            show_progress: Whether to show a progress bar

        Returns:
            Dictionary mapping image paths to embeddings (numpy arrays)
        """
        embeddings = {}
        failed_images = []

        # Process in batches
        iterator = range(0, len(image_paths), batch_size)
        if show_progress:
            iterator = tqdm(iterator, desc="Extracting features", unit="batch")

        for i in iterator:
            batch_paths = image_paths[i : i + batch_size]

            # Load images
            images = []
            valid_paths = []
            for path in batch_paths:
                img = self._load_image(path)
                if img is not None:
                    images.append(img)
                    valid_paths.append(str(path))
                else:
                    failed_images.append(str(path))

            if not images:
                continue

            try:
                # Preprocess batch
                inputs = self.processor(images=images, return_tensors="pt", padding=True)
                inputs = {k: v.to(self.device) for k, v in inputs.items()}

                # Extract features
                with torch.no_grad():
                    image_features = self._get_image_features(inputs)

                # Normalize for cosine similarity
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)

                # Convert to numpy and store
                features_np = image_features.cpu().numpy()
                for path, features in zip(valid_paths, features_np):
                    embeddings[path] = features

            except Exception as e:
                print(f"\nWarning: Batch processing failed: {e}")
                # Fall back to individual processing for this batch
                for path in valid_paths:
                    embedding = self.extract_single(path)
                    if embedding is not None:
                        embeddings[str(path)] = embedding
                    else:
                        failed_images.append(str(path))

        if failed_images:
            print(f"\nWarning: Failed to process {len(failed_images)} images")

        return embeddings

    def get_embedding_dimension(self) -> int:
        """Get the dimensionality of the embeddings."""
        # CLIP ViT-B/32 produces 512-dimensional embeddings
        return self.model.config.projection_dim
