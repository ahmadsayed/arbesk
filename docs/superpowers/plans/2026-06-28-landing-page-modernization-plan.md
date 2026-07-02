# Arbesk Landing Page Modernization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Historical note:** This plan references `/library.html` for Library links. The current unified SPA serves Library under `/library` inside `app.html`; update links accordingly when implementing.

**Goal:** Modernize `frontend/src/pug/index.pug` with a bold editorial layout, asymmetric sections, diagonal separators, dark contrast bands, and scroll-triggered transitions.

**Architecture:** All changes live inside the existing `frontend/src/pug/index.pug` template as an inline stylesheet, structural markup changes, and a small inline `IntersectionObserver` script. No new dependencies or backend changes.

**Tech Stack:** Pug, SCSS/CSS (inline), vanilla JS (`IntersectionObserver`), Playwright screenshot verification.

## Global Constraints
- No new runtime dependencies.
- Keep changes scoped to `frontend/src/pug/index.pug`.
- Respect `prefers-reduced-motion`.
- Preserve existing landing-page layout overrides that prevent `#app { height: 100vh }` clipping.
- Build with `npm run build:frontend`; verify with a full-page Playwright screenshot.
- Maintain the existing Arabesque wood color tokens.

## Implementation Notes / Deviations

During inline execution, the following adjustments were made to the original plan to ensure robustness, avoid a blank/white page, and keep the content concise:

- Added a `<script>` in `<head>` that adds `.js-animations` to `<html>`. Reveal/hero animations are only active when this class is present. Content remains visible if JavaScript fails or is disabled (the `<noscript>` block then also forces visibility).
- Reveal CSS was restructured so `.reveal .reveal-child-*` defaults to `opacity: 1` and only animates after `.revealed` is added by `IntersectionObserver`; if the observer never fires, content is still readable.
- The hero was changed from `min-height: 100vh` to a compact auto-height section with stronger gold gradients, a subtle dot-grid texture, a bottom gold rule, and a scroll cue — so the next section is visible above the fold and the page no longer looks like a blank white canvas.
- `.landing-section.band-dark` overrides `max-width: none` so dark bands are full-bleed.
- The standalone "Time is a dimension" and "Pull quote" sections were removed; the hero states the time-travel premise once, and the technology sections (Objects have memory, Each asset is its own micro-ledger) were kept brief.
- "Objects have memory" and "Built for teams" were converted to full-bleed dark bands; "We build in 3D" and "Each asset is its own micro-ledger" use tinted backgrounds. This creates contrast and breaks up the long cream page.
- Dark-band overrides were added for the colour-memory card so its text remains readable on the dark background.
- Manifest chain diagram uses inline blocks instead of an SVG.
- Screenshot verification uses `google-chrome --headless` against a local HTTP server (`python3 -m http.server`) because full-page CLI screenshots do not trigger `IntersectionObserver` for below-the-fold sections.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `frontend/src/pug/index.pug` | Modify | Single source for styles, markup, and reveal script. |
| `frontend/dist/index.html` | Generated | Output of `npm run build:frontend`; verify visually. |

---

### Task 1: Replace the inline stylesheet with editorial styles

**Files:**
- Modify: `frontend/src/pug/index.pug` lines 11–233 (the entire `style.` block)

**Interfaces:**
- Consumes: existing CSS custom properties from `styles.css` (`--choco-*`, `--gold`).
- Produces: new utility classes used in Task 3: `.landing-page`, `.slant-top`, `.slant-bottom`, `.band-dark`, `.feature-card`, `.reveal`, `.revealed`, `.hero-animate`.

- [ ] **Step 1: Replace the `<style>` block**

Replace the current inline `style.` block with the following block. Keep it immediately after the `link(rel="stylesheet", href="/css/styles.css")` and before `body.landing-page`.

