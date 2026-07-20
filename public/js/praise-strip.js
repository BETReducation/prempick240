// Site-wide praise strip — sits directly under the nav on every page and shows
// what this week's winners would share. Self-mounting: just include the script.

(function () {
  function fmt(n) { return Number(Math.round(Number(n) * 10) / 10).toLocaleString('en-GB'); }

  function mount(p) {
    const strip = document.createElement('div');
    strip.className = 'praise-strip';
    strip.innerHTML = `
      <a class="praise-strip-inner" href="ranking.html" title="See the full praise ledger">
        <span class="praise-strip-item primary">
          <i class="fa-solid fa-trophy"></i>
          <strong>${fmt(p.currentPot)}</strong>
          <span class="praise-strip-label">praise to claim this week</span>
        </span>
        <span class="praise-strip-item">
          <strong>${fmt(p.remaining)}</strong>
          <span class="praise-strip-label">left in the pot</span>
        </span>
        <span class="praise-strip-item">
          <strong>${fmt(p.claimed)}</strong>
          <span class="praise-strip-label">won so far</span>
        </span>
      </a>`;

    const nav = document.querySelector('nav.site-nav');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(strip, nav.nextSibling);
    else document.body.insertBefore(strip, document.body.firstChild);
  }

  // A failure here must never take a page down — the strip is decoration.
  document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/praise')
      .then(r => r.ok ? r.json() : null)
      .then(p => { if (p && p.playerCount) mount(p); })
      .catch(() => {});
  });
})();
