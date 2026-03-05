import { CLIPVisionModelWithProjection, AutoProcessor, RawImage } from '@xenova/transformers';
import path from 'path';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

let processor = null;
let model = null;

/**
 * Load the CLIP model and processor. Idempotent — safe to call multiple times.
 * Downloads and caches model files (~350MB) on first run.
 * @param {function} onProgress - optional callback({ file, progress })
 */
export async function loadModel(onProgress) {
  if (model) return;

  processor = await AutoProcessor.from_pretrained(MODEL_ID, {
    progress_callback: onProgress,
  });

  model = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
    progress_callback: onProgress,
  });
}

/**
 * Compute a L2-normalized CLIP image embedding for a local image file.
 * @param {string} imagePath - absolute or relative path to the image
 * @returns {number[]} normalized embedding vector (512 dimensions for ViT-B/32)
 */
export async function getEmbedding(imagePath) {
  const image = await RawImage.read(path.resolve(imagePath));
  const inputs = await processor(image);
  const { image_embeds } = await model(inputs);

  // L2-normalize so cosine similarity = dot product
  const data = Array.from(image_embeds.data);
  const norm = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0));
  return data.map(v => v / norm);
}

/**
 * Cosine similarity between two L2-normalized embedding vectors.
 * Returns value in [-1, 1]; practically [0, 1] for image embeddings.
 */
export function cosineSimilarity(a, b) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}
