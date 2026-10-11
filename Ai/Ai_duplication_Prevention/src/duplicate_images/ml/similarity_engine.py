"""Similarity search using FAISS for finding duplicate images."""

from typing import List, Tuple, Dict, Set
from collections import defaultdict
import numpy as np
import faiss


class DuplicateGroup:
    """Represents a group of duplicate/similar images."""

    def __init__(self, image_paths: List[str], similarities: List[float]):
        """
        Initialize a duplicate group.

        Args:
            image_paths: List of image file paths in this group
            similarities: List of similarity scores between images
        """
        self.image_paths = image_paths
        self.similarities = similarities
        self.avg_similarity = np.mean(similarities) if similarities else 0.0

    def __len__(self):
        return len(self.image_paths)

    def __repr__(self):
        return f"DuplicateGroup({len(self)} images, avg_sim={self.avg_similarity:.3f})"


class SimilarityEngine:
    """Find similar images using FAISS for efficient similarity search."""

    def __init__(self, metric: str = "cosine"):
        """
        Initialize the similarity engine.

        Args:
            metric: Similarity metric to use (cosine or euclidean)
        """
        self.metric = metric
        self.index = None
        self.paths = []
        self.embeddings = None

    def build_index(self, embeddings: Dict[str, np.ndarray]):
        """
        Build a FAISS index for fast similarity search.

        Args:
            embeddings: Dictionary mapping image paths to embeddings
        """
        if not embeddings:
            raise ValueError("No embeddings provided")

        # Extract paths and embedding vectors
        self.paths = list(embeddings.keys())
        embedding_vectors = np.array([embeddings[path] for path in self.paths])

        # Store embeddings
        self.embeddings = embedding_vectors.astype(np.float32)

        # Get embedding dimension
        dimension = self.embeddings.shape[1]

        # Normalize embeddings for cosine similarity
        if self.metric == "cosine":
            faiss.normalize_L2(self.embeddings)
            # Use IndexFlatIP (inner product) for cosine similarity on normalized vectors
            self.index = faiss.IndexFlatIP(dimension)
        else:
            # Use IndexFlatL2 for Euclidean distance
            self.index = faiss.IndexFlatL2(dimension)

        # Add embeddings to index
        self.index.add(self.embeddings)

    def find_similar(
        self, query_embedding: np.ndarray, threshold: float = 0.90, k: int = 100
    ) -> List[Tuple[str, float]]:
        """
        Find images similar to a query embedding.

        Args:
            query_embedding: Query embedding vector
            threshold: Minimum similarity threshold
            k: Maximum number of results to return

        Returns:
            List of (image_path, similarity_score) tuples
        """
        if self.index is None:
            raise ValueError("Index not built. Call build_index() first.")

        # Prepare query
        query = query_embedding.astype(np.float32).reshape(1, -1)

        # Normalize for cosine similarity
        if self.metric == "cosine":
            faiss.normalize_L2(query)

        # Search
        distances, indices = self.index.search(query, min(k, len(self.paths)))

        # Convert to similarity scores and filter by threshold
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1:  # Invalid index
                continue

            # Convert distance to similarity
            if self.metric == "cosine":
                similarity = float(dist)  # Already similarity for inner product
            else:
                # Convert L2 distance to similarity (inverse)
                similarity = 1.0 / (1.0 + float(dist))

            if similarity >= threshold:
                results.append((self.paths[idx], similarity))

        return results

    def find_duplicates(self, threshold: float = 0.90) -> List[DuplicateGroup]:
        """
        Find all duplicate groups in the indexed images.

        Args:
            threshold: Minimum similarity threshold for duplicates

        Returns:
            List of DuplicateGroup objects
        """
        if self.index is None:
            raise ValueError("Index not built. Call build_index() first.")

        # Build graph of similar images
        edges = self._find_similar_pairs(threshold)

        # Find connected components (duplicate groups)
        groups = self._find_connected_components(edges)

        # Create DuplicateGroup objects
        duplicate_groups = []
        for group in groups:
            if len(group) < 2:
                continue  # Skip single images

            # Convert set to list for indexing
            group_list = list(group)
            group_paths = [self.paths[idx] for idx in group_list]

            # Calculate similarities within group
            similarities = []
            for i, idx1 in enumerate(group_list):
                for idx2 in group_list[i + 1 :]:
                    sim = self._calculate_similarity(idx1, idx2)
                    if sim >= threshold:
                        similarities.append(sim)

            duplicate_groups.append(DuplicateGroup(group_paths, similarities))

        # Sort by group size (largest first)
        duplicate_groups.sort(key=lambda g: len(g), reverse=True)

        return duplicate_groups

    def _find_similar_pairs(self, threshold: float) -> List[Tuple[int, int, float]]:
        """
        Find all pairs of similar images.

        Args:
            threshold: Minimum similarity threshold

        Returns:
            List of (index1, index2, similarity) tuples
        """
        edges = []

        # Use FAISS range search for efficient pair finding
        if self.metric == "cosine":
            # For cosine similarity (inner product on normalized vectors)
            # We search for all neighbors with similarity >= threshold
            lims, D, I = self.index.range_search(self.embeddings, threshold)

            # Process results
            for i in range(len(self.paths)):
                start = lims[i]
                end = lims[i + 1]
                for j_idx in range(start, end):
                    j = I[j_idx]
                    similarity = D[j_idx]

                    # Avoid self-matches and duplicate pairs
                    if i < j:
                        edges.append((i, j, float(similarity)))
        else:
            # For Euclidean distance, we need a different approach
            # Search for k nearest neighbors for each image
            k = min(100, len(self.paths))
            distances, indices = self.index.search(self.embeddings, k)

            for i in range(len(self.paths)):
                for j_idx, dist in zip(indices[i], distances[i]):
                    if j_idx == -1 or j_idx == i:
                        continue

                    # Convert distance to similarity
                    similarity = 1.0 / (1.0 + float(dist))

                    if similarity >= threshold and i < j_idx:
                        edges.append((i, j_idx, similarity))

        return edges

    def _calculate_similarity(self, idx1: int, idx2: int) -> float:
        """Calculate similarity between two images by their indices."""
        emb1 = self.embeddings[idx1]
        emb2 = self.embeddings[idx2]

        if self.metric == "cosine":
            # Cosine similarity (vectors already normalized)
            similarity = float(np.dot(emb1, emb2))
        else:
            # Euclidean distance to similarity
            dist = np.linalg.norm(emb1 - emb2)
            similarity = 1.0 / (1.0 + dist)

        return similarity

    def _find_connected_components(
        self, edges: List[Tuple[int, int, float]]
    ) -> List[Set[int]]:
        """
        Find connected components in the similarity graph.

        Args:
            edges: List of (index1, index2, similarity) tuples

        Returns:
            List of sets, each containing indices of connected images
        """
        # Build adjacency list
        graph = defaultdict(set)
        for i, j, _ in edges:
            graph[i].add(j)
            graph[j].add(i)

        # Find connected components using DFS
        visited = set()
        components = []

        def dfs(node, component):
            visited.add(node)
            component.add(node)
            for neighbor in graph[node]:
                if neighbor not in visited:
                    dfs(neighbor, component)

        for node in graph:
            if node not in visited:
                component = set()
                dfs(node, component)
                components.append(component)

        return components

    def get_statistics(self) -> dict:
        """Get statistics about the indexed images."""
        if self.index is None:
            return {"indexed_images": 0}

        return {
            "indexed_images": len(self.paths),
            "embedding_dimension": self.embeddings.shape[1],
            "metric": self.metric,
        }
