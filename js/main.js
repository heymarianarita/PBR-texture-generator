// App state, UI wiring and event handling.

import { decodeFile, readPixels, grayToCanvas, rgbToCanvas, LARGE_EDGE, HUGE_EDGE } from './image-io.js';
import { createPipeline, runPipeline } from './pipeline.js';
import { downloadPng, downloadZip, makeGltf } from './export.js';
import { SAMPLES } from './samples.js';

const PREVIEW_EDGE = 1024;
const STORAGE_KEY = 'normal-map-maker:settings:v1';

const DEFAULTS = Object.freeze({
  // Height
  invert: false,
  autoLevels: true,
  black: 0,
  white: 1,
  gamma: 1,
  contrast: 1,
  highpass: 0,
  blur: 0,
  // Normal
  strength: 2.5,
  kernel: 'sobel',
  fine: 1,
  medium: 0.5,
  coarse: 0.25,
  flipGreen: false,
  tileable: false,
  // Specular / roughness
  roughness: false,
  specSource: 0,
  specBlack: 0,
  specWhite: 1,
  specGamma: 1.5,
  specInvert: false,
  // Occlusion and metallic (ORM)
  aoStrength: 1,
  aoRadius: 8,
  metallic: 0,
  // Export & preview
  exportSize: 'full',
  shape: 'plane',
  tile: false,
  showColor: true,
  orm: false,
  lightHeight: 0.6,
});

const GROUPS = [
  {
    title: 'Height',
    controls: [
      { key: 'invert', type: 'toggle', label: 'Invert', hint: 'Use when bumps look like dents, e.g. light mortar between bricks.' },
      { key: 'autoLevels', type: 'toggle', label: 'Auto levels', hint: 'Stretch the height to use the full 0 to 1 range.' },
      { key: 'black', type: 'range', label: 'Black point', min: 0, max: 1, step: 0.01 },
      { key: 'white', type: 'range', label: 'White point', min: 0, max: 1, step: 0.01 },
      { key: 'gamma', type: 'range', label: 'Gamma', min: 0.2, max: 3, step: 0.01 },
      { key: 'contrast', type: 'range', label: 'Contrast', min: 0, max: 3, step: 0.01 },
      { key: 'highpass', type: 'range', label: 'Flatten lighting', min: 0, max: 200, step: 1, unit: 'px', zero: 'off',
        hint: 'High-pass radius. Removes uneven lighting and large slopes.' },
      { key: 'blur', type: 'range', label: 'Blur', min: 0, max: 10, step: 0.1, unit: 'px', zero: 'off', hint: 'Smooth out noise and JPEG artefacts.' },
    ],
  },
  {
    title: 'Normal',
    controls: [
      { key: 'strength', type: 'range', label: 'Strength', min: 0, max: 10, step: 0.05 },
      { key: 'fine', type: 'range', label: 'Fine detail', min: 0, max: 2, step: 0.05 },
      { key: 'medium', type: 'range', label: 'Medium detail', min: 0, max: 2, step: 0.05 },
      { key: 'coarse', type: 'range', label: 'Coarse detail', min: 0, max: 2, step: 0.05 },
      { key: 'kernel', type: 'segmented', label: 'Filter', options: [['sobel', 'Sobel'], ['scharr', 'Scharr']] },
      { key: 'flipGreen', type: 'segmented', label: 'Format', options: [[false, 'OpenGL (Y+)'], [true, 'DirectX (Y−)']],
        hint: 'OpenGL: Blender, Unity, Godot, glTF. DirectX: Unreal, 3ds Max.' },
      { key: 'tileable', type: 'toggle', label: 'Seamless edges (tileable)', hint: 'Wrap filters around the edges so a tiling texture stays seamless.' },
    ],
  },
  {
    title: 'Specular and roughness',
    controls: [
      { key: 'roughness', type: 'segmented', label: 'Output', options: [[false, 'Specular'], [true, 'Roughness']],
        hint: 'Roughness is the inverse of specular, as used by PBR materials.' },
      { key: 'specSource', type: 'range', label: 'Source: colour → height', min: 0, max: 1, step: 0.01 },
      { key: 'specBlack', type: 'range', label: 'Black point', min: 0, max: 1, step: 0.01 },
      { key: 'specWhite', type: 'range', label: 'White point', min: 0, max: 1, step: 0.01 },
      { key: 'specGamma', type: 'range', label: 'Gamma', min: 0.2, max: 4, step: 0.01 },
      { key: 'specInvert', type: 'toggle', label: 'Invert' },
    ],
  },
  {
    title: 'Occlusion and metallic',
    controls: [
      { key: 'aoStrength', type: 'range', label: 'Occlusion', min: 0, max: 3, step: 0.05, zero: 'off',
        hint: 'Darkens cavities found in the height map. At 0 the occlusion channel is plain white.' },
      { key: 'aoRadius', type: 'range', label: 'Occlusion radius', min: 1, max: 40, step: 1, unit: 'px' },
      { key: 'metallic', type: 'range', label: 'Metallic', min: 0, max: 1, step: 0.01,
        hint: '0 for most materials, 1 for bare metal.' },
    ],
  },
];

