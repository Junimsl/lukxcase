// Image utilities: exact fingerprint (SHA-256), perceptual fingerprint (dHash),
// and a JPEG copy for vision analysis. The original file is always kept untouched.

export async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function decode(source) {
  // source: Blob or URL string
  if (source instanceof Blob) {
    try { return await createImageBitmap(source); } catch { /* fall through to <img> */ }
    return loadImg(URL.createObjectURL(source), true);
  }
  return loadImg(source, false);
}

function loadImg(url, revoke) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => { if (revoke) URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (revoke) URL.revokeObjectURL(url); reject(new Error("Imagem não pôde ser lida.")); };
    img.src = url;
  });
}

export function dims(bitmap) {
  return { width: bitmap.width || bitmap.naturalWidth, height: bitmap.height || bitmap.naturalHeight };
}

/**
 * 256-bit difference hash of the ARTWORK, as a 64-char hex string.
 * Product photos share the same phone mockup on a plain background, so the hash first
 * finds the product's bounding box, skips the frame and camera area, and hashes only
 * the printed design. Re-encoded/resized copies differ by roughly 5–30 bits; different designs by 80+.
 */
export function dHash(bitmap) {
  const N = 16;
  const { width, height } = dims(bitmap);
  const scale = Math.min(1, 128 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), hgt = Math.max(1, Math.round(height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = hgt;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, hgt);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, hgt);
  const d = ctx.getImageData(0, 0, w, hgt).data;
  const bg = [d[0], d[1], d[2]];
  let x0 = w, y0 = hgt, x1 = -1, y1 = -1;
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 36) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = hgt - 1; }
  const bw = x1 - x0, bh = y1 - y0;
  const sx = x0 + bw * 0.1, sy = y0 + bh * 0.3, sw = Math.max(1, bw * 0.8), sh = Math.max(1, bh * 0.65);
  const s = document.createElement("canvas");
  s.width = N + 1; s.height = N;
  const sctx = s.getContext("2d", { willReadFrequently: true });
  sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = "high";
  sctx.drawImage(c, sx, sy, sw, sh, 0, 0, N + 1, N);
  const g = sctx.getImageData(0, 0, N + 1, N).data;
  const gray = (x, y) => { const i = (y * (N + 1) + x) * 4; return g[i] * 0.299 + g[i + 1] * 0.587 + g[i + 2] * 0.114; };
  let hex = "";
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x += 4) {
    let nib = 0;
    for (let k = 0; k < 4; k++) nib = (nib << 1) | (gray(x + k, y) < gray(x + k + 1, y) ? 1 : 0);
    hex += nib.toString(16);
  }
  return hex;
}

export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return a && a.length ? a.length * 4 : 256;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { n += x & 1; x >>= 1; }
  }
  return n;
}

/** JPEG copy (max side `max` px) — the vision service accepts JPEG/PNG/WebP/GIF, not AVIF. */
export function toJpeg(bitmap, max = 1024, quality = 0.9) {
  const { width, height } = dims(bitmap);
  const scale = Math.min(1, max / Math.max(width, height));
  const c = document.createElement("canvas");
  c.width = Math.round(width * scale); c.height = Math.round(height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao preparar a imagem."))), "image/jpeg", quality));
}

export function extensionFor(file) {
  const fromName = (file.name || "").split(".").pop().toLowerCase();
  const allowed = ["avif", "webp", "png", "jpg", "jpeg", "gif"];
  if (allowed.includes(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  const map = { "image/avif": "avif", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };
  return map[file.type] || null;
}
