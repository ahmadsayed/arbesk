# Arbesk Landing Page Modernization — Design Spec

## Status
Approved for implementation.

## Goal
Modernize `frontend/src/pug/index.pug` with a bold editorial look and smooth transitions between sections, while staying visually connected to the Arbesk Studio/Library Arabesque wood theme.

## Constraints
- No new runtime dependencies.
- Keep changes scoped to the landing page template and inline styles.
- Respect `prefers-reduced-motion`.
- Preserve existing landing-page layout overrides that prevent `#app { height: 100vh }` clipping.

## Visual Direction

### Typography
- Hero headline: `clamp(3.5rem, 10vw, 7rem)`, weight 800, line-height `0.95`, negative tracking `-0.04em`.
- Section headlines: `clamp(2.2rem, 5vw, 3.8rem)`, weight 700.
- Body: `1.15rem`, max line-length `38ch`.
- Pull quote: `clamp(2.5rem, 7vw, 5rem)`, weight 800, centered.

### Layout
- Hero: centered, full viewport height (`min-height: 100vh`).
- Feature sections: asymmetric two-column splits (~55/45 or 60/40), alternating text/visual sides.
- Each feature section places its visual inside a rounded contrast card (`--choco-2`) with a subtle shadow.
- Section separators use diagonal `clip-path` polygons on alternating sections to create a slanted scroll rhythm.
- Pull quote and Time section use full-bleed dark bands (`--choco-12`) with gold/white text.

### Section Plan
1. **Hero** — large centered headline, narrow subtitle, single pill CTA with arrow hover animation.
2. **We build in 3D** — text left, axes/cube visual inside contrast card right.
3. **Objects have memory** — ghost-cube visual left, text right.
4. **Time is a dimension** — full-bleed dark band with gold timeline and overlaid text.
5. **Pull quote** — full-bleed dark band, gold headline, white supporting text.
6. **Each asset is its own micro-ledger** — text left, manifest chain inside contrast card right.
7. **Built for teams** — folder/avatars visual left, text right.
8. **Footer** — dark band with diagonal top edge, large CTA, Library/Studio links.

### Color & Contrast
- Base sections: `--landing-bg` background, `--landing-fg` text.
- Contrast cards: `--landing-card` (`--choco-2`) with soft shadow.
- Dark bands: `--choco-12` background, `--gold` headline, `--choco-1` body text.
- CTAs: `--gold` background, white text.

### Transitions & Motion
- Scroll-triggered reveal via `IntersectionObserver`.
- Initial state: `opacity: 0; transform: translateY(60px) scale(0.98)`.
- Final state: `opacity: 1; transform: none`.
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` over `0.8s`.
- Stagger within a section: headline `0s`, body `0.1s`, visual `0.2s`.
- Hero animates on page load, not scroll.
- Diagonal separators provide natural visual transitions between sections.
- Reduced motion: disable transforms, set instant opacity transition.

### Mobile
- Diagonal clip slope reduces from `8%` to `4%`.
- Asymmetric splits collapse to single column with visual first.
- Hero headline scales via existing `clamp`.

## Implementation Notes
- Add a small inline `<script>` block at the bottom of `index.pug` for `IntersectionObserver` reveal logic.
- Update the existing `<style>` block with new section classes, clip paths, and animation keyframes.
- Reuse existing SVG illustrations; enhance them with subtle CSS hover transforms rather than redrawing.
- Build with `npm run build:frontend` and verify with a full-page screenshot.

## Out of Scope
- New illustrations or 3D rendered hero assets.
- New backend routes or API changes.
- E2E selector changes (landing page is not covered by Studio E2E specs).
