# PBR Texture Generator

Turn a photo into PBR texture maps, right in the browser: normal, specular, height and ORM (occlusion, roughness, metallic), alongside your source photo. Nothing is uploaded: all processing happens on your device.

<!-- Add screenshots here once deployed, e.g. ![Screenshot](assets/screenshot.png) -->

## How to use it

1. Drop an image, click to upload, or paste one. A brick texture is shown until you do.
2. Click a map tile to see that map and its essential settings. Everything else is under **Advanced**, which starts collapsed.
   - **Source:** your photo, used as the base colour. No settings.
   - **Normal:** large, medium and fine details. Advanced: strength, invert, OpenGL or DirectX.
   - **Specular:** roughness. Advanced: contrast, invert. Specular is the inverse of the ORM roughness, so they share these settings.
   - **Height:** contrast, smooth. Advanced: even out lighting, invert.
   - **ORM:** occlusion, roughness, metallic. Advanced: occlusion spread, roughness contrast, invert roughness. Red is occlusion, green is roughness, blue is metallic.
3. Check the result in the **3D** preview (plane or sphere, with 2×2 tiling to spot seams), or switch to **Flat** to see the selected map.
   - The light stays still. On the plane, drag to move the light. On the sphere, drag to rotate it.
   - Scroll or pinch to zoom. Double-click to reset.
4. Pick a size (512, 1K, 2K or 4K) and download the selected map, all maps as a `.zip`, or a Second Life material.

Turn on **Seamless** for tiling textures so the filters wrap around the edges. The interface uses MDS (Mariana's Design System): light by default, dark when your system is, and a Light / Dark / System switch in the header.

## How it works

Plain HTML, CSS and ES modules. There's no build step. three.js and fflate load from jsDelivr through an import map with pinned versions.

Filters run on the CPU over `Float32Array`s. While you adjust settings, the image is processed at 1024px on the long edge. On download it re-runs at the chosen size, upscaling if the photo is smaller. Radii and strength scale with resolution, so the download matches the preview.

The 3D preview is a glTF-style material: base colour, normal, and an ORM texture (R occlusion, G roughness, B metallic).

```
index.html
css/style.css    app styles on MDS tokens, light and dark
css/mds/         MDS v3 tokens: colours, type, spacing, effects, base
js/
  main.js        app state, map tiles, settings, downloads
  image-io.js    file → canvas → float arrays, resizing, array → canvas
  height.js      greyscale, levels, invert, high-pass, blur
  normal.js      Sobel/Scharr, multi-scale detail, OpenGL/DirectX
  specular.js    roughness from brightness (specular = 1 − roughness)
  orm.js         ambient occlusion and ORM packing
  pipeline.js    runs the stages, caching unchanged ones for the preview
  preview.js     three.js scene, draggable light, zoom
  export.js      PNG downloads, zip bundle and .gltf material
  samples.js     procedural brick texture shown on first load
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

The 3D preview always shows the selected format correctly. If lighting looks inverted in your engine, switch the format. If bumps look like dents, use **Normal → Invert bumps**.

## Using in Second Life / Firestorm

Second Life PBR materials follow glTF. They need a base colour, an OpenGL normal map and an ORM texture (R occlusion, G roughness, B metallic). Each texture must be a power of two on each side and at most 2048px.

1. Tune the maps. Set **Metallic** to 0 for most materials, or 1 for bare metal. The 3D preview already shows the material the way Second Life will build it.
2. Under **Download**, choose **Second Life material (.zip)**. The zip holds:
   - `name_basecolor.png`
   - `name_normal_gl.png` (always OpenGL, whatever the Format setting)
   - `name_orm.png`
   - `name.gltf`, a single quad whose material uses the three PNGs

   It uses the chosen size, capped at 2048px, with each side rounded to the nearest power of two, so a 1500×700 photo at 2K becomes 2048×512. The maps are made at the photo's own proportions and then stretched, so they line up once mapped back onto a face.
3. Unzip it. In Firestorm, either upload the `.gltf` as a material (keep the PNGs next to it), or create a new material in your inventory and upload the three PNGs into its base colour, normal and ORM slots. Texture uploads cost L$.

## Testing checklist

- [ ] Square, wide and tall images
- [ ] Small and 4K+ images at each download size
- [ ] PNG with transparency (transparent areas become flat) and heavily compressed JPEG
- [ ] Tileable texture with **Seamless** on: check with **Tile 2×2**
- [ ] Chrome, Firefox, mobile Safari
- [ ] Load the exported normal map in Blender to confirm the green channel
- [ ] Upload the Second Life export in Firestorm and compare it with the 3D preview

## Ideas for later

- ML depth estimation as an optional height source (transformers.js, lazy-loaded)
- Presets
- WebGL shader port or Web Worker if full-resolution export feels slow
