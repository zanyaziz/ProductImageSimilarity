# ImageSimilarity

A Node.js CLI tool that compares a query image against a folder of images to determine if they depict the **same physical product**. Built for marketplace listing verification — detecting whether camera photos and stock photos in a listing show the same item.

## How It Works

Each image pair is scored using two complementary signals:

- **CLIP embeddings** (`@xenova/transformers`) — runs OpenAI's CLIP ViT-B/32 model locally via ONNX Runtime. Captures semantic/category-level similarity. High recall.
- **Difference hash (dHash)** — compresses each image to a 64-bit structural fingerprint using `sharp`. Captures pixel-level patterns. High precision when it fires.

```
final_score = 0.70 × CLIP_cosine_similarity + 0.30 × dHash_hamming_similarity
```

A configurable threshold (default `0.72`) classifies each pair as **MATCH** or **NO MATCH**.

No GPU required. No Python. No external APIs. The CLIP model (~350MB) downloads and caches locally on first run.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm (bundled with Node.js)

## Getting Started

### 1. Clone the repository

```bash
git clone <repo-url>
cd ImageSimilarity
```

### 2. Install dependencies

```bash
npm install
```

### 3. Prepare your images

Create a folder containing the images you want to compare against (e.g. stock photos from a listing), and have your query image (e.g. a camera photo) ready separately:

```
assets/listing_1/
  stock-front.jpg
  stock-side.jpg
  stock-interior.jpg

my-car-photo.jpg   ← query image
```

### 4. Run a comparison

```bash
node src/index.js --query ./assets/listing_1/Comparison.jpg --folder ./assets/listing_1/
```

### 5. Wait for the model to download (first run only)

On first run, the CLIP ViT-B/32 model is downloaded automatically from HuggingFace and cached locally. You will see progress in the terminal:

```
Loading CLIP model (first run downloads ~350MB)...
  ↓ onnx/model_quantized.onnx
  ↓ tokenizer.json
  ↓ preprocessor_config.json
Model ready.
```

**What is being downloaded:**

| File | Description |
|---|---|
| `onnx/model_quantized.onnx` | The CLIP vision model weights in ONNX format (~85MB quantized) |
| `tokenizer.json` | Tokenizer config |
| `preprocessor_config.json` | Image preprocessing config |

**Where it is cached:**

```
~/.cache/huggingface/hub/models--Xenova--clip-vit-base-patch32/
```

This directory persists across runs — subsequent runs skip the download entirely and load from disk in a few seconds.

> **Slow download?** The files are served from HuggingFace CDN. If you are on a slow connection, the first run may take a few minutes. Do not interrupt it — the download will resume from scratch if cancelled.

> **Disk space:** The full cached model takes approximately 350MB. To remove it and free space, delete the cache directory:
> ```bash
> rm -rf ~/.cache/huggingface/hub/models--Xenova--clip-vit-base-patch32
> ```

## Usage

This project ships two CLI scripts.

---

### `download.js` — Download images from a listing

Launches a headless browser, renders the listing page (including lazy-loaded images), and saves all product images to a local folder.

```
Options:
  -u, --url <url>         Marketplace listing URL (required)
  -f, --folder <path>     Destination folder — created if it doesn't exist (required)
  --min-size <pixels>     Minimum image dimension to include (default: 300)
  -h, --help              Display help
```

**Example:**
```bash
node src/download.js --url "https://www.facebook.com/marketplace/item/123456" --folder ./assets/listing_1
```

**Sample output:**
```
Launching browser...
Loading: https://www.facebook.com/marketplace/item/123456

Found 8 image(s). Downloading to assets/listing_1/

  ✓ 1.jpg  (1080×1080)
  ✓ 2.jpg  (1080×1080)
  ✓ 3.jpg  (960×720)
  ✗ SKIP   cdn.example.com/icon.png — HTTP 403
  ✓ 4.jpg  (1080×1080)

4 image(s) saved to assets/listing_1
```

> **Note:** Some marketplaces (e.g. Facebook Marketplace) require you to be logged in to view listings. If you get 0 images, try lowering `--min-size` or check if the listing requires authentication.

---

### `index.js` — Compare a query image against a folder

```
Options:
  -q, --query <path>      Path to the query image (required)
  -f, --folder <path>     Path to folder of images to compare against (required)
  -t, --threshold <0-1>   Match threshold — lower is more permissive (default: 0.72)
  -h, --help              Display help
```

**Examples:**

Compare a camera photo against downloaded listing images:
```bash
node src/index.js --query ./assets/listing_1/Comparison.jpg --folder ./assets/listing_1/
```

Use a stricter threshold to reduce false positives:
```bash
node src/index.js --query ./assets/listing_1/Comparison.jpg --folder ./assets/listing_1/ --threshold 0.80
```

Use a looser threshold for higher recall:
```bash
node src/index.js --query ./assets/listing_1/Comparison.jpg --folder ./assets/listing_1/ --threshold 0.65
```

---

### End-to-end workflow

```bash
# Step 1: Download all images from a listing
node src/download.js --url "<listing-url>" --folder ./assets/listing_1

# Step 2: Compare your query image against the downloaded images
node src/index.js --query ./assets/listing_1/Comparison.jpg --folder ./assets/listing_1/
```

### Sample Output

```
Loading CLIP model (first run downloads ~350MB)...
Model ready.

Query:  my-car-photo.jpg
Folder: /path/to/listing-images
Images: 5  |  Threshold: 0.72

Image                   CLIP    dHash   Score   Result
──────────────────────────────────────────────────────
stock-front.jpg        0.891   0.781   0.857   MATCH
stock-side.jpg         0.874   0.703   0.823   MATCH
stock-interior.jpg     0.701   0.438   0.622   NO MATCH
dealer-photo.jpg       0.612   0.344   0.531   NO MATCH
other-listing.jpg      0.543   0.281   0.464   NO MATCH
──────────────────────────────────────────────────────

2 MATCH / 5 compared   (threshold: 0.72)
```

## Supported Image Formats

`.jpg` `.jpeg` `.png` `.webp` `.avif` `.tiff`

## Tuning the Threshold

The default threshold of `0.72` is a balanced starting point. Adjust based on your use case:

| Goal | Threshold | Trade-off |
|---|---|---|
| Minimize false positives | 0.78–0.85 | May miss valid matches at different angles |
| Balanced | 0.72 | Good general-purpose default |
| Maximize recall | 0.60–0.68 | More false positives for similar-looking items |

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | At least one image matched |
| `1` | No matches found, or fatal error |

This makes the tool scriptable — useful for pipeline integration.

## Project Structure

```
ImageSimilarity/
  src/
    download.js     CLI — scrape and download images from a marketplace listing
    index.js        CLI — compare a query image against a folder
    embeddings.js   CLIP model loader and embedding extractor
    dhash.js        Difference hash computation and Hamming similarity
    scorer.js       Score combination and match classification
  assets/           Local image sets (gitignored)
  prompt.md         Problem context, architecture decisions, trade-off analysis
  package.json
  README.md
```

## Limitations

- **Extreme viewpoint changes** (>45°) reduce dHash effectiveness. CLIP compensates but instance-level precision drops.
- **Visually generic items** (plain white appliances, common car models) can produce false positives since CLIP captures category similarity, not individual identity.
- **Sequential processing** — images are compared one at a time. For large folders, consider pre-computing and caching embeddings.

See [prompt.md](prompt.md) for a detailed discussion of the approach, trade-offs, and planned improvements.
