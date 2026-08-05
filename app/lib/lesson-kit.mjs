// Shared lesson primitives (ES module, client-side). Pure + DOM-free at import
// time so it can be unit-tested in Node and imported by every lesson module.

// The hero Webo SVG, reused by the world, chat, reward, and the speech bubble.
export const WEBO_SVG = `<svg viewBox="0 0 140 170">
      <line x1="70" y1="14" x2="70" y2="30" stroke="#e08e0b" stroke-width="4"/>
      <circle cx="70" cy="9" r="6" fill="#ffb938"/>
      <rect x="38" y="28" width="64" height="54" rx="18" fill="#f5a623"/>
      <rect x="46" y="36" width="48" height="38" rx="13" fill="#14263f"/>
      <circle class="eye" cx="60" cy="55" r="6.5" fill="#4fd1c5"/>
      <circle class="eye" cx="80" cy="55" r="6.5" fill="#4fd1c5"/>
      <circle cx="62" cy="53" r="2" fill="#eaf2ff"/><circle cx="82" cy="53" r="2" fill="#eaf2ff"/>
      <path d="M62 66 Q70 72 78 66" stroke="#4fd1c5" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <rect x="32" y="46" width="8" height="18" rx="4" fill="#e08e0b"/>
      <rect x="100" y="46" width="8" height="18" rx="4" fill="#e08e0b"/>
      <rect x="44" y="84" width="52" height="50" rx="16" fill="#f5a623"/>
      <rect x="52" y="92" width="36" height="34" rx="11" fill="#f5e6c8"/>
      <rect x="28" y="90" width="12" height="34" rx="6" fill="#e08e0b"/>
      <rect x="100" y="90" width="12" height="34" rx="6" fill="#e08e0b"/>
      <rect x="54" y="132" width="13" height="26" rx="6" fill="#e08e0b"/>
      <rect x="73" y="132" width="13" height="26" rx="6" fill="#e08e0b"/>
    </svg>`;

// ---------- Art assets (the swap-in point for kid-centric graphics) ----------
// The app ships with placeholder inline SVG. To replace it with real art (PNG /
// illustration / SVG file), drop the files under /assets and set the paths here
// (character) or per lesson via `prop.img` (world props) - NO logic changes needed.
// See assets/README.md for the asset contract. Until a path is set, the SVG renders.
export const WEBO_ART = '/assets/webo.png'; // transparent, ~square

// Markup for the Webo character: an <img> if WEBO_ART is set, else the inline SVG.
// Used by the hero, chat avatar, reward, and speech bubble, so one swap updates all.
export function weboHtml() {
  return WEBO_ART ? `<img src="${WEBO_ART}" alt="Webo" class="webo-art">` : WEBO_SVG;
}

// Markup for a lesson's world prop: an <img> if the lesson set prop.img, else its SVG
// (prop.html). Optional prop.size sets the image width (defaults via CSS .prop-img).
export function propArt(prop) {
  if (prop && prop.img) {
    const sz = prop.size ? ` style="width:${prop.size}"` : '';
    return `<img src="${prop.img}" alt="" class="prop-img"${sz}>`;
  }
  return prop ? prop.html : '';
}

// A Webo speech bubble (used at the top of most lesson steps).
export function speech(text) {
  return `<div class="speech"><div class="mini-webo">${weboHtml()}</div><div class="bubble">${text}</div></div>`;
}

// HTML-escape untrusted text before injecting it into the chat log.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Merge a restored progress blob into the live lessons array. Never DOWNGRADES:
// a star earned on this device is kept even if the blob does not have it (OR the
// completed flags). Mutates + returns `lessons`. Pure (no DOM/storage) -> testable.
export function mergeProgress(lessons, blob) {
  if (!blob || !Array.isArray(blob.lessons)) return lessons;
  blob.lessons.forEach((sl) => {
    const l = lessons.find((x) => x.id === sl.id);
    if (l && sl.completed) l.completed = true;
  });
  return lessons;
}

// True when the user asked for reduced motion. Guarded so importing this module
// never touches `window` (only the call does, at runtime in the browser).
export function prefersReducedMotion() {
  return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
