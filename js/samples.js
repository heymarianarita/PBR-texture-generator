// Procedurally generated, tileable sample textures, so the repo needs no
// binary sample files.

const SIZE = 1024;

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Value noise that repeats every `period` units.
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, period, seed, octaves = 5) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, period * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function paint(fn) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let y = 0, i = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++, i += 4) {
      const [r, g, b] = fn(x, y, x / SIZE, y / SIZE);
      d[i] = r * 255;
      d[i + 1] = g * 255;
      d[i + 2] = b * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function bricks() {
  const bw = 128, bh = 64;
  return paint((x, y, u, v) => {
    const row = Math.floor(y / bh);
    const xx = (x + (row & 1) * (bw / 2)) % SIZE;
    const col = Math.floor(xx / bw);
    const lx = xx - col * bw, ly = y - row * bh;
    const edge = Math.min(lx, bw - 1 - lx, ly, bh - 1 - ly);
    const grain = fbm(u * 96, v * 96, 96, 11, 3);
    const gap = 5 + (fbm(u * 8, v * 8, 8, 3, 4) - 0.5) * 6;
    if (edge < gap) {
      const m = 0.26 + 0.14 * grain;
      return [m * 1.05, m, m * 0.92];
    }
    const id = hash2(col, row, 5);
    const bevel = smoothstep(gap, gap + 8, edge);
    const chip = smoothstep(0.6, 0.7, fbm(u * 24, v * 24, 24, col * 31 + row * 7, 3));
    const shade = (0.55 + 0.45 * bevel) * (0.75 + 0.45 * grain) * (1 - 0.35 * chip);
    return [(0.62 + 0.2 * id) * shade, (0.3 + 0.1 * id) * shade, (0.22 + 0.05 * id) * shade];
  });
}

function cobbles() {
  const C = 6, cell = SIZE / C;
  const pts = [];
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      pts.push([(i + 0.2 + 0.6 * hash2(i, j, 1)) * cell, (j + 0.2 + 0.6 * hash2(i, j, 2)) * cell]);
    }
  }
  return paint((x, y, u, v) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let f1 = Infinity, f2 = Infinity, id = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ci = cx + di, cj = cy + dj;
        const wi = (ci + C) % C, wj = (cj + C) % C;
        const p = pts[wj * C + wi];
        const d = Math.hypot(x - (p[0] + (ci - wi) * cell), y - (p[1] + (cj - wj) * cell));
        if (d < f1) { f2 = f1; f1 = d; id = wj * C + wi; } else if (d < f2) f2 = d;
      }
    }
    const edge = (f2 - f1) / 2;
    const grain = fbm(u * 64, v * 64, 64, 21, 4);
    const gap = 6 + (fbm(u * 10, v * 10, 10, 4, 3) - 0.5) * 6;
    if (edge < gap) {
      const m = 0.14 + 0.1 * grain;
      return [m * 1.1, m, m * 0.85];
    }
    const t = hash2(id, 0, 9);
    const dome = 1 - Math.min(1, (f1 / (cell * 0.7)) ** 2);
    const bevel = smoothstep(gap, gap + 16, edge);
    const shade = (0.4 + 0.6 * bevel * (0.6 + 0.4 * dome)) * (0.7 + 0.5 * grain);
    return [(0.5 + 0.2 * t) * shade, (0.48 + 0.15 * t) * shade, (0.44 + 0.08 * t) * shade];
  });
}

function plaster() {
  return paint((x, y, u, v) => {
    const base = fbm(u * 6, v * 6, 6, 1, 6);
    const ridge = 1 - Math.abs(fbm(u * 14, v * 14, 14, 9, 4) - 0.5) * 2;
    const grain = fbm(u * 160, v * 160, 160, 5, 2);
    const s = 0.62 + 0.35 * (base - 0.5) * 2 + 0.12 * smoothstep(0.75, 1, ridge) + 0.08 * (grain - 0.5);
    return [0.92 * s, 0.86 * s, 0.76 * s];
  });
}

export const SAMPLES = [
  { id: 'bricks', label: 'Bricks', make: bricks },
  { id: 'cobbles', label: 'Cobblestones', make: cobbles },
  { id: 'plaster', label: 'Plaster', make: plaster },
];
