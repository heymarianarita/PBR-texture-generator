// Runs height → normal / specular, re-running only the stages whose
// settings changed.

import { computeHeight } from './height.js';
import { computeNormal } from './normal.js';
import { computeSpecular } from './specular.js';

const HEIGHT_KEYS = ['invert', 'autoLevels', 'black', 'white', 'gamma', 'contrast', 'highpass', 'blur', 'tileable'];
const NORMAL_KEYS = ['strength', 'kernel', 'fine', 'medium', 'coarse', 'flipGreen'];
const SPEC_KEYS = ['specSource', 'specBlack', 'specWhite', 'specGamma', 'specInvert'];

const keyOf = (s, keys) => JSON.stringify(keys.map((k) => s[k]));

// One-off run, used for full-resolution export.
export function runPipeline(img, s, scale, want = { normal: true, spec: true }) {
  const height = computeHeight(img, s, scale);
  return {
    height,
    normal: want.normal ? computeNormal(height, img.w, img.h, s, scale) : null,
    spec: want.spec ? computeSpecular(img, height, s) : null,
  };
}

// Cached runner for the live preview. `img.id` identifies the source image.
export function createPipeline() {
  let cache = {};
  return function run(img, s, scale = 1) {
    const changed = { height: false, normal: false, spec: false };
    const hk = `${img.id}|${scale}|${keyOf(s, HEIGHT_KEYS)}`;
    if (cache.hk !== hk) {
      cache = { hk, height: computeHeight(img, s, scale) };
      changed.height = true;
    }
    const nk = keyOf(s, NORMAL_KEYS);
    if (changed.height || cache.nk !== nk) {
      cache.nk = nk;
      cache.normal = computeNormal(cache.height, img.w, img.h, s, scale);
      changed.normal = true;
    }
    const sk = keyOf(s, SPEC_KEYS);
    if (changed.height || cache.sk !== sk) {
      cache.sk = sk;
      cache.spec = computeSpecular(img, cache.height, s);
      changed.spec = true;
    }
    return { height: cache.height, normal: cache.normal, spec: cache.spec, changed };
  };
}
