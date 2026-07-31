/**
 * Shrinks a photographed receipt before it is uploaded.
 *
 * A phone camera produces roughly 4032x3024 at 3-5 MB. All of that was being
 * sent up and then handed to the OCR model, over a restaurant's wifi, while a
 * table waited. The upload alone is most of the delay, and a larger image does
 * not make the model faster.
 *
 * A receipt is high-contrast black text on white, and the thing that decides
 * whether OCR can read it is how many pixels tall a character is — not the
 * megapixel count. 2000px on the long edge keeps line items comfortably legible
 * on a full-page receipt while cutting a 4 MB photo to roughly 300-500 KB.
 *
 * Deliberately conservative. Going to 1200px would be smaller again and starts
 * losing the small print near the totals, which is exactly the part that must
 * be right. If parse accuracy ever drops, raise MAX_EDGE before anything else.
 *
 * Returns the original file untouched on any failure. A slow upload is a bad
 * experience; a lost receipt is a broken one.
 */

const MAX_EDGE = 2000;
const QUALITY = 0.85;

/** Below this, re-encoding costs more time than it saves. */
const SKIP_BELOW_BYTES = 400 * 1024;

export async function compressImage(file) {
  if (!file || typeof document === 'undefined') return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));

    // Already small enough in dimensions — re-encoding would only lose detail.
    if (scale === 1 && file.type === 'image/jpeg') {
      close(bitmap);
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);

    const ctx = canvas.getContext('2d');
    // Receipts are fine text; the smoothing quality is visible in the output.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    close(bitmap);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    // HEIC in, JPEG out — rename so the extension is not a lie.
    const name = file.name.replace(/\.(hei[cf]|png|webp)$/i, '.jpg');
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
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
