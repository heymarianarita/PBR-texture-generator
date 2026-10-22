// App state, UI wiring and event handling.

import { decodeFile, readPixels, grayToCanvas, rgbToCanvas } from './image-io.js';
import { createPipeline, runPipeline } from './pipeline.js';
import { downloadPng, downloadZip, makeGltf } from './export.js';
import { SAMPLE } from './samples.js';

const PREVIEW_EDGE = 1024;
const STORAGE_KEY = 'pbr-texture-generator:settings:v2';
const THEME_KEY = 'pbr-texture-generator:theme';

// Settings not shown in the UI keep these values; they still drive the
// pipeline (levels, filter).
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
  tileable: false,
  // Normal
  strength: 2.5,
  coarse: 0.25,
  medium: 0.5,
  fine: 1,
  kernel: 'sobel',
  flipGreen: false,
  // Roughness
  roughBase: 0.65,
  roughContrast: 1,
  roughInvert: false,
  // Metallic and occlusion
  metallic: 0,
  aoStrength: 1,
  aoRadius: 8,
  // Viewer and download
  size: '2048',
  view: '3d',
  shape: 'plane',
  tile: false,
  selected: 'normal',
});

// Settings kept when "Reset all settings" is pressed.
const KEEP_ON_RESET = ['size', 'view', 'shape', 'tile', 'selected'];

// The maps, in tile order. `controls` are the only settings shown for each.
// Roughness settings are shared by the Specular and ORM tiles.
const ROUGHNESS = { key: 'roughBase', type: 'range', label: 'Roughness', min: 0, max: 1, step: 0.01, ends: ['Shiny', 'Matte'] };
const ROUGH_CONTRAST = { key: 'roughContrast', type: 'range', label: 'Roughness contrast', min: 0, max: 3, step: 0.01 };
const ROUGH_INVERT = { key: 'roughInvert', type: 'toggle', label: 'Invert roughness' };

const MAPS = [
  {
    id: 'basecolor', label: 'Source', file: 'basecolor',
    about: 'Your photo, used as the base colour.',
    controls: [],
  },
  {
    id: 'normal', label: 'Normal', file: 'normal',
    about: 'Fakes bumps and grooves so light catches the surface.',
    controls: [
      { key: 'coarse', type: 'range', label: 'Large details', min: 0, max: 2, step: 0.05 },
      { key: 'medium', type: 'range', label: 'Medium details', min: 0, max: 2, step: 0.05 },
      { key: 'fine', type: 'range', label: 'Fine details', min: 0, max: 2, step: 0.05 },
    ],
    advanced: [
      { key: 'strength', type: 'range', label: 'Strength', min: 0, max: 10, step: 0.1 },
      { key: 'invert', type: 'toggle', label: 'Invert', hint: 'Use when bumps look like dents.' },
      { key: 'flipGreen', type: 'segmented', label: 'Format', options: [[false, 'OpenGL'], [true, 'DirectX']],
        hint: 'OpenGL for Blender, Unity, Godot and Second Life. DirectX for Unreal.' },
    ],
  },
  {
    id: 'specular', label: 'Specular', file: 'specular',
    about: 'Bright is shiny, dark is matte. It is the inverse of the roughness in the ORM map, so the two stay in sync.',
    controls: [ROUGHNESS],
    advanced: [{ ...ROUGH_CONTRAST, label: 'Contrast' }, { ...ROUGH_INVERT, label: 'Invert' }],
  },
  {
    id: 'height', label: 'Height', file: 'height',
    about: 'Light is high, dark is low. The normal map and occlusion are built from it.',
    controls: [
      { key: 'contrast', type: 'range', label: 'Contrast', min: 0, max: 3, step: 0.01 },
      { key: 'blur', type: 'range', label: 'Smooth', min: 0, max: 10, step: 0.1, unit: 'px' },
    ],
    advanced: [
      { key: 'highpass', type: 'range', label: 'Even out lighting', min: 0, max: 200, step: 1, unit: 'px', zero: 'Off',
        hint: 'Removes shadows and bright patches from uneven lighting in the photo.' },
      { key: 'invert', type: 'toggle', label: 'Invert' },
    ],
  },
  {
    id: 'orm', label: 'ORM', file: 'orm',
    about: 'The packed PBR texture: occlusion in red, roughness in green, metallic in blue.',
    controls: [
      { key: 'aoStrength', type: 'range', label: 'Occlusion', min: 0, max: 3, step: 0.05,
        hint: 'Darkens cracks and crevices that light struggles to reach.' },
      ROUGHNESS,
      { key: 'metallic', type: 'range', label: 'Metallic', min: 0, max: 1, step: 0.01, ends: ['Not metal', 'Metal'] },
    ],
    advanced: [
      { key: 'aoRadius', type: 'range', label: 'Occlusion spread', min: 1, max: 40, step: 1, unit: 'px' },
      ROUGH_CONTRAST,
      ROUGH_INVERT,
    ],
  },
];
const mapById = Object.fromEntries(MAPS.map((m) => [m.id, m]));

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
  if (!mapById[s.selected]) s.selected = DEFAULTS.selected;
  return s;
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

