#!/usr/bin/env node
/**
 * Compiles an image into a MindAR `.mind` target file, offline, in Node.
 *
 *   npm run compile-target                                   # default paths
 *   npm run compile-target -- <input.jpg|png> <output.mind>  # custom paths
 *
 * MindAR cannot track a raw JPG/PNG: it needs pre-extracted matching
 * (detection) and tracking features. This runs MindAR's own OfflineCompiler
 * (tfjs CPU backend + node-canvas), so the output is identical in format to
 * the web compiler at https://hiukim.github.io/mind-ar-js-doc/tools/compile
 *
 * Re-run this whenever the target artwork changes, then update
 * `target.aspect` in src/ar/trackingConfig.js if the image proportions changed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadImage } from 'canvas';
import { OfflineCompiler } from 'mind-ar/src/image-target/offline-compiler.js';

const input = resolve(process.argv[2] ?? 'public/targets/ceat-target.jpg');
const output = resolve(process.argv[3] ?? 'public/targets/ceat-target.mind');

const image = await loadImage(await readFile(input));
console.log(`Compiling ${input} (${image.width}x${image.height})`);
if (Math.max(image.width, image.height) > 2000) {
  console.warn('Warning: images above ~2000px slow compilation and do not improve tracking.');
}

const started = Date.now();
const compiler = new OfflineCompiler();
let lastLogged = -10;
await compiler.compileImageTargets([image], (percent) => {
  if (percent - lastLogged >= 10) {
    lastLogged = percent;
    console.log(`  ${percent.toFixed(0)}%`);
  }
});

// Feature counts are the best offline indicator of target quality: a target
// with few features is slow to detect and loses tracking easily.
const [{ matchingData, trackingData }] = compiler.data;
const matchCounts = matchingData.map((k) => k.maximaPoints.length + k.minimaPoints.length);
const trackCounts = trackingData.map((t) => t.points.length);
console.log(`Matching features per scale: ${matchCounts.join(', ')}`);
console.log(`Tracking features per scale: ${trackCounts.join(', ')}`);
// MindAR's frame-to-frame tracker uses the 128px keyframe (index 1) and drops
// the target when fewer than 4 points match. For reference, a busy, high-contrast
// 1080x1920 test image yields ~500 matching / ~70 tracking features.
if (matchCounts[0] < 300 || trackCounts[1] < 40) {
  console.warn(
    'Warning: this is a weak tracking target (few distinctive features). Expect slower\n' +
      'detection and earlier tracking loss. Add high-contrast detail across the whole image.',
  );
}

await writeFile(output, Buffer.from(compiler.exportData()));
console.log(`Wrote ${output} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`Target aspect (height / width): ${(image.height / image.width).toFixed(4)}`);
