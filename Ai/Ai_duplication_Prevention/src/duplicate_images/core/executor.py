"""Action executor for handling file operations on duplicates."""

import os
import shutil
from pathlib import Path
from typing import List

from send2trash import send2trash
from rich.console import Console


class ActionExecutor:
    """Execute actions on duplicate files (delete, move, etc.)."""

    def __init__(self):
        """Initialize the action executor."""
        self.console = Console()

    def delete(self, paths: List[str], dry_run: bool = False, use_trash: bool = True):
        """
        Delete files.

        Args:
            paths: List of file paths to delete
            dry_run: If True, only show what would be deleted
            use_trash: If True, move to trash instead of permanent deletion
        """
        if not paths:
            self.console.print("[yellow]No files to delete.[/yellow]")
            return

        if dry_run:
            self.console.print("\n[bold yellow]DRY RUN - Files that would be deleted:[/bold yellow]")
            for path in paths:
                self.console.print(f"  - {path}")
            return

        # Perform deletion
        success_count = 0
        failed_count = 0

        for path in paths:
            try:
                if not os.path.exists(path):
                    self.console.print(f"[yellow]Skipping (not found):[/yellow] {path}")
                    failed_count += 1
                    continue

                if use_trash:
                    send2trash(path)
                    self.console.print(f"[green]Moved to trash:[/green] {path}")
                else:
                    os.remove(path)
                    self.console.print(f"[green]Deleted:[/green] {path}")

                success_count += 1

            except Exception as e:
                self.console.print(f"[red]Failed to delete[/red] {path}: {e}")
                failed_count += 1

        # Summary
        self.console.print(
            f"\n[bold]Summary:[/bold] {success_count} deleted, {failed_count} failed"
        )

    def move(
        self,
        paths: List[str],
        destination: str,
        dry_run: bool = False,
        preserve_structure: bool = False,
    ):
        """
        Move files to a destination directory.

        Args:
            paths: List of file paths to move
            destination: Destination directory
            dry_run: If True, only show what would be moved
            preserve_structure: If True, preserve directory structure
        """
        if not paths:
            self.console.print("[yellow]No files to move.[/yellow]")
            return

        dest_path = Path(destination)

        if dry_run:
            self.console.print(f"\n[bold yellow]DRY RUN - Files that would be moved to {destination}:[/bold yellow]")
            for path in paths:
                self.console.print(f"  - {path}")
            return

        # Create destination directory
        if not dest_path.exists():
            dest_path.mkdir(parents=True, exist_ok=True)
            self.console.print(f"[cyan]Created directory:[/cyan] {destination}")

        # Perform move
        success_count = 0
        failed_count = 0

        for path in paths:
            try:
                if not os.path.exists(path):
                    self.console.print(f"[yellow]Skipping (not found):[/yellow] {path}")
                    failed_count += 1
                    continue

                source = Path(path)

                if preserve_structure:
                    # Preserve directory structure relative to common root
                    # For simplicity, just use the filename with a unique suffix if needed
                    dest_file = dest_path / source.name
                else:
                    dest_file = dest_path / source.name

                # Handle name conflicts
                if dest_file.exists():
                    base = dest_file.stem
                    ext = dest_file.suffix
                    counter = 1
                    while dest_file.exists():
                        dest_file = dest_path / f"{base}_{counter}{ext}"
                        counter += 1

                # Move file
                shutil.move(str(source), str(dest_file))
                self.console.print(f"[green]Moved:[/green] {path} → {dest_file}")
                success_count += 1

            except Exception as e:
                self.console.print(f"[red]Failed to move[/red] {path}: {e}")
                failed_count += 1

        # Summary
        self.console.print(
            f"\n[bold]Summary:[/bold] {success_count} moved, {failed_count} failed"
        )

    def copy(
        self,
        paths: List[str],
        destination: str,
        dry_run: bool = False,
    ):
        """
        Copy files to a destination directory.

        Args:
            paths: List of file paths to copy
            destination: Destination directory
            dry_run: If True, only show what would be copied
        """
        if not paths:
            self.console.print("[yellow]No files to copy.[/yellow]")
            return

        dest_path = Path(destination)

        if dry_run:
            self.console.print(f"\n[bold yellow]DRY RUN - Files that would be copied to {destination}:[/bold yellow]")
            for path in paths:
                self.console.print(f"  - {path}")
            return

        # Create destination directory
        if not dest_path.exists():
            dest_path.mkdir(parents=True, exist_ok=True)
            self.console.print(f"[cyan]Created directory:[/cyan] {destination}")

        # Perform copy
        success_count = 0
        failed_count = 0

        for path in paths:
            try:
                if not os.path.exists(path):
                    self.console.print(f"[yellow]Skipping (not found):[/yellow] {path}")
                    failed_count += 1
                    continue

                source = Path(path)
                dest_file = dest_path / source.name

                # Handle name conflicts
                if dest_file.exists():
                    base = dest_file.stem
                    ext = dest_file.suffix
                    counter = 1
                    while dest_file.exists():
                        dest_file = dest_path / f"{base}_{counter}{ext}"
                        counter += 1

                # Copy file
                shutil.copy2(str(source), str(dest_file))
                self.console.print(f"[green]Copied:[/green] {path} → {dest_file}")
                success_count += 1

            except Exception as e:
                self.console.print(f"[red]Failed to copy[/red] {path}: {e}")
                failed_count += 1

        # Summary
        self.console.print(
            f"\n[bold]Summary:[/bold] {success_count} copied, {failed_count} failed"
        )
