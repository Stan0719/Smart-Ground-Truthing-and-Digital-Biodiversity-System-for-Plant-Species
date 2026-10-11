"""Desktop interface for reviewing visually similar photos."""

import contextlib
import json
import os
from pathlib import Path
import queue
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageOps, ImageTk


class ScanOutput:
    def __init__(self, events):
        self.events = events

    def write(self, text):
        if text.strip():
            self.events.put(("log", text.replace("\r", "\n")))

    def flush(self):
        pass


class DuplicateImagesApp:
    def __init__(self, root):
        self.root = root
        root.title("Plant Photo Duplicates")
        root.geometry("1060x760")
        root.minsize(780, 600)
        self.events = queue.Queue()
        self.groups = []
        self.photos = []
        self.scanning = False
        self.detector = None
        default_folder = Path.cwd() / "Plants"
        self.folder = tk.StringVar(value=str(default_folder if default_folder.exists() else Path.cwd()))
        self.threshold = tk.StringVar(value="0.90")
        self.recursive = tk.BooleanVar(value=True)
        self.status = tk.StringVar(value="Ready")

        style = ttk.Style(root)
        style.configure("TButton", padding=6)
        style.configure("Treeview", rowheight=30)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(2, weight=1)

        controls = ttk.Frame(root, padding=16)
        controls.grid(row=0, column=0, sticky="ew")
        controls.columnconfigure(1, weight=1)
        ttk.Label(controls, text="Photo folder").grid(row=0, column=0, padx=(0, 10))
        self.folder_input = ttk.Entry(controls, textvariable=self.folder)
        self.folder_input.grid(row=0, column=1, sticky="ew")
        self.browse_button = ttk.Button(controls, text="Browse...", command=self.browse)
        self.browse_button.grid(row=0, column=2, padx=(8, 0))
        options = ttk.Frame(controls)
        options.grid(row=1, column=0, columnspan=3, sticky="ew", pady=(12, 0))
        ttk.Label(options, text="Similarity threshold").pack(side="left")
        self.threshold_input = ttk.Spinbox(options, from_=0.50, to=1.00, increment=0.01,
                                         textvariable=self.threshold, width=6)
        self.threshold_input.pack(side="left", padx=8)
        self.recursive_input = ttk.Checkbutton(options, text="Include subfolders", variable=self.recursive)
        self.recursive_input.pack(side="left", padx=8)
        self.scan_button = ttk.Button(options, text="Scan photos", command=self.start_scan)
        self.scan_button.pack(side="right")
        self.export_button = ttk.Button(options, text="Export JSON...", command=self.export, state="disabled")
        self.export_button.pack(side="right", padx=8)

        status_bar = ttk.Frame(root, padding=(16, 0, 16, 12))
        status_bar.grid(row=1, column=0, sticky="ew")
        status_bar.columnconfigure(0, weight=1)
        ttk.Label(status_bar, textvariable=self.status).grid(row=0, column=0, sticky="w")
        self.progress = ttk.Progressbar(status_bar, mode="indeterminate", length=130)
        self.progress.grid(row=0, column=1, padx=(8, 0))

        content = ttk.Panedwindow(root, orient="horizontal")
        content.grid(row=2, column=0, sticky="nsew", padx=16)
        group_panel = ttk.Frame(content)
        self.tree = ttk.Treeview(group_panel, columns=("count", "score"), selectmode="browse")
        self.tree.heading("#0", text="Group")
        self.tree.heading("count", text="Photos")
        self.tree.heading("score", text="Similarity")
        self.tree.column("#0", width=85, stretch=False)
        self.tree.column("count", width=60, stretch=False, anchor="center")
        self.tree.column("score", width=85, stretch=False, anchor="center")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self.show_group)
        content.add(group_panel, weight=1)

        preview_panel = ttk.Frame(content)
        self.canvas = tk.Canvas(preview_panel, background="#f4f5f6", highlightthickness=0)
        scrollbar = ttk.Scrollbar(preview_panel, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.preview = ttk.Frame(self.canvas, padding=12)
        self.preview_window = self.canvas.create_window((0, 0), window=self.preview, anchor="nw")
        self.preview.bind("<Configure>", lambda event: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", self.resize_preview)
        ttk.Label(self.preview, text="No results").pack(pady=40)
        content.add(preview_panel, weight=3)

        log_panel = ttk.Frame(root, padding=16)
        log_panel.grid(row=3, column=0, sticky="ew")
        ttk.Label(log_panel, text="Scan activity").pack(anchor="w")
        self.log = tk.Text(log_panel, height=6, wrap="word", state="disabled", font=("Consolas", 9))
        self.log.pack(fill="x", pady=(5, 0))
        root.after(100, self.poll_events)

    def resize_preview(self, event):
        self.canvas.itemconfigure(self.preview_window, width=event.width)
        for child in self.preview.winfo_children():
            if isinstance(child, ttk.Label):
                child.configure(wraplength=max(200, event.width - 40))

    def browse(self):
        folder = filedialog.askdirectory(parent=self.root, initialdir=self.folder.get())
        if folder:
            self.folder.set(folder)

    def start_scan(self):
        if self.scanning:
            return
        folder = Path(self.folder.get()).expanduser()
        try:
            threshold = float(self.threshold.get())
            if not 0 < threshold <= 1:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid threshold", "Enter a threshold greater than 0 and at most 1.")
            return
        if not folder.is_dir():
            messagebox.showerror("Folder unavailable", "Choose an existing photo folder.")
            return
        self.scanning = True
        self.groups = []
        self.tree.delete(*self.tree.get_children())
        self.clear_preview()
        self.export_button.configure(state="disabled")
        for widget in (self.scan_button, self.folder_input, self.browse_button,
                       self.threshold_input, self.recursive_input):
            widget.configure(state="disabled")
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self.status.set("Scanning...")
        self.progress.start(12)
        threading.Thread(target=self.scan_worker, args=(str(folder.resolve()), threshold,
                         self.recursive.get()), daemon=True).start()

    def scan_worker(self, folder, threshold, recursive):
        output = ScanOutput(self.events)
        try:
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                # Import and model loading run off the UI thread.
                os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
                from .core.detector import DuplicateDetector

                if self.detector is None:
                    self.detector = DuplicateDetector(cache_dir=Path.cwd() / ".gui-cache")
                groups = self.detector.detect(folder, threshold=threshold, recursive=recursive)
                self.events.put(("done", groups))
        except Exception as error:
            self.events.put(("error", str(error)))

    def poll_events(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "log":
                    self.log.configure(state="normal")
                    self.log.insert("end", value if value.endswith("\n") else value + "\n")
                    self.log.see("end")
                    self.log.configure(state="disabled")
                else:
                    self.finish_scan()
                    if kind == "error":
                        self.status.set("Scan failed")
                        messagebox.showerror("Scan failed", value)
                    else:
                        self.groups = value
                        self.status.set(f"Scan complete | {len(self.groups)} matching groups")
                        for index, group in enumerate(self.groups):
                            self.tree.insert("", "end", iid=str(index), text=f"Group {index + 1}",
                                             values=(len(group.image_paths), f"{group.avg_similarity:.1%}"))
                        self.export_button.configure(state="normal")
                        if self.groups:
                            self.tree.selection_set("0")
                        else:
                            ttk.Label(self.preview, text="No matching groups").pack(pady=40)
        except queue.Empty:
            pass
        self.root.after(100, self.poll_events)

    def finish_scan(self):
        self.scanning = False
        self.progress.stop()
        for widget in (self.scan_button, self.folder_input, self.browse_button,
                       self.threshold_input, self.recursive_input):
            widget.configure(state="normal")

    def clear_preview(self):
        for child in self.preview.winfo_children():
            child.destroy()
        self.photos.clear()
        self.canvas.yview_moveto(0)

    def show_group(self, event=None):
        selection = self.tree.selection()
        if not selection:
            return
        self.clear_preview()
        for path in self.groups[int(selection[0])].image_paths:
            try:
                with Image.open(path) as image:
                    image = ImageOps.exif_transpose(image).convert("RGB")
                    image.thumbnail((400, 230))
                    photo = ImageTk.PhotoImage(image)
                self.photos.append(photo)
                ttk.Label(self.preview, image=photo, anchor="center").pack(fill="x", pady=(8, 4))
            except Exception as error:
                ttk.Label(self.preview, text=f"Preview unavailable: {error}", wraplength=400).pack()
            ttk.Label(self.preview, text=Path(path).name, font=("Segoe UI", 10, "bold")).pack(anchor="w")
            ttk.Label(self.preview, text=str(path), wraplength=max(200, self.canvas.winfo_width() - 40)).pack(anchor="w")
            ttk.Separator(self.preview).pack(fill="x", pady=12)

    def export(self):
        path = filedialog.asksaveasfilename(parent=self.root, defaultextension=".json",
                                          filetypes=[("JSON", "*.json")], initialfile="plant-scan-results.json")
        if not path:
            return
        data = {"groups": [{"group_id": index + 1, "average_similarity": group.avg_similarity,
                            "images": group.image_paths} for index, group in enumerate(self.groups)]}
        try:
            Path(path).write_text(json.dumps(data, indent=2), encoding="utf-8")
            self.status.set(f"Saved results to {path}")
        except OSError as error:
            messagebox.showerror("Export failed", str(error))


def main():
    root = tk.Tk()
    DuplicateImagesApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