```pug
    style.
      :root {
        --landing-bg: var(--choco-1, #faf6f2);
        --landing-fg: var(--choco-12, #2a1a0e);
        --landing-muted: var(--choco-7, #8c6a4a);
        --landing-gold: var(--gold, #a07848);
        --landing-card: var(--choco-2, #f0e6d8);
        --landing-border: var(--choco-5, #b89a7a);
        --landing-dark: var(--choco-12, #2a1a0e);
      }

      html:has(.landing-page),
      .landing-page,
      .landing-page body {
        overflow: auto;
        height: auto;
      }

      .landing-page #app {
        height: auto;
        min-height: 100vh;
        overflow: visible;
      }

      .landing-page {
        background: var(--landing-bg);
        color: var(--landing-fg);
        line-height: 1.6;
      }

      /* Header */
      .landing-page .headerbar {
        position: sticky;
        top: 0;
        z-index: 100;
        background: color-mix(in srgb, var(--landing-bg) 92%, transparent);
        backdrop-filter: blur(10px);
        border-bottom: 1px solid color-mix(in srgb, var(--landing-border) 30%, transparent);
      }

      /* Typography */
      .landing-hero h1 {
        font-size: clamp(3.5rem, 10vw, 7rem);
        font-weight: 800;
        letter-spacing: -0.04em;
        line-height: 0.95;
        margin: 0 0 1.25rem;
      }

      .landing-section .text h2 {
        font-size: clamp(2.2rem, 5vw, 3.8rem);
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.05;
        margin: 0 0 1rem;
      }

      .landing-section .text p {
        font-size: 1.15rem;
        color: var(--landing-muted);
        margin: 0;
        max-width: 38ch;
      }

      /* Layout shells */
      .landing-hero,
      .landing-section,
      .landing-footer {
        width: 100%;
        margin: 0 auto;
        padding: 5rem 2rem;
      }

      .landing-hero {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }

      .landing-hero .lead {
        font-size: clamp(1.1rem, 2.4vw, 1.35rem);
        color: var(--landing-muted);
        max-width: 560px;
        margin: 0 auto 2.5rem;
      }

      .landing-hero .lead strong {
        color: var(--landing-gold);
      }

      /* CTA */
      .cta {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        background: var(--landing-gold);
        color: #fff;
        padding: 0.95rem 2.25rem;
        border-radius: 999px;
        font-weight: 600;
        text-decoration: none;
        font-size: 1rem;
        box-shadow: 0 4px 20px rgba(160,120,72,0.35);
        transition: transform 0.25s ease, box-shadow 0.25s ease;
      }

      .cta:hover {
        transform: translateY(-3px);
        box-shadow: 0 8px 28px rgba(160,120,72,0.45);
      }

      .cta svg {
        transition: transform 0.25s ease;
      }

      .cta:hover svg {
        transform: translateX(4px);
      }

      /* Feature sections */
      .landing-section {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 4rem;
        align-items: center;
        max-width: 1180px;
      }

      .landing-section.reverse {
        grid-template-columns: 0.85fr 1.15fr;
      }

      .landing-section.reverse .text {
        order: 2;
      }

      .landing-section.reverse .visual {
        order: 1;
      }

      .feature-card {
        background: var(--landing-card);
        border: 1px solid color-mix(in srgb, var(--landing-border) 40%, transparent);
        border-radius: 24px;
        padding: 2rem;
        box-shadow: 0 12px 40px rgba(42, 26, 14, 0.06);
      }

      .landing-section .visual {
        display: grid;
        place-items: center;
        min-height: 240px;
      }

      .landing-section .visual svg {
        width: 100%;
        max-width: 340px;
        height: auto;
      }

      /* Diagonal separators */
      .slant-bottom {
        clip-path: polygon(0 0, 100% 0, 100% 92%, 0 100%);
        padding-bottom: 8rem;
      }

      .slant-top {
        clip-path: polygon(0 8%, 100% 0, 100% 100%, 0 100%);
        padding-top: 8rem;
      }

      .slant-top.slant-bottom {
        clip-path: polygon(0 8%, 100% 0, 100% 92%, 0 100%);
      }

      /* Dark bands */
      .band-dark {
        background: var(--landing-dark);
        color: var(--landing-bg);
      }

      .band-dark .text h2 {
        color: var(--landing-gold);
      }

      .band-dark .text p {
        color: color-mix(in srgb, var(--landing-bg) 80%, transparent);
      }

      .band-dark .cta {
        background: var(--landing-gold);
        color: #fff;
      }

      /* Pull quote */
      .pull-quote {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        min-height: 70vh;
        padding: 7rem 2rem;
      }

      .pull-quote .quote-mark {
        font-size: 5rem;
        line-height: 0.8;
        color: var(--landing-gold);
        opacity: 0.5;
        margin-bottom: 0.5rem;
      }

      .pull-quote blockquote {
        font-size: clamp(2.5rem, 7vw, 5rem);
        font-weight: 800;
        letter-spacing: -0.03em;
        line-height: 1.05;
        margin: 0 auto 1.25rem;
        max-width: 900px;
        color: var(--landing-gold);
      }

      .pull-quote p {
        color: color-mix(in srgb, var(--landing-bg) 75%, transparent);
        font-size: 1.15rem;
        max-width: 560px;
        margin: 0 auto;
      }

      /* Footer */
      .landing-footer {
        text-align: center;
        padding: 7rem 2rem 6rem;
      }

      .landing-footer h2 {
        font-size: clamp(2rem, 5vw, 3.2rem);
        font-weight: 700;
        margin: 0 0 1.5rem;
        color: var(--landing-bg);
      }

      .landing-footer .links {
        margin-top: 3rem;
        display: flex;
        gap: 1.5rem;
        justify-content: center;
        font-size: 0.95rem;
      }

      .landing-footer .links a {
        color: color-mix(in srgb, var(--landing-bg) 70%, transparent);
        text-decoration: none;
        transition: color 0.2s;
      }

      .landing-footer .links a:hover {
        color: var(--landing-gold);
      }

      /* Reveal animations */
      .reveal .reveal-child-1,
      .reveal .reveal-child-2,
      .reveal .reveal-child-3 {
        opacity: 0;
        transform: translateY(40px);
        transition: opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
                    transform 0.8s cubic-bezier(0.22, 1, 0.36, 1);
      }

      .reveal.revealed .reveal-child-1 { opacity: 1; transform: none; transition-delay: 0s; }
      .reveal.revealed .reveal-child-2 { opacity: 1; transform: none; transition-delay: 0.12s; }
      .reveal.revealed .reveal-child-3 { opacity: 1; transform: none; transition-delay: 0.24s; }

      /* Hero load animation */
      .hero-animate {
        opacity: 0;
        transform: translateY(40px);
        animation: hero-in 1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }

      .hero-animate:nth-child(1) { animation-delay: 0.1s; }
      .hero-animate:nth-child(2) { animation-delay: 0.25s; }
      .hero-animate:nth-child(3) { animation-delay: 0.4s; }

      @keyframes hero-in {
        to {
          opacity: 1;
          transform: none;
        }
      }

      @media (max-width: 860px) {
        .landing-section,
        .landing-section.reverse {
          grid-template-columns: 1fr;
          gap: 2.5rem;
          text-align: center;
        }

        .landing-section .text p {
          max-width: none;
          margin: 0 auto;
        }

        .landing-section.reverse .text,
        .landing-section.reverse .visual,
        .landing-section .visual {
          order: 0;
        }

        .landing-section .visual {
          order: -1;
        }

        .slant-bottom {
          clip-path: polygon(0 0, 100% 0, 100% 96%, 0 100%);
          padding-bottom: 6rem;
        }

        .slant-top {
          clip-path: polygon(0 4%, 100% 0, 100% 100%, 0 100%);
          padding-top: 6rem;
        }

        .slant-top.slant-bottom {
          clip-path: polygon(0 4%, 100% 0, 100% 96%, 0 100%);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .reveal .reveal-child-1,
        .reveal .reveal-child-2,
        .reveal .reveal-child-3,
        .hero-animate {
          animation: none;
          opacity: 1;
          transform: none;
          transition: opacity 0.2s ease;
        }
      }
```

