# Audit — Current State

> Part of [GNOME HIG Unification Plan](README.md)

---

## 1.1 What's There Now

The current studio (`studio.pug` + `styles.scss` + `_studio-legacy.scss` + ~27 UI modules) is a single-page 3D workspace using the GNOME HIG layout:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [✦] Arbesk  [Library][Studio]  My World · 3 nodes  [Save][Besk] [Wallet] │ ← Header Bar (48px)
├──────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────────────────────────┐ ┌────────────────────────┐ │
│ │ Settings │ │                              │ │                        │ │
│ │ Chat     │ │     3D Viewport              │ │     Inspector          │ │
│ │ Outline  │ │     (Babylon.js canvas)      │ │     (collapsed)        │ │
│ │ Gallery  │ │                              │ │                        │ │
│ │ Activity │ │ [Prompt textarea        ][✦] │ │                        │ │
│ │          │ ├──────────────────────────────┤ │                        │ │
│ │          │ │ Message Bar                  │ │                        │ │
│ └──────────┘ └──────────────────────────────┘ └────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│ Draft · 3 nodes · 1 child · Depth 0/5                    [?]             │ ← Bottom Bar
└──────────────────────────────────────────────────────────────────────────┘
```

| Panel / Zone | Toggle Mechanism | Position |
|---|---|---|
| Left Sidebar (Settings/Chat/Outline/Gallery/Activity) | View-switcher tabs + collapse toggle | Left, 340px |
| Inspector | `collapsed` class, toggled by node selection | Right, 340px |
| Message Bar | Always visible | Bottom of viewport |
| Bottom Bar | Always visible | Full-width bottom, 32px |
| Header Bar | Always visible | Full-width top, 48px |
| Drop overlay | Programmatic show/hide via CSS classes | Over the viewport |

---

## 1.2 Pre-Unification HIG Violations (Resolved)

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

## 1.3 Pre-Unification CSS Architecture Problems (Resolved)

These issues were identified before the HIG unification and are now resolved:

- **~2136 lines** in single `studio.scss` → split into 29 SCSS partials
- Bootstrap 5.1.3 as hard dependency → removed; token-based styling
- Heavy `!important` and deep nesting → limited nesting, almost no `!important`
- Only 10 CSS custom properties → ~50+ semantic tokens plus spacing/sizing/radii/shadows
- `rgba()` hardcoded with no opacity scale → `color-mix()` and `rgb()` channels used consistently
- Dark-only palette. No `prefers-color-scheme` support → light/dark aliases + manual `data-theme` override
- Custom scrollbar hiding (`::-webkit-scrollbar { display: none }`) → removed
- Logo image used as background pattern on `#app::before` — decorative, no function → removed
