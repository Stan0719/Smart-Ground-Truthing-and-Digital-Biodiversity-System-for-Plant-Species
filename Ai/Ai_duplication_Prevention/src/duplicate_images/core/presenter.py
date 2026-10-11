"""Result presentation and formatting."""

import json
import os
from typing import List
from pathlib import Path

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box

from ..ml.similarity_engine import DuplicateGroup
from ..core.scanner import ImageScanner


class ResultPresenter:
    """Format and display duplicate detection results."""

    def __init__(self):
        """Initialize the result presenter."""
        self.console = Console()
        self.scanner = ImageScanner()

    def display_summary(self, duplicate_groups: List[DuplicateGroup]):
        """
        Display a summary of duplicate groups.

        Args:
            duplicate_groups: List of DuplicateGroup objects
        """
        if not duplicate_groups:
            self.console.print("\n[green]No duplicates found![/green]")
            return

        # Calculate statistics
        total_duplicates = sum(len(group) for group in duplicate_groups)
        total_groups = len(duplicate_groups)

        # Calculate potential space savings
        total_wasted_space = 0
        for group in duplicate_groups:
            if len(group.image_paths) > 1:
                sizes = [
                    self.scanner.get_file_size(path)
                    for path in group.image_paths
                    if os.path.exists(path)
                ]
                if sizes:
                    # Keep the largest, delete the rest
                    total_wasted_space += sum(sizes) - max(sizes)

        # Display summary panel
        summary = f"""
[bold cyan]Duplicate Detection Summary[/bold cyan]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[yellow]Duplicate Groups Found:[/yellow] {total_groups}
[yellow]Total Duplicate Images:[/yellow] {total_duplicates}
[yellow]Potential Space Savings:[/yellow] {self._format_bytes(total_wasted_space)}
        """
        self.console.print(Panel(summary.strip(), border_style="cyan"))

    def display_groups(self, duplicate_groups: List[DuplicateGroup], detailed: bool = True):
        """
        Display duplicate groups in a formatted table.

        Args:
            duplicate_groups: List of DuplicateGroup objects
            detailed: Whether to show detailed information
        """
        if not duplicate_groups:
            return

        for i, group in enumerate(duplicate_groups, 1):
            self.console.print(f"\n[bold magenta]Group {i}[/bold magenta] "
                             f"({len(group)} images, "
                             f"avg similarity: {group.avg_similarity:.2%})")

            # Create table
            table = Table(box=box.SIMPLE, show_header=detailed, padding=(0, 1))
            table.add_column("Path", style="cyan", no_wrap=False)

            if detailed:
                table.add_column("Size", justify="right", style="yellow")

            # Add rows
            for path in group.image_paths:
                if detailed and os.path.exists(path):
                    size = self.scanner.get_file_size(path)
                    table.add_row(path, self._format_bytes(size))
                else:
                    table.add_row(path)

            self.console.print(table)

    def display_similar_images(self, results: List[tuple], query_image: str):
        """
        Display similar images found for a query.

        Args:
            results: List of (image_path, similarity_score) tuples
            query_image: Path to the query image
        """
        if not results:
            self.console.print("\n[yellow]No similar images found.[/yellow]")
            return

        self.console.print(f"\n[bold cyan]Similar images to:[/bold cyan] {query_image}\n")

        # Create table
        table = Table(box=box.ROUNDED, show_header=True)
        table.add_column("Rank", justify="right", style="magenta")
        table.add_column("Image Path", style="cyan")
        table.add_column("Similarity", justify="right", style="green")

        # Add rows
        for rank, (path, similarity) in enumerate(results, 1):
            table.add_row(str(rank), path, f"{similarity:.2%}")

        self.console.print(table)

    def export_json(self, duplicate_groups: List[DuplicateGroup], output_path: str):
        """
        Export results to JSON format.

        Args:
            duplicate_groups: List of DuplicateGroup objects
            output_path: Path to save the JSON file
        """
        data = {
            "summary": {
                "total_groups": len(duplicate_groups),
                "total_duplicates": sum(len(group) for group in duplicate_groups),
            },
            "groups": [
                {
                    "group_id": i,
                    "image_count": len(group),
                    "average_similarity": group.avg_similarity,
                    "images": [
                        {
                            "path": path,
                            "size_bytes": self.scanner.get_file_size(path)
                            if os.path.exists(path)
                            else 0,
                        }
                        for path in group.image_paths
                    ],
                }
                for i, group in enumerate(duplicate_groups, 1)
            ],
        }

        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

        self.console.print(f"\n[green]Results exported to:[/green] {output_path}")

    def _format_bytes(self, num_bytes: int) -> str:
        """
        Format bytes into human-readable format.

        Args:
            num_bytes: Number of bytes

        Returns:
            Formatted string (e.g., "1.5 MB")
        """
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if num_bytes < 1024.0:
                return f"{num_bytes:.2f} {unit}"
            num_bytes /= 1024.0
        return f"{num_bytes:.2f} PB"