const settings = loadSettings();

// ---------- State ----------
const state = {
  img: null,          // preview-resolution pixels { w, h, rgb, canvas, id }
  source: null,       // full-resolution canvas
  name: 'texture',
  imageId: 0,
};
const canvases = {
  basecolor: null, // the preview-size source canvas
  normal: document.createElement('canvas'),
  specular: document.createElement('canvas'),
  height: document.createElement('canvas'),
  orm: document.createElement('canvas'),   // R occlusion, G roughness, B metallic; also drives the 3D preview
};
const tiles = new Map(); // map id -> { button, thumb }
const pipeline = createPipeline();
let preview = null;

// ---------- Controls ----------
function formatValue(c, v) {
  if (c.zero && v === 0) return c.zero;
  const decimals = c.step >= 1 ? 0 : c.step >= 0.1 ? 1 : 2;
  return v.toFixed(decimals) + (c.unit ? ` ${c.unit}` : '');
}

function buildControl(c) {
  if (c.type === 'range') {
    const el = document.createElement('label');
    el.className = 'slider';
    el.innerHTML = '<span class="slider-head"><span></span><output></output></span><input type="range">';
    el.querySelector('.slider-head > span').textContent = c.label;
    const input = el.querySelector('input');
    const out = el.querySelector('output');
    Object.assign(input, { min: c.min, max: c.max, step: c.step, value: settings[c.key] });
    if (c.hint) el.title = c.hint;
    const show = () => {
      out.textContent = formatValue(c, settings[c.key]);
      input.style.setProperty('--fill', `${((settings[c.key] - c.min) / (c.max - c.min)) * 100}%`);
    };
    input.addEventListener('input', () => {
      settings[c.key] = parseFloat(input.value);
      show();
      onSettingChanged(c.key);
    });
    input.addEventListener('dblclick', () => {
      settings[c.key] = DEFAULTS[c.key];
      input.value = settings[c.key];
      show();
      onSettingChanged(c.key);
    });
    show();
    if (c.ends) {
      const ends = document.createElement('span');
      ends.className = 'slider-ends';
      ends.innerHTML = '<span></span><span></span>';
      ends.children[0].textContent = c.ends[0];
      ends.children[1].textContent = c.ends[1];
      el.append(ends);
    }
    return el;
  }
  if (c.type === 'toggle') {
    const el = document.createElement('label');
    el.className = 'check';
    el.innerHTML = '<input type="checkbox"><span></span>';
    el.querySelector('span').textContent = c.label;
    const input = el.querySelector('input');
    input.checked = settings[c.key];
    if (c.hint) el.title = c.hint;
    input.addEventListener('change', () => {
      settings[c.key] = input.checked;
      onSettingChanged(c.key);
    });
    return el;
  }
  // segmented
  const el = document.createElement('div');
  el.className = 'field';
  el.innerHTML = '<span class="label"></span><div class="seg wide" role="group"></div>';
  el.querySelector('.label').textContent = c.label;
  const seg = el.querySelector('.seg');
  seg.setAttribute('aria-label', c.label);
  if (c.hint) el.title = c.hint;
  const buttons = c.options.map(([value, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => {
      settings[c.key] = value;
      for (const [v, btn] of buttons) btn.setAttribute('aria-pressed', String(v === value));
      onSettingChanged(c.key);
    });
    seg.append(b);
    return [value, b];
  });
  for (const [v, btn] of buttons) btn.setAttribute('aria-pressed', String(v === settings[c.key]));
  if (c.hint) {
    const p = document.createElement('p');
    p.className = 'about small';
    p.textContent = c.hint;
    el.append(p);
  }
  return el;
}

