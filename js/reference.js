// Reads a reference photo of the look you want and suggests a setup: how shiny
// the surface is, how big its bumps are, whether it has a grain, and which
// preset fits best. Everything is measured from the pixels in the browser, so
// it's a best guess; the user can pick another preset at any time.

import { readPixels } from './image-io.js';
import { blur } from './height.js';
import { presetById } from './presets.js';

const ANALYSE_EDGE = 768; // small photos are analysed as they are, never upscaled
const CROP = 0.7; // the material is usually in the middle of the photo

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

function centreCrop(src) {
  const w = Math.max(1, Math.round(src.width * CROP));
  const h = Math.max(1, Math.round(src.height * CROP));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, w, h);
  return c;
}

function meanAbsDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function percentile(a, p) {
  const sorted = Float32Array.from(a).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// Measure the photo. All values are roughly 0..1.
export function measure(canvas) {
  const { w, h, rgb } = readPixels(centreCrop(canvas), ANALYSE_EDGE);
  const n = w * h;
  const L = new Float32Array(n), S = new Float32Array(n);
  let sumL = 0, sumL2 = 0, sumS = 0, hueX = 0, hueY = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const s = max > 0 ? (max - min) / max : 0;
    L[i] = l;
    S[i] = s;
    sumL += l;
    sumL2 += l * l;
    sumS += s;
    if (max > min) {
      // Hue as a saturation-weighted angle, averaged on the circle.
      let hue;
      if (max === r) hue = ((g - b) / (max - min)) % 6;
      else if (max === g) hue = (b - r) / (max - min) + 2;
      else hue = (r - g) / (max - min) + 4;
      const a = (hue * Math.PI) / 3;
      hueX += Math.cos(a) * s;
      hueY += Math.sin(a) * s;
    }
  }
  const meanL = sumL / n;
  const stdL = Math.sqrt(Math.max(0, sumL2 / n - meanL * meanL));
  const meanS = sumS / n;
  const hue = ((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360;

  // Detail at three sizes: differences between progressively blurred copies.
  // Anything larger than the coarse band is the object's shape and lighting,
  // not the material, so it's left out.
  const b1 = blur(L, w, h, 1, false), b4 = blur(L, w, h, 4, false), b16 = blur(L, w, h, 16, false);
  const fine = meanAbsDiff(L, b1), medium = meanAbsDiff(b1, b4), coarse = meanAbsDiff(b4, b16);
  const energy = fine + medium + coarse || 1e-6;
  // Surface texture relative to brightness, so dark and light materials compare fairly.
  const texture = (fine + medium) / (meanL + 0.05);

  // Highlights: bright outliers, well above what the texture's own variation
  // explains, so a high-contrast pattern doesn't count as shine.
  const local = blur(L, w, h, 6, false);
  const excess = new Float32Array(n);
  let d2 = 0;
  for (let i = 0; i < n; i++) {
    excess[i] = L[i] - local[i];
    d2 += excess[i] ** 2;
  }
  const detailStd = Math.sqrt(d2 / n) || 1e-6;
  const threshold = Math.max(0.12, 3 * detailStd);
  let spec = 0, specSat = 0;
  for (let i = 0; i < n; i++) {
    if (L[i] > 0.55 && L[i] - local[i] > threshold) {
      spec++;
      specSat += S[i];
    }
  }
  const peak = percentile(L, 0.995) - percentile(L, 0.5);
  // Shine: how far the very brightest spots stand out from the texture. Even a
  // single small highlight counts, as long as it's strong (glossy test images
  // score over 20, a fuzzy fabric about 7, matte patterns under 3).
  const topExcess = percentile(excess, 0.9999);
  const shine = clamp01((topExcess / detailStd - 6) / 10) * clamp01((topExcess - 0.1) / 0.1);
  // Metal reflects in its own colour; other materials have whitish highlights.
  const tint = spec ? specSat / spec / (meanS + 0.05) : 0;

  // Grain or weave: how consistently the small detail points one way
  // (structure tensor coherence). Measured on the detail only, so the curve of
  // an object's silhouette or a shadow edge doesn't count as grain.
  const detail = new Float32Array(n);
  for (let i = 0; i < n; i++) detail[i] = b1[i] - b4[i];
  const jxx = new Float32Array(n), jyy = new Float32Array(n), jxy = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (detail[i + 1] - detail[i - 1]) / 2, gy = (detail[i + w] - detail[i - w]) / 2;
      jxx[i] = gx * gx;
      jyy[i] = gy * gy;
      jxy[i] = gx * gy;
    }
  }
  const sxx = blur(jxx, w, h, 4, false), syy = blur(jyy, w, h, 4, false), sxy = blur(jxy, w, h, 4, false);
  // Averaged per pixel (not weighted by edge strength) so a few strong edges
  // can't dominate; flat areas with no detail are skipped.
  let trMean = 0;
  for (let i = 0; i < n; i++) trMean += sxx[i] + syy[i];
  trMean /= n;
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const tr = sxx[i] + syy[i];
    if (tr < trMean * 0.1) continue;
    sum += Math.sqrt((sxx[i] - syy[i]) ** 2 + 4 * sxy[i] ** 2) / tr;
    count++;
  }
  const coherence = count ? sum / count : 0;

  return {
    fine: fine / energy, medium: medium / energy, coarse: coarse / energy, energy, texture,
    shine, tint, peak, meanL, stdL, meanS, hue, coherence,
  };
}

