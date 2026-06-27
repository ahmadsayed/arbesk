# Nesting UX: Path Bar, Outliner & Inspector

> Part of [GNOME HIG Unification Plan](README.md)  
> See also: [Layout Architecture](layout.md)

---

## Header Bar — Nesting Navigation

### Root Level
```
[✦ Arbesk]  [Library][Studio]  My World · 3 nodes     [◐][◐][◐]  [Save][Besk] [Wallet]
```

### Nested (inside a child world)
```
[✦ Arbesk]  [Library][Studio]  [←] My World  ▸  Living Room  · 2 nodes   [◐][◐]   [Save] [Wallet]
                                ^ back  ^────────── path bar ──────────
```

Follows the **GNOME Path Bar** pattern (Nautilus/Files). Each breadcrumb segment is clickable. Back button ascends one level.

### Dive/Ascend Interactions

| Action | Behavior |
|---|---|
| Double-click child world in viewport or Outline | **Dive in** — save current state, load child manifest, update breadcrumb |
| Back button (←) or `Alt+Left` | **Ascend** one level |
| Click breadcrumb segment | Jump directly to that ancestor |
| `Escape` at root of child | Ascend to parent |
| Depth guard at 5 | Disable dive, show warning "Maximum nesting depth reached" |

### Publish Visibility
- Publish button hidden only when nested inside a non-token world
- Save button works at any level

---

## Outline View — Scene Hierarchy Tree

Primary navigation for fractal nesting. Shows what's in the current world without hunting through the viewport.

```
┌──────────────────────────────────────┐
│ Outline                        [+][-] │
│ ──────────────────────────────────── │
│                                       │
│ ▼ 🌐 My World (root)                  │
│   📦 Table_Mesh_01                    │
│   📦 Chair_Mesh_02                    │
│   ▼ 🧩 Living Room (Token #42)       │
│     📦 Sofa_Mesh_01                   │
│     🧩 Coffee Table (Token #17)       │
│   🧩 Garden (Token #89)              │
│                                       │
│ ──────────────────────────────────── │
│ 5 items · 2 children · Depth 1/5     │
└──────────────────────────────────────┘
```

**Icon key**: 🌐 = current world, 📦 = mesh node, 🧩 = token child world (dive-able)

### Outline Interactions

| Action | Behavior |
|---|---|
| **Click** | Select node in viewport (highlight, open inspector) |
| **Double-click** on 🧩 | Dive into child world |
| **Drag** from Gallery view onto Outline | Add token as child world at specific position |
| **[+] button** | Switch to Gallery view so an asset can be dragged into the scene |
| **[-] button** | Remove selected node |

Matches **GNOME Builder project tree** and **Blender Outliner** pattern.

---

## Inspector — Three Modes

Right sidebar. Appears on node selection, hidden when nothing selected. Pushes viewport (doesn't overlay).

### Mode 1: Regular Mesh Node — Parametric Color Editor

```
┌──────────────────────────┬──────────────────┐
│                          │ Properties       │
│  3D Viewport             │ ──────────────── │
│                          │ Color            │
│                          │ ──────────────── │
│                          │ Component        │
│                          │ [Mesh_0 swatch]  │
│                          │                  │
│                          │ [    color     ] │
│                          │                  │
└──────────────────────────┴──────────────────┘
```

Color edits are live-previewed on the selected component. They are baked into the manifest on Save/Besk it. The inspector also supports undo/redo for color changes (`Ctrl+Z` / `Ctrl+Shift+Z`).

### Mode 2: Token Child World Node

```
┌──────────────────────────┬──────────────────┐
│                          │ Properties       │
│  3D Viewport             │ ──────────────── │
│                          │ Token Info       │
│                          │ Linked Token #42 │
│                          │ Contract 0x…     │
│                          │ Chain 314159     │
│                          │ Resolution latest│
│                          │ Manifest CID …   │
│                          │ ──────────────── │
│                          │ [Open This       │
│                          │  World →]        │
└──────────────────────────┴──────────────────┘
```

### Mode 3: Asset Comments

```
┌──────────────────────────┬──────────────────┐
│                          │ Properties       │
│  3D Viewport             │ ──────────────── │
│                          │ Comments · 0     │
│                          │ ──────────────── │
│                          │ [No comments…]   │
│                          │                  │
│                          │ Add a comment    │
│                          │ [Textarea      ] │
│                          │ [Post]           │
└──────────────────────────┴──────────────────┘
```

---

## Selection Sync

| Trigger | Result |
|---|---|
| Click node in Outline | Viewport highlights it + inspector opens |
| Click mesh in viewport | Outline highlights it + inspector opens |
| Click empty space in viewport | Inspector closes |

Width: 340px (`--inspector-width`).

---

## Overlay Changes

| Current | Proposed |
|---|---|
| Welcome Overlay | Inline empty state with "Start New Asset" + "Open From Library" buttons |
| Waiting/Generation Overlay | Inline spinner on generate button + status text "Generating…" in bottom bar |
| Asset Drop Overlay | Viewport border highlight + matching highlight on target Outliner row |
| Settings Accordion | Always-visible in Settings sidebar view (no accordion toggle) |
| Dive into child world | Immediate scene swap (no transition; `prefers-reduced-motion` respected trivially) |

---

## New JS Modules

| Module | Purpose |
|---|---|
| `ui/sidebar.js` | Unified 5-view sidebar controller, collapse state, responsive behavior |
| `ui/outliner.js` | Scene hierarchy tree, selection sync, dive/ascend triggers |
| `ui/nesting.js` | Dive/ascend state machine, breadcrumb management, depth gating |
