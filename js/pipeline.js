// Runs height → normal / specular / ORM, re-running only the stages whose
// settings changed.

import { computeHeight } from './height.js';
import { computeNormal } from './normal.js';
import { computeSpecular } from './specular.js';
import { computeOcclusion, packOrm } from './orm.js';

const HEIGHT_KEYS = ['invert', 'autoLevels', 'black', 'white', 'gamma', 'contrast', 'highpass', 'blur', 'tileable'];
const NORMAL_KEYS = ['strength', 'kernel', 'fine', 'medium', 'coarse', 'flipGreen'];
const SPEC_KEYS = ['specSource', 'specBlack', 'specWhite', 'specGamma', 'specInvert'];
const AO_KEYS = ['aoStrength', 'aoRadius'];

const keyOf = (s, keys) => JSON.stringify(keys.map((k) => s[k]));

// One-off run, used for full-resolution export. The ORM map needs specular.
export function runPipeline(img, s, scale, want = { normal: true, spec: true, orm: true }) {
  const height = computeHeight(img, s, scale);
  const spec = want.spec || want.orm ? computeSpecular(img, height, s) : null;
  return {
    height,
    normal: want.normal ? computeNormal(height, img.w, img.h, s, scale) : null,
    spec,
    orm: want.orm ? packOrm(computeOcclusion(height, img.w, img.h, s, scale), spec, s.metallic) : null,
  };
}

// Cached runner for the live preview. `img.id` identifies the source image.
export function createPipeline() {
  let cache = {};
  return function run(img, s, scale = 1) {
    const changed = { height: false, normal: false, spec: false, orm: false };
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
    const ak = keyOf(s, AO_KEYS);
    let aoChanged = false;
    if (changed.height || cache.ak !== ak) {
      cache.ak = ak;
      cache.ao = computeOcclusion(cache.height, img.w, img.h, s, scale);
      aoChanged = true;
    }
    if (aoChanged || changed.spec || cache.metallic !== s.metallic) {
      cache.metallic = s.metallic;
      cache.orm = packOrm(cache.ao, cache.spec, s.metallic);
      changed.orm = true;
    }
    return { height: cache.height, normal: cache.normal, spec: cache.spec, orm: cache.orm, changed };
  };
}
