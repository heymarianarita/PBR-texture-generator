// Roughness from the photo's brightness, returned as specular (1 − roughness)
// so the ORM packing and the specular export can share it. Darker areas read
// as rougher, brighter areas as smoother; Invert flips that.

export function computeSpecular(img, H, s) {
  const { w, h, rgb } = img;
  const n = w * h;
  const out = new Float32Array(n);
  const base = s.roughBase;
  const k = s.roughContrast * (s.roughInvert ? -1 : 1);

  for (let i = 0; i < n; i++) {
    const lum = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
    let r = base + (0.5 - lum) * k;
    r = r < 0 ? 0 : r > 1 ? 1 : r;
    out[i] = 1 - r;
  }
  return out;
}
