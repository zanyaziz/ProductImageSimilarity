import sharp from 'sharp';

const HASH_SIZE = 8; // produces a 64-bit hash (8 rows × 8 column comparisons)

/**
 * Compute a difference hash (dHash) for an image.
 *
 * Algorithm:
 * 1. Resize to (HASH_SIZE+1) × HASH_SIZE (9×8) in grayscale
 * 2. For each row, compare each pixel to the one to its right
 * 3. Encode result as an array of 64 bits (1 = left brighter, 0 = right brighter)
 *
 * dHash is sensitive to pixel-level structural patterns — complementary to CLIP's
 * semantic embeddings. Two images of the same physical item at similar angles
 * will share many bits even across lighting differences.
 *
 * @param {string} imagePath
 * @returns {number[]} 64-element array of 0/1 bits
 */
export async function computeDHash(imagePath) {
  const width = HASH_SIZE + 1;
  const height = HASH_SIZE;

  const { data } = await sharp(imagePath)
    .resize(width, height, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bits = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      const left = data[y * width + x];
      const right = data[y * width + x + 1];
      bits.push(left > right ? 1 : 0);
    }
  }

  return bits;
}

/**
 * Hamming similarity between two dHash bit arrays.
 * Returns 1.0 for identical hashes, 0.0 for completely opposite.
 *
 * Rule of thumb for 64-bit dHash:
 *   0–5 bits different  → nearly identical
 *   6–15 bits different → similar
 *   >15 bits different  → likely different item or very different angle
 *
 * @param {number[]} bitsA
 * @param {number[]} bitsB
 * @returns {number} similarity in [0, 1]
 */
export function hammingSimilarity(bitsA, bitsB) {
  let diff = 0;
  for (let i = 0; i < bitsA.length; i++) {
    if (bitsA[i] !== bitsB[i]) diff++;
  }
  return 1 - diff / bitsA.length;
}
