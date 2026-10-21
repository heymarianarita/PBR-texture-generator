// PNG downloads and the zip bundle. fflate is loaded only when a zip is made.

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadPng(canvas, filename) {
  downloadBlob(await canvasToBlob(canvas), filename);
}

// Build a zip Blob from { filename: canvas }, plus optional { filename: text }.
export async function makeZip(files, texts = {}) {
  const { zipSync, strToU8 } = await import('fflate');
  const entries = {};
  for (const [name, text] of Object.entries(texts)) entries[name] = strToU8(text);
  for (const [name, canvas] of Object.entries(files)) {
    const bytes = new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer());
    entries[name] = [bytes, { level: 0 }]; // PNGs are already compressed
  }
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

export async function downloadZip(files, zipName, texts) {
  downloadBlob(await makeZip(files, texts), zipName);
}

// A glTF 2.0 file with one textured quad (width / height = aspect) whose
// material uses the given images: { basecolor, normal, orm } file names.
// The ORM image feeds both occlusion (R) and metallic-roughness (G, B).
export function makeGltf(name, images, aspect) {
  const x = aspect / 2;
  const data = new ArrayBuffer(140);
  new Float32Array(data, 0, 12).set([-x, -0.5, 0, x, -0.5, 0, x, 0.5, 0, -x, 0.5, 0]);
  new Float32Array(data, 48, 12).set([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Float32Array(data, 96, 8).set([0, 1, 1, 1, 1, 0, 0, 0]);
  new Uint16Array(data, 128, 6).set([0, 1, 2, 0, 2, 3]);
  const bytes = new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);

  const FLOAT = 5126, USHORT = 5123, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
  const gltf = {
    asset: { version: '2.0', generator: 'PBR Texture Generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{
      name,
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicRoughnessTexture: { index: 2 },
        metallicFactor: 1,
        roughnessFactor: 1,
      },
      normalTexture: { index: 1 },
      occlusionTexture: { index: 2 },
    }],
    textures: [{ source: 0, sampler: 0 }, { source: 1, sampler: 0 }, { source: 2, sampler: 0 }],
    images: [{ uri: images.basecolor }, { uri: images.normal }, { uri: images.orm }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: 4, type: 'VEC3', min: [-x, -0.5, 0], max: [x, 0.5, 0] },
      { bufferView: 1, componentType: FLOAT, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: FLOAT, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: USHORT, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: 48, byteLength: 48, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: 96, byteLength: 32, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: 128, byteLength: 12, target: ELEMENT_ARRAY_BUFFER },
    ],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${btoa(bin)}` }],
  };
  return JSON.stringify(gltf, null, 2);
}
