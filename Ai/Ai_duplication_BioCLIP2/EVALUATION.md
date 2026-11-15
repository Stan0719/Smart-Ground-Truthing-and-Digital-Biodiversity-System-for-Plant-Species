Use this experiment to compare the original OpenAI CLIP ViT-B/32 model family
with BioCLIP 2 on photographs you can label reliably. It evaluates whether
same-plant photo pairs score above different-plant pairs. It does not train
either model or change the website's review decisions.

The folders are already created:

```text
evaluation_photos/
  duplicate/
    plant_A_two_views/
      view_1.jpg
      view_2.jpg
    plant_B_two_views/
      view_1.jpg
      view_2.jpg
  non_duplicate/
    different_plants_same_species/
      plant_A.jpg
      plant_B.jpg
    different_plants_different_species/
      plant_C.jpg
      plant_D.jpg
```

The prepared dataset uses numbered pair folders such as `01` and `02`; the
descriptive folder names above are examples only. Create more pair folders as
needed. Each populated pair folder must contain exactly two supported image
files. Empty folders and `.gitkeep` are ignored.

If photos have been prepared from `Plants`, open `evaluation_photos/review.html`
to inspect the numbered pairs. Its visual labels are provisional until the
photographer confirms physical plant identity. `label_provenance.json` retains
the source filenames, file hashes, selection reasons and label status. Its note
appears in comparison reports, and the status is included in the score CSV.
The `needs_review` and `image_copy_examples` folders are excluded from scoring.
After verifying/correcting the pairs, update the provenance status and note to
describe what you actually confirmed. No model scores were used to label pairs.

In `duplicate`, use two independently captured photos of the SAME physical
plant. In `non_duplicate`, use photos of TWO DIFFERENT physical plants,
including different plants of the same species. Folder names supply your
ground truth; the program cannot verify your labels. Keep a note of physical
plant IDs and species for each pair. Never label by how high the model scores.

Start with a few pairs to check the workflow. Aim for at least 20 varied pairs
in each group for a preliminary study; there is no minimum count that guarantees
a reliable conclusion. Cover different viewpoints, lighting and backgrounds.
Use many physical plants, not many near-identical pictures of one individual.
If every duplicate shares a pot/background while every non-duplicate changes
it, the experiment may measure background similarity instead of plant identity.
Identical file copies and repeated photo pairs are rejected. Cropped/recompressed
copies can evade that check but still do not test new-view plant recognition.

From the repository root in PowerShell, validate without loading models:

```powershell
& ".\Ai\Ai_duplication_BioCLIP2\.venv\Scripts\python.exe" -B ".\Ai\Ai_duplication_BioCLIP2\compare_models.py" --check
```

After validation succeeds, run both models:

```powershell
& ".\Ai\Ai_duplication_BioCLIP2\.venv\Scripts\python.exe" -B ".\Ai\Ai_duplication_BioCLIP2\compare_models.py"
```

The existing BioCLIP environment has the required packages. Missing model
weights download on first use. Photographs are processed locally. Both models
use OpenCLIP with their own prescribed preprocessing, identical orientation/RGB
handling and normalised cosine scoring. The baseline uses OpenAI ViT-B/32
weights through OpenCLIP rather than the older Transformers application and its
grouping logic. Small implementation differences are possible; this compares
the selected models in a common pipeline, not every aspect of the old app.
Models load sequentially to reduce peak memory. `--device cpu` forces CPU.

Each successful run creates a new `comparison_results/<UTC timestamp>/` folder:

| File | Purpose |
|:--|:--|
| `report.html` | Open locally in a browser for photo pairs and measured results. Embedded thumbnails make it portable. |
| `pair_scores.csv` | Human labels, paths, file hashes and both cosine scores. |
| `summary.json` | Counts, AUC, mean scores, model identities, versions, device and run time. |

ROC AUC compares score ordering WITHIN each model: how often does a same-plant
pair score above a different-plant pair? Ties count as half. 1.0 is perfect
separation on this set; 0.5 is chance-level ordering. AUC is not classification
accuracy, a duplicate probability, or top-five retrieval success. No threshold
is fitted and no pairs receive automatic duplicate predictions.

A higher AUC provides evidence of better pair separation on your labelled set.
Keep all results, including failures and a result favouring CLIP. Repeated views
of the same plants are correlated, so do not treat them as fully independent
evidence. Small differences on a small set are inconclusive. Confirm promising
results with more plants captured separately, and use a gallery/query evaluation
to establish top-five retrieval performance. Any future threshold must be tuned
on development examples and evaluated on separate held-out plants.

Encoding time excludes loading/downloading weights and reuses vectors within
each model run for repeated file paths. It includes preprocessing and scoring;
it is not a production request-latency benchmark. Raw cosine means have different
scales across models. BioCLIP 2 also has a larger image encoder, so differences
cannot be attributed solely to biological pretraining.

Photo files and generated results are git-ignored. Reports embed your photos;
share a report only when you intend to share those images.

Model loading follows the official [OpenCLIP usage](https://github.com/mlfoundations/open_clip)
and [BioCLIP 2 model card](https://huggingface.co/imageomics/bioclip-2).
