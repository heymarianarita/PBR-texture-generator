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

// Build a zip Blob from { filename: canvas }.
export async function makeZip(files) {
  const { zipSync } = await import('fflate');
  const entries = {};
  for (const [name, canvas] of Object.entries(files)) {
    const bytes = new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer());
    entries[name] = [bytes, { level: 0 }]; // PNGs are already compressed
  }
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

export async function downloadZip(files, zipName) {
  downloadBlob(await makeZip(files), zipName);
}
