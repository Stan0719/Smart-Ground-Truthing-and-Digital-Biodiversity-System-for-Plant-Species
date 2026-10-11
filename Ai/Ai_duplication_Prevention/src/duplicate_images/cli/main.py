"""Main CLI interface for duplicate image detection."""

import os

# Fix OpenMP conflict on macOS (PyTorch + FAISS both use OpenMP)
# This must be set before importing any libraries that use OpenMP
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import click
from pathlib import Path

from ..core.detector import DuplicateDetector
from ..core.presenter import ResultPresenter
from ..core.executor import ActionExecutor
from ..config.defaults import DEFAULT_CONFIG


@click.group()
@click.version_option(version="0.1.0")
def cli():
    """
    Duplicate Image Detector - Find semantically similar images using AI.

    Uses CLIP (Contrastive Language-Image Pre-training) to understand image content
    and find duplicates based on visual similarity, not just file metadata.
    """
    pass


@cli.command()
@click.argument("directory", type=click.Path(exists=True, file_okay=False, dir_okay=True))
@click.option(
    "--threshold",
    "-t",
    default=0.90,
    type=float,
    help="Similarity threshold (0.0-1.0). Higher = more strict.",
    show_default=True,
)
@click.option(
    "--model",
    default="openai/clip-vit-base-patch32",
    help="CLIP model to use for feature extraction.",
    show_default=True,
)
@click.option(
    "--device",
    type=click.Choice(["auto", "cpu", "cuda", "mps"]),
    default="auto",
    help="Device to use for inference.",
    show_default=True,
)
@click.option(
    "--batch-size",
    default=32,
    type=int,
    help="Batch size for processing images.",
    show_default=True,
)
@click.option(
    "--no-cache",
    is_flag=True,
    help="Disable embedding cache (slower but uses less disk space).",
)
@click.option(
    "--output",
    "-o",
    type=click.Path(),
    help="Export results to JSON file.",
)
@click.option(
    "--detailed",
    is_flag=True,
    help="Show detailed information about each duplicate group.",
)
@click.option(
    "--tag",
    is_flag=True,
    help="Tag duplicates by prepending group numbers to filenames.",
)
@click.option(
    "--tag-prefix",
    default="GROUP",
    help="Prefix to use when tagging (requires --tag).",
    show_default=True,
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="Preview tagging changes without actually renaming files (requires --tag).",
)
def scan(directory, threshold, model, device, batch_size, no_cache, output, detailed, tag, tag_prefix, dry_run):
    """
    Scan a directory for duplicate images.

    DIRECTORY: Path to the directory containing images to scan.

    Examples:

        \b
        # Basic scan with default settings
        duplicate-images scan ~/Pictures

        \b
        # More strict matching (fewer false positives)
        duplicate-images scan ~/Pictures --threshold 0.95

        \b
        # Export results to JSON
        duplicate-images scan ~/Pictures --output results.json

        \b
        # Scan and tag duplicates in one command
        duplicate-images scan ~/Pictures --tag

        \b
        # Preview tagging before applying
        duplicate-images scan ~/Pictures --tag --dry-run
    """
    # Initialize detector
    detector = DuplicateDetector(
        model_name=model, device=device, cache_enabled=not no_cache
    )

    # Run detection
    duplicate_groups = detector.detect(
        directory=directory, threshold=threshold, batch_size=batch_size
    )

    # Display results
    presenter = ResultPresenter()
    presenter.display_summary(duplicate_groups)
    presenter.display_groups(duplicate_groups, detailed=detailed)

    # Export if requested
    if output:
        presenter.export_json(duplicate_groups, output)

    # Tag duplicates if requested
    if tag and duplicate_groups:
        from pathlib import Path
        from rich.console import Console
        import re

        console = Console()
        console.print(f"\n[cyan]Tagging duplicate groups with prefix '{tag_prefix}'...[/cyan]\n")

        total_renamed = 0
        total_failed = 0

        for group_num, group in enumerate(duplicate_groups, 1):
            group_tag = f"{tag_prefix}{group_num}-"

            if detailed or dry_run:
                console.print(f"\n[magenta]Group {group_num}[/magenta] ({len(group)} images):")

            for path in group.image_paths:
                p = Path(path)
                filename = p.name

                # Check if already tagged
                if filename.startswith(group_tag):
                    if detailed or dry_run:
                        console.print(f"  [yellow]Already tagged:[/yellow] {filename}")
                    continue

                # Remove any existing group tags before adding new one
                clean_filename = re.sub(rf'^{re.escape(tag_prefix)}\d+-', '', filename)
                new_filename = f"{group_tag}{clean_filename}"
                new_path = p.parent / new_filename

                if dry_run:
                    console.print(f"  [cyan]Would rename:[/cyan] {filename} → {new_filename}")
                    total_renamed += 1
                else:
                    try:
                        # Check for name conflicts
                        if new_path.exists():
                            console.print(f"  [red]Conflict:[/red] {new_filename} already exists")
                            total_failed += 1
                            continue

                        p.rename(new_path)
                        if detailed:
                            console.print(f"  [green]Renamed:[/green] {filename} → {new_filename}")
                        total_renamed += 1
                    except Exception as e:
                        console.print(f"  [red]Failed:[/red] {filename}: {e}")
                        total_failed += 1

        # Summary
        console.print("\n" + "="*60)
        if dry_run:
            console.print(f"[yellow]DRY RUN:[/yellow] Would rename {total_renamed} files")
        else:
            console.print(f"[green]Successfully renamed:[/green] {total_renamed} files")
            if total_failed > 0:
                console.print(f"[red]Failed:[/red] {total_failed} files")
        console.print("="*60)


