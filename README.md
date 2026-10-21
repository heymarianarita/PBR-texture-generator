# Normal Map Maker

Make **height**, **normal** and **specular/roughness** maps from a photo, right in the browser. Nothing is uploaded: all processing happens on your device.

<!-- Add screenshots here once deployed, e.g. ![Screenshot](assets/screenshot.png) -->

## Features

- Drag and drop, click to browse, or paste an image (PNG, JPEG, WebP). Three procedural samples are built in.
- **Height:** invert, auto levels, black/white point, gamma, contrast, high-pass "flatten lighting", blur
- **Normal:** strength, fine/medium/coarse detail, Sobel or Scharr filter, OpenGL (Y+) or DirectX (Y−) output, seamless/tileable edges
- **Specular/Roughness:** derived from colour, height or a mix, with levels, gamma and invert
- **Live 3D preview** (three.js): a plane or sphere, where the pointer moves the light. Also has light height, 2×2 tiling to check seams, and a colour on/off switch.
- **Export:** each map as a PNG, or all of them as a `.zip`, at full or capped resolution

## How it works

Plain HTML, CSS and ES modules. There's no build step. three.js and fflate load from jsDelivr through an import map with pinned versions.

Filters run on the CPU over `Float32Array`s. While you adjust sliders, the image is processed at 1024px on the long edge. On export it re-runs at the chosen size. Slider radii and strength scale with resolution, so the export matches the preview.

The UI uses **MDS** (Mariana's Design System). Its tokens are in `css/mds/`, copied unchanged from the design system so you can drop in updates. `css/style.css` uses only MDS variables: night surfaces with grain, content in windows, and mint as the only accent.

```
index.html
css/mds/         MDS tokens and base styles (fonts, colours, type, spacing, effects)
css/style.css
js/
  main.js        app state, UI wiring, events
  image-io.js    file → canvas → float arrays, resizing, array → canvas
  height.js      greyscale, levels, invert, high-pass, blur
  normal.js      Sobel/Scharr, multi-scale detail, OpenGL/DirectX
  specular.js    specular (roughness = 1 − specular)
  pipeline.js    runs the stages, caching unchanged ones for the preview
  preview.js     three.js scene and light control
  export.js      PNG downloads and zip bundle
  samples.js     procedural sample textures
assets/favicon.svg
```

## Run locally

ES modules don't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

1. Create a public GitHub repo and push these files to `main`.
2. Go to **Settings → Pages → Source: Deploy from a branch**, then choose `main` and `/ (root)`.
3. After a minute or two, open `https://USERNAME.github.io/REPO/`. Every push to `main` redeploys.
4. Replace `USERNAME/REPO` in the Open Graph tags in `index.html`, and add a 1200×630 `assets/og-image.png`.

## Normal map conventions

| Format | Used by |
| --- | --- |
| OpenGL (Y+) | Blender, Unity, Godot, glTF, three.js |
| DirectX (Y−) | Unreal Engine, 3ds Max, CryEngine |

The 3D preview always shows the selected format correctly. If lighting looks inverted in your engine, switch the format. If bumps look like dents, use **Height → Invert**.

## Testing checklist

- [ ] Square, wide and tall images
- [ ] 4K+ images (export defaults to 4096px; full size is disabled above 8192px)
- [ ] PNG with transparency (transparent areas become flat) and heavily compressed JPEG
- [ ] Tileable texture with **Seamless edges** on: check with **Tile 2×2**
- [ ] Chrome, Firefox, mobile Safari
- [ ] Load the exported normal map in Blender to confirm the green channel

## Ideas for later

- ML depth estimation as an optional height source (transformers.js, lazy-loaded)
- Presets
- WebGL shader port or Web Worker if full-resolution export feels slow
