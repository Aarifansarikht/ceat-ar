#!/usr/bin/env node
/**
 * End-to-end tracking test in desktop Chrome with a synthetic camera.
 *
 *   npm run build && npm run test:e2e
 *
 * Requires ffmpeg and Chrome (or set CHROME_PATH). It:
 *   1. renders a 14 s camera clip (1280x720) of the target with KNOWN
 *      placement: static → moving/rotating → sliding out → absent → back
 *      at a different position and angle;
 *   2. feeds it to Chrome as the camera (--use-file-for-fake-video-capture);
 *   3. runs the real production build (MindAR detection/tracking + Three.js);
 *   4. compares where the anchor projects on screen with where the target
 *      actually is in the clip, and checks found/lost/re-found behaviour and
 *      that exactly one model instance exists.
 *
 * This validates the pipeline and the coordinate math. It does NOT replace
 * testing on real phones: real cameras add blur, noise, autofocus, glare and
 * hand shake that a synthetic clip does not have.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = resolve(process.env.E2E_OUT ?? join(tmpdir(), 'ceat-webar-e2e'));
mkdirSync(OUT, { recursive: true });
const TARGET = resolve('public/targets/ceat-target.jpg');
const CLIP = join(OUT, 'fake-camera.mjpeg');
const PORT = 4179;
const VIEW = { width: 412, height: 915 }; // typical phone CSS viewport
// Landscape clip on a portrait screen: the app must cover-crop it, which is
// the harder case for the camera/FOV math. It matches the app's requested
// 1280x720, so Chrome delivers it uncropped (verified at runtime below).
const VIDEO = { width: 1280, height: 720 };
const TW = 300; // target width in the clip (px); height ≈ 533
const ASPECT = 1920 / 1080;

// Target centre and in-plane angle (radians, clockwise on screen) over time.
// Kept as ffmpeg expressions *and* JS so expectations match the clip exactly.
const SEG = {
  static1: { cx: 640, cy: 360, a: 0 },
  static2: { cx: 660, cy: 380, a: -0.2 },
};
const cxExpr =
  'if(lt(t,4),640, if(lt(t,7),640+40*sin((t-4)*2), if(lt(t,9),640-(t-7)*600, if(lt(t,10.5),-3000,660))))';
const cyExpr = 'if(lt(t,10.5),360,380)';
const aExpr = 'if(lt(t,4),0, if(lt(t,7),0.15*sin((t-4)*2), if(lt(t,10.5),0,-0.2)))';

function renderClip() {
  const side = 616; // rotate canvas, larger than the target diagonal (612 px)
  const half = side / 2;
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x3c3f44:s=${VIDEO.width}x${VIDEO.height}:r=30:d=14`,
    '-loop', '1', '-framerate', '30', '-t', '14', '-i', TARGET,
    '-filter_complex',
    `[1:v]scale=${TW}:-2,format=rgba,rotate='${aExpr}':ow=${side}:oh=${side}:c=none[t];` +
      `[0:v][t]overlay=x='${cxExpr}-${half}':y='${cyExpr}-${half}':eval=frame,format=yuvj420p`,
    '-c:v', 'mjpeg', '-q:v', '3', '-f', 'mjpeg', CLIP,
  ]);
}

/** Clip pixel → CSS px on screen, replicating the object-fit: cover layout. */
function videoToScreen(x, y) {
  const s = Math.max(VIEW.width / VIDEO.width, VIEW.height / VIDEO.height);
  return {
    x: x * s + (VIEW.width - VIDEO.width * s) / 2,
    y: y * s + (VIEW.height - VIDEO.height * s) / 2,
  };
}

