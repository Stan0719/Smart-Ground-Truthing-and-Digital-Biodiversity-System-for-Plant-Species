"""Reproducible install: DeepFace dependencies install overlapping cv2 packages."""
import subprocess
import sys
from pathlib import Path

if sys.version_info[:2] != (3, 11):
    raise SystemExit('Activate the Python 3.11 virtual environment first.')
subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(Path(__file__).with_name('requirements.txt'))], check=True)
# Install the headless build last so desktop OpenCV cannot overwrite it.
subprocess.run([sys.executable, '-m', 'pip', 'install', '--force-reinstall', '--no-deps', 'opencv-contrib-python-headless==4.12.0.88'], check=True)
subprocess.run([sys.executable, '-m', 'pip', 'check'], check=True)
print('Dependencies installed. Start server.py to initialize and verify the models.')