Immediately after the closing `style.` block, add a `noscript` fallback so content is visible if JavaScript is disabled:

```pug
    noscript
      style.
        .reveal .reveal-child-1,
        .reveal .reveal-child-2,
        .reveal .reveal-child-3,
        .hero-animate {
          opacity: 1;
          transform: none;
          animation: none;
        }
```

- [ ] **Step 2: Build to check for CSS syntax errors**

Run: `npm run build:frontend`

Expected: build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pug/index.pug
git commit -m "design(landing): add editorial stylesheet and animation tokens"
```

---

### Task 2: Add the scroll-reveal script

**Files:**
- Modify: `frontend/src/pug/index.pug` (append a new `script.` block just before closing `</body>`)

**Interfaces:**
- Consumes: elements with class `.reveal`.
- Produces: adds `.revealed` class when elements enter the viewport.

- [ ] **Step 1: Append the reveal script**

Add this script block immediately before `</body>`:

```pug
    script.
      (function () {
        if (!('IntersectionObserver' in window)) {
          document.querySelectorAll('.reveal').forEach(function (el) {
            el.classList.add('revealed');
          });
          return;
        }

        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('revealed');
              observer.unobserve(entry.target);
            }
          });
        }, {
          threshold: 0.15,
          rootMargin: '0px 0px -50px 0px'
        });

        document.querySelectorAll('.reveal').forEach(function (el) {
          observer.observe(el);
        });
      })();
