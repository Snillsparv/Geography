#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// Batch-vectorize the hand-drawn country images into clean, scalable SVG.
//
// Pipeline per image:
//   raster (webp/png/jpg)
//     → preprocess.py  (denoise + adaptive colour quantization, keep alpha)
//     → VTracer        (colour vectorization, spline curves)
//     → SVGO           (optimize / shrink)
//     → <name>.svg     (written next to the source, non-destructive)
//
// SVG is text, so Firebase Hosting serves it gzip/brotli-compressed — typically
// ~3x smaller over the wire than the already-binary webp, and infinitely
// scalable for zoom and reprojection.
//
// Usage:
//   node tools/vectorize.mjs [rootDir] [--force]
//     rootDir   directory to scan recursively (default: assets)
//     --force   re-generate even if the .svg is newer than its source
//
// Tunables via env: VEC_COLORS (16), VEC_MEDIAN (3), VEC_ALPHA (128),
//                   VEC_COLOR_PRECISION (6), VEC_FILTER_SPECKLE (6).
// ──────────────────────────────────────────────────────────────────────────
import { vectorize, ColorMode, Hierarchical, PathSimplifyMode } from '@neplex/vectorizer';
import { optimize } from 'svgo';
import { readFile, writeFile, readdir, stat, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || 'assets';
const FORCE = process.argv.includes('--force');
const EXTS = new Set(['.webp', '.png', '.jpg', '.jpeg']);

const VEC_CFG = {
  colorMode: ColorMode.Color,
  colorPrecision: +(process.env.VEC_COLOR_PRECISION || 8),
  filterSpeckle: +(process.env.VEC_FILTER_SPECKLE || 6),
  spliceThreshold: 45,
  cornerThreshold: 60,
  hierarchical: Hierarchical.Stacked,
  mode: PathSimplifyMode.Spline,
  layerDifference: 16,
  lengthThreshold: 4,
  maxIterations: 10,
  pathPrecision: 2,
};

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await walk(full, out);
    } else if (EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

async function isUpToDate(src, svg) {
  if (FORCE || !existsSync(svg)) return false;
  const [a, b] = await Promise.all([stat(src), stat(svg)]);
  return b.mtimeMs >= a.mtimeMs;
}

function runPython(script, manifest) {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', [script], { stdio: ['pipe', 'inherit', 'inherit'] });
    py.on('error', reject);
    py.on('close', code => (code === 0 ? resolve() : reject(new Error('preprocess exited ' + code))));
    py.stdin.write(JSON.stringify(manifest));
    py.stdin.end();
  });
}

async function main() {
  const all = await walk(ROOT);
  const work = [];
  for (const src of all) {
    const svg = src.replace(/\.[^.]+$/, '.svg');
    if (await isUpToDate(src, svg)) continue;
    work.push({ src, svg });
  }

  console.log(`Found ${all.length} raster images, ${work.length} need (re)building.`);
  if (work.length === 0) return;

  // Phase 1 — preprocess all into a temp staging dir (one python process).
  const stage = await mkdtemp(path.join(tmpdir(), 'vec-'));
  work.forEach((w, i) => { w.prepped = path.join(stage, `${i}.png`); });
  console.log('Preprocessing (denoise + quantize)…');
  await runPython(path.join(path.dirname(new URL(import.meta.url).pathname), 'preprocess.py'),
    work.map(w => ({ src: w.src, prepped: w.prepped })));

  // Phase 2 — vectorize + optimize each.
  let done = 0, rawTotal = 0, optTotal = 0;
  for (const w of work) {
    try {
      const buf = await readFile(w.prepped);
      let rawSvg = await vectorize(buf, VEC_CFG);
      // VTracer emits width/height but no viewBox; add one so the SVG scales and
      // can be reprojected. (svgo v4 keeps viewBox by default.)
      if (!/viewBox=/.test(rawSvg)) {
        const wm = rawSvg.match(/<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/);
        const hm = rawSvg.match(/<svg[^>]*\bheight="(\d+(?:\.\d+)?)"/);
        if (wm && hm) {
          rawSvg = rawSvg.replace(/<svg /, `<svg viewBox="0 0 ${wm[1]} ${hm[1]}" `);
        }
      }
      const { data } = optimize(rawSvg, { multipass: true });
      await mkdir(path.dirname(w.svg), { recursive: true });
      await writeFile(w.svg, data);
      rawTotal += rawSvg.length;
      optTotal += data.length;
    } catch (e) {
      console.error(`  ✗ ${w.src}: ${e.message}`);
    }
    if (++done % 25 === 0 || done === work.length) {
      console.log(`  vectorized ${done}/${work.length}`);
    }
  }

  await rm(stage, { recursive: true, force: true });
  console.log(`\nDone. Optimized SVG total: ${(optTotal / 1024 / 1024).toFixed(2)} MB ` +
    `(${(100 - (optTotal / rawTotal) * 100).toFixed(0)}% smaller than raw trace).`);
}

main().catch(e => { console.error(e); process.exit(1); });
