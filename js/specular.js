// Specular map from the source colours, optionally blended with height.
// Roughness is the inverse (1 − specular) and is produced when drawing.

export function computeSpecular(img, H, s) {
  const { w, h, rgb } = img;
  const n = w * h;
  const out = new Float32Array(n);
  const mix = s.specSource; // 0 = colour brightness, 1 = height
  const black = s.specBlack, white = Math.max(s.specWhite, s.specBlack + 0.001);
  const levels = 1 / (white - black);
  const gamma = s.specGamma;

  for (let i = 0; i < n; i++) {
    const lum = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
    let v = lum + (H[i] - lum) * mix;
    v = (v - black) * levels;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (gamma !== 1) v = Math.pow(v, gamma);
    out[i] = s.specInvert ? 1 - v : v;
  }
  return out;
}
