# Image Similarity — Problem Context & Implementation Plan

## Problem Statement

Detect whether images uploaded to a marketplace listing depict the **same physical product**. A listing may contain a mix of stock photos (manufacturer/dealer-sourced, clean backgrounds, studio lighting) and user-captured camera photos (real-world context, variable lighting, angles, clutter). The question to answer per image pair:

> **Is this the same product being sold, or just a similar-looking one?**

This is an **instance-level identity** problem, not a category-level similarity problem.

---

## Domain Context: Marketplace Listings

- Each listing has N images (typically 3–10)
- Some images are stock photos: perfect angles, no EXIF camera data, consistent metadata
- Some are camera photos: EXIF present, real-world backgrounds, variable quality
- The goal is to cross-check camera images against stock photos to confirm the actual item matches what's advertised
- High-value categories (cars, electronics, furniture) have the highest risk of misrepresentation

### Why Cars Are Hard

- Stock photos are often manufacturer or dealer CDN images — a blue Honda Civic stock photo embeds very similarly to *any other* blue Honda Civic camera photo
- Discriminating features: license plates, VIN area, paint condition (chips/scratches), custom mods, wheel specifics, interior wear patterns
- Semantic embeddings (CLIP) capture "blue Civic" but not "this specific blue Civic"
- Geometric feature matching captures "this exact scratch pattern" when visible

---

## Chosen Approach: Hybrid (Approaches 1 + 2)

### Why Not LLM Vision (Approach 3)

- Too expensive at scale (~$0.01–0.02 per pair)
- Latency too high for real-time use
- Reserved as an optional final escalation layer for flagged listings

### Why Combine Classical Features + Deep Embeddings

The two methods capture **orthogonal signals** with non-overlapping failure modes:

| Signal | Captures | Fails On |
|---|---|---|
| CLIP/DINO embedding | Semantic/category-level appearance | Instance-level discrimination (same model ≠ same item) |
| dHash (perceptual hash) | Pixel-level structural patterns | Very different angles, heavy lighting change |

Together: CLIP provides high recall, dHash adds precision for borderline cases.

---

## Technical Architecture

### Stack
- **Runtime:** Node.js (ESM)
- **CLIP embeddings:** `@xenova/transformers` — runs CLIP ViT-B/32 via ONNX Runtime in-process, no Python, no GPU required. Downloads and caches model (~350MB) on first run to `~/.cache/huggingface/hub/`.
- **Perceptual hashing:** `sharp` — resize + grayscale + raw pixel buffer → difference hash (dHash)
- **CLI:** `commander`

### Why dHash Over SIFT/ORB

SIFT/ORB (the original Approach 1) requires OpenCV bindings (`opencv4nodejs`) which have complex native compilation requirements. dHash is a pure-JS equivalent that serves the same complementary role:

- Both operate at the pixel/texture level, not semantic level
- dHash computes a 64-bit hash by comparing adjacent grayscale pixels left-to-right across an 8×8 downscaled image
- Hamming distance between two hashes = structural divergence
- Fast (~1ms per image), zero GPU, no native deps

dHash is less powerful than SIFT for finding specific keypoint correspondences but is a strong secondary signal for the scoring pipeline.

### Scoring Formula

```
final_score = 0.70 × clip_cosine_similarity + 0.30 × dhash_hamming_similarity

threshold = 0.72 (configurable via --threshold flag)
```

CLIP score range: 0.0–1.0 (cosine similarity of L2-normalized embeddings)
dHash similarity: `1 - (hamming_distance / 64)`, range 0.0–1.0

**Threshold rationale:**
- Pure CLIP without calibration produces false positives around 0.75–0.90 for same-model-different-instance
- Adding dHash weight pushes same-instance pairs higher while pulling different-instance pairs lower
- 0.72 is a conservative default; tune upward (0.78+) for lower false positive rate, downward (0.65) for higher recall

---

## File Structure

```
ImageSimilarity/
  src/
    index.js        CLI entry point, orchestration, output rendering
    embeddings.js   CLIP model loader and embedding extractor
    dhash.js        Difference hash computation and Hamming similarity
    scorer.js       Score combination and classification
  prompt.md         This file
  package.json
```

---

## CLI Usage

```bash
node src/index.js --query <image-path> --folder <folder-path> [--threshold <0-1>]
```

**Example:**
```bash
node src/index.js --query ./camera-photo.jpg --folder ./listing-images/ --threshold 0.72
```

**Output:**
```
Loading CLIP model (first run downloads ~350MB)...
Model ready.

Query: camera-photo.jpg
Comparing against 5 image(s) in listing-images/

Image                  CLIP   dHash   Score  Result
---------------------------------------------------
stock-front.jpg       0.891   0.781   0.857  MATCH
stock-side.jpg        0.874   0.703   0.823  MATCH
stock-interior.jpg    0.701   0.438   0.622  NO MATCH
dealer-photo.jpg      0.612   0.344   0.531  NO MATCH
other-listing.jpg     0.543   0.281   0.464  NO MATCH

2/5 images matched (threshold: 0.72)
```

---

## Known Limitations & Future Improvements

1. **Angle invariance:** dHash degrades for >45° viewpoint change. SIFT/ORB with RANSAC homography would be more robust for extreme angles (requires OpenCV bindings).

2. **Instance vs. category confusion:** For highly generic-looking products (plain white appliances, common car models), even the combined score may produce false positives. Fine-tuning a Siamese network on labeled product pairs would significantly improve precision.

3. **LLM escalation layer:** For scores in the ambiguous zone (0.65–0.80), a vision LLM call (Claude Vision, GPT-4V) as a final verifier would reduce false positives for high-value listings.

4. **EXIF pre-classification:** Stock photos typically lack camera EXIF metadata. Classifying images as stock vs. camera before comparison could inform weight adjustments — stock-to-stock comparisons need stricter thresholds than stock-to-camera.

5. **Scale:** Current design processes images sequentially. For batch processing, embeddings can be precomputed and cached, and CLIP inference can be batched for GPU throughput.
