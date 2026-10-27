> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

# Duplicate Image Detector

[![Python](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.0+-red.svg)](https://pytorch.org/)
[![CLIP](https://img.shields.io/badge/model-CLIP-orange.svg)](https://github.com/openai/CLIP)
[![FAISS](https://img.shields.io/badge/search-FAISS-green.svg)](https://github.com/facebookresearch/faiss)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)]()

AI-powered duplicate image detection using CLIP (Contrastive Language-Image Pre-training) and semantic similarity. This tool finds duplicate and similar images based on their visual content, not just file names or metadata.

## Features

- **Smart Detection**: Uses deep learning (CLIP model) to understand image content
- **Semantic Similarity**: Finds duplicates even if images are resized, cropped, or slightly edited
- **Fast Performance**: FAISS-powered similarity search, ~100-200 images/second on GPU
- **Smart Caching**: Only processes each image once, subsequent scans are near-instant
- **Interactive Cleanup**: Choose which duplicates to keep/delete with an interactive interface
- **Multiple Actions**: Delete, move, or copy duplicate files
- **Rich CLI**: Beautiful terminal output with progress bars and tables
- **Flexible Output**: Export results to JSON for further processing

## How It Works

1. **Scan** - Recursively finds all images in a directory
2. **Extract** - Uses CLIP to create 512-dimensional embeddings that capture image semantics
3. **Cache** - Stores embeddings to avoid recomputation on future scans
4. **Search** - Uses FAISS to efficiently find similar images above a threshold
5. **Group** - Clusters similar images into duplicate groups
6. **Act** - Delete, move, or interactively clean duplicates

## Installation

### Prerequisites

- Python 3.8 or higher
- pip (Python package manager)

### Install from Source

```bash
# Clone or navigate to the repository
cd duplicated-images

# Install the package in editable mode
pip install -e .

# Or install with development dependencies
pip install -e ".[dev]"
```

### Alternative: Install Dependencies Only

```bash
pip install -r requirements.txt
```

### Shell Completions (Optional)

Enable tab completion for the CLI:

```bash
# For zsh (auto-installs to ~/.zsh/completions)
duplicate-images completion --install

# Then restart your shell or run:
source ~/.zshrc

# For bash
duplicate-images completion --shell bash --install

# For fish
duplicate-images completion --shell fish --install
```

Now you can use TAB to autocomplete commands and options:
```bash
duplicate-images <TAB>         # Shows: scan, clean, find, cache, completion
duplicate-images scan --<TAB>  # Shows all available options
```

## Usage

### Desktop Window

From the project folder with your virtual environment activated:

```powershell
python launch_gui.py
```

Choose a photo folder, set the similarity threshold, and click **Scan photos**.
Select a matching group to review photo previews. Results can be exported to JSON.
Unreadable images are skipped and listed in the scan activity area.

### Basic Scan

Find all duplicate images in a directory:

```bash
duplicate-images scan ~/Pictures
```

### Scan with Custom Threshold

Use a higher threshold for stricter matching (fewer false positives):

```bash
duplicate-images scan ~/Pictures --threshold 0.95
```

Use a lower threshold for more lenient matching (finds more similar images):

```bash
duplicate-images scan ~/Pictures --threshold 0.85
```

### Export Results to JSON

```bash
duplicate-images scan ~/Pictures --output results.json
```

### Interactive Cleanup

Interactively review and delete duplicates:

```bash
duplicate-images clean ~/Pictures
```

Move duplicates to a folder instead of deleting:

```bash
duplicate-images clean ~/Pictures --action move --move-to ~/Duplicates
```

Dry run to see what would happen without actually doing it:

```bash
duplicate-images clean ~/Pictures --dry-run
```

### Find Similar Images

Find images similar to a specific query image:

```bash
duplicate-images find query.jpg ~/Pictures --top-k 20
```

### Tag Duplicates for Easy Viewing

Tag duplicate images by prepending group numbers to their filenames. This makes it super easy to see which images are duplicates in Finder or any file browser!

```bash
# Scan and tag duplicates in one command
duplicate-images scan ~/Pictures --tag

# Preview what would be renamed first (dry run)
duplicate-images scan ~/Pictures --tag --dry-run

# Use a custom prefix
duplicate-images scan ~/Pictures --tag --tag-prefix DUP

# Or use the standalone tag command (if you want to re-tag after scanning)
duplicate-images tag ~/Pictures

# Remove tags later
duplicate-images tag ~/Pictures --undo
```

**Before:**
```
IMG_001.jpg
IMG_002.jpg
IMG_003.jpg
vacation.jpg
```

**After tagging:**
```
GROUP1-IMG_001.jpg
GROUP1-IMG_002.jpg
GROUP2-IMG_003.jpg
GROUP2-vacation.jpg
```

Now in Finder, duplicates sort together and are instantly recognizable!

### Cache Management

View cache statistics:

```bash
duplicate-images cache
```

This will show cache size and allow you to clear it if needed.

## Advanced Options

### Scan Command Options

- `--threshold, -t`: Similarity threshold (0.0-1.0, default: 0.90)
- `--model`: CLIP model to use (default: openai/clip-vit-base-patch32)
- `--device`: Device for inference (auto, cpu, cuda, mps)
- `--batch-size`: Batch size for processing (default: 32)
- `--no-cache`: Disable embedding cache
- `--output, -o`: Export results to JSON
- `--detailed`: Show detailed information

### Clean Command Options

- `--threshold, -t`: Similarity threshold (default: 0.90)
- `--action`: Action to perform (delete, move)
- `--move-to`: Destination directory for move action
- `--dry-run`: Show what would be done without doing it
- `--auto`: Automatically keep first image (non-interactive)

### Find Command Options

- `--threshold, -t`: Minimum similarity (default: 0.85)
- `--top-k, -k`: Max results to show (default: 10)

## Examples

### Example 1: Quick Scan

```bash
# Scan your photos directory for duplicates
duplicate-images scan ~/Photos

# Output:
# ═══════════════════════════════════════════════════
# Scanning directory: /Users/you/Photos
# Similarity threshold: 0.90
# ═══════════════════════════════════════════════════
#
# Step 1/4: Scanning for images...
# Found 1523 images
#
# Step 2/4: Extracting image embeddings...
# Loaded 1200 embeddings from cache
# Extracting embeddings for 323 new images...
#
# Step 3/4: Building similarity index...
# Index built successfully
#
# Step 4/4: Finding duplicate groups...
# Found 47 duplicate groups
```

### Example 2: Interactive Cleanup

```bash
duplicate-images clean ~/Downloads --action delete

# You'll be prompted for each duplicate group:
# Group 1/47
# ═══════════════════════════════════════════════════
#   1. /Users/you/Downloads/IMG_001.jpg
#   2. /Users/you/Downloads/IMG_001 (1).jpg
#   3. /Users/you/Downloads/IMG_001_copy.jpg
#
# Which image do you want to KEEP?
# > 1. /Users/you/Downloads/IMG_001.jpg
#   2. /Users/you/Downloads/IMG_001 (1).jpg
#   3. /Users/you/Downloads/IMG_001_copy.jpg
#   Skip this group
```

### Example 3: Find Similar Images

```bash
duplicate-images find vacation.jpg ~/Photos --threshold 0.80 --top-k 15

# Similar images to: vacation.jpg
# ┌──────┬────────────────────────────────────┬────────────┐
# │ Rank │ Image Path                         │ Similarity │
# ├──────┼────────────────────────────────────┼────────────┤
# │    1 │ /Users/you/Photos/beach1.jpg      │     94.23% │
# │    2 │ /Users/you/Photos/beach2.jpg      │     89.45% │
# │    3 │ /Users/you/Photos/sunset.jpg      │     85.67% │
# └──────┴────────────────────────────────────┴────────────┘
```

## Performance

### Speed
- **First scan**: ~100-200 images/second on GPU, ~20-30 images/second on CPU
- **Subsequent scans**: Near-instant (only similarity search, uses cached embeddings)
- **Similarity search**: Sub-second for 10,000 images

### Memory & Storage
- **Memory**: ~2KB per image (for embeddings)
- **Disk**: ~2MB per 1,000 cached images
- **Model size**: ~350MB (CLIP ViT-B/32)

## Understanding Similarity Thresholds

- **0.95+**: Very strict, only finds near-identical images
- **0.90** (default): Good balance, finds clear duplicates
- **0.85**: More lenient, finds similar images with variations
- **0.80 and below**: Very loose, may include semantically similar but visually different images

## Troubleshooting

### CUDA/GPU Issues

If you have a CUDA-capable GPU but get CPU warnings:

```bash
# Install PyTorch with CUDA support
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### Memory Issues

If you run out of memory with large image collections:

```bash
# Reduce batch size
duplicate-images scan ~/Photos --batch-size 16
```

### Cache Location

The default cache is at `~/.cache/duplicate-images`. To clear it:

```bash
duplicate-images cache
# Then select "yes" when prompted to clear
```

Or manually delete it:

```bash
rm -rf ~/.cache/duplicate-images
```

## Technical Details

### Technology Stack

- **CLIP**: OpenAI's Contrastive Language-Image Pre-training model
- **FAISS**: Facebook AI Similarity Search for efficient vector search
- **PyTorch**: Deep learning framework
- **Click**: CLI framework
- **Rich**: Beautiful terminal formatting
- **Questionary**: Interactive prompts

### Architecture

The tool uses a modular architecture:

- **ML Layer**: Feature extraction (CLIP), similarity search (FAISS), caching
- **Core Layer**: Scanner, detector, presenter, executor
- **CLI Layer**: Command-line interface
- **Config Layer**: Configuration management

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - see LICENSE file for details

## Acknowledgments

- OpenAI for the CLIP model
- Facebook AI for FAISS
- HuggingFace for the transformers library