const PREVIEW_CONTROLS = [
  { key: 'shape', type: 'segmented', options: [['plane', 'Plane'], ['sphere', 'Sphere']] },
  { key: 'tile', type: 'toggle', label: 'Tile 2×2' },
  { key: 'showColor', type: 'toggle', label: 'Colour' },
  { key: 'orm', type: 'toggle', label: 'ORM (SL PBR)',
    hint: 'Preview as a Second Life PBR material: occlusion, roughness and metallic from the ORM map.' },
  { key: 'lightHeight', type: 'range', label: 'Light height', min: 0.1, max: 2, step: 0.05 },
];

const $ = (sel) => document.querySelector(sel);

// ---------- Settings ----------
function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) {
      if (typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
    }
  } catch { /* storage unavailable: use defaults */ }
  return s;
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

const settings = loadSettings();
const controls = new Map(); // key -> function that shows the current value

// ---------- State ----------
const state = {
  img: null,          // preview-resolution pixels { w, h, rgb, canvas, id }
  source: null,       // full-resolution canvas
  name: 'texture',
  imageId: 0,
  lastRoughness: null,
};
const canvases = {
  height: document.createElement('canvas'),
  normal: document.createElement('canvas'),
  spec: document.createElement('canvas'),   // shown & exported: specular or roughness
  rough: document.createElement('canvas'),  // always roughness, for the 3D preview
  orm: document.createElement('canvas'),    // R occlusion, G roughness, B metallic
};
const pipeline = createPipeline();
let preview = null;

// ---------- Control building ----------
function formatValue(c, v) {
  if (c.zero && v === 0) return c.zero;
  const decimals = c.step >= 1 ? 0 : c.step >= 0.1 ? 1 : 2;
  return v.toFixed(decimals) + (c.unit ? ` ${c.unit}` : '');
}

function buildControl(c) {
  let el;
  if (c.type === 'range') {
    el = document.createElement('label');
    el.className = 'ctl';
    el.innerHTML = `<span class="ctl-label"><span></span><output></output></span><input type="range">`;
    el.querySelector('.ctl-label > span').textContent = c.label;
    const input = el.querySelector('input');
    const out = el.querySelector('output');
    Object.assign(input, { min: c.min, max: c.max, step: c.step });
    const showFill = () => input.style.setProperty('--fill', `${((input.value - c.min) / (c.max - c.min)) * 100}%`);
    input.addEventListener('input', () => {
      settings[c.key] = parseFloat(input.value);
      out.textContent = formatValue(c, settings[c.key]);
      showFill();
      onSettingChanged(c.key);
    });
    input.addEventListener('dblclick', () => setSetting(c.key, DEFAULTS[c.key]));
    input.title = (c.hint ? c.hint + ' ' : '') + 'Double-click to reset.';
    controls.set(c.key, () => {
      input.value = settings[c.key];
      out.textContent = formatValue(c, settings[c.key]);
      showFill();
    });
  } else if (c.type === 'toggle') {
    el = document.createElement('label');
    el.className = 'ctl toggle';
    el.innerHTML = `<input type="checkbox"><span></span>`;
    el.querySelector('span').textContent = c.label;
    const input = el.querySelector('input');
    input.addEventListener('change', () => {
      settings[c.key] = input.checked;
      onSettingChanged(c.key);
    });
    if (c.hint) el.title = c.hint;
    controls.set(c.key, () => { input.checked = settings[c.key]; });
  } else if (c.type === 'segmented') {
    el = document.createElement('div');
    el.className = 'ctl';
    if (c.label) {
      const lab = document.createElement('span');
      lab.className = 'ctl-label';
      lab.textContent = c.label;
      el.append(lab);
    }
    const seg = document.createElement('div');
    seg.className = 'segmented';
    seg.setAttribute('role', 'radiogroup');
    if (c.label) seg.setAttribute('aria-label', c.label);
    const inputs = c.options.map(([value, text]) => {
      const lab = document.createElement('label');
      lab.innerHTML = `<input type="radio" name="seg-${c.key}"><span class="chip"></span>`;
      lab.querySelector('span').textContent = text;
      const input = lab.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) {
          settings[c.key] = value;
          onSettingChanged(c.key);
        }
      });
      seg.append(lab);
      return [value, input];
    });
    el.append(seg);
    if (c.hint) el.title = c.hint;
    controls.set(c.key, () => {
      for (const [value, input] of inputs) input.checked = value === settings[c.key];
    });
  }
  return el;
}