@cli.command()
@click.argument("directory", type=click.Path(exists=True, file_okay=False, dir_okay=True))
@click.option(
    "--threshold",
    "-t",
    default=0.90,
    type=float,
    help="Similarity threshold (0.0-1.0).",
    show_default=True,
)
@click.option(
    "--action",
    type=click.Choice(["delete", "move"]),
    default="delete",
    help="Action to perform on duplicates.",
    show_default=True,
)
@click.option(
    "--move-to",
    type=click.Path(),
    help="Directory to move duplicates to (required if action=move).",
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="Show what would be done without actually doing it.",
)
@click.option(
    "--auto",
    is_flag=True,
    help="Automatically keep the first image in each group (non-interactive).",
)
def clean(directory, threshold, action, move_to, dry_run, auto):
    """
    Interactively clean duplicate images.

    DIRECTORY: Path to the directory containing images to clean.

    This command finds duplicates and allows you to choose which images to keep
    and which to delete or move.

    Examples:

        \b
        # Interactive cleanup (will prompt for each group)
        duplicate-images clean ~/Pictures

        \b
        # Move duplicates to a folder instead of deleting
        duplicate-images clean ~/Pictures --action move --move-to ~/Duplicates

        \b
        # Dry run to see what would happen
        duplicate-images clean ~/Pictures --dry-run
    """
    import questionary

    if action == "move" and not move_to:
        click.echo("Error: --move-to is required when action=move", err=True)
        raise click.Abort()

    # Initialize components
    detector = DuplicateDetector()
    presenter = ResultPresenter()
    executor = ActionExecutor()

    # Find duplicates
    duplicate_groups = detector.detect(directory=directory, threshold=threshold)

    if not duplicate_groups:
        click.echo("No duplicates found!")
        return

    # Display summary
    presenter.display_summary(duplicate_groups)

    # Process each group
    for i, group in enumerate(duplicate_groups, 1):
        click.echo(f"\n{'='*60}")
        click.echo(f"Group {i}/{len(duplicate_groups)}")
        click.echo(f"{'='*60}")

        # Display group
        for j, path in enumerate(group.image_paths):
            click.echo(f"  {j + 1}. {path}")

        if auto:
            # Automatically keep first, remove rest
            files_to_process = group.image_paths[1:]
        else:
            # Ask user which to keep
            choices = [f"{j + 1}. {path}" for j, path in enumerate(group.image_paths)]
            choices.append("Skip this group")

            answer = questionary.select(
                "Which image do you want to KEEP? (others will be deleted/moved)",
                choices=choices,
            ).ask()

            if answer == "Skip this group" or answer is None:
                click.echo("Skipping this group...")
                continue

            # Get index of file to keep
            keep_idx = int(answer.split(".")[0]) - 1
            files_to_process = [
                path for j, path in enumerate(group.image_paths) if j != keep_idx
            ]

        # Perform action
        if action == "delete":
            executor.delete(files_to_process, dry_run=dry_run, use_trash=True)
        elif action == "move":
            executor.move(files_to_process, move_to, dry_run=dry_run)


