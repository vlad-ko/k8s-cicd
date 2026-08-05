# Art assets

Drop kid-centric art here to replace the placeholder inline SVG. Nothing in this
folder is required to run the app - until an asset path is set, the app renders its
built-in SVG. Swapping art needs **no logic changes**; you only set paths.

## The Webo character

One swap point updates the hero, chat avatar, reward screen, and every speech bubble.

1. Add the file, e.g. `assets/webo.png` (transparent background, roughly square; PNG
   or SVG; export ~2x for retina, e.g. 240x240).
2. In `lib/lesson-kit.mjs` set:
   ```js
   export const WEBO_ART = '/assets/webo.png';
   ```

The image fills its container (`.webo-art { width: 100%; height: auto }`), so it scales
to each spot automatically. To keep the SVG, leave `WEBO_ART = null`.

## World props (the things that pop into Webo's World per lesson)

Each lesson module (`lessons/<id>.mjs`) owns its prop. To use art instead of the SVG,
set `prop.img` (and optionally `prop.size`):

```js
prop: {
  pos: { left: '6%', bottom: '104px' }, // or cls: 'prop-jars' - placement (unchanged)
  img: '/assets/props/safe.png',        // transparent PNG/SVG; preferred over html
  size: '60px',                         // optional display width (default 56px)
  html: `<svg>...</svg>`,               // kept as the fallback if img is unset
}
```

Suggested file naming: `assets/props/<lesson-id>.png` (`jars`, `penny`, `seeds`,
`needs`, `goal`, `earn`, `giving`, `safe`, ...). Transparent background; size to taste
(props are small, ~50-80px on screen).

## Stage art (inside a lesson)

Lesson stages mostly use emoji (already kid-friendly) plus shared CSS. To restyle them
globally, edit `styles.css`; emoji can be swapped for `<img>` inside a lesson's
`run(ctx)` markup if a richer look is wanted later.

## Recommendations

- Transparent backgrounds (PNG-24 or SVG) so props sit naturally in the scene.
- Consistent, warm, rounded, friendly style across the set.
- Keep files small (these are tiny on screen); compress PNGs.
- Provide @2x where it matters; the CSS sizes by width so source can be larger.
