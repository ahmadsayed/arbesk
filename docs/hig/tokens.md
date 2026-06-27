# Tokens, CSS Methodology & Templating

> Part of [GNOME HIG Unification Plan](README.md)  
> Reference for Phase A implementation

---

## Token System: libadwaita Surfaces + Open Props Scales + Arabesque Palette

Three layers, following the Open Props theme pattern. The Arabesque warm-wood palette maps onto Open Props' `choco` and `brown` color scales.

### Layer 1: Raw Palette

```scss
:root {
  // choco scale ≈ Arabesque warm-wood
  --choco-1:  #faf6f2;   // warm white
  --choco-2:  #f0e6d8;
  --choco-3:  #e0d0bc;
  --choco-4:  #cdb89a;
  --choco-5:  #b89a7a;
  --choco-6:  #a28060;   // ≈ --arabesque-accent-muted
  --choco-7:  #8c6a4a;
  --choco-8:  #7a5c3e;   // ≈ --arabesque-panel
  --choco-9:  #664a30;   // ≈ --arabesque-bg
  --choco-10: #523a22;
  --choco-11: #3d2a18;
  --choco-12: #2a1a0e;   // ≈ --arabesque-void

  // Accent: warm gold
  --gold-3:  #d4a574;    // ≈ --arabesque-accent-light
  --gold-5:  #a07848;    // ≈ --arabesque-accent (darkened for 3:1 focus contrast)
  --gold-7:  #a07848;

  // Semantic
  --red-3:   #e01b24;   // destructive
  --red-4:   #c01c28;
  --green-4: #2ec27e;   // success
  --yellow-4: #e5a50a;  // warning

  // 3D viewport + Babylon-specific tokens
  --viewport-bg: #1e1e1e; // neutral dark gray; stable across modes
  --highlight-amber: #d4a017; // selection glow color
  --axis-x: #e22b30;      // Blender convention — red
  --axis-y: #43c142;      // Blender convention — green
  --axis-z: #3478eb;      // Blender convention — blue
}
```

### Layer 2: Per-Surface Variants (Light + Dark)

```scss
:root {
  // ── Light ──
  --window-bg-light:      var(--choco-1);
  --window-fg-light:      var(--choco-12);
  --view-bg-light:        var(--choco-2);
  --view-fg-light:        var(--choco-12);
  --headerbar-bg-light:   var(--choco-2);
  --headerbar-fg-light:   var(--choco-12);
  --sidebar-bg-light:     var(--choco-1);
  --sidebar-fg-light:     var(--choco-11);
  --card-bg-light:        var(--choco-1);
  --card-fg-light:        var(--choco-11);
  --popover-bg-light:     var(--choco-2);
  --popover-fg-light:     var(--choco-12);
  --border-light:         #b89a7a; // darkened for visible surface separation
  --accent-bg-light:      var(--gold-5);
  --accent-fg-light:      var(--choco-12);
  --destructive-bg-light: var(--red-3);
  --destructive-fg-light: #ffffff;
  --dim-fg-light:         var(--choco-7);

  // ── Dark ──
  --window-bg-dark:       var(--choco-12);
  --window-fg-dark:       var(--choco-2);
  --view-bg-dark:         var(--choco-11);
  --view-fg-dark:         var(--choco-2);
  --headerbar-bg-dark:    var(--choco-11);
  --headerbar-fg-dark:    var(--choco-2);
  --sidebar-bg-dark:      var(--choco-12);
  --sidebar-fg-dark:      var(--choco-3);
  --card-bg-dark:         var(--choco-10);
  --card-fg-dark:         var(--choco-3);
  --popover-bg-dark:      var(--choco-10);
  --popover-fg-dark:      var(--choco-2);
  --border-dark:          var(--choco-9);
  --accent-bg-dark:       var(--gold-5);
  --accent-fg-dark:       var(--choco-12);
  --destructive-bg-dark:  var(--red-4);
  --destructive-fg-dark:  #ffffff;
  --dim-fg-dark:          var(--choco-6);
}
```

### Layer 3: Theme-Agnostic Aliases

All component CSS uses ONLY these. Never reference `-light` or `-dark` variants directly.

