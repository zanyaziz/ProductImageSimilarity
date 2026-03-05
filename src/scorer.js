// CLIP captures semantic/category similarity — high recall, moderate precision for instance identity.
// dHash captures pixel-level structural similarity — low recall, high precision when it fires.
// Weighting CLIP higher since it's the primary signal; dHash is a precision booster.
const EMBED_WEIGHT = 0.7;
const DHASH_WEIGHT = 0.3;

export const DEFAULT_THRESHOLD = 0.72;

/**
 * Combine CLIP cosine similarity and dHash Hamming similarity into a single score.
 *
 * A borderline CLIP score (0.75–0.85) can be pushed into MATCH territory by strong
 * dHash agreement, and pulled into NO MATCH territory when dHash diverges — which is
 * exactly the failure mode for "same model, different instance" (e.g., two identical
 * car models where CLIP scores high but the pixel structure differs).
 *
 * @param {number} embedScore - cosine similarity [0, 1]
 * @param {number} dhashScore - Hamming similarity [0, 1]
 * @returns {number} weighted final score [0, 1]
 */
export function combineScores(embedScore, dhashScore) {
  return EMBED_WEIGHT * embedScore + DHASH_WEIGHT * dhashScore;
}

/**
 * @param {number} score - final combined score
 * @param {number} threshold - configurable match threshold
 * @returns {'MATCH' | 'NO MATCH'}
 */
export function classify(score, threshold) {
  return score >= threshold ? 'MATCH' : 'NO MATCH';
}
