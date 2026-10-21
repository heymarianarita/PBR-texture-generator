// Normal map from a height array: Sobel/Scharr gradients at up to three
// detail scales, packed to RGB in OpenGL (Y+) or DirectX (Y−) convention.

import { blur, edgeIndex } from './height.js';

// Derivative kernels as [corner, edge, normaliser], so both give height
// change per pixel.
const KERNELS = {
  sobel: [1, 2, 8],
  scharr: [3, 10, 32],
};

// Detail layers: blur sigma (preview pixels) for each scale.
const LAYERS = [
  ['fine', 0],
  ['medium', 2],
  ['coarse', 6],
];

// Base multiplier so a strength of ~2.5 looks right on typical photos.
const STRENGTH_UNIT = 8;

// Add weight × gradient of H into gx, gy. gy is positive going down the image.
function accumulateGradient(H, w, h, kernel, wrap, weight, gx, gy) {
  const [a, b, norm] = KERNELS[kernel] || KERNELS.sobel;
  const ka = (a / norm) * weight, kb = (b / norm) * weight;
  const xm = new Int32Array(w), xp = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    xm[x] = edgeIndex(x - 1, w, wrap);
    xp[x] = edgeIndex(x + 1, w, wrap);
  }
  for (let y = 0; y < h; y++) {
    const rm = edgeIndex(y - 1, h, wrap) * w;
    const r0 = y * w;
    const rp = edgeIndex(y + 1, h, wrap) * w;
    for (let x = 0; x < w; x++) {
      const l = xm[x], r = xp[x];
      const tl = H[rm + l], tc = H[rm + x], tr = H[rm + r];
      const ml = H[r0 + l], mr = H[r0 + r];
      const bl = H[rp + l], bc = H[rp + x], br = H[rp + r];
      const i = r0 + x;
      gx[i] += ka * (tr - tl + br - bl) + kb * (mr - ml);
      gy[i] += ka * (bl - tl + br - tr) + kb * (bc - tc);
    }
  }
}

export function computeNormal(H, w, h, s, scale) {
  const n = w * h;
  const wrap = s.tileable;
  const gx = new Float32Array(n), gy = new Float32Array(n);

  for (const [key, sigma] of LAYERS) {
    const weight = s[key];
    if (!(weight > 0)) continue;
    const src = sigma > 0 ? blur(H, w, h, sigma * scale, wrap) : H;
    accumulateGradient(src, w, h, s.kernel, wrap, weight, gx, gy);
  }

  // Gradients shrink as resolution grows, so scale strength with it to make
  // the full-size export match the preview.
  const k = s.strength * STRENGTH_UNIT * scale;
  // Image y points down. OpenGL normal maps have green = up, which is +dH/dy
  // in image space; DirectX flips it.
  const gs = s.flipGreen ? -k : k;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const nx = -gx[i] * k, ny = gy[i] * gs;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    out[i * 3] = nx * inv * 0.5 + 0.5;
    out[i * 3 + 1] = ny * inv * 0.5 + 0.5;
    out[i * 3 + 2] = inv * 0.5 + 0.5;
  }
  return out;
}