@cli.command()
@click.argument("query_image", type=click.Path(exists=True, dir_okay=False))
@click.argument("search_directory", type=click.Path(exists=True, file_okay=False))
@click.option(
    "--threshold",
    "-t",
    default=0.85,
    type=float,
    help="Minimum similarity threshold.",
    show_default=True,
)
@click.option(
    "--top-k",
    "-k",
    default=10,
    type=int,
    help="Maximum number of results to show.",
    show_default=True,
)
def find(query_image, search_directory, threshold, top_k):
    """
    Find images similar to a specific query image.

    QUERY_IMAGE: Path to the image to search for.

    SEARCH_DIRECTORY: Directory to search in.

    Example:

        \b
        duplicate-images find photo.jpg ~/Pictures --top-k 20
    """
    detector = DuplicateDetector()
    presenter = ResultPresenter()

    # Find similar images
    results = detector.find_similar_to_image(
        query_image=query_image,
        search_directory=search_directory,
        threshold=threshold,
        top_k=top_k,
    )

    # Display results
    presenter.display_similar_images(results, query_image)


@cli.command()
@click.argument("directory", type=click.Path(exists=True, file_okay=False, dir_okay=True))
@click.option(
    "--threshold",
    "-t",
    default=0.90,
    type=float,
    help="Similarity threshold (0.0-1.0).",
    show_default=True,
)
@click.option(
    "--prefix",
    default="GROUP",
    help="Prefix to use for group tags.",
    show_default=True,
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="Show what would be done without actually doing it.",
)
@click.option(
    "--undo",
    is_flag=True,
    help="Remove group tags from filenames.",
)
def tag(directory, threshold, prefix, dry_run, undo):
    """
    Tag duplicate images by prepending group numbers to filenames.

    DIRECTORY: Path to the directory containing images.

    This makes it easy to identify duplicates in Finder or any file browser.
    Files in the same duplicate group will have the same prefix (e.g., GROUP1-).

    Examples:

        \b
        # Tag duplicates with GROUP1-, GROUP2-, etc.
        duplicate-images tag ~/Pictures

        \b
        # Use custom prefix
        duplicate-images tag ~/Pictures --prefix DUP

        \b
        # Preview what would be renamed
        duplicate-images tag ~/Pictures --dry-run

        \b
        # Remove tags from filenames
        duplicate-images tag ~/Pictures --undo
    """
    import os
    from pathlib import Path
    from rich.console import Console

    console = Console()
    detector = DuplicateDetector()
    presenter = ResultPresenter()

    if undo:
        # Remove group tags
        console.print("\n[yellow]Removing group tags from filenames...[/yellow]\n")

        # Scan for images
        from ..core.scanner import ImageScanner
        scanner = ImageScanner()
        image_paths = scanner.scan(directory, recursive=True)

        renamed_count = 0
        for path in image_paths:
            p = Path(path)
            filename = p.name

            # Check if filename starts with the pattern PREFIX#-
            import re
            pattern = rf'^{re.escape(prefix)}\d+-'
            if re.match(pattern, filename):
                # Remove the prefix
                new_filename = re.sub(pattern, '', filename)
                new_path = p.parent / new_filename

                if dry_run:
                    console.print(f"[cyan]Would rename:[/cyan] {filename} → {new_filename}")
                else:
                    try:
                        p.rename(new_path)
                        console.print(f"[green]Renamed:[/green] {filename} → {new_filename}")
                        renamed_count += 1
                    except Exception as e:
                        console.print(f"[red]Failed:[/red] {filename}: {e}")

        if dry_run:
            console.print(f"\n[yellow]DRY RUN:[/yellow] Would remove tags from {renamed_count} files")
        else:
            console.print(f"\n[green]Removed tags from {renamed_count} files[/green]")
        return

    # Find duplicates
    duplicate_groups = detector.detect(directory=directory, threshold=threshold)

    if not duplicate_groups:
        console.print("\n[yellow]No duplicates found![/yellow]")
        return

    # Display summary
    presenter.display_summary(duplicate_groups)

    console.print(f"\n[cyan]Tagging duplicate groups with prefix '{prefix}'...[/cyan]\n")

    total_renamed = 0
    total_failed = 0

    for group_num, group in enumerate(duplicate_groups, 1):
        group_tag = f"{prefix}{group_num}-"

        console.print(f"\n[magenta]Group {group_num}[/magenta] ({len(group)} images):")

        for path in group.image_paths:
            p = Path(path)
            filename = p.name

            # Check if already tagged
            if filename.startswith(group_tag):
                console.print(f"  [yellow]Already tagged:[/yellow] {filename}")
                continue

            # Remove any existing group tags before adding new one
            import re
            clean_filename = re.sub(rf'^{re.escape(prefix)}\d+-', '', filename)
            new_filename = f"{group_tag}{clean_filename}"
            new_path = p.parent / new_filename

            if dry_run:
                console.print(f"  [cyan]Would rename:[/cyan] {filename} → {new_filename}")
                total_renamed += 1
            else:
                try:
                    # Check for name conflicts
                    if new_path.exists():
                        console.print(f"  [red]Conflict:[/red] {new_filename} already exists")
                        total_failed += 1
                        continue

                    p.rename(new_path)
                    console.print(f"  [green]Renamed:[/green] {filename} → {new_filename}")
                    total_renamed += 1
                except Exception as e:
                    console.print(f"  [red]Failed:[/red] {filename}: {e}")
                    total_failed += 1

    # Summary
    console.print("\n" + "="*60)
    if dry_run:
        console.print(f"[yellow]DRY RUN:[/yellow] Would rename {total_renamed} files")
    else:
        console.print(f"[green]Successfully renamed:[/green] {total_renamed} files")
        if total_failed > 0:
            console.print(f"[red]Failed:[/red] {total_failed} files")
    console.print("="*60)


