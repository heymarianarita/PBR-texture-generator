// Height map: greyscale, invert, high-pass flattening, blur and levels.
// Also exports the blur used by the other stages.

// Index lookup at the image edge: wrap for tileable textures, clamp otherwise.
export function edgeIndex(i, n, wrap) {
  if (wrap) {
    i %= n;
    return i < 0 ? i + n : i;
  }
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

// Box widths whose three passes approximate a Gaussian of the given sigma.
function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxH(src, dst, w, h, r, wrap) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + edgeIndex(i, w, wrap)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * inv;
      sum += src[row + edgeIndex(x + r + 1, w, wrap)] - src[row + edgeIndex(x - r, w, wrap)];
    }
  }
}

function boxV(src, dst, w, h, r, wrap) {
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[edgeIndex(i, h, wrap) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * inv;
      sum += src[edgeIndex(y + r + 1, h, wrap) * w + x] - src[edgeIndex(y - r, h, wrap) * w + x];
    }
  }
}

// Approximate Gaussian blur (three box passes). Cost doesn't depend on sigma.
export function blur(src, w, h, sigma, wrap) {
  const out = Float32Array.from(src);
  if (!(sigma > 0)) return out;
  const tmp = new Float32Array(src.length);
  for (const size of boxesForGauss(sigma)) {
    const r = (size - 1) / 2;
    if (r <= 0) continue;
    boxH(out, tmp, w, h, r, wrap);
    boxV(tmp, out, w, h, r, wrap);
  }
  return out;
}

// Value range that holds the middle 99% of pixels, so a few outliers don't
// squash the contrast.
function percentileRange(a, lowP = 0.005, highP = 0.995) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < min) min = a[i];
    if (a[i] > max) max = a[i];
  }
  if (max - min < 1e-6) return [min, min + 1];
  const BINS = 2048;
  const hist = new Uint32Array(BINS);
  const k = (BINS - 1) / (max - min);
  for (let i = 0; i < a.length; i++) hist[((a[i] - min) * k) | 0]++;
  const lowCount = a.length * lowP, highCount = a.length * highP;
  let acc = 0, lo = min, hi = max, foundLo = false;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (!foundLo && acc >= lowCount) { lo = min + b / k; foundLo = true; }
    if (acc >= highCount) { hi = min + (b + 1) / k; break; }
  }
  return hi - lo < 1e-6 ? [min, max] : [lo, hi];
}

// img: { w, h, rgb }. `scale` converts slider radii (defined at preview
// resolution) to the resolution being processed.
export function computeHeight(img, s, scale) {
  const { w, h, rgb } = img;
  const n = w * h;
  const wrap = s.tileable;
  let H = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    H[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  }
  if (s.invert) for (let i = 0; i < n; i++) H[i] = 1 - H[i];

  // High-pass: subtract the large-scale brightness so uneven lighting
  // doesn't turn into a big slope in the height.
  if (s.highpass > 0) {
    const low = blur(H, w, h, s.highpass * scale, wrap);
    for (let i = 0; i < n; i++) H[i] = H[i] - low[i] + 0.5;
  }

  if (s.blur > 0) H = blur(H, w, h, s.blur * scale, wrap);

  let lo = 0, hi = 1;
  if (s.autoLevels) [lo, hi] = percentileRange(H);
  const norm = 1 / (hi - lo);

  const black = s.black, white = Math.max(s.white, s.black + 0.001);
  const levels = 1 / (white - black);
  const gamma = s.gamma, contrast = s.contrast;
  for (let i = 0; i < n; i++) {
    let v = (H[i] - lo) * norm;
    v = (v - 0.5) * contrast + 0.5;
    v = (v - black) * levels;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    H[i] = gamma === 1 ? v : Math.pow(v, gamma);
  }
  return H;
}