```scss
:root {
  --window-bg:      var(--window-bg-light);
  --window-fg:      var(--window-fg-light);
  --view-bg:        var(--view-bg-light);
  --view-fg:        var(--view-fg-light);
  --headerbar-bg:   var(--headerbar-bg-light);
  --headerbar-fg:   var(--headerbar-fg-light);
  --sidebar-bg:     var(--sidebar-bg-light);
  --sidebar-fg:     var(--sidebar-fg-light);
  --card-bg:        var(--card-bg-light);
  --card-fg:        var(--card-fg-light);
  --popover-bg:     var(--popover-bg-light);
  --popover-fg:     var(--popover-fg-light);
  --border-color:   var(--border-light);
  --accent-bg:      var(--accent-bg-light);
  --accent-fg:      var(--accent-fg-light);
  --destructive-bg: var(--destructive-bg-light);
  --destructive-fg: var(--destructive-fg-light);
  --dim-fg:         var(--dim-fg-light);
}

@media (prefers-color-scheme: dark) {
  :root {
    --window-bg:      var(--window-bg-dark);
    --window-fg:      var(--window-fg-dark);
    --view-bg:        var(--view-bg-dark);
    --view-fg:        var(--view-fg-dark);
    --headerbar-bg:   var(--headerbar-bg-dark);
    --headerbar-fg:   var(--headerbar-fg-dark);
    --sidebar-bg:     var(--sidebar-bg-dark);
    --sidebar-fg:     var(--sidebar-fg-dark);
    --card-bg:        var(--card-bg-dark);
    --card-fg:        var(--card-fg-dark);
    --popover-bg:     var(--popover-bg-dark);
    --popover-fg:     var(--popover-fg-dark);
    --border-color:   var(--border-dark);
    --accent-bg:      var(--accent-bg-dark);
    --accent-fg:      var(--accent-fg-dark);
    --destructive-bg: var(--destructive-bg-dark);
    --destructive-fg: var(--destructive-fg-dark);
    --dim-fg:         var(--dim-fg-dark);
  }
}

// Manual override (takes precedence over system preference)
:root[data-theme="light"] {
  --window-bg: var(--window-bg-light);
  --window-fg: var(--window-fg-light);
  --view-bg: var(--view-bg-light);
  --view-fg: var(--view-fg-light);
  --headerbar-bg: var(--headerbar-bg-light);
  --headerbar-fg: var(--headerbar-fg-light);
  --sidebar-bg: var(--sidebar-bg-light);
  --sidebar-fg: var(--sidebar-fg-light);
  --card-bg: var(--card-bg-light);
  --card-fg: var(--card-fg-light);
  --popover-bg: var(--popover-bg-light);
  --popover-fg: var(--popover-fg-light);
  --border-color: var(--border-light);
  --accent-bg: var(--accent-bg-light);
  --accent-fg: var(--accent-fg-light);
  --destructive-bg: var(--destructive-bg-light);
  --destructive-fg: var(--destructive-fg-light);
  --dim-fg: var(--dim-fg-light);
}

:root[data-theme="dark"] {
  --window-bg: var(--window-bg-dark);
  --window-fg: var(--window-fg-dark);
  --view-bg: var(--view-bg-dark);
  --view-fg: var(--view-fg-dark);
  --headerbar-bg: var(--headerbar-bg-dark);
  --headerbar-fg: var(--headerbar-fg-dark);
  --sidebar-bg: var(--sidebar-bg-dark);
  --sidebar-fg: var(--sidebar-fg-dark);
  --card-bg: var(--card-bg-dark);
  --card-fg: var(--card-fg-dark);
  --popover-bg: var(--popover-bg-dark);
  --popover-fg: var(--popover-fg-dark);
  --border-color: var(--border-dark);
  --accent-bg: var(--accent-bg-dark);
  --accent-fg: var(--accent-fg-dark);
  --destructive-bg: var(--destructive-bg-dark);
  --destructive-fg: var(--destructive-fg-dark);
  --dim-fg: var(--dim-fg-dark);
}
```

### Other Tokens (Open Props Scales)