function buildControls() {
  const host = $('#control-groups');
  for (const g of GROUPS) {
    const sec = document.createElement('details');
    sec.className = 'group';
    sec.open = true;
    const sum = document.createElement('summary');
    sum.textContent = g.title;
    sec.append(sum);
    for (const c of g.controls) sec.append(buildControl(c));
    host.append(sec);
  }
  const stage = $('#stage-controls');
  for (const c of PREVIEW_CONTROLS) stage.append(buildControl(c));
  for (const show of controls.values()) show();
}

function setSetting(key, value) {
  settings[key] = value;
  controls.get(key)?.();
  onSettingChanged(key);
}

// ---------- Recompute ----------
let recomputeTimer = 0;
function onSettingChanged(key) {
  saveSettings();
  if (key === 'roughness') updateSpecLabels();
  if (['shape', 'tile', 'showColor', 'orm', 'lightHeight', 'flipGreen'].includes(key)) {
    preview?.setOptions(previewOptions());
  }
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, 30);
}

function previewOptions() {
  const { shape, tile, showColor, orm, lightHeight, flipGreen } = settings;
  return { shape, tile, showColor, orm, lightHeight, flipGreen };
}

function recompute() {
  if (!state.img) return;
  const t0 = performance.now();
  const { w, h } = state.img;
  const r = pipeline(state.img, settings, 1);
  if (r.changed.height) grayToCanvas(r.height, w, h, canvases.height);
  if (r.changed.normal) rgbToCanvas(r.normal, w, h, canvases.normal);
  const roughChanged = r.changed.spec;
  if (r.changed.spec || state.lastRoughness !== settings.roughness) {
    grayToCanvas(r.spec, w, h, canvases.spec, settings.roughness);
    state.lastRoughness = settings.roughness;
  }
  if (roughChanged) grayToCanvas(r.spec, w, h, canvases.rough, true);
  if (r.changed.orm) rgbToCanvas(r.orm, w, h, canvases.orm);
  preview?.refresh({ normal: r.changed.normal, rough: roughChanged, orm: r.changed.orm });

  const ms = Math.round(performance.now() - t0);
  const src = state.source;
  $('#status').textContent =
    `${state.name} · ${src.width}×${src.height} · preview ${w}×${h} · ${ms} ms`;
}

function updateSpecLabels() {
  const label = settings.roughness ? 'Roughness' : 'Specular';
  $('#spec-caption').textContent = label;
  $('#export-spec').textContent = label;
}

// ---------- Loading ----------
async function loadFile(file) {
  setBusy('Loading image…');
  try {
    const canvas = await decodeFile(file);
    setSource(canvas, file.name || 'pasted-image');
  } catch (err) {
    toast(err.message, true);
  } finally {
    setBusy(false);
  }
}

function setSource(canvas, name) {
  state.source = canvas;
  state.name = name;
  state.imageId++;
  state.img = { ...readPixels(canvas, PREVIEW_EDGE), id: state.imageId };
  const { w, h } = state.img;

  // Draw blank maps at the new size before handing canvases to three.js.
  for (const c of Object.values(canvases)) { c.width = w; c.height = h; }
  state.lastRoughness = null;

  setSlot('source', state.img.canvas);
  setSlot('height', canvases.height);
  setSlot('normal', canvases.normal);
  setSlot('spec', canvases.spec);
  setSlot('orm', canvases.orm);

  buildExportSizes();
  recompute();
  preview?.setSource(previewSources());
}

function previewSources() {
  return { albedo: state.img.canvas, normal: canvases.normal, rough: canvases.rough, orm: canvases.orm };
}

