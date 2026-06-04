# Audit — Current State

> Part of [GNOME HIG Unification Plan](README.md)

---

## 1.1 What's There Now

The current studio (`studio.pug` + `studio.scss` + 7 UI modules) is a single-page 3D workspace with these zones:

```
┌─────────────────────────────────────────────────────────────────┐
│ [✦ Arbesk] [Asset Status] [History Timeline]    [Btns][Wallet] │ ← Topbar (80px)
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────────────────────────┐ ┌──────────────┐ │
│ │ Settings  │ │                              │ │              │ │
│ │ (collaps) │ │     3D Viewport              │ │  Asset       │ │
│ │ ───────── │ │     (Babylon.js canvas)      │ │  Library     │ │
│ │ Chat      │ │                              │ │  (collaps)   │ │
│ │ History   │ │ [Inspector floats top-right] │ │              │ │
│ │ ───────── │ │ [Welcome/Drop/Wait overlays] │ │              │ │
│ │ Timeline  │ │                              │ │              │ │
│ └──────────┘ ├───────────────────────────────┤ └──────────────┘ │
│              │ [Prompt textarea        ][✦] │                   │
├──────────────┴───────────────────────────────┴──────────────────┤
│ [Ledger Panel — fixed bottom-left, collapsible, slides up]      │
└─────────────────────────────────────────────────────────────────┘
```

| Panel / Zone | Toggle Mechanism | Position |
|---|---|---|
| Left Sidebar (Create/Settings/Chat/Timeline) | Collapse button + auto-show button on left edge | Left, 300px |
| Asset Library | Collapse button + auto-show button on right edge | Right, 260px |
| Inspector | `hidden` attribute, toggled by node selection | Floating top-right |
| Micro-Ledger | Toggle button in bottom-left corner | Fixed bottom-left, slides up |
| Topbar | Always visible | Full-width top, 80px |
| Welcome/Generation/Drop overlays | Programmatic show/hide via CSS classes | Over the viewport |

---

## 1.2 HIG Violations

| Problem | HIG Principle Violated | Severity |
|---|---|---|
| **4 separate floating/show/hidden panels** | Single content focus | Critical |
| **3 different toggle buttons in 3 corners** | Consistent control placement | Critical |
| **Inconsistent panel behaviors** (slide-left, slide-right, float, slide-up) | Consistent interaction patterns | High |
| **Topbar overloaded** (7 elements: brand, status, timeline, 4 buttons, wallet) | Header Bar should be simple | High |
| **No primary navigation model** | Provide clear navigation hierarchy | High |
| **Settings buried in accordion** | Don't hide critical configuration | Medium |
| **Save/Publish scattered** | Actions contextual to content | Medium |
| **Single 768px breakpoint** | Adaptive layout | Medium |
| **Custom everything** (no system font, no accessibility) | System styles, dark/light, high-contrast | Medium |
| **No nesting visibility** (no breadcrumbs, no scene tree) | Show hierarchy | Critical |
| **Scene composition invisible** (no list of what's in the world) | All content discoverable | High |

---

## 1.3 CSS Architecture Problems

- **~2136 lines** in single `studio.scss`
- Bootstrap 5.1.3 as hard dependency
- Heavy `!important` and deep nesting
- Only 10 CSS custom properties (palette only, no spacing/sizing tokens)
- `rgba()` hardcoded with no opacity scale
- Dark-only palette. No `prefers-color-scheme` support.
- Custom scrollbar hiding (`::-webkit-scrollbar { display: none }`) — breaks accessibility
- Logo image used as background pattern on `#app::before` — decorative, no function