// Show the selected map's description and controls.
function showMapSettings() {
  const map = mapById[settings.selected];
  $('#map-title').textContent = map.label;
  $('#map-about').textContent = map.about;
  const els = map.controls.map(buildControl);
  if (map.advanced?.length) {
    const adv = document.createElement('details');
    adv.className = 'advanced';
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced';
    const body = document.createElement('div');
    body.className = 'controls';
    body.append(...map.advanced.map(buildControl));
    adv.append(summary, body);
    els.push(adv);
  }
  $('#map-controls').replaceChildren(...els);
  const name = map.label === map.label.toUpperCase() ? map.label : map.label.toLowerCase();
  $('#download-map').textContent = `Download ${name}`;
  for (const [id, t] of tiles) t.button.setAttribute('aria-pressed', String(id === map.id));
  drawFlat();
}

function buildTiles() {
  const host = $('#tiles');
  for (const map of MAPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile';
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 160;
    const label = document.createElement('span');
    label.textContent = map.short || map.label;
    if (map.short) button.title = map.label;
    button.append(thumb, label);
    button.addEventListener('click', () => {
      settings.selected = map.id;
      saveSettings();
      showMapSettings();
    });
    host.append(button);
    tiles.set(map.id, { button, thumb });
  }
}

// Draw a map canvas into its tile, cropped to a square.
function drawThumb(id) {
  const src = canvases[id];
  const t = tiles.get(id);
  if (!src || !t || !src.width) return;
  const ctx = t.thumb.getContext('2d');
  const side = Math.min(src.width, src.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, t.thumb.width, t.thumb.height);
}

// The Flat view shows the selected map at preview resolution.
function drawFlat() {
  if (settings.view !== 'flat') return;
  const src = canvases[settings.selected];
  const flat = $('#flat');
  if (!src || !src.width) return;
  flat.width = src.width;
  flat.height = src.height;
  flat.getContext('2d').drawImage(src, 0, 0);
}

// ---------- Recompute ----------
let recomputeTimer = 0;
function onSettingChanged(key) {
  saveSettings();
  if (key === 'flipGreen') preview?.setOptions({ flipGreen: settings.flipGreen });
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, 30);
}

function recompute() {
  if (!state.img) return;
  const { w, h } = state.img;
  const r = pipeline(state.img, settings, 1);
  const redrawn = [];
  if (r.changed.height) { grayToCanvas(r.height, w, h, canvases.height); redrawn.push('height'); }
  if (r.changed.normal) { rgbToCanvas(r.normal, w, h, canvases.normal); redrawn.push('normal'); }
  if (r.changed.spec) { grayToCanvas(r.spec, w, h, canvases.specular); redrawn.push('specular'); }
  if (r.changed.orm) { rgbToCanvas(r.orm, w, h, canvases.orm); redrawn.push('orm'); }
  preview?.refresh({ normal: r.changed.normal, orm: r.changed.orm });

  for (const id of redrawn) drawThumb(id);
  if (redrawn.includes(settings.selected)) drawFlat();
}