```

- [ ] **Step 2: Build to check for JS syntax errors**

Run: `npm run build:frontend`

Expected: build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pug/index.pug
git commit -m "feat(landing): add IntersectionObserver scroll-reveal script"
```

---

### Task 3: Rewrite the body markup for editorial layout

**Files:**
- Modify: `frontend/src/pug/index.pug` lines 234–383 (the entire `body.landing-page` block)

**Interfaces:**
- Consumes: new CSS classes from Task 1 and reveal logic from Task 2.
- Produces: the final editorial landing-page markup.

- [ ] **Step 1: Replace the `<body>` block**

Replace the current `body.landing-page` block with the following markup. Keep the same header structure but update `main` contents.

```pug
  body.landing-page
    #app
      header.headerbar
        h1.sr-only Arbesk
        .headerbar-brand
          img.logo-light(src="/logo.webp", alt="Arbesk")
          img.logo-dark(src="/logo-dark.webp", alt="Arbesk")

        nav.page-switcher(aria-label="Page")
          a.page-switcher-tab(href="/library.html") Library
          a.page-switcher-tab(href="/studio.html") Studio

        .headerbar-actions
          a.btn.btn-primary(href="/library.html") Launch App

      main
        section.landing-hero
          h1.hero-animate The world is 4D.
          p.lead.hero-animate
            | Move freely in three dimensions — then move back through the fourth.
            | In Arbesk, time is a dimension you can travel, but only backward.
            br
            strong Because the future is what you build.
          a.cta.hero-animate(href="/library.html")
            | Launch App
            svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round")
              line(x1="5" y1="12" x2="19" y2="12")
              polyline(points="12 5 19 12 12 19")

        section.landing-section.slant-bottom.reveal
          .text
            h2.reveal-child-1 We build in 3D.
            p.reveal-child-2 Move, rotate, and scale in space. That part is familiar. Every 3D tool gives you the three spatial dimensions.
          .visual.reveal-child-3
            .feature-card
              svg(viewBox="0 0 200 200" aria-label="3D axes and cube")
                // Axes
                line(x1="30" y1="170" x2="30" y2="40" stroke="#a07848" stroke-width="2")
                polygon(points="30,35 26,45 34,45" fill="#a07848")
                text(x="25" y="30" fill="#8c6a4a" font-size="12" font-weight="600") Y

                line(x1="30" y1="170" x2="170" y2="170" stroke="#a07848" stroke-width="2")
                polygon(points="175,170 165,166 165,174" fill="#a07848")
                text(x="178" y="175" fill="#8c6a4a" font-size="12" font-weight="600") X

                line(x1="30" y1="170" x2="90" y2="130" stroke="#a07848" stroke-width="2")
                polygon(points="93,128 85,130 88,136" fill="#a07848")
                text(x="95" y="125" fill="#8c6a4a" font-size="12" font-weight="600") Z

                // Cube
                path(d="M70 90 L120 90 L120 140 L70 140 Z" fill="none" stroke="#523a22" stroke-width="2")
                path(d="M85 75 L135 75 L135 125 L85 125 Z" fill="none" stroke="#523a22" stroke-width="2")
                line(x1="70" y1="90" x2="85" y2="75" stroke="#523a22" stroke-width="2")
                line(x1="120" y1="90" x2="135" y2="75" stroke="#523a22" stroke-width="2")
                line(x1="120" y1="140" x2="135" y2="125" stroke="#523a22" stroke-width="2")
                line(x1="70" y1="140" x2="85" y2="125" stroke="#523a22" stroke-width="2")

        section.landing-section.reverse.reveal
          .text
            h2.reveal-child-1 Objects have memory.
            p.reveal-child-2 A scratch, a repaint, a redesign — in the real world, every change stays part of the object. Digital assets should work the same way.
          .visual.reveal-child-3
            .feature-card
              svg(viewBox="0 0 240 200" aria-label="Cube with history trail")
                // Ghost trail
                rect(x="60" y="110" width="40" height="40" fill="none" stroke="#b89a7a" stroke-width="1.5" opacity="0.25" transform="rotate(-12 80 130)")
                rect(x="70" y="105" width="40" height="40" fill="none" stroke="#b89a7a" stroke-width="1.5" opacity="0.4" transform="rotate(-6 90 125)")
                rect(x="80" y="100" width="40" height="40" fill="none" stroke="#b89a7a" stroke-width="1.5" opacity="0.6")
                // Current cube
                rect(x="110" y="85" width="50" height="50" fill="#f0e6d8" stroke="#a07848" stroke-width="2.5" rx="4")
                text(x="135" y="118" fill="#2a1a0e" font-size="11" font-weight="600" text-anchor="middle") NOW

        section.landing-section.band-dark.slant-top.slant-bottom.reveal
          .text
            h2.reveal-child-1 Time is a dimension.
            p.reveal-child-2 Arbesk adds history as a first-class axis. Open any past version of any asset, instantly. No copies. No confusion.
          .visual.reveal-child-3
            svg(viewBox="0 0 300 120" aria-label="Version timeline")
              line(x1="20" y1="60" x2="280" y2="60" stroke="#a07848" stroke-width="2")
              circle(cx="60" cy="60" r="6" fill="#a07848")
              circle(cx="130" cy="60" r="6" fill="#a07848")
              circle(cx="200" cy="60" r="6" fill="#a07848")
              circle(cx="270" cy="60" r="8" fill="#faf6f2" stroke="#a07848" stroke-width="2")
              text(x="60" y="90" fill="#b89a7a" font-size="11" font-weight="600" text-anchor="middle") v1
              text(x="130" y="90" fill="#b89a7a" font-size="11" font-weight="600" text-anchor="middle") v2
              text(x="200" y="90" fill="#b89a7a" font-size="11" font-weight="600" text-anchor="middle") v3
              text(x="270" y="90" fill="#b89a7a" font-size="11" font-weight="600" text-anchor="middle") v4
              // Scrub handle
              rect(x="190" y="42" width="20" height="36" rx="4" fill="#a07848" opacity="0.25")
              line(x1="200" y1="48" x2="200" y2="72" stroke="#a07848" stroke-width="2")

        section.landing-section.pull-quote.reveal
          .quote-mark.reveal-child-1 “
          blockquote.reveal-child-2 The future is what you build.
          p.reveal-child-3 We preserve every past version. We never predict the future — you create it.

        section.landing-section.reverse.reveal
          .text
            h2.reveal-child-1 Each asset is its own micro-ledger.
            p.reveal-child-2 Every version is a manifest. Every manifest links to the one before. Data + history, content-addressed and immutable.
          .visual.reveal-child-3
            .feature-card
              svg(viewBox="0 0 300 160" aria-label="Manifest chain")
                // Chain blocks
                rect(x="20" y="60" width="45" height="40" rx="6" fill="#f0e6d8" stroke="#a07848" stroke-width="2")
                text(x="42" y="85" fill="#2a1a0e" font-size="10" font-weight="600" text-anchor="middle") M1

                line(x1="65" y1="80" x2="90" y2="80" stroke="#a07848" stroke-width="2" stroke-dasharray="4 2")

                rect(x="90" y="60" width="45" height="40" rx="6" fill="#f0e6d8" stroke="#a07848" stroke-width="2")
                text(x="112" y="85" fill="#2a1a0e" font-size="10" font-weight="600" text-anchor="middle") M2

                line(x1="135" y1="80" x2="160" y2="80" stroke="#a07848" stroke-width="2" stroke-dasharray="4 2")

                rect(x="160" y="60" width="45" height="40" rx="6" fill="#f0e6d8" stroke="#a07848" stroke-width="2")
                text(x="182" y="85" fill="#2a1a0e" font-size="10" font-weight="600" text-anchor="middle") M3

                line(x1="205" y1="80" x2="230" y2="80" stroke="#a07848" stroke-width="2" stroke-dasharray="4 2")

                rect(x="230" y="60" width="45" height="40" rx="6" fill="#f0e6d8" stroke="#a07848" stroke-width="2")
                text(x="252" y="85" fill="#2a1a0e" font-size="10" font-weight="600" text-anchor="middle") M4

                text(x="150" y="130" fill="#8c6a4a" font-size="12" font-weight="600" text-anchor="middle") prev_manifest_cid

        section.landing-section.reverse.reveal
          .text
            h2.reveal-child-1 Built for teams.
            p.reveal-child-2 Comment on assets, invite editors with Merkle proofs, and collaborate on collections — all without reminting or losing history.
          .visual.reveal-child-3
            .feature-card
              svg(viewBox="0 0 240 180" aria-label="Collaboration")
                // Shared folder
                path(d="M60 60 L110 60 L120 75 L180 75 L180 130 L60 130 Z" fill="none" stroke="#a07848" stroke-width="2")
                // Avatars
                circle(cx="90" cy="120" r="14" fill="#f0e6d8" stroke="#a07848" stroke-width="2")
                text(x="90" y="125" fill="#2a1a0e" font-size="10" font-weight="600" text-anchor="middle") A
                circle(cx="125" cy="120" r="14" fill="#f0e6d8" stroke="#a07848" stroke-width="2")
                text(x="125" y="125" fill="#2a1a0e" font-size="10" font-weight="600" text-anchor="middle") B
                circle(cx="160" cy="120" r="14" fill="#f0e6d8" stroke="#a07848" stroke-width="2")
                text(x="160" y="125" fill="#2a1a0e" font-size="10" font-weight="600" text-anchor="middle") C
                // Comment bubble
                rect(x="150" y="40" width="60" height="30" rx="8" fill="#f0e6d8" stroke="#a07848" stroke-width="2")
                polygon(points="160,70 165,78 170,70" fill="#f0e6d8" stroke="#a07848" stroke-width="1")
                line(x1="160" y1="55" x2="200" y2="55" stroke="#b89a7a" stroke-width="2")
                line(x1="160" y1="62" x2="190" y2="62" stroke="#b89a7a" stroke-width="2")

        footer.landing-footer.band-dark.slant-top.reveal
          h2.reveal-child-1 Start building the future.
          a.cta.reveal-child-2(href="/library.html") Launch App
          .links.reveal-child-3
            a(href="/library.html") Library
            a(href="/studio.html") Studio
```

