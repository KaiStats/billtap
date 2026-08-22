/**
 * The split, as a picture somebody would actually post.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * `navigator.share({ title, text })`. Text. A blob of characters that gets
 * pasted into iMessage and scrolled past, and on the host screen it was being
 * offered underneath a summary card that was already designed, already
 * branded, and already on screen — the picture existed and was thrown away at
 * the moment of sharing.
 *
 * `navigator.share` takes `files`, and iOS Safari and Android Chrome — the two
 * browsers that matter at a dinner table — both support it. So the card is
 * drawn to a canvas and shared as a PNG.
 *
 * ── Why no dependency ───────────────────────────────────────────────────────
 *
 * html-to-image and html2canvas both do this by reimplementing CSS layout, and
 * both are large. This card is six lines of text on a rectangle: the 2D canvas
 * API draws it in a hundred lines with nothing to install, nothing to keep up
 * to date, and no npm install script running in CI. worker/.github/workflows
 * already argues about supply chain for exactly this reason.
 *
 * ── The split here is deliberate ────────────────────────────────────────────
 *
 * `shareCardLines` is pure and is where every decision about what the card
 * *says* lives, so it can be tested. `drawShareCard` is the canvas, which is
 * pixels and cannot be meaningfully asserted about in node. Getting the words
 * wrong is the failure that matters — a card claiming a saving nobody made is
 * worse than an ugly one.
 */

/** Card geometry. Square, because that is what posts to a story or a feed. */
export const CARD = { w: 1080, h: 1080 };

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/**
 * What the card says, decided once and testable.
 *
 * @param {{ title?: any, people?: any, total?: any, minutes?: any, fairness?: any }} [input]
 * @returns {{ brand: string, title: string, headline: string, sub: string, stats: {label: string, value: string}[] }}
 */
export function shareCardLines({ title, people, total, minutes, fairness } = {}) {
  const stats = [];
  if (Number(people) > 0) stats.push({ label: 'People', value: String(people) });
  if (Number(total) > 0) stats.push({ label: 'Total', value: money(total) });
  if (Number(minutes) > 0) stats.push({ label: 'Settled in', value: `${minutes} min` });

  /**
   * The headline is the saving when there is one, and the total when there is
   * not.
   *
   * Never a saving of zero dressed up as one: a table where everybody ordered
   * the same thing was split correctly by an even split too, and claiming
   * otherwise is the one lie this card could tell. See src/lib/fairness.js.
   */
  const saved = Number(fairness?.moved ?? fairness?.saved);
  const hasSaving = Number.isFinite(saved) && saved > 0;

  return {
    brand: 'BillTap',
    title: String(title || 'Dinner').slice(0, 40),
    headline: hasSaving ? `${money(saved)} back where it belonged` : 'Everyone paid their own way',
    sub: hasSaving
      ? 'Nobody paid for somebody else’s cocktails.'
      : 'Split by what each person actually ordered.',
    stats,
  };
}

/**
 * Draws the card and hands back a PNG.
 *
 * Browser only — there is no canvas in node, and the caller is a click
 * handler. Returns null rather than throwing when the browser will not give
 * us a blob, because a share that quietly falls back to text is a much better
 * outcome than an exception inside a tap handler.
 *
 * @param {{ brand: string, title: string, headline: string, sub: string, stats: {label: string, value: string}[] }} lines
 * @returns {Promise<Blob|null>}
 */
export async function drawShareCard(lines) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = CARD.w;
    canvas.height = CARD.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Ground. The same midnight navy the product is drawn in, so a card in
    // somebody's feed reads as the same thing they used at the table.
    const bg = ctx.createLinearGradient(0, 0, 0, CARD.h);
    bg.addColorStop(0, '#070b16');
    bg.addColorStop(1, '#0d1728');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD.w, CARD.h);

    // One teal aurora, matching the landing page's own direction note.
    const glow = ctx.createRadialGradient(CARD.w * 0.75, CARD.h * 0.2, 0, CARD.w * 0.75, CARD.h * 0.2, CARD.w * 0.7);
    glow.addColorStop(0, 'rgba(0,200,150,0.18)');
    glow.addColorStop(1, 'rgba(0,200,150,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CARD.w, CARD.h);

    ctx.textAlign = 'center';

    // Brand
    ctx.fillStyle = '#f0b429';
    ctx.font = '600 34px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(lines.brand.toUpperCase(), CARD.w / 2, 130);

    // Where
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '500 40px ui-sans-serif, system-ui, -apple-system, sans-serif';
    ctx.fillText(lines.title, CARD.w / 2, 220);

    // The headline — the reason anyone would post this.
    ctx.fillStyle = '#00c896';
    ctx.font = '800 84px ui-sans-serif, system-ui, -apple-system, sans-serif';
    wrap(ctx, lines.headline, CARD.w / 2, 400, CARD.w - 140, 96);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '400 36px ui-sans-serif, system-ui, -apple-system, sans-serif';
    wrap(ctx, lines.sub, CARD.w / 2, 580, CARD.w - 180, 48);

    // Stats row
    const n = lines.stats.length;
    if (n) {
      const boxW = 260;
      const gap = 28;
      const totalW = n * boxW + (n - 1) * gap;
      let x = (CARD.w - totalW) / 2;
      const y = 720;
      for (const stat of lines.stats) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, x, y, boxW, 160, 24);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 52px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(stat.value, x + boxW / 2, y + 82);

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '500 26px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(stat.label, x + boxW / 2, y + 126);

        x += boxW + gap;
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '500 32px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('billtap.app', CARD.w / 2, CARD.h - 80);

    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    // A card that could not be drawn falls back to text, which is what the
    // caller does with a null.
    return null;
  }
}

/** Centred word wrap, because a long restaurant name must not run off the card. */
function wrap(ctx, text, cx, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  let cursor = y;
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (ctx.measureText(attempt).width > maxWidth && line) {
      ctx.fillText(line, cx, cursor);
      line = word;
      cursor += lineHeight;
    } else {
      line = attempt;
    }
  }
  if (line) ctx.fillText(line, cx, cursor);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Shares the picture, and degrades all the way down rather than failing.
 *
 * Three rungs: the image, then text through the share sheet, then the
 * clipboard. A tap that appears to do nothing is the worst outcome available
 * here, so every rung is tried before giving up.
 *
 * An AbortError means the person opened the share sheet and closed it. That is
 * not a failure and must not fall through to copying something to their
 * clipboard behind their back.
 *
 * @param {{ blob?: Blob|null, text: string, url?: string }} input
 * @returns {Promise<'image'|'text'|'copied'|'cancelled'|'failed'>}
 */
export async function shareCardImage({ blob, text, url = 'https://billtap.app' }) {
  const withUrl = url ? `${text} ${url}` : text;

  try {
    if (blob && typeof File === 'function' && navigator.canShare) {
      const file = new File([blob], 'billtap-split.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text });
        return 'image';
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    // Fall through and try text.
  }

  try {
    if (navigator.share) {
      await navigator.share({ title: 'BillTap', text: withUrl });
      return 'text';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
  }

  try {
    await navigator.clipboard.writeText(withUrl);
    return 'copied';
  } catch {
    return 'failed';
  }
}
