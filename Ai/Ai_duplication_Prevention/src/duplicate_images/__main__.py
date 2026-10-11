"""Entry point for running the package as a module."""

import os

# Fix OpenMP conflict on macOS (PyTorch + FAISS both use OpenMP)
# This must be set before importing any libraries
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

from duplicate_images.cli.main import cli

if __name__ == "__main__":
    cli()
