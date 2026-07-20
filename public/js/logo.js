// Logo generator. Draws straight onto a canvas rather than rasterising an SVG,
// so the Outfit webfont is guaranteed to be the one that renders — a standalone
// SVG would fall back to a system font on whoever opens it.

const GREEN = '#4dc97a';   // the dark-theme accent; reads brightly on black
const MUTED = '#6b7a99';

// Draw centred text, shrinking the face until it fits maxWidth. Letter-spaced
// strapline text is easy to overflow at one size and not another, and a logo
// that clips at 512px but not 1024px is worse than one that's slightly smaller.
function fitText(ctx, text, cx, cy, maxWidth, startPx, weight, family, spacing) {
  let px = startPx;
  for (let i = 0; i < 40; i++) {
    ctx.font = `${weight} ${px}px ${family}`;
    ctx.letterSpacing = `${spacing * (px / startPx)}px`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px *= 0.96;
  }
  ctx.fillText(text, cx, cy);
  ctx.letterSpacing = '0px';
}

// Each variant draws itself at an arbitrary size, so one routine serves both
// the on-screen preview and the full-resolution download.
const VARIANTS = {
  square: {
    label: 'Square',
    note: 'Profile pictures, avatars',
    ratio: 1,
    draw(ctx, w, h, bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = GREEN;
      fitText(ctx, 'PP240', w / 2, h * 0.46, w * 0.82,
              w * 0.30, 900, 'Outfit, system-ui, sans-serif', 0);

      ctx.fillStyle = MUTED;
      fitText(ctx, 'PREDICTION LEAGUE', w / 2, h * 0.66, w * 0.80,
              w * 0.058, 600, "'Space Grotesk', system-ui, sans-serif", w * 0.012);

      // Underline echoing the accent bar used across the site
      ctx.fillStyle = GREEN;
      ctx.fillRect(w * 0.38, h * 0.735, w * 0.24, Math.max(2, w * 0.011));
    }
  },

  stacked: {
    label: 'Square · stacked',
    note: 'Bolder at small sizes',
    ratio: 1,
    draw(ctx, w, h, bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = GREEN;
      ctx.font = `900 ${w * 0.40}px Outfit, system-ui, sans-serif`;
      ctx.fillText('PP', w / 2, h * 0.37);
      ctx.fillText('240', w / 2, h * 0.68);
    }
  },

  banner: {
    label: 'Banner',
    note: 'Headers, link previews',
    ratio: 1200 / 630,
    draw(ctx, w, h, bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = GREEN;
      fitText(ctx, 'PP240', w / 2, h * 0.44, w * 0.62,
              h * 0.30, 900, 'Outfit, system-ui, sans-serif', 0);

      ctx.fillStyle = MUTED;
      fitText(ctx, 'PREMIER LEAGUE & CHAMPIONSHIP', w / 2, h * 0.66, w * 0.72,
              h * 0.062, 600, "'Space Grotesk', system-ui, sans-serif", h * 0.014);

      ctx.fillStyle = GREEN;
      ctx.fillRect(w * 0.42, h * 0.76, w * 0.16, Math.max(2, h * 0.012));
    }
  }
};

function render(canvas, key, size, bg) {
  // `size` is the longest edge, so the chosen number is the one that matters
  // for an upload limit. The banner keeps a 1.91:1 ratio — the shape Twitter,
  // Facebook and WhatsApp use for link previews.
  const v = VARIANTS[key];
  const w = Math.round(v.ratio >= 1 ? size : size * v.ratio);
  const h = Math.round(v.ratio >= 1 ? size / v.ratio : size);
  canvas.width = w;
  canvas.height = h;
  v.draw(canvas.getContext('2d'), w, h, bg);
  return canvas;
}

function download(key) {
  const size = parseInt(document.getElementById('logoSize').value);
  const bg   = document.getElementById('logoBg').value;
  const off  = render(document.createElement('canvas'), key, size, bg);
  off.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prempick240-${key}-${off.width}x${off.height}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}

function build() {
  const grid = document.getElementById('logoGrid');
  grid.innerHTML = Object.entries(VARIANTS).map(([key, v]) => `
    <div class="logo-card">
      <canvas id="cv-${key}"></canvas>
      <div class="logo-card-foot">
        <div>
          <span class="logo-card-name">${v.label}</span>
          <span class="logo-card-note">${v.note}</span>
        </div>
        <button class="btn btn-primary btn-sm" data-logo="${key}">Download PNG</button>
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-logo]').forEach(b =>
    b.addEventListener('click', () => download(b.dataset.logo)));

  redraw();
}

function redraw() {
  const bg = document.getElementById('logoBg').value;
  // Preview at 2x for a crisp result on retina screens.
  Object.keys(VARIANTS).forEach(key =>
    render(document.getElementById('cv-' + key), key, 600, bg));
}

// Wait for Outfit to load, or the first paint uses a fallback face.
document.addEventListener('DOMContentLoaded', () => {
  build();
  document.getElementById('logoBg').addEventListener('change', redraw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
});