- [ ] **Step 2: Build to check markup**

Run: `npm run build:frontend`

Expected: build completes and `frontend/dist/index.html` is generated.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pug/index.pug
git commit -m "feat(landing): rewrite body with editorial layout and diagonal bands"
```

---

### Task 4: Verify with full-page screenshot

**Files:**
- Verify: `frontend/dist/index.html`

**Interfaces:**
- Consumes: built landing page output.

- [ ] **Step 1: Serve the built frontend and capture a full-page screenshot**

Run:

```bash
npm run build:frontend
npx playwright screenshot --viewport-size=1280,900 --full-page "file://$(pwd)/frontend/dist/index.html" /tmp/arbesk-landing-modern.png
```

Expected: command exits `0` and `/tmp/arbesk-landing-modern.png` is created.

- [ ] **Step 2: Visually inspect the screenshot**

Check that:
1. Hero is full-height with large headline and CTA.
2. Each feature section has asymmetric layout and alternates text/visual sides.
3. The Time section and Footer appear as dark bands.
4. Diagonal separators are visible between sections.
5. The Pull Quote is centered in a dark band.
6. All sections are visible (no `100vh` clipping).
7. Manifest chain M4 is fully visible inside its card.

If any check fails, adjust the CSS or markup and rebuild.

- [ ] **Step 3: Commit verification artifact note (no binary commit)**

```bash
git add docs/superpowers/specs/2026-06-28-landing-page-modernization-design.md
git add docs/superpowers/plans/2026-06-28-landing-page-modernization-plan.md
git commit -m "docs: landing page modernization spec and plan"
```

---

## Self-Review Checklist

- [ ] Spec coverage: every section of the design spec maps to a task.
- [ ] No placeholders: every step has exact code or commands.
- [ ] Type/class consistency: `.reveal`, `.revealed`, `.hero-animate`, `.feature-card`, `.band-dark`, `.slant-top`, `.slant-bottom`, `.reveal-child-*` are defined in Task 1 and used in Task 3.
- [ ] Mobile responsive: media queries included in Task 1.
- [ ] Accessibility: `prefers-reduced-motion` included in Task 1.
