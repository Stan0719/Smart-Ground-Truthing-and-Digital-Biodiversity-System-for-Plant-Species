# BioCLIP 2 plant photo ranking experiment

This separate desktop app uses pretrained `imageomics/bioclip-2` weights via
OpenCLIP. No training dataset or database is needed. Your existing Plants folder
is the default reference gallery and is read only. The original CLIP detector
and firmware remain separate. The website can also request comparisons
through the plant backend, as described below.

## Setup (PowerShell, from the repository root)

```powershell
cd Ai/Ai_duplication_BioCLIP2
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe gui.py
```

Python 3.10 or newer is recommended. First indexing downloads the pretrained
weights and requires internet access and enough disk space for a large ViT-L/14
model. CPU works but may be slow; compatible CUDA PyTorch is used automatically
when available. Weights and image features are cached under this folder's
`.cache`, separate from the original detector's cache. No photos are uploaded
to a remote inference API: inference runs locally.

## Try your photos

1. Leave Reference folder set to the existing `Ai_duplication_Prevention/Plants`,
   or browse to another folder. Subfolders are included.
2. Click **Load plant photos** and wait. The first photo is compared automatically.
3. Select a photo from the left to compare another one. Alternatively, use
   **Use another photo...** for a photo outside the gallery.
4. **YOUR PHOTO** stays visible in the middle. **POSSIBLE MATCHES** appear on the
   right, closest first, with a large similarity percentage on each photo card.
5. Click a match picture or **Compare side by side** for a larger comparison.
   Change **Number of results**, then click **Compare photo** to see more matches.
   Use the scrollbar on the right to see further results. Loading logs are
   available under **Show loading details**.

There is no minimum score, so weak matches remain visible. The exact query path
is excluded from its results; copied versions at other paths can still appear.
Results rank individual photos, not database plant records. Unlike the original
group display, each score is a direct comparison with the query, with no chain
grouping or group-average score.

If you add, remove, or edit reference photos, click **Load plant photos** again.
Changed photos get new cache keys. Images that cannot be opened are skipped and
reported. A search can legitimately return no candidates if only the query is
indexed.

## Website integration

From the repository root, keep these running in separate PowerShell terminals:

```powershell
& ".\Ai\Ai_duplication_BioCLIP2\.venv\Scripts\python.exe" -B ".\Ai\Ai_duplication_BioCLIP2\api.py"
```

```powershell
npm.cmd --prefix plant-conservation-backend start
```

```powershell
npm.cmd --prefix web run dev
```

Keep the existing account service running for website login. Wait for
`BioCLIP API ready` before using **Conservation Officer → Review Submissions →
Check similarity**. Restart an already-running plant backend after code changes.
The Python service listens only on `127.0.0.1:8002`; the authenticated plant API
handles website requests. No Cloudflare tunnel is needed for this local setup.

The query observation needs a stored JPEG/PNG. Reference photos must belong to
other approved plants, approved observations and approved assets. One photo is
selected per plant, preferring the whole-plant `photo:0` from the latest approved
observation. Up to 50 reference plants (in plant ID order) are compared, and the
top five are shown. This limit is not a search of every plant in a larger database.
The folder gallery used by the desktop GUI is separate from these database photos.

The existing drawer shows real plant/observation IDs, species and cosine similarity.
Distances use valid recorded coordinates, with no distance shown when unavailable.
Results are cached only for the current page session and cleared on refresh or
review updates. This feature reads existing records; it does not create database
tables, save analysis results, merge plants or change officer review decisions.
Missing photos, model outages and malformed results produce errors without demo
scores. CPU comparisons, especially the first request, may take time; a request
times out after three minutes.

## Evaluate before using for decisions

For a labelled same-plant/different-plant folder comparison against the original
OpenAI CLIP model family, follow [EVALUATION.md](EVALUATION.md). The separate
`compare_models.py` tool creates a visual report and CSV using real model scores;
it does not change this app's retrieval or officer-review behaviour.

No training is performed. Knowing the individual plant IDs helps you evaluate:
does another view of the same plant appear in the first five results, and do
different plants of the same species rank incorrectly? BioCLIP 2's biological
training does not guarantee individual plant identification across viewpoints.
Scores are not confidence probabilities and are not interchangeable with your
original CLIP scores. Keep officer review before rejecting any submission.

Official model and usage: https://huggingface.co/imageomics/bioclip-2

Run lightweight ranking/cache checks without downloading weights:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
