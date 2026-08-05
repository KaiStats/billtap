/**
 * Shrinks a photographed receipt before it is uploaded.
 *
 * A phone camera produces roughly 4032x3024 at 3-5 MB. All of that was being
 * sent up and then handed to the OCR model, over a restaurant's wifi, while a
 * table waited. The upload is the dominant term in the whole scan, and a larger
 * image does not make the model faster.
 *
 * A receipt is high-contrast black text on white, and the thing that decides
 * whether OCR can read it is how many pixels tall a character is — not the
 * megapixel count. 2000px on the long edge keeps line items comfortably legible
 * on a full-page receipt while cutting a 4 MB photo to roughly 300-500 KB.
 *
 * Deliberately conservative on dimensions. Going to 1200px would be smaller
 * again and starts losing the small print near the totals, which is exactly the
 * part that must be right. If parse accuracy ever drops, raise MAX_EDGE before
 * anything else.
 *
 * ── WebP ────────────────────────────────────────────────────────────────────
 *
 * The bytes come down again by encoding WebP instead of JPEG — typically a
 * quarter to a third smaller at the same visual quality, and on a restaurant's
 * wifi bytes are seconds. Probed at runtime rather than assumed, because
 * canvas.toBlob silently falls back to PNG when it does not recognise the type,
 * and a PNG of a photograph is enormous.
 *
 * ── Slow connections ────────────────────────────────────────────────────────
 *
 * On a connection the browser reports as 2g or 3g the trade shifts: another
 * 200 KB costs more seconds than the extra detail is worth. Those get a smaller
 * edge and a lower quality. A receipt still reads at 1600px.
 *
 * Returns the original file untouched on any failure. A slow upload is a bad
 * experience; a lost receipt is a broken one.
 */

const MAX_EDGE = 2000;
const QUALITY = 0.82;

/** What a connection the browser calls slow gets instead. */
const SLOW_MAX_EDGE = 1600;
const SLOW_QUALITY = 0.72;

/** Below this, re-encoding costs more time than it saves. */
const SKIP_BELOW_BYTES = 400 * 1024;

/** Cached, because the probe allocates a canvas. */
let webpSupport = null;

/**
 * Does canvas.toBlob actually produce WebP here?
 *
 * Asking for an unsupported type does not throw — it quietly returns PNG, and a
 * PNG of a photograph can be larger than the JPEG we were trying to beat. So
 * the probe checks what came back rather than what was asked for.
 */
async function supportsWebp() {
  if (webpSupport !== null) return webpSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
    webpSupport = blob?.type === 'image/webp';
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/** The browser's own view of the connection, where it has one. */
function onSlowConnection() {
  const effective = typeof navigator !== 'undefined' && navigator.connection?.effectiveType;
  return effective === 'slow-2g' || effective === '2g' || effective === '3g';
}

/**
 * @returns the file to upload, carrying `__compression` describing what
 *          happened. src/lib/scanTiming.js reports it — guessing at which phase
 *          of a scan is slow is how it stayed slow.
 */
export async function compressImage(file) {
  if (!file || typeof document === 'undefined') return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  const started = Date.now();
  const slow = onSlowConnection();
  const maxEdge = slow ? SLOW_MAX_EDGE : MAX_EDGE;
  const quality = slow ? SLOW_QUALITY : QUALITY;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxEdge / Math.max(width, height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const ctx = canvas.getContext('2d');
    // Receipts are fine text; the smoothing quality is visible in the output.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    close(bitmap);

    const type = (await supportsWebp()) ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));

    // Bigger than what we started with means the encode was a waste — an
    // already-optimised image, or a fallback that produced PNG.
    if (!blob || blob.size >= file.size) return file;

    const extension = type === 'image/webp' ? '.webp' : '.jpg';
    const name = `${file.name.replace(/\.(jpe?g|hei[cf]|png|webp)$/i, '')}${extension}`;
    const out = new File([blob], name, { type, lastModified: Date.now() });

    /** @type {any} */ (out).__compression = {
      ms: Date.now() - started,
      from_bytes: file.size,
      to_bytes: blob.size,
      saved_pct: Math.round((1 - blob.size / file.size) * 100),
      max_edge: maxEdge,
      type,
      slow_connection: slow,
    };
    return out;
  } catch {
    // Includes the HEIC case on browsers that cannot decode it. Upload as-is.
    return file;
  }
}

/**
 * createImageBitmap where available — it decodes off the main thread, so the
 * UI does not freeze on a large photo. Falls back to an <img>, which is what
 * older Safari needs.
 */
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function close(bitmap) {
  if (typeof bitmap.close === 'function') bitmap.close();
}