function setSlot(map, canvas) {
  document.querySelector(`.map[data-map="${map}"] .slot`).replaceChildren(canvas);
}

// ---------- Export ----------
function buildExportSizes() {
  const select = $('#export-size');
  const warn = $('#size-warning');
  const { width, height } = state.source;
  const long = Math.max(width, height);
  const options = [];
  if (long <= HUGE_EDGE) options.push(['full', `Full size (${width}×${height})`]);
  for (const edge of [8192, 4096, 2048, 1024, 512]) {
    if (edge < long) options.push([String(edge), `${edge}px long edge`]);
  }
  select.replaceChildren(...options.map(([v, t]) => new Option(t, v)));

  const values = options.map(([v]) => v);
  if (!values.includes(settings.exportSize) || (long > LARGE_EDGE && settings.exportSize === 'full')) {
    settings.exportSize = long > LARGE_EDGE ? String(LARGE_EDGE) : 'full';
  }
  select.value = settings.exportSize;

  if (long > HUGE_EDGE) {
    warn.textContent = `This image is very large (${width}×${height}). Full-size export is turned off to avoid running out of memory.`;
  } else if (long > LARGE_EDGE) {
    warn.textContent = `Large image (${width}×${height}). Full-size export can take a while and use a lot of memory.`;
  }
  warn.hidden = long <= LARGE_EDGE;
}

function baseName() {
  return state.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'texture';
}

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function doExport(kind) {
  if (!state.source) return;
  if (kind === 'sl') return exportSecondLife();
  const src = state.source;
  const long = Math.max(src.width, src.height);
  const edge = settings.exportSize === 'full' ? long : Math.min(long, parseInt(settings.exportSize, 10));
  setBusy(`Processing at ${edge}px…`);
  await nextPaint();
  try {
    const img = readPixels(src, edge);
    const scale = Math.max(img.w, img.h) / Math.max(state.img.w, state.img.h);
    const all = kind === 'all';
    const r = runPipeline(img, settings, scale, {
      normal: all || kind === 'normal',
      spec: all || kind === 'spec',
      orm: all || kind === 'orm',
    });
    const base = baseName();
    const specName = settings.roughness ? 'roughness' : 'specular';
    const files = {};
    if (all || kind === 'height') files[`${base}_height.png`] = grayToCanvas(r.height, img.w, img.h);
    if (r.normal) files[`${base}_normal_${settings.flipGreen ? 'dx' : 'gl'}.png`] = rgbToCanvas(r.normal, img.w, img.h);
    if (all || kind === 'spec') files[`${base}_${specName}.png`] = grayToCanvas(r.spec, img.w, img.h, undefined, settings.roughness);
    if (r.orm) files[`${base}_orm.png`] = rgbToCanvas(r.orm, img.w, img.h);

    setBusy('Encoding PNG…');
    await nextPaint();
    if (all) {
      await downloadZip(files, `${base}_maps.zip`);
    } else {
      const [[name, canvas]] = Object.entries(files);
      await downloadPng(canvas, name);
    }
  } catch (err) {
    console.error(err);
    toast('That export ran out of memory. Try a smaller size.', true);
  } finally {
    setBusy(false);
  }
}

// Second Life PBR: base colour, OpenGL normal and ORM, each side a power of
// two and at most 2048px, plus a .gltf material that uses them.
const SL_MAX_EDGE = 2048;

function nearestPow2(v) {
  return Math.min(SL_MAX_EDGE, 2 ** Math.max(0, Math.round(Math.log2(v))));
}

// Resample a canvas to exactly w × h.
function resized(canvas, w, h) {
  if (canvas.width === w && canvas.height === h) return canvas;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, w, h);
  return out;
}