// ---------- Loading ----------
async function loadFile(file) {
  setBusy('Loading image…');
  try {
    const canvas = await decodeFile(file);
    setSource(canvas, file.name || 'pasted-image.png');
  } catch (err) {
    toast(err.message);
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

  canvases.basecolor = state.img.canvas;
  for (const [id, c] of Object.entries(canvases)) {
    if (id !== 'basecolor') { c.width = w; c.height = h; }
  }

  recompute();
  drawThumb('basecolor');
  drawFlat();
  preview?.setSource(previewSources());
  $('#status').textContent = `${name} · ${canvas.width}×${canvas.height}`;
}

function previewSources() {
  return { albedo: state.img.canvas, normal: canvases.normal, orm: canvases.orm };
}

// ---------- Download ----------
function baseName() {
  return state.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'texture';
}

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// Process the source at `edge` px on the long edge (upscaling if needed).
function processAt(edge, overrides = {}) {
  const img = readPixels(state.source, edge, true);
  const scale = Math.max(img.w, img.h) / Math.max(state.img.w, state.img.h);
  const s = { ...settings, ...overrides };
  return { img, s, r: runPipeline(img, s, scale) };
}

function mapCanvas(id, { img, r }) {
  const { w, h } = img;
  switch (id) {
    case 'basecolor': return img.canvas;
    case 'normal': return rgbToCanvas(r.normal, w, h);
    case 'specular': return grayToCanvas(r.spec, w, h);
    case 'height': return grayToCanvas(r.height, w, h);
    case 'orm': return rgbToCanvas(r.orm, w, h);
  }
  return null;
}

function fileName(id, s) {
  if (id === 'normal') return `${baseName()}_normal_${s.flipGreen ? 'dx' : 'gl'}.png`;
  return `${baseName()}_${mapById[id].file}.png`;
}

async function download(kind) {
  if (!state.source) return;
  const edge = parseInt(settings.size, 10);
  setBusy(`Making ${edge}px maps…`);
  await nextPaint();
  try {
    const job = processAt(edge);
    if (kind === 'one') {
      await downloadPng(mapCanvas(settings.selected, job), fileName(settings.selected, job.s));
    } else {
      const files = {};
      for (const { id } of MAPS) files[fileName(id, job.s)] = mapCanvas(id, job);
      setBusy('Zipping…');
      await nextPaint();
      await downloadZip(files, `${baseName()}_pbr.zip`);
    }
  } catch (err) {
    console.error(err);
    toast('That size ran out of memory. Try a smaller one.');
  } finally {
    setBusy(false);
  }
}

// Second Life PBR: base colour, OpenGL normal and ORM, each side a power of
// two and at most 2048px, plus a .gltf material that uses them.
const SL_MAX_EDGE = 2048;
const pow2 = (v) => Math.min(SL_MAX_EDGE, 2 ** Math.max(0, Math.round(Math.log2(v))));

function resized(canvas, w, h) {
  if (canvas.width === w && canvas.height === h) return canvas;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, w, h);
  return out;
}

async function downloadSecondLife() {
  if (!state.source) return;
  const { width, height } = state.source;
  const long = Math.max(width, height);
  const edge = Math.min(parseInt(settings.size, 10), SL_MAX_EDGE);
  const w = pow2((width / long) * edge), h = pow2((height / long) * edge);
  setBusy(`Making ${w}×${h} Second Life maps…`);
  await nextPaint();
  try {
    // Process at the photo's proportions, then stretch to the power-of-two
    // size so the maps line up once mapped back onto a face.
    const job = processAt(Math.max(w, h), { flipGreen: false });
    const base = baseName();
    const names = { basecolor: `${base}_basecolor.png`, normal: `${base}_normal_gl.png`, orm: `${base}_orm.png` };
    const files = {
      [names.basecolor]: resized(mapCanvas('basecolor', job), w, h),
      [names.normal]: resized(mapCanvas('normal', job), w, h),
      [names.orm]: resized(mapCanvas('orm', job), w, h),
    };
    setBusy('Zipping…');
    await nextPaint();
    await downloadZip(files, `${base}_secondlife.zip`, { [`${base}.gltf`]: makeGltf(base, names, w / h) });
    if (parseInt(settings.size, 10) > SL_MAX_EDGE) toast('Second Life allows up to 2048px, so these are 2K.');
  } catch (err) {
    console.error(err);
    toast('That size ran out of memory. Try a smaller one.');
  } finally {
    setBusy(false);
  }
}

// ---------- Segmented switches outside the map settings ----------
function bindSwitch(selector, attr, key, onChange) {
  const buttons = [...document.querySelectorAll(`${selector} button`)];
  const show = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === settings[key])));
  buttons.forEach((b) => b.addEventListener('click', () => {
    settings[key] = b.dataset[attr];
    saveSettings();
    show();
    onChange?.();
  }));
  show();
  return show;
}

// The hint follows what dragging does: move the light, or turn the sphere.
function updateHint() {
  const drag = settings.shape === 'sphere' ? 'Drag to rotate' : 'Drag to move the light';
  const zoom = matchMedia('(pointer: coarse)').matches ? 'pinch to zoom' : 'scroll to zoom';
  $('#viewport-hint').textContent = `${drag} · ${zoom}`;
}

function applyView() {
  const flat = settings.view === 'flat';
  $('#viewport').classList.toggle('flat-mode', flat);
  $('#flat').hidden = !flat;
  $('#opts-3d').hidden = flat;
  $('#viewport-hint').hidden = flat || !preview;
  $('#zoom-controls').hidden = flat || !preview;
  if (flat) drawFlat();
  else preview?.resize();
}