function expected(seg) {
  const corner = (lx, ly) => {
    const c = Math.cos(seg.a), s = Math.sin(seg.a);
    return videoToScreen(seg.cx + lx * c - ly * s, seg.cy + lx * s + ly * c);
  };
  return {
    centre: videoToScreen(seg.cx, seg.cy),
    topRight: corner(TW / 2, (-TW * ASPECT) / 2),
    bottomLeft: corner(-TW / 2, (TW * ASPECT) / 2),
  };
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

async function main() {
  const chrome =
    process.env.CHROME_PATH ??
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
    ].find(existsSync);
  if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');
  if (!existsSync('dist/index.html')) throw new Error('Run `npm run build` first');

  console.log('Rendering synthetic camera clip…');
  renderClip();

  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2500));

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: [
      '--use-fake-ui-for-media-stream', // auto-grant camera permission
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${CLIP}`,
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
    ],
  });

  const result = { ok: true, notes: [] };
  const fail = (msg) => {
    result.ok = false;
    result.notes.push(`FAIL: ${msg}`);
  };

  try {
    const page = await browser.newPage();
    await page.setViewport({ ...VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    // localhost is a secure context, so getUserMedia works over http here.
    await page.goto(`http://localhost:${PORT}/?debug`, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: join(OUT, '1-intro.png') });
    const t0 = Date.now();
    await page.click('.btn-primary');

    await page.waitForSelector('[data-ar-state="scanning"]', { timeout: 60000 });
    console.log(`Scanning after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const delivered = await page.evaluate(() => window.__AR_DEBUG__.videoSize());
    if (delivered.width !== VIDEO.width || delivered.height !== VIDEO.height) {
      throw new Error(`Chrome delivered ${delivered.width}x${delivered.height}, expected the clip size; expectations would be invalid`);
    }
    await page.screenshot({ path: join(OUT, '2-scanning.png') });

    // Sample state + projected anchor geometry for ~35 s (2.5 loops of the clip).
    const samples = [];
    const startSampling = Date.now();
    let shotFound = false;
    while (Date.now() - startSampling < 35000) {
      const s = await page.evaluate((aspect) => {
        const d = window.__AR_DEBUG__;
        const state = document.querySelector('.ar-root')?.dataset.arState;
        if (!d) return { state };
        return {
          state,
          visible: d.anchorVisible(),
          instances: d.modelInstances(),
          centre: d.project(0, 0, 0),
          topRight: d.project(0.5, aspect / 2, 0),
          bottomLeft: d.project(-0.5, -aspect / 2, 0),
          diag: document.querySelector('.ar-diagnostics')?.textContent,
        };
      }, ASPECT);
      s.t = Date.now() - startSampling;
      samples.push(s);
      if (!shotFound && s.state === 'target-found') {
        await new Promise((r) => setTimeout(r, 700)); // let the entrance finish
        await page.screenshot({ path: join(OUT, '3-target-found.png') });
        shotFound = true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.screenshot({ path: join(OUT, '4-end.png') });

    // ---- Analysis ----
    const firstFound = samples.find((s) => s.state === 'target-found');
    if (!firstFound) fail('target never detected');
    else console.log(`First detection ${(firstFound.t / 1000).toFixed(1)} s after scanning started`);

    const transitions = samples.reduce((acc, s, i) => {
      if (i === 0 || s.state !== samples[i - 1].state) acc.push(s.state);
      return acc;
    }, []);
    console.log('State sequence:', transitions.join(' → '));
    const foundCount = transitions.filter((s) => s === 'target-found').length;
    const lostCount = transitions.filter((s) => s === 'tracking-lost').length;
    if (lostCount < 1) fail('tracking was never lost while the target left the frame');
    if (foundCount < 2) fail('target was not re-acquired after being lost');

    const maxInstances = Math.max(...samples.map((s) => s.instances ?? 0));
    if (maxInstances !== 1) fail(`model instances = ${maxInstances} (expected exactly 1)`);
    else result.notes.push('Exactly one model instance throughout');

    // Alignment. The clip loops and its phase is unknown, so samples are
    // assigned to a static segment by pose: centre within 25 px AND in-plane
    // angle within 0.03 rad. The moving segment still crosses static1's pose
    // briefly, so robust percentiles (p50/p95) are the headline numbers.
    const tracked = samples.filter((s) => s.state === 'target-found' && s.visible);
    const angleOf = (s) => Math.atan2(s.topRight.y - s.bottomLeft.y, s.topRight.x - s.bottomLeft.x);
    const pct = (arr, p) => {
      const v = [...arr].sort((x, y) => x - y);
      return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
    };
    const targetPx = TW * Math.max(VIEW.width / VIDEO.width, VIEW.height / VIDEO.height);
    for (const [name, seg] of Object.entries(SEG)) {
      const exp = expected(seg);
      const expAngle = angleOf(exp);
      const near = tracked.filter(
        (s) => dist(s.centre, exp.centre) < 25 && Math.abs(angleOf(s) - expAngle) < 0.03,
      );
      if (near.length < 10) {
        fail(`${name}: only ${near.length} tracked samples matched the expected pose`);
        continue;
      }
      const centreErr = near.map((s) => dist(s.centre, exp.centre));
      const cornerErr = near.flatMap((s) => [dist(s.topRight, exp.topRight), dist(s.bottomLeft, exp.bottomLeft)]);
      // Jitter: frame-to-frame motion of the projected centre between
      // consecutive samples of a static target (ideal: 0).
      const steps = [];
      for (let i = 1; i < samples.length; i++) {
        if (near.includes(samples[i]) && near.includes(samples[i - 1])) {
          steps.push(dist(samples[i].centre, samples[i - 1].centre));
        }
      }
      result.notes.push(
        `${name} (${near.length} samples, target ${targetPx.toFixed(0)} px wide on screen):
` +
          `    centre error  p50 ${pct(centreErr, 50).toFixed(1)}  p95 ${pct(centreErr, 95).toFixed(1)} px
` +
          `    corner error  p50 ${pct(cornerErr, 50).toFixed(1)}  p95 ${pct(cornerErr, 95).toFixed(1)} px
` +
          `    projected/true size  x ${pct(near.map((s) => (s.topRight.x - s.bottomLeft.x) / (exp.topRight.x - exp.bottomLeft.x)), 50).toFixed(4)}  y ${pct(near.map((s) => (s.topRight.y - s.bottomLeft.y) / (exp.topRight.y - exp.bottomLeft.y)), 50).toFixed(4)}
` +
          `    jitter (step) p50 ${steps.length ? pct(steps, 50).toFixed(2) : 'n/a'}  p95 ${steps.length ? pct(steps, 95).toFixed(2) : 'n/a'} px`,
      );
      // > 10% of target width = gross misalignment (a coordinate/camera bug).
      // > 3% = pose-estimation error, typically caused by a target with few
      // features (a feature-rich test image measures ~1.5% p95 in this harness).
      const p95 = pct(cornerErr, 95) / targetPx;
      if (p95 > 0.1) fail(`${name}: overlay misaligned with target (corner p95 ${(p95 * 100).toFixed(1)}% of width)`);
      else if (p95 > 0.03) {
        result.notes.push(`WARN: ${name}: corner p95 ${(p95 * 100).toFixed(1)}% of width — improve target artwork for tighter anchoring`);
      }
    }

    const diag = samples.map((s) => s.diag).filter(Boolean).at(-1);
    if (diag) result.notes.push(`Diagnostics (desktop headless Chrome — not representative of phones): ${diag}`);
    const errors = logs.filter((l) => /error/i.test(l));
    if (errors.length) result.notes.push(`Console errors:\n  ${errors.join('\n  ')}`);

    // Exit releases the camera and returns to intro.
    await page.click('.icon-btn[aria-label="Exit AR"]');
    await page.waitForSelector('[data-ar-state="intro"]', { timeout: 5000 });
    const leftovers = await page.evaluate(() => ({
      videos: document.querySelectorAll('video').length,
      canvases: document.querySelectorAll('.ar-stage canvas').length,
      debug: !!window.__AR_DEBUG__,
    }));
    if (leftovers.videos || leftovers.canvases || leftovers.debug) fail(`exit left resources: ${JSON.stringify(leftovers)}`);
    else result.notes.push('Exit removed video, canvas and debug hooks');

    // Restart, then Rescan: the tracker is rebuilt on the same model.
    await page.click('.btn-primary');
    await page.waitForSelector('[data-ar-state="target-found"]', { timeout: 60000 });
    await page.click('.ctrl:nth-child(4)'); // Rescan
    await page.waitForSelector('[data-ar-state="scanning"], [data-ar-state="initializing"]', { timeout: 5000 });
    await page.waitForSelector('[data-ar-state="target-found"]', { timeout: 30000 });
    const afterRescan = await page.evaluate(() => window.__AR_DEBUG__.modelInstances());
    if (afterRescan !== 1) fail(`after rescan: ${afterRescan} model instances`);
    else result.notes.push('Restart + Rescan: target re-found, still exactly one model instance');

    // Camera permission denied → explained error with retry, Back → intro.
    const denied = await browser.createBrowserContext();
    const dpage = await denied.newPage();
    await dpage.setViewport({ ...VIEW, isMobile: true });
    const origin = `http://localhost:${PORT}`;
    // --use-fake-ui-for-media-stream auto-grants, so simulate the user tapping
    // "Block": browsers reject getUserMedia with a NotAllowedError DOMException.
    await dpage.evaluateOnNewDocument(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await dpage.goto(`${origin}/?debug`, { waitUntil: 'networkidle0' });
    await dpage.click('.btn-primary');
    await dpage.waitForSelector('[data-ar-state="error"]', { timeout: 15000 });
    const title = await dpage.$eval('.error-card h2', (el) => el.textContent);
    await dpage.screenshot({ path: join(OUT, '5-permission-denied.png') });
    if (title !== 'Camera access needed') fail(`permission denial showed "${title}"`);
    else result.notes.push('Permission denied → "Camera access needed" with Try again / Back');
    await dpage.click('.error-actions .btn-ghost');
    await dpage.waitForSelector('[data-ar-state="intro"]', { timeout: 5000 });
    await denied.close();
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n' + result.notes.join('\n'));
  console.log(`\nScreenshots: ${OUT}`);
  console.log(result.ok ? '\nE2E PASSED (synthetic camera)' : '\nE2E FAILED');
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
