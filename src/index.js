import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import { loadModel, getEmbedding, cosineSimilarity } from './embeddings.js';
import { computeDHash, hammingSimilarity } from './dhash.js';
import { combineScores, classify, DEFAULT_THRESHOLD } from './scorer.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif']);

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

program
  .name('image-similarity')
  .description('Compare a query image against a folder of images to detect if they show the same product')
  .requiredOption('-q, --query <path>', 'Path to the query image (e.g. camera photo)')
  .requiredOption('-f, --folder <path>', 'Path to folder of images to compare against (e.g. listing stock photos)')
  .option('-t, --threshold <number>', 'Match threshold 0–1 (lower = more permissive)', String(DEFAULT_THRESHOLD))
  .parse();

const opts = program.opts();
const threshold = parseFloat(opts.threshold);

if (isNaN(threshold) || threshold < 0 || threshold > 1) {
  console.error('Error: --threshold must be a number between 0 and 1');
  process.exit(1);
}

async function main() {
  const queryPath = path.resolve(opts.query);
  const folderPath = path.resolve(opts.folder);

  if (!fs.existsSync(queryPath)) {
    console.error(`Error: Query image not found: ${queryPath}`);
    process.exit(1);
  }
  if (!fs.statSync(queryPath).isFile()) {
    console.error(`Error: Query path is not a file: ${queryPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(folderPath)) {
    console.error(`Error: Folder not found: ${folderPath}`);
    process.exit(1);
  }
  if (!fs.statSync(folderPath).isDirectory()) {
    console.error(`Error: Folder path is not a directory: ${folderPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(folderPath)
    .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .map(f => path.join(folderPath, f));

  if (files.length === 0) {
    console.error(`No supported images found in: ${folderPath}`);
    console.error(`Supported formats: ${[...IMAGE_EXTENSIONS].join(', ')}`);
    process.exit(1);
  }

  // Load model with download progress
  process.stdout.write('\nLoading CLIP model (first run downloads ~350MB)...\n');
  let lastFile = '';
  await loadModel((progress) => {
    if (progress.file && progress.file !== lastFile) {
      lastFile = progress.file;
      process.stdout.write(`  ${DIM}↓ ${progress.file}${RESET}\r`);
    }
  });
  process.stdout.write('Model ready.                                          \n');

  console.log(`\nQuery:  ${path.basename(queryPath)}`);
  console.log(`Folder: ${folderPath}`);
  console.log(`Images: ${files.length}  |  Threshold: ${threshold}\n`);

  // Pre-compute query signals
  const queryEmbed = await getEmbedding(queryPath);
  const queryHash = await computeDHash(queryPath);

  // Build column widths
  const maxNameLen = Math.max(...files.map(f => path.basename(f).length), 'Image'.length);
  const header =
    'Image'.padEnd(maxNameLen) + '   ' +
    'CLIP'.padStart(6) + '   ' +
    'dHash'.padStart(6) + '   ' +
    'Score'.padStart(6) + '   ' +
    'Result';
  const divider = '─'.repeat(header.length);

  console.log(header);
  console.log(divider);

  const results = [];

  for (const filePath of files) {
    const name = path.basename(filePath);
    try {
      const embed = await getEmbedding(filePath);
      const hash = await computeDHash(filePath);

      const embedScore = cosineSimilarity(queryEmbed, embed);
      const dhashScore = hammingSimilarity(queryHash, hash);
      const finalScore = combineScores(embedScore, dhashScore);
      const label = classify(finalScore, threshold);
      const isMatch = label === 'MATCH';

      results.push({ name, embedScore, dhashScore, finalScore, label });

      const color = isMatch ? GREEN : RED;
      console.log(
        name.padEnd(maxNameLen) + '   ' +
        embedScore.toFixed(3).padStart(6) + '   ' +
        dhashScore.toFixed(3).padStart(6) + '   ' +
        finalScore.toFixed(3).padStart(6) + '   ' +
        color + label + RESET
      );
    } catch (err) {
      results.push({ name, error: err.message });
      console.log(
        name.padEnd(maxNameLen) + '   ' +
        `${RED}ERROR: ${err.message}${RESET}`
      );
    }
  }

  const matches = results.filter(r => r.label === 'MATCH').length;
  const errors = results.filter(r => r.error).length;

  console.log(divider);
  console.log(`\n${GREEN}${matches} MATCH${RESET} / ${results.length - errors} compared` +
    (errors > 0 ? ` / ${RED}${errors} error(s)${RESET}` : '') +
    `   (threshold: ${threshold})`);

  // Exit with code 1 if nothing matched, useful for scripting
  if (matches === 0) process.exit(1);
}

main().catch(err => {
  console.error(`\n${RED}Fatal: ${err.message}${RESET}`);
  process.exit(1);
});