// ---------- Theme ----------
// System (follows the OS), Light or Dark. The button cycles them; an explicit choice is saved.
const THEME_MODES = ['system', 'light', 'dark'];

function currentTheme() {
  return document.documentElement.dataset.theme || 'system';
}

function applyTheme(mode) {
  const root = document.documentElement;
  // Pause transitions for the frame the theme changes in, so every control switches together.
  root.classList.add('mds-theme-switching');
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    if (mode === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch { /* ignore */ }
  const next = THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];
  const button = $('#theme-toggle');
  button.setAttribute('aria-label', `Theme: ${mode}. Switch to ${next}`);
  button.title = `Theme: ${mode}`;
  for (const icon of button.querySelectorAll('.theme-icon')) icon.hidden = icon.dataset.mode !== mode;
  syncThemeColours();
  void root.offsetHeight;
  setTimeout(() => root.classList.remove('mds-theme-switching'), 0);
}

// The 3D background and the browser bar colour come from CSS, so refresh them whenever the theme changes.
function syncThemeColours() {
  const css = getComputedStyle(document.documentElement);
  document.querySelector('meta[name="theme-color"]').content = css.getPropertyValue('--bg').trim();
  preview?.setBackground(css.getPropertyValue('--viewer').trim());
}

// ---------- UI helpers ----------
function setBusy(message) {
  $('#busy').hidden = !message;
  if (message) $('#busy-text').textContent = message;
}

let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
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
  const endDrag = () => {
    dragDepth = 0;
    overlay.hidden = true;
    document.body.classList.remove('dragging');
  };
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    overlay.hidden = false;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) endDrag(); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    endDrag();
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  const seamless = $('#seamless-toggle');
  seamless.checked = settings.tileable;
  seamless.addEventListener('change', () => {
    settings.tileable = seamless.checked;
    onSettingChanged('tileable');
  });

  const tile = $('#tile-toggle');
  tile.checked = settings.tile;
  tile.addEventListener('change', () => {
    settings.tile = tile.checked;
    saveSettings();
    preview?.setOptions({ tile: settings.tile });
  });

  bindSwitch('#view-switch', 'view', 'view', applyView);
  bindSwitch('#shape-switch', 'shape', 'shape', () => {
    preview?.setOptions({ shape: settings.shape });
    updateHint();
  });
  bindSwitch('#size-switch', 'size', 'size');

  $('#download-map').addEventListener('click', () => download('one'));
  $('#download-all').addEventListener('click', () => download('all'));
  $('#download-sl').addEventListener('click', downloadSecondLife);

  $('#theme-toggle').addEventListener('click', () => {
    const mode = currentTheme();
    applyTheme(THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]);
  });
  // On System, follow the OS when it switches between light and dark.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme() === 'system') applyTheme('system');
  });

  $('#reset').addEventListener('click', () => {
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (!KEEP_ON_RESET.includes(k)) settings[k] = v;
    }
    seamless.checked = settings.tileable;
    preview?.setOptions({ flipGreen: settings.flipGreen });
    showMapSettings();
    onSettingChanged('reset');
  });
}

async function loadSample(sample) {
  setBusy(`Making the ${sample.label.toLowerCase()} sample…`);
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
    preview.setOptions({ shape: settings.shape, tile: settings.tile, flipGreen: settings.flipGreen });
    applyTheme(currentTheme());
    const level = $('#zoom-level');
    preview.onZoom((z) => { level.textContent = `${Math.round(z * 100)}%`; });
    $('#zoom-in').addEventListener('click', () => preview.zoomIn());
    $('#zoom-out').addEventListener('click', () => preview.zoomOut());
    level.addEventListener('click', () => preview.resetZoom());
    if (state.img) preview.setSource(previewSources());
  } catch (err) {
    console.error(err);
    const msg = document.createElement('p');
    msg.className = 'viewport-error';
    msg.textContent = "The 3D preview couldn't start. Switch to Flat to see the maps; downloads still work.";
    viewport.append(msg);
  }
  applyView();
}

// ---------- Start ----------
updateHint();
buildTiles();
wireEvents();
applyTheme(currentTheme());
showMapSettings();
const previewReady = initPreview();
await loadSample(SAMPLE);
await previewReady;