// How well each preset fits the measurements (higher is better). Thresholds
// were set against test patterns and a bouclé reference photo.
const fuzziness = (f) => clamp01((f.texture - 0.08) / 0.06); // lots of small detail for its brightness
const grainness = (f) => clamp01((f.coherence - 0.55) / 0.25); // detail clearly runs one way

function scores(f) {
  const matte = 1 - f.shine;
  const fuzzy = fuzziness(f);
  const grain = grainness(f);
  const weave = clamp01((f.coherence - 0.45) / 0.1) * (1 - grain); // some order, but not one direction
  const grey = 1 - clamp01(f.meanS / 0.2);
  const brown = (f.hue >= 10 && f.hue <= 50 ? 1 : 0) * clamp01((f.meanS - 0.15) / 0.15);
  const tinted = clamp01((f.tint - 0.6) / 0.4);
  const smooth = clamp01((0.4 - f.fine) / 0.2);
  return {
    velvet: matte * fuzzy * (1 - grain) * (1 - 0.5 * weave),
    fabric: matte * fuzzy * weave,
    leather: (1 - 0.5 * f.shine) * clamp01((f.medium - 0.25) / 0.2) * (1 - 0.5 * grey) * (1 - grain) * (1 - 0.5 * fuzzy),
    wood: brown * grain * (1 - 0.5 * f.shine),
    stone: matte * clamp01((f.coarse + f.medium - 0.6) / 0.3) * (0.5 + 0.5 * grey) * (1 - 0.5 * fuzzy),
    plaster: matte * grey * clamp01((0.06 - f.energy) / 0.04) * clamp01((f.meanL - 0.45) / 0.2),
    metal: f.shine * clamp01(tinted + grey * clamp01((f.stdL - 0.15) / 0.1)),
    plastic: f.shine * (1 - tinted) * clamp01((f.meanS - 0.2) / 0.2) * smooth,
    polished: f.shine * clamp01((f.peak - 0.45) / 0.2) * smooth * (1 - tinted),
  };
}

// Plain-language reasons shown with the suggestion.
function describe(f, presetId) {
  const notes = [];
  if (f.shine < 0.2) notes.push('Very matte: no sharp highlights.');
  else if (f.shine < 0.5) notes.push('A soft sheen.');
  else notes.push('Shiny: sharp, bright highlights.');
  if (f.texture < 0.04) {
    notes.push('A smooth surface with little texture.');
  } else {
    const band = [['fine', f.fine], ['medium', f.medium], ['coarse', f.coarse]].sort((a, b) => b[1] - a[1])[0][0];
    notes.push({
      fine: 'Mostly fine detail, like fuzz, fibres or grain.',
      medium: 'Mostly mid-size bumps.',
      coarse: 'Mostly large shapes and lumps.',
    }[band]);
    if (fuzziness(f) > 0.5) notes.push('Lots of small, fuzzy detail.');
    if (grainness(f) > 0.5) notes.push('A clear grain direction.');
  }
  if (presetId === 'metal') notes.push('Highlights take on the surface colour, which suggests metal.');
  return notes;
}

const round = (v, step) => Math.round(v / step) * step;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Custom settings matched to the photo. Everything a photo shows is set from
// the measurements: roughness, metallic, the size of the bumps, how deep they
// are and how much occlusion they get. The closest preset only fills in what
// a photo can't show (roughness contrast, height contrast, smoothing).
export function matchSettings(presetId, f) {
  const base = presetById[presetId].settings;
  const weight = (frac) => Math.min(2, frac * 3); // fractions sum to 1, sliders default to about 1
  const band = [['fine', f.fine], ['medium', f.medium], ['coarse', f.coarse]].sort((a, b) => b[1] - a[1])[0][0];
  return {
    ...base,
    roughBase: +round(clamp(0.95 - 0.8 * f.shine, 0.08, 0.97), 0.01).toFixed(2),
    metallic: presetId === 'metal' ? 1 : 0,
    coarse: +round(weight(f.coarse), 0.05).toFixed(2),
    medium: +round(weight(f.medium), 0.05).toFixed(2),
    fine: +round(weight(f.fine), 0.05).toFixed(2),
    strength: +round(clamp(mix(base.strength, 1 + f.texture * 15, 0.5), 0.8, 4), 0.1).toFixed(1),
    aoStrength: +round(clamp(mix(base.aoStrength, 0.4 + f.texture * 8, 0.5), 0.3, 2), 0.05).toFixed(2),
    aoRadius: { fine: 4, medium: 8, coarse: 12 }[band],
  };
}

// Analyse a reference photo. Returns custom settings matched to it, the
// closest presets (best first) and plain-language reasons.
export function analyseReference(canvas) {
  const f = measure(canvas);
  const ranked = Object.entries(scores(f)).sort((a, b) => b[1] - a[1]);
  const best = ranked[0][1] > 0.12 ? ranked[0][0] : f.shine > 0.5 ? 'plastic' : f.shine > 0.25 ? 'leather' : 'fabric';
  const closest = [best, ...ranked.map(([id]) => id).filter((id) => id !== best)].slice(0, 3);
  return { closest, settings: matchSettings(best, f), notes: describe(f, best), measurements: f };
}