```scss
:root {
  // Spacing (4px base, rem)
  --size-1:  0.25rem;   // 4px  — icon padding
  --size-2:  0.5rem;    // 8px  — inline gap
  --size-3:  1rem;      // 16px — component padding
  --size-4:  1.25rem;   // 20px — section gap
  --size-5:  1.5rem;    // 24px — layout gap
  --size-6:  1.75rem;   // 28px
  --size-7:  2rem;      // 32px — panel padding
  --size-8:  3rem;      // 48px
  --size-10: 5rem;      // 80px

  // Typography
  --font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Mono', ui-monospace, monospace;
  --font-size-0: 0.75rem;    // labels, meta, badge
  --font-size-1: 0.875rem;   // body, inputs
  --font-size-2: 0.9375rem;  // sidebar headings, card titles
  --font-size-3: 1.125rem;   // section headings
  --font-size-5: 1.5rem;     // page title
  --font-weight-4: 400;
  --font-weight-6: 600;
  --font-weight-7: 700;
  --font-lineheight-2: 1.375;
  --font-lineheight-3: 1.5;

  // Radii
  --radius-0: 0;            // square (swatches, flush rows)
  --radius-1: 0.25rem;      // 4px — tight controls
  --radius-2: 0.5rem;       // cards, inputs, buttons
  --radius-3: 0.75rem;      // panels, modals
  --radius-round: 999px;    // pills, history nodes, badges

  // Shadows (light/dark adaptive)
  --shadow-1: 0 1px 2px -1px rgb(0 0 0 / 10%);
  --shadow-2: 0 2px 4px -2px rgb(0 0 0 / 12%);
  --shadow-3: 0 4px 8px -2px rgb(0 0 0 / 15%);
  --shadow-4: 0 8px 16px -4px rgb(0 0 0 / 18%);
  --shadow-5: 0 12px 24px -8px rgb(0 0 0 / 25%);

  // Borders
  --border-size-1: 1px;

  // Transitions
  --duration-quick: 120ms;
  --duration-moderate: 260ms;
  --ease-out-3: cubic-bezier(0.25, 0, 0, 1);

  // Layout dimensions
  --headerbar-height: 48px;
  --sidebar-width: 340px;
  --inspector-width: 340px;
  --messagebar-min-height: 52px;
  --bottombar-height: 32px;
}
```

### Derived / Decorative Tokens

```scss
:root {
  // RGB channels of the gold accent for rgba() composition
  --accent-bg-rgb: 160 120 72;

  // Glass / elevated floating surfaces
  --glass-blur: 12px;
  --popover-glass-bg: color-mix(in srgb, var(--popover-bg) 86%, transparent);

  // libadwaita-style translucent hover/active overlays
  --surface-overlay-hover: color-mix(in srgb, var(--window-fg) 6%, transparent);
  --surface-overlay-active: color-mix(in srgb, var(--window-fg) 10%, transparent);

  // Calmer low-contrast separator
  --border-hairline: color-mix(in srgb, var(--border-color) 50%, transparent);

  // Focus ring + soft accent glow
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent-bg) 35%, transparent);
  --glow-accent: 0 0 0 3px color-mix(in srgb, var(--accent-bg) 25%, transparent);
  --accent-shadow: 0 4px 12px -4px color-mix(in srgb, var(--accent-bg) 55%, transparent);

  // Subtle warm gradients
  --gradient-accent: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-bg) 92%, white),
    var(--accent-bg)
  );
  --gradient-headerbar: linear-gradient(
    180deg,
    color-mix(in srgb, var(--headerbar-bg) 97%, white),
    var(--headerbar-bg)
  );
  --gradient-sidebar: linear-gradient(
    180deg,
    color-mix(in srgb, var(--sidebar-bg) 97%, white),
    var(--sidebar-bg)
  );
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-quick: 0ms;
    --duration-moderate: 0ms;
  }
}

@media (prefers-contrast: more) {
  :root {
    --border-color: currentColor;
    --shadow-1: none;
    --shadow-2: none;
    --shadow-3: none;
    --shadow-4: none;
    --shadow-5: none;
    --gradient-accent: var(--accent-bg);
    --gradient-headerbar: var(--headerbar-bg);
    --gradient-sidebar: var(--sidebar-bg);
    --glow-accent: none;
    --accent-shadow: none;
    --popover-glass-bg: var(--popover-bg);
    --focus-ring: 0 0 0 3px var(--accent-bg);
    --border-hairline: currentColor;
  }
}

// Screen-reader only utility
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

---

## CSS Methodology

**No formal methodology** (no BEM, no utility-first, no CSS-in-JS). Single-page app, one developer.

| Rule | Example |
|---|---|
| **Semantic class names** | `.headerbar`, `.sidebar`, `.outliner` — the class IS the component |
| **One component = one SCSS file** | `_headerbar.scss` contains all `.headerbar*` styles |
| **Max 2 levels of nesting** | `.headerbar .headerbar-title` OK. `.a .b .c .d` not OK. |
| **No ID selectors in CSS** | `#renderCanvas` stays in JS only. CSS uses only classes. |
| **CSS custom properties for all values** | `var(--sidebar-bg)`, never hardcoded colors. |
| **Comment section headers** | `/* Header Bar */` between blocks. |
| **Minimal utility classes** | A small set lives in `_responsive.scss` (`.hidden`, `.sr-only`, `.text-mono`, etc.). |
| **Minimal `!important`** | Only utility helpers such as `.hidden`. |

