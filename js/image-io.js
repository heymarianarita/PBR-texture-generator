// Image loading, resizing, and conversion between canvases and float arrays.

export const MAX_SOURCE_EDGE = 16384; // browsers refuse canvases much larger than this
export const LARGE_EDGE = 4096;       // above this, export defaults to a capped size
export const HUGE_EDGE = 8192;        // above this, full-size export is disabled (memory)

const SUPPORTED_HINT = 'Try a PNG, JPEG or WebP image.';

// Decode an image File/Blob into a full-resolution canvas.
export async function decodeFile(file) {
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error(`"${file.name}" isn't an image. ${SUPPORTED_HINT}`);
  }
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await decodeWithImageElement(file);
  }
  const w = source.width, h = source.height;
  if (!w || !h) throw new Error(`Couldn't read "${file.name}". ${SUPPORTED_HINT}`);
  if (Math.max(w, h) > MAX_SOURCE_EDGE) {
    throw new Error(`Image is ${w}×${h}. The maximum is ${MAX_SOURCE_EDGE}px on the long edge.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0);
  source.close?.();
  return canvas;
}

async function decodeWithImageElement(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(`This browser can't decode "${file.name}". ${SUPPORTED_HINT}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Draw `source` scaled so its long edge is at most `maxEdge` (or exactly
// `maxEdge` when `upscale` is set), and return
// { w, h, rgb: Float32Array (interleaved, 0..1), canvas }.
// Transparent pixels are composited over mid grey, which reads as flat height.
export function readPixels(source, maxEdge, upscale = false) {
  const sw = source.width, sh = source.height;
  const long = Math.max(sw, sh);
  const k = maxEdge && (upscale || long > maxEdge) ? maxEdge / long : 1;
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  const px = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3] / 255;
    const bg = 0.5 * (1 - a);
    rgb[i * 3] = (px[i * 4] / 255) * a + bg;
    rgb[i * 3 + 1] = (px[i * 4 + 1] / 255) * a + bg;
    rgb[i * 3 + 2] = (px[i * 4 + 2] / 255) * a + bg;
  }
  return { w, h, rgb, canvas };
}

function prepare(canvas, w, h) {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  return { ctx, img: ctx.createImageData(w, h) };
}

// Write a single-channel 0..1 array to a greyscale canvas.
export function grayToCanvas(arr, w, h, canvas = document.createElement('canvas'), invert = false) {
  const { ctx, img } = prepare(canvas, w, h);
  const d = img.data;
  for (let i = 0, n = w * h; i < n; i++) {
    const v = invert ? 1 - arr[i] : arr[i];
    const b = v * 255 + 0.5;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Write an interleaved RGB 0..1 array to a canvas.
export function rgbToCanvas(arr, w, h, canvas = document.createElement('canvas')) {
  const { ctx, img } = prepare(canvas, w, h);
  const d = img.data;
  for (let i = 0, n = w * h; i < n; i++) {
    d[i * 4] = arr[i * 3] * 255 + 0.5;
    d[i * 4 + 1] = arr[i * 3 + 1] * 255 + 0.5;
    d[i * 4 + 2] = arr[i * 3 + 2] * 255 + 0.5;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
