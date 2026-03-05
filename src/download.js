import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { program } from 'commander';

/**
 * Find the Chrome executable installed by Puppeteer, preferring arm64 on Apple Silicon.
 * This lets an x64 Node process still launch the arm64 Chrome (via Rosetta).
 */
function findChrome() {
  const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(cacheDir)) return null;

  const entries = fs.readdirSync(cacheDir);

  for (const prefix of ['mac_arm', 'mac-']) {
    const dir = entries.find(e => e.startsWith(prefix));
    if (!dir) continue;
    const arch = prefix === 'mac_arm' ? 'arm64' : 'x64';
    const chromePath = path.join(
      cacheDir, dir,
      `chrome-mac-${arch}`,
      'Google Chrome for Testing.app',
      'Contents', 'MacOS',
      'Google Chrome for Testing'
    );
    if (fs.existsSync(chromePath)) return chromePath;
  }

  return null;
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
};

program
  .name('download-listing')
  .description('Download all images from a marketplace listing into a local folder')
  .requiredOption('-u, --url <url>', 'Marketplace listing URL (Facebook, Craigslist, eBay, etc.)')
  .requiredOption('-f, --folder <path>', 'Destination folder (created if it does not exist)')
  .option('--min-size <pixels>', 'Minimum width/height in pixels to include an image', '300')
  .parse();

const opts = program.opts();
const minSize = parseInt(opts.minSize);

/**
 * Download a single image URL to disk.
 * Uses content-type header to determine the file extension.
 */
async function downloadImage(url, folderPath, index) {
  const response = await fetch(url, {
    headers: {
      // Mimic a real browser request so CDNs don't block us
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Referer': new URL(url).origin,
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  const ext = EXT_MAP[contentType] || '.jpg';
  const destPath = path.join(folderPath, `${index}${ext}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);

  return { destPath, ext };
}

async function main() {
  const folderPath = path.resolve(opts.folder);
  fs.mkdirSync(folderPath, { recursive: true });

  console.log(`\nLaunching browser...`);
  const chromePath = findChrome();
  if (!chromePath) {
    console.error(`${RED}Chrome not found. Run: npx puppeteer browsers install chrome${RESET}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Accept all content types so image CDN responses aren't blocked
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  console.log(`Loading: ${opts.url}\n`);

  try {
    await page.goto(opts.url, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch {
    // networkidle2 can time out on heavy pages — proceed with what loaded
    console.warn(`${DIM}Page load timed out — proceeding with what loaded${RESET}`);
  }

  // Scroll through the page to trigger lazy-loaded images
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let scrolled = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        scrolled += step;
        if (scrolled >= document.body.scrollHeight) {
          clearInterval(timer);
          setTimeout(resolve, 500);
        }
      }, 120);
    });
  });

  // Brief pause for any remaining lazy images to fire
  await new Promise(r => setTimeout(r, 1500));

  // Extract all sufficiently large images from the rendered page
  const images = await page.evaluate((minSize) => {
    return Array.from(document.querySelectorAll('img'))
      .filter(img => img.naturalWidth >= minSize && img.naturalHeight >= minSize)
      .map(img => {
        // Prefer the highest-resolution srcset entry over src
        let best = img.src;
        if (img.srcset) {
          const candidates = img.srcset
            .split(',')
            .map(s => s.trim().split(/\s+/))
            .filter(p => p[0] && !p[0].startsWith('data:'))
            .sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0));
          if (candidates.length > 0) best = candidates[0][0];
        }
        return { src: best, width: img.naturalWidth, height: img.naturalHeight };
      })
      .filter(img => img.src && !img.src.startsWith('data:'));
  }, minSize);

  await browser.close();

  // Deduplicate by URL
  const seen = new Set();
  const unique = images.filter(img => {
    if (seen.has(img.src)) return false;
    seen.add(img.src);
    return true;
  });

  if (unique.length === 0) {
    console.error(
      `${RED}No images found above ${minSize}px.${RESET}\n` +
      `Try lowering --min-size, or the listing may require login.`
    );
    process.exit(1);
  }

  console.log(`Found ${unique.length} image(s). Downloading to ${folderPath}/\n`);

  let saved = 0;
  for (const img of unique) {
    const i = saved + 1;
    try {
      const { ext } = await downloadImage(img.src, folderPath, i);
      console.log(`  ${GREEN}✓${RESET} ${i}${ext}  ${DIM}(${img.width}×${img.height})${RESET}`);
      saved++;
    } catch (err) {
      const shortUrl = img.src.length > 70 ? img.src.slice(0, 70) + '…' : img.src;
      console.log(`  ${RED}✗${RESET} SKIP  ${DIM}${shortUrl}${RESET}  — ${err.message}`);
    }
  }

  console.log(`\n${saved} image(s) saved to ${folderPath}`);

  if (saved === 0) process.exit(1);
}

main().catch(err => {
  console.error(`\n${RED}Fatal: ${err.message}${RESET}`);
  process.exit(1);
});
