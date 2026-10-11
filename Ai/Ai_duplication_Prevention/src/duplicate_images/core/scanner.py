"""Image scanner for finding image files in directories."""

import os
from pathlib import Path
from typing import List, Set

from ..config.defaults import DEFAULT_CONFIG


class ImageScanner:
    """Scan directories for image files."""

    def __init__(self, image_extensions: List[str] = None):
        """
        Initialize the image scanner.

        Args:
            image_extensions: List of image file extensions to look for
        """
        if image_extensions is None:
            image_extensions = DEFAULT_CONFIG["image_extensions"]
        self.image_extensions = set(image_extensions)

    def scan(
        self, directory: str, recursive: bool = True, follow_symlinks: bool = False
    ) -> List[str]:
        """
        Scan a directory for image files.

        Args:
            directory: Directory path to scan
            recursive: Whether to scan subdirectories recursively
            follow_symlinks: Whether to follow symbolic links

        Returns:
            List of image file paths
        """
        directory = Path(directory)

        if not directory.exists():
            raise ValueError(f"Directory does not exist: {directory}")

        if not directory.is_dir():
            raise ValueError(f"Path is not a directory: {directory}")

        image_files = []

        if recursive:
            # Use rglob for recursive search
            for ext in self.image_extensions:
                # Search for files with this extension
                pattern = f"**/*{ext}"
                for file_path in directory.glob(pattern):
                    if file_path.is_file():
                        # Check symlinks
                        if not follow_symlinks and file_path.is_symlink():
                            continue
                        image_files.append(str(file_path.absolute()))
        else:
            # Non-recursive: only scan immediate directory
            for ext in self.image_extensions:
                pattern = f"*{ext}"
                for file_path in directory.glob(pattern):
                    if file_path.is_file():
                        if not follow_symlinks and file_path.is_symlink():
                            continue
                        image_files.append(str(file_path.absolute()))

        # Remove duplicates and sort
        image_files = sorted(list(set(image_files)))

        return image_files

    def is_image_file(self, file_path: str) -> bool:
        """
        Check if a file is an image based on its extension.

        Args:
            file_path: Path to the file

        Returns:
            True if the file has an image extension
        """
        ext = Path(file_path).suffix
        return ext in self.image_extensions

    def get_file_size(self, file_path: str) -> int:
        """
        Get the size of a file in bytes.

        Args:
            file_path: Path to the file

        Returns:
            File size in bytes
        """
        return os.path.getsize(file_path)

    def get_total_size(self, file_paths: List[str]) -> int:
        """
        Get the total size of multiple files.

        Args:
            file_paths: List of file paths

        Returns:
            Total size in bytes
        """
        total = 0
        for path in file_paths:
            try:
                total += self.get_file_size(path)
            except Exception:
                pass
        return total