@cli.command()
def cache():
    """Show cache statistics and manage cache."""
    detector = DuplicateDetector()
    stats = detector.get_cache_stats()

    click.echo("\nCache Statistics:")
    click.echo(f"  Location: {stats['cache_directory']}")
    click.echo(f"  Cached images: {stats['total_cached_images']}")
    click.echo(f"  Total size: {stats['total_size_mb']:.2f} MB")

    if click.confirm("\nDo you want to clear the cache?"):
        detector.clear_cache()
        click.echo("Cache cleared!")


@cli.command()
@click.option(
    "--shell",
    type=click.Choice(["zsh", "bash", "fish"]),
    default="zsh",
    help="Shell to generate completions for.",
    show_default=True,
)
@click.option(
    "--install",
    is_flag=True,
    help="Automatically install the completion script.",
)
def completion(shell, install):
    """
    Generate shell completion script.

    Examples:

        \b
        # Generate zsh completion and install it
        duplicate-images completion --install

        \b
        # Just print the completion script
        duplicate-images completion
    """
    import os
    import subprocess

    if shell == "zsh":
        completion_script = """#compdef duplicate-images

_duplicate-images() {
    local -a commands
    commands=(
        'scan:Scan a directory for duplicate images'
        'clean:Interactively clean duplicate images'
        'find:Find images similar to a specific query image'
        'tag:Tag duplicates by prepending group numbers'
        'cache:Show cache statistics and manage cache'
        'completion:Generate shell completion script'
    )

    local -a scan_opts
    scan_opts=(
        '(-t --threshold)'{-t,--threshold}'[Similarity threshold (0.0-1.0)]:threshold:(0.80 0.85 0.90 0.95)'
        '--model[CLIP model to use]:model:(openai/clip-vit-base-patch32 openai/clip-vit-large-patch14)'
        '--device[Device to use]:device:(auto cpu cuda mps)'
        '--batch-size[Batch size for processing]:batch_size:(16 32 64)'
        '--no-cache[Disable embedding cache]'
        '(-o --output)'{-o,--output}'[Export results to JSON]:filename:_files'
        '--detailed[Show detailed information]'
        '--tag[Tag duplicates with group numbers]'
        '--tag-prefix[Prefix for tagging]:prefix:(GROUP DUP DUPE)'
        '--dry-run[Preview changes without applying]'
    )

    local -a clean_opts
    clean_opts=(
        '(-t --threshold)'{-t,--threshold}'[Similarity threshold (0.0-1.0)]:threshold:(0.80 0.85 0.90 0.95)'
        '--action[Action to perform]:action:(delete move)'
        '--move-to[Directory to move duplicates to]:directory:_directories'
        '--dry-run[Show what would be done without doing it]'
        '--auto[Automatically keep first image]'
    )

    local -a find_opts
    find_opts=(
        '(-t --threshold)'{-t,--threshold}'[Minimum similarity threshold]:threshold:(0.75 0.80 0.85 0.90)'
        '(-k --top-k)'{-k,--top-k}'[Maximum number of results]:number:(5 10 20 50)'
    )

    local -a tag_opts
    tag_opts=(
        '(-t --threshold)'{-t,--threshold}'[Similarity threshold (0.0-1.0)]:threshold:(0.80 0.85 0.90 0.95)'
        '--prefix[Prefix to use for group tags]:prefix:(GROUP DUP DUPE)'
        '--dry-run[Show what would be done without doing it]'
        '--undo[Remove group tags from filenames]'
    )

    _arguments -C \
        '1: :->cmds' \
        '*:: :->args' && return 0

    case "$state" in
        cmds)
            _describe -t commands 'duplicate-images commands' commands
            ;;
        args)
            case "$line[1]" in
                scan)
                    _arguments \
                        '1:directory:_directories' \
                        $scan_opts
                    ;;
                clean)
                    _arguments \
                        '1:directory:_directories' \
                        $clean_opts
                    ;;
                find)
                    _arguments \
                        '1:query image:_files -g "*.{jpg,jpeg,png,gif,bmp,tiff,webp}"' \
                        '2:search directory:_directories' \
                        $find_opts
                    ;;
                tag)
                    _arguments \
                        '1:directory:_directories' \
                        $tag_opts
                    ;;
                completion)
                    _arguments \
                        '--shell[Shell type]:shell:(zsh bash fish)' \
                        '--install[Install completion script]'
                    ;;
            esac
            ;;
    esac
}

_duplicate-images "$@"
"""
    elif shell == "bash":
        completion_script = """# bash completion for duplicate-images

_duplicate_images_completion() {
    local cur prev opts
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    # Main commands
    if [ $COMP_CWORD -eq 1 ]; then
        opts="scan clean find tag cache completion"
        COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
        return 0
    fi

    # Command-specific completions
    case "${COMP_WORDS[1]}" in
        scan|clean|tag)
            if [ $COMP_CWORD -eq 2 ]; then
                COMPREPLY=( $(compgen -d -- ${cur}) )
            else
                opts="--threshold --help"
                COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
            fi
            ;;
        find)
            if [ $COMP_CWORD -eq 2 ]; then
                COMPREPLY=( $(compgen -f -- ${cur}) )
            elif [ $COMP_CWORD -eq 3 ]; then
                COMPREPLY=( $(compgen -d -- ${cur}) )
            fi
            ;;
    esac
}

complete -F _duplicate_images_completion duplicate-images
"""
    else:  # fish
        completion_script = """# fish completion for duplicate-images

complete -c duplicate-images -f

# Commands
complete -c duplicate-images -n "not __fish_seen_subcommand_from scan clean find tag cache completion" -a scan -d "Scan directory for duplicates"
complete -c duplicate-images -n "not __fish_seen_subcommand_from scan clean find tag cache completion" -a clean -d "Clean duplicate images"
complete -c duplicate-images -n "not __fish_seen_subcommand_from scan clean find tag cache completion" -a find -d "Find similar images"
complete -c duplicate-images -n "not __fish_seen_subcommand_from scan clean find tag cache completion" -a tag -d "Tag duplicates with group numbers"
complete -c duplicate-images -n "not __fish_seen_subcommand_from scan clean find tag cache completion" -a cache -d "Manage cache"
complete -c duplicate-images -n "not __fish_seen_subcommand_from scan clean find tag cache completion" -a completion -d "Generate completions"

# scan command options
complete -c duplicate-images -n "__fish_seen_subcommand_from scan" -s t -l threshold -d "Similarity threshold" -x
complete -c duplicate-images -n "__fish_seen_subcommand_from scan" -l model -d "CLIP model" -x
complete -c duplicate-images -n "__fish_seen_subcommand_from scan" -l device -d "Device" -xa "auto cpu cuda mps"
complete -c duplicate-images -n "__fish_seen_subcommand_from scan" -l detailed -d "Show details"

# clean command options
complete -c duplicate-images -n "__fish_seen_subcommand_from clean" -s t -l threshold -d "Similarity threshold" -x
complete -c duplicate-images -n "__fish_seen_subcommand_from clean" -l action -d "Action" -xa "delete move"
complete -c duplicate-images -n "__fish_seen_subcommand_from clean" -l dry-run -d "Dry run"

# tag command options
complete -c duplicate-images -n "__fish_seen_subcommand_from tag" -s t -l threshold -d "Similarity threshold" -x
complete -c duplicate-images -n "__fish_seen_subcommand_from tag" -l prefix -d "Group prefix" -xa "GROUP DUP DUPE"
complete -c duplicate-images -n "__fish_seen_subcommand_from tag" -l dry-run -d "Dry run"
complete -c duplicate-images -n "__fish_seen_subcommand_from tag" -l undo -d "Remove tags"
"""

    if install:
        # Auto-install the completion
        home = os.path.expanduser("~")

        if shell == "zsh":
            # Try to detect existing fpath directories
            comp_dir = None
            potential_dirs = [
                os.path.join(home, ".zsh", "complete"),
                os.path.join(home, ".zsh", "completions"),
                os.path.join(home, ".zsh", "completion"),
                "/usr/local/share/zsh/site-functions",
            ]

            # Check which directories exist and are writable
            for dir_path in potential_dirs:
                if os.path.exists(dir_path) and os.access(dir_path, os.W_OK):
                    comp_dir = dir_path
                    click.echo(f"[cyan]Found existing completion directory:[/cyan] {comp_dir}")
                    break

            # If no existing directory found, create default
            if comp_dir is None:
                comp_dir = os.path.join(home, ".zsh", "completions")
                os.makedirs(comp_dir, exist_ok=True)
                click.echo(f"[cyan]Created completion directory:[/cyan] {comp_dir}")

            # Write completion file
            comp_file = os.path.join(comp_dir, "_duplicate-images")
            with open(comp_file, "w") as f:
                f.write(completion_script)

            click.echo(f"✓ Installed zsh completion to: {comp_file}")

            # Check if we need to update fpath (only if we created a new directory)
            zshrc = os.path.join(home, ".zshrc")
            needs_fpath = comp_dir == os.path.join(home, ".zsh", "completions")

            if needs_fpath and os.path.exists(zshrc):
                with open(zshrc, "r") as f:
                    content = f.read()
                    if comp_dir in content or ".zsh/completions" in content:
                        needs_fpath = False

            if needs_fpath:
                fpath_line = f'fpath=({comp_dir} $fpath)'
                with open(zshrc, "a") as f:
                    f.write(f"\n# Added by duplicate-images\n")
                    f.write(f"{fpath_line}\n")
                    f.write(f"autoload -Uz compinit && compinit\n")
                click.echo(f"✓ Updated {zshrc} with completion path")

            click.echo("\n" + "="*60)
            click.echo("Installation complete! To activate completions:")
            click.echo("="*60)
            click.echo("\n  1. Restart your shell, or run:")
            click.echo(f"     source {zshrc}")
            click.echo("\n  2. Then try:")
            click.echo("     duplicate-images <TAB>")
            click.echo("="*60)

        elif shell == "bash":
            # Install to bash completion directory
            comp_dir = os.path.join(home, ".bash_completion.d")
            os.makedirs(comp_dir, exist_ok=True)

            comp_file = os.path.join(comp_dir, "duplicate-images")
            with open(comp_file, "w") as f:
                f.write(completion_script)

            click.echo(f"✓ Installed bash completion to: {comp_file}")

            bashrc = os.path.join(home, ".bashrc")
            source_line = f"[ -f {comp_file} ] && source {comp_file}"

            with open(bashrc, "a") as f:
                f.write(f"\n# Added by duplicate-images\n")
                f.write(f"{source_line}\n")

            click.echo(f"✓ Updated {bashrc}")
            click.echo("\nRestart your shell or run: source {bashrc}")

        elif shell == "fish":
            # Install to fish completion directory
            comp_dir = os.path.join(home, ".config", "fish", "completions")
            os.makedirs(comp_dir, exist_ok=True)

            comp_file = os.path.join(comp_dir, "duplicate-images.fish")
            with open(comp_file, "w") as f:
                f.write(completion_script)

            click.echo(f"✓ Installed fish completion to: {comp_file}")
            click.echo("\nCompletions will be available immediately in new fish shells.")
    else:
        # Just print the script
        click.echo(completion_script)


if __name__ == "__main__":
    cli()
