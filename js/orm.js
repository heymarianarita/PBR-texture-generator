// ORM texture for glTF / Second Life PBR: R = ambient occlusion,
// G = roughness, B = metallic.

import { blur } from './height.js';

// How fast occlusion darkens with cavity depth (in 0..1 height units).
// Exponential falloff keeps deep cavities from going fully black.
const CAVITY_GAIN = 2;

// Ambient occlusion from height: points below their blurred surroundings
// sit in a cavity and get darker. Strength 0 gives plain white.
export function computeOcclusion(H, w, h, s, scale) {
  const n = w * h;
  const out = new Float32Array(n).fill(1);
  if (!(s.aoStrength > 0)) return out;
  const avg = blur(H, w, h, s.aoRadius * scale, s.tileable);
  const k = s.aoStrength * CAVITY_GAIN;
  for (let i = 0; i < n; i++) {
    const depth = avg[i] - H[i];
    if (depth > 0) out[i] = Math.exp(-depth * k);
  }
  return out;
}

// Interleave occlusion, roughness (1 − specular) and a flat metallic value.
export function packOrm(ao, spec, metallic) {
  const n = ao.length;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = ao[i];
    out[i * 3 + 1] = 1 - spec[i];
    out[i * 3 + 2] = metallic;
  }
  return out;
}
