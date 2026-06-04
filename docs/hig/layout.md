# Layout Architecture

> Part of [GNOME HIG Unification Plan](README.md)  
> See also: [Nesting UX](nesting.md), [Tokens & CSS](tokens.md)

---

## GNOME HIG Layout Pattern

GNOME apps follow a consistent layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  Header Bar                                                      │
├──────────┬───────────────────────────────────────┬──────────────┤
│          │                                       │              │
│  Sidebar │  Content Area                         │  Inspector   │
│  (nav)   │  (primary workspace)                  │  (optional)  │
│          │                                       │              │
│          ├───────────────────────────────────────┤              │
│          │  Message Bar / Bottom Sheet           │              │
└──────────┴───────────────────────────────────────┴──────────────┘
```

---

## Arbesk Layout

**Root level (top-level world):**

```
┌─────────────────────────────────────────────────────────────────┐
│ [✦] Arbesk  │ My World · 3 nodes    [◐][◐][◐]  [Save][Publish] │ HDR
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                      │
│ 🖊 Create │            3D Viewport                               │
│ 🌳 Outln │            (Babylon.js canvas)                       │
│ 📚 Lib   │                                                      │
│ 📋 Ledger│            [Inspector — only on selection]           │
│          │                                                      │
│ ──────── │                                                      │
│          ├──────────────────────────────────────────────────────┤
│ VIEW     │ [Describe your 3D asset…                       ][✦] │ MSG
│ CONTENT  │                                                      │
├──────────┴──────────────────────────────────────────────────────┤
│ Draft · 3 nodes · 1 child · Provider: Mock   [⏻ Wallet]        │ BAR
└─────────────────────────────────────────────────────────────────┘
```

**Nested view (inside a child world):**

```
┌─────────────────────────────────────────────────────────────────┐
│ [✦] [←] My World > Living Room   · 2 nodes   [◐][◐]  [Save]   │ HDR
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                      │
│ 🖊 Create │            3D Viewport                               │
│ 🌳 Outln │            (Living Room's canvas)                    │
│ 📚 Lib   │                                                      │
│ 📋 Ledger│            [Inspector — only on selection]           │
│          │                                                      │
│ ──────── │                                                      │
│          ├──────────────────────────────────────────────────────┤
│          │ [Describe an object for this room…            ][✦]  │ MSG
├──────────┴──────────────────────────────────────────────────────┤
│ Depth 1/5 · 2 nodes · Token #42 · Living Room  [⏻ Wallet]     │ BAR
└─────────────────────────────────────────────────────────────────┘
```

---

## Zones

| Zone | What it replaces | Content |
|---|---|---|
| **Header Bar** | Current `.arabesque-topbar` | Brand icon, back button (nested), breadcrumb path bar, document title, history timeline pill, Save/Publish buttons |
| **Left Sidebar** | `.chat-sidebar` + `.asset-library-panel` + `.ledger-panel` | Unified sidebar with View Switcher (4 icons) |
| **Content Area** | `.main-stage` + `.viewport` | 3D canvas + bottom message bar |
| **Right Inspector** | Floating `#inspector` | Contextual sidebar. Appears on node selection. Two modes. |
| **Bottom Bar** | New | Nesting depth, node/child counts, provider, wallet button |

---

## View Switcher — 4 Views

The sidebar uses a vertical icon stack to switch between four views:

| # | View | Icon | Content |
|---|---|---|---|
| 1 | **Create** | 🖊 | Asset settings (name, provider, tier, team), chat history, version slider |
| 2 | **Outline** | 🌳 | Scene tree showing nodes and child worlds. Click to select, double-click to dive. |
| 3 | **Library** | 📚 | "My Assets" + "Shared Assets" with draggable asset cards |
| 4 | **Ledger** | 📋 | Operation filter + stats + log entries |

---

## Header Bar

**Root level:**
```
[✦ Arbesk]  My World · 3 nodes     [◐][◐][◐]  [Save][Publish]
```

**Nested (inside child world):**
```
[✦ Arbesk] [←] My World  ▸  Living Room  · 2 nodes   [◐][◐]   [Save]
             ^ back  ^────────── path bar ──────────
```

| Element | When visible |
|---|---|
| Brand icon only (no text) | Always |
| Back button (←) | Nested only |
| Path bar (clickable breadcrumbs) | Nested only |
| Document title + counts | Always |
| History timeline pill | When asset has history |
| Save button | Always when asset is open |
| Publish button | Root level only |
| Wallet button | Moved to bottom bar |

Dive/Ascend: Double-click child world → dive. Back button / `Alt+Left` / `Escape` → ascend. Breadcrumb click → jump to ancestor.

---

## Message Bar (Prompt Input)

Pinned to bottom of content area. Expands on multi-line input. Generate button inline.

```
┌─────────────────────────────────────────────────────────────────┐
│                         3D Viewport                              │
├─────────────────────────────────────────────────────────────────┤
│ [Describe your 3D asset…                                 ][✦]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Bottom Bar

```
Draft · 3 nodes · 1 child · Provider: Mock     [⏻ Wallet]
```

Shows document state, depth, counts, provider. Wallet button lives here.

---

## Adaptive Breakpoints

| Breakpoint | Layout |
|---|---|
| **Narrow** (< 480px) | Sidebar hidden, swipe-to-reveal. Viewport full-width. Inspector as bottom sheet. |
| **Medium** (480–900px) | Sidebar overlays content. Inspector overlays content. |
| **Wide** (900px+) | Full three-column: sidebar | viewport | inspector. All visible. |

---

## What Gets Removed

| Element | Reason |
|---|---|
| `.arabesque-lattice-border` | Decorative, no function |
| `#app::before` pattern background | Decorative, interferes with legibility |
| `#mobileMenuBtn` | Replaced by adaptive sidebar |
| `#showSidebarBtn` | Replaced by unified sidebar toggle |
| `#showAssetLibraryBtn` | Replaced by unified sidebar toggle |
| `#ledgerPanelToggle` | Replaced by unified sidebar toggle |
| `#assetStatus` block | Replaced by headerbar title + path bar |
| `#newAssetTopBtn` | Moved to Create view + `Ctrl+N` |
| Bootstrap 5 dependency | Replaced by token system |
| `.chat-editor` wrapper | Replaced by message bar |
| `.welcome-overlay` | Replaced by inline empty state |
| `.waiting-overlay` | Replaced by inline spinner + status |
| `.arabesque-spinner` | Replaced by inline spinner on button |