async function exportSecondLife() {
  const src = state.source;
  const long = Math.max(src.width, src.height);
  const k = Math.min(1, SL_MAX_EDGE / long);
  const w = nearestPow2(src.width * k), h = nearestPow2(src.height * k);
  setBusy(`Processing at ${w}×${h}…`);
  await nextPaint();
  try {
    // Process at the aspect-correct size, then stretch to the power-of-two
    // size, so the maps match the photo once mapped back onto a face.
    const img = readPixels(src, Math.min(long, Math.max(w, h)));
    const scale = Math.max(img.w, img.h) / Math.max(state.img.w, state.img.h);
    const r = runPipeline(img, { ...settings, flipGreen: false }, scale, { normal: true, spec: false, orm: true });
    const base = baseName();
    const names = {
      basecolor: `${base}_basecolor.png`,
      normal: `${base}_normal_gl.png`,
      orm: `${base}_orm.png`,
    };
    const files = {
      [names.basecolor]: resized(src, w, h),
      [names.normal]: resized(rgbToCanvas(r.normal, img.w, img.h), w, h),
      [names.orm]: resized(rgbToCanvas(r.orm, img.w, img.h), w, h),
    };
    setBusy('Encoding PNG…');
    await nextPaint();
    await downloadZip(files, `${base}_secondlife.zip`, { [`${base}.gltf`]: makeGltf(base, names, w / h) });
    toast(`Second Life maps saved at ${w}×${h}.`);
  } catch (err) {
    console.error(err);
    toast('That export ran out of memory. Try a smaller image.', true);
  } finally {
    setBusy(false);
  }
}

// ---------- UI helpers ----------
function setBusy(message) {
  $('#busy').hidden = !message;
  if (message) $('#busy-text').textContent = message;
}

let toastTimer = 0;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 6000 : 3000);
}

function openLightbox(map) {
  const slot = document.querySelector(`.map[data-map="${map}"] .slot canvas`);
  if (!slot) return;
  const dialog = $('#lightbox');
  const big = document.createElement('canvas');
  big.width = slot.width;
  big.height = slot.height;
  big.getContext('2d').drawImage(slot, 0, 0);
  dialog.querySelector('.slot').replaceChildren(big);
  const label = document.querySelector(`.map[data-map="${map}"] figcaption`).textContent;
  dialog.querySelector('.caption').textContent = `${label}, ${baseName()} · ${slot.width}×${slot.height} preview`;
  dialog.showModal();
}

// ---------- Events ----------
function wireEvents() {
  const fileInput = $('#file-input');
  const dropzone = $('#dropzone');
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  // Whole-window drag and drop.
  let dragDepth = 0;
  const overlay = $('#drop-overlay');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    overlay.hidden = false;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      overlay.hidden = true;
      document.body.classList.remove('dragging');
    }
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    document.body.classList.remove('dragging');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  // Samples
  const samples = $('#samples');
  for (const s of SAMPLES) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = s.label;
    b.addEventListener('click', () => loadSample(s));
    samples.append(b);
  }

  // Thumbnails → lightbox
  for (const fig of document.querySelectorAll('.map')) {
    fig.addEventListener('click', () => openLightbox(fig.dataset.map));
    fig.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(fig.dataset.map); }
    });
  }
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  // Export
  $('#export-size').addEventListener('change', (e) => {
    settings.exportSize = e.target.value;
    saveSettings();
  });
  for (const b of document.querySelectorAll('[data-export]')) {
    b.addEventListener('click', () => doExport(b.dataset.export));
  }

  $('#reset').addEventListener('click', () => {
    const exportSize = settings.exportSize;
    Object.assign(settings, DEFAULTS, { exportSize });
    for (const show of controls.values()) show();
    updateSpecLabels();
    preview?.setOptions(previewOptions());
    onSettingChanged('reset');
  });
}

async function loadSample(sample) {
  setBusy(`Generating ${sample.label.toLowerCase()}…`);
  await nextPaint();
  try {
    setSource(sample.make(), `${sample.id}.png`);
  } finally {
    setBusy(false);
  }
}

async function initPreview() {
  const viewport = $('#viewport');
  try {
    const { createPreview } = await import('./preview.js');
    preview = await createPreview(viewport);
    preview.setOptions(previewOptions());
    const level = $('#zoom-level');
    preview.onZoom((z) => { level.textContent = `${Math.round(z * 100)}%`; });
    $('#zoom-in').addEventListener('click', () => preview.zoomIn());
    $('#zoom-out').addEventListener('click', () => preview.zoomOut());
    level.addEventListener('click', () => preview.resetZoom());
    $('#zoom-controls').hidden = false;
    if (state.img) {
      preview.setSource(previewSources());
    }
  } catch (err) {
    console.error(err);
    const msg = document.createElement('p');
    msg.className = 'viewport-error';
    msg.textContent = "The 3D preview couldn't start, but the maps and downloads still work.";
    viewport.replaceChildren(msg);
  }
}

// ---------- Start ----------
buildControls();
updateSpecLabels();
wireEvents();
const previewReady = initPreview();
await loadSample(SAMPLES[0]);
await previewReady;
