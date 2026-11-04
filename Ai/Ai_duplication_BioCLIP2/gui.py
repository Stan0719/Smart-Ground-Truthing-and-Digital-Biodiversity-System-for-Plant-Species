"""Standalone, read-only photo review interface for BioCLIP 2."""

from pathlib import Path
import queue
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageOps, ImageTk

HERE = Path(__file__).resolve().parent
DEFAULT_PLANTS = HERE.parent / "Ai_duplication_Prevention" / "Plants"


class App:
    def __init__(self, root):
        self.root = root
        root.title("BioCLIP 2 - Compare Plant Photos")
        root.geometry("1240x820")
        root.minsize(1000, 650)
        style = ttk.Style(root)
        style.configure("Heading.TLabel", font=("Segoe UI", 14, "bold"))
        style.configure("Score.TLabel", font=("Segoe UI", 17, "bold"), foreground="#215b43")
        self.events = queue.Queue()
        self.engine = None
        self.busy = False
        self.images = []
        self.paths = []
        self.cards = []
        self.query_images = []
        self.current_query = None
        self.columns = 1
        self.folder = tk.StringVar(value=str(DEFAULT_PLANTS))
        self.query = tk.StringVar()
        self.top_k = tk.StringVar(value="5")
        self.status = tk.StringVar(value="Step 1: Click Load plant photos. Then select a photo on the left.")
        self.controls = []

        toolbar = ttk.Frame(root, padding=12)
        toolbar.pack(fill="x")
        toolbar.columnconfigure(1, weight=1)
        ttk.Label(toolbar, text="1. Photos to compare").grid(row=0, column=0, sticky="w")
        entry = ttk.Entry(toolbar, textvariable=self.folder)
        entry.grid(row=0, column=1, sticky="ew", padx=8)
        browse = ttk.Button(toolbar, text="Browse...", command=self.browse_folder)
        browse.grid(row=0, column=2)
        index = ttk.Button(toolbar, text="Load plant photos", command=self.index)
        index.grid(row=0, column=3, padx=8)
        ttk.Label(toolbar, text="2. Photo to check").grid(row=1, column=0, sticky="w", pady=8)
        query_entry = ttk.Entry(toolbar, textvariable=self.query)
        query_entry.grid(row=1, column=1, sticky="ew", padx=8)
        choose = ttk.Button(toolbar, text="Use another photo...", command=self.browse_query)
        choose.grid(row=1, column=2)
        search = ttk.Button(toolbar, text="Compare photo", command=self.search)
        search.grid(row=1, column=3, padx=8)
        ttk.Label(toolbar, text="Number of results").grid(row=2, column=0, sticky="w")
        count = ttk.Spinbox(toolbar, from_=1, to=100, textvariable=self.top_k, width=6)
        count.grid(row=2, column=1, sticky="w", padx=8)
        self.controls = [entry, browse, index, query_entry, choose, search, count]

        ttk.Label(root, text="Compare YOUR PHOTO with the POSSIBLE MATCHES. "
                  "Higher % means more visually similar, not confirmed as the same plant.",
                  wraplength=1000).pack(fill="x", padx=12)
        ttk.Label(root, textvariable=self.status).pack(fill="x", padx=12, pady=8)
        self.progress = ttk.Progressbar(root, mode="indeterminate")
        self.progress.pack(fill="x", padx=12)

        panes = ttk.Panedwindow(root, orient="horizontal")
        self.panes = panes
        panes.pack(fill="both", expand=True, padx=12, pady=8)
        sources = ttk.Frame(panes)
        ttk.Label(sources, text="Choose a photo", font=("Segoe UI", 11, "bold")).pack(anchor="w", pady=8)
        self.listbox = tk.Listbox(sources, width=22, exportselection=False,
                                  font=("Segoe UI", 10), selectbackground="#286346")
        scroll = ttk.Scrollbar(sources, command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.listbox.pack(fill="both", expand=True)
        self.listbox.bind("<<ListboxSelect>>", self.select_query)
        panes.add(sources, weight=1)

        query_panel = ttk.Frame(panes, padding=12)
        ttk.Label(query_panel, text="YOUR PHOTO", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(query_panel, text="This is the photo being checked.").pack(anchor="w", pady=(3, 12))
        self.query_preview = ttk.Frame(query_panel)
        self.query_preview.pack(fill="both", expand=True)
        ttk.Label(self.query_preview, text="Load photos, then select one\nfrom the list on the left.",
                  justify="center").pack(pady=60)
        panes.add(query_panel, weight=2)

        right = ttk.Frame(panes)
        ttk.Label(right, text="POSSIBLE MATCHES", style="Heading.TLabel").pack(anchor="w", pady=(12, 3))
        ttk.Label(right, text="Closest first. Click a picture to compare it larger.").pack(anchor="w", pady=(0, 8))
        canvas = tk.Canvas(right, highlightthickness=0)
        scrollbar = ttk.Scrollbar(right, command=canvas.yview)
        canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        canvas.pack(fill="both", expand=True)
        self.preview = ttk.Frame(canvas, padding=10)
        window = canvas.create_window((0, 0), window=self.preview, anchor="nw")
        self.preview.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        def resize_results(event):
            canvas.itemconfigure(window, width=event.width)
            columns = 2 if event.width >= 570 else 1
            if columns != self.columns:
                self.columns = columns
                self.layout_cards()
        canvas.bind("<Configure>", resize_results)
        self.canvas = canvas
        panes.add(right, weight=3)
        self.details = tk.BooleanVar(value=False)
        ttk.Checkbutton(root, text="Show loading details", variable=self.details,
                        command=self.toggle_details).pack(anchor="w", padx=12, pady=(0, 8))
        self.log = tk.Text(root, height=5, state="disabled", wrap="word")
        ttk.Label(self.preview, text="Matches will appear here after you choose a photo.",
                  wraplength=300).pack(pady=60)
        root.after(100, self.poll)

    def browse_folder(self):
        value = filedialog.askdirectory(initialdir=self.folder.get())
        if value:
            self.folder.set(value)

    def browse_query(self):
        value = filedialog.askopenfilename(initialdir=self.folder.get(), filetypes=[
            ("Images", "*.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff *.gif"), ("All files", "*.*")])
        if value:
            self.query.set(value)
            if self.paths:
                self.search()

    def toggle_details(self):
        if self.details.get():
            self.log.pack(fill="x", padx=12, pady=(0, 12), before=self.panes)
        else:
            self.log.pack_forget()

    def layout_cards(self):
        for column in range(2):
            self.preview.columnconfigure(column, weight=1 if column < self.columns else 0)
        for index, card in enumerate(self.cards):
            card.grid(row=index // self.columns, column=index % self.columns,
                      sticky="nsew", padx=5, pady=6)

    def select_query(self, event=None):
        selected = self.listbox.curselection()
        if selected and not self.busy:
            self.query.set(str(self.paths[selected[0]]))
            self.search()

    def run(self, action, work):
        if self.busy:
            return
        self.busy = True
        for widget in self.controls:
            widget.configure(state="disabled")
        self.listbox.configure(state="disabled")
        self.status.set(f"{action}...")
        self.progress.start()

        def worker():
            try:
                self.events.put((action, work()))
            except Exception as error:
                self.events.put(("error", str(error)))
        threading.Thread(target=worker, daemon=True).start()

    def clear_preview(self):
        for child in self.preview.winfo_children():
            child.destroy()
        self.images.clear()
        self.cards.clear()
        self.canvas.yview_moveto(0)

    def show_query(self, path):
        self.current_query = path
        for child in self.query_preview.winfo_children():
            child.destroy()
        self.query_images.clear()
        self.photo_widget(self.query_preview, path, (330, 330), self.query_images)
        ttk.Label(self.query_preview, text=Path(path).name, wraplength=290).pack(pady=10)

    def photo_widget(self, parent, path, size, references, command=None):
        try:
            with Image.open(path) as original:
                image = ImageOps.exif_transpose(original).convert("RGB")
                image.thumbnail(size)
                # A consistent frame makes portrait and landscape photos easier to compare.
                background = Image.new("RGB", size, "#eef1ed")
                background.paste(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
                photo = ImageTk.PhotoImage(background)
            references.append(photo)
            label = ttk.Label(parent, image=photo, cursor="hand2" if command else "")
            label.pack(pady=6)
            if command:
                label.bind("<Button-1>", lambda event: command())
        except OSError as error:
            ttk.Label(parent, text=f"Preview unavailable: {error}", wraplength=size[0]).pack()

    def open_comparison(self, match_path, score):
        window = tk.Toplevel(self.root)
        window.title("Compare photos - same plant or separate plants?")
        window.geometry("1080x700")
        window.photos = []
        ttk.Label(window, text=f"Visual similarity: {score:.1%} - please check the photos yourself",
                  style="Heading.TLabel").pack(pady=14)
        row = ttk.Frame(window, padding=10)
        row.pack(fill="both", expand=True)
        for path, title in ((self.current_query, "YOUR PHOTO"), (match_path, "POSSIBLE MATCH")):
            panel = ttk.Frame(row, padding=8)
            panel.pack(side="left", fill="both", expand=True)
            ttk.Label(panel, text=title, style="Heading.TLabel").pack()
            self.photo_widget(panel, path, (490, 490), window.photos)
            ttk.Label(panel, text=Path(path).name, wraplength=470).pack()
        ttk.Button(window, text="Close comparison", command=window.destroy).pack(pady=10)

    def index(self):
        folder = self.folder.get()
        if not Path(folder).is_dir():
            messagebox.showerror("Folder unavailable", "Choose an existing reference folder.")
            return
        self.paths = []
        self.listbox.delete(0, "end")
        self.clear_preview()
        for child in self.query_preview.winfo_children():
            child.destroy()
        self.query_images.clear()
        self.current_query = None

        def work():
            if self.engine is None:
                from engine import BioCLIPSearch
                self.engine = BioCLIPSearch(HERE / ".cache", log=lambda s: self.events.put(("log", s)))
            return self.engine.index(folder)
        self.run("Indexing", work)

    def search(self):
        if not self.paths:
            messagebox.showinfo("Load photos first", "Click Load plant photos first.")
            return
        try:
            count = int(self.top_k.get())
            if not 1 <= count <= 100:
                raise ValueError
        except ValueError:
            messagebox.showerror("Invalid count", "Enter a whole number from 1 to 100.")
            return
        query = self.query.get()
        if not Path(query).is_file():
            messagebox.showerror("Query required", "Choose a photo to compare.")
            return
        self.clear_preview()
        self.show_query(query)
        ttk.Label(self.preview, text="Looking for similar photos...").pack(pady=60)
        self.run("Searching", lambda: (query, self.engine.search(query, count)))

    def show_match(self, path, rank, score):
        card = ttk.Frame(self.preview, padding=10, relief="solid", borderwidth=1)
        title = "#1 - Closest result" if rank == 1 else f"#{rank} - Possible match"
        ttk.Label(card, text=title, font=("Segoe UI", 11, "bold")).pack(anchor="w")
        ttk.Label(card, text=f"{score:.1%}", style="Score.TLabel").pack(anchor="w", pady=(4, 0))
        ttk.Label(card, text="visual similarity").pack(anchor="w")
        self.photo_widget(card, path, (240, 190), self.images,
                          command=lambda: self.open_comparison(path, score))
        ttk.Label(card, text=Path(path).name, wraplength=230).pack(anchor="w")
        ttk.Button(card, text="Compare side by side",
                   command=lambda: self.open_comparison(path, score)).pack(fill="x", pady=(8, 0))
        self.cards.append(card)

    def poll(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "log":
                    self.log.configure(state="normal")
                    self.log.insert("end", value + "\n")
                    self.log.see("end")
                    self.log.configure(state="disabled")
                    continue
                self.busy = False
                self.progress.stop()
                for widget in self.controls:
                    widget.configure(state="normal")
                self.listbox.configure(state="normal")
                if kind == "error":
                    self.status.set("Failed — see error message.")
                    messagebox.showerror("BioCLIP 2", value)
                elif kind == "Indexing":
                    self.paths = value
                    for number, path in enumerate(value, 1):
                        self.listbox.insert("end", f"Photo {number:02d} | {path.name}")
                    self.status.set(f"Loaded {len(value)} photos. Select a photo on the left to compare it.")
                    if value:
                        self.listbox.selection_set(0)
                        self.select_query()
                elif kind == "Searching":
                    query, results = value
                    self.clear_preview()
                    self.show_query(query)
                    for rank, (path, score) in enumerate(results, 1):
                        self.show_match(path, rank, score)
                    self.layout_cards()
                    if not results:
                        ttk.Label(self.preview, text="No other photos to compare. Load a folder with more photos.",
                                  wraplength=300).pack(pady=40)
                    self.status.set(f"Showing {len(results)} possible matches, closest first. "
                                    "These are suggestions, not confirmed duplicates.")
        except queue.Empty:
            pass
        self.root.after(100, self.poll)


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
