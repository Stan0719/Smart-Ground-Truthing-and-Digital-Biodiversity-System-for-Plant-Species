from setuptools import setup, find_packages

setup(
    name="duplicate-images",
    version="0.1.0",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    install_requires=[
        "torch>=2.0.0",
        "transformers>=4.30.0",
        "pillow>=10.0.0",
        "numpy>=1.24.0",
        "faiss-cpu>=1.7.4",
        "click>=8.1.0",
        "rich>=13.0.0",
        "questionary>=2.0.0",
        "opencv-python>=4.8.0",
        "tqdm>=4.65.0",
        "pyyaml>=6.0",
        "send2trash>=1.8.0",
    ],
    entry_points={
        "console_scripts": [
            "duplicate-images=duplicate_images.cli.main:cli",
        ],
    },
    python_requires=">=3.8",
    author="Your Name",
    author_email="your.email@example.com",
    description="AI-powered duplicate image detection using CLIP and semantic similarity",
    long_description=open("README.md", encoding="utf-8").read() if __name__ == "__main__" else "",
    long_description_content_type="text/markdown",
    url="https://github.com/yourusername/duplicate-images",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
)