### What SCSS is used for

- `@use` to compose partials into one output file
- Nesting (max 2 levels) for readability
- Variables (`$var`) only for internal calculations within a file

### What SCSS is NOT used for

- Mixins → use CSS custom properties instead
- Functions → no complex color math needed
- `@extend` → creates unpredictable output
- Loops/conditionals → not needed for 27+ files

---

## File Structure

```
styles.scss              ← entry point, ~38 @use lines
├── base/
│   ├── _tokens.scss     ← all CSS custom properties (this file)
│   └── _reset.scss      ← minimal reset
├── components/
│   ├── _headerbar.scss
│   ├── _sidebar.scss
│   ├── _viewport.scss
│   ├── _inspector.scss
│   ├── _messagebar.scss
│   ├── _bottombar.scss
│   ├── _buttons.scss
│   ├── _forms.scss
│   ├── _cards.scss
│   ├── _history.scss
│   ├── _outliner.scss
│   ├── _pathbar.scss
│   ├── _ledger.scss
│   ├── _comments.scss
│   ├── _chat.scss
│   ├── _timeline.scss
│   ├── _settings.scss
│   ├── _layout.scss
│   ├── _dialog.scss
│   ├── _toasts.scss
│   ├── _empty-state.scss
│   ├── _wallet-popover.scss
│   ├── _wallet-modal.scss
│   ├── _library-toolbar.scss
│   ├── _library-grid.scss
│   └── _library-context-menu.scss
└── utilities/
    └── _responsive.scss
```

---

## Pug: Keep It

**Decision**: Keep Pug. Single ~380-line template. Already in the build pipeline. Switching to plain HTML adds ~150 lines of closing tags with no benefit.

### When to reconsider
- Template passes ~500 lines
- Second frontend developer joins
- Build step becomes iteration bottleneck

If any happen, migrate to plain static HTML (no templating engine needed for one page).

### Pug Mixins for Repeated Patterns

```pug
//- Asset library card (rendered dynamically by asset-library.js)
mixin assetCard(tokenId, role)
  .asset-card(data-token-id=tokenId draggable="true")
    .asset-card-thumbnail ✦
    .asset-card-id Token ##{tokenId}
    .asset-card-name Loading...
    .asset-card-badge(class=role === 'owner' ? 'badge-owner' : 'badge-editor')
      = role === 'owner' ? 'Owner' : 'Editor'

//- Sidebar view switcher button
mixin switcherBtn(view, label, iconSvg, shortcut)
  button.sidebar-switcher-btn(data-view=view role="tab" aria-label=label title=label + ' (' + shortcut + ')')
    | !{iconSvg}

//- Form control group
mixin controlGroup(label, forId)
  .form-group
    label.form-label(for=forId) #{label}
    block
```
