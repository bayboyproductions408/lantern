// Renders a verse as a square image and hands it to the share sheet.
//
// This exists for growth as much as for delight: in an ad-supported app with no
// paid tier, installs are the revenue, and a verse card someone posts is the
// cheapest install there is.

const SIZE = 1080;
const MARGIN = 110;

const THEME = {
  bg: '#14110f',
  glow: '#3a2b12',
  text: '#f3ede4',
  accent: '#e0a437',
  muted: '#a4988a',
};

/** Breaks text into lines that fit `maxWidth` at the current font. */
function wrap(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Picks the largest font size at which the verse still fits the card.
 * Long verses shrink rather than overflow or get truncated.
 */
function fit(ctx, text, maxWidth, maxHeight) {
  for (let size = 62; size >= 26; size -= 2) {
    ctx.font = `${size}px "Iowan Old Style", Palatino, Georgia, serif`;
    const lines = wrap(ctx, text, maxWidth);
    const lineHeight = size * 1.42;
    if (lines.length * lineHeight <= maxHeight) return { size, lines, lineHeight };
  }
  ctx.font = '26px "Iowan Old Style", Palatino, Georgia, serif';
  const lines = wrap(ctx, text, maxWidth).slice(0, 14);
  return { size: 26, lines, lineHeight: 26 * 1.42 };
}

export function renderCard(verseText, reference) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // A soft lamp-glow from the upper left, echoing the app's icon.
  const glow = ctx.createRadialGradient(SIZE * 0.3, SIZE * 0.22, 20, SIZE * 0.3, SIZE * 0.22, SIZE * 0.85);
  glow.addColorStop(0, THEME.glow);
  glow.addColorStop(1, THEME.bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const maxWidth = SIZE - MARGIN * 2;
  const { lines, lineHeight } = fit(ctx, `“${verseText}”`, maxWidth, SIZE - MARGIN * 2 - 190);

  ctx.fillStyle = THEME.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const blockHeight = lines.length * lineHeight;
  let y = (SIZE - blockHeight) / 2 - 30;
  for (const line of lines) {
    ctx.fillText(line, SIZE / 2, y);
    y += lineHeight;
  }

  // Reference, under a short rule.
  const ruleY = y + 18;
  ctx.strokeStyle = THEME.accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(SIZE / 2 - 46, ruleY);
  ctx.lineTo(SIZE / 2 + 46, ruleY);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = THEME.accent;
  ctx.font = '600 34px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(reference, SIZE / 2, ruleY + 46);

  ctx.fillStyle = THEME.muted;
  ctx.font = '500 24px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Lantern · the Bible, read aloud', SIZE / 2, SIZE - 64);

  return canvas;
}

function toBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Shares a verse card. Falls back through the share sheet, then a download,
 * then copying the text — so it does something useful on every browser.
 *
 * Returns how it was handled, for the confirmation message.
 */
export async function shareVerse(verseText, reference) {
  const canvas = renderCard(verseText, reference);
  const blob = await toBlob(canvas);
  const fileName = `${reference.replace(/[^\w]+/g, '-').toLowerCase()}.png`;

  if (blob && navigator.canShare) {
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: `${verseText} — ${reference}` });
        return 'shared';
      } catch (err) {
        if (err.name === 'AbortError') return 'cancelled';
      }
    }
  }

  if (blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'downloaded';
  }

  await navigator.clipboard.writeText(`${verseText} — ${reference}`);
  return 'copied';
}
