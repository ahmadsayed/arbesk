# Nesting UX: Path Bar, Outliner & Inspector

> Part of [GNOME HIG Unification Plan](README.md)  
> See also: [Layout Architecture](layout.md)

---

## Header Bar — Nesting Navigation

### Root Level
```
[✦ Arbesk]  My World · 3 nodes     [◐][◐][◐]  [Save][Publish]
```

### Nested (inside a child world)
```
[✦ Arbesk] [←] My World  ▸  Living Room  · 2 nodes   [◐][◐]   [Save]
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
| Depth guard at 5 | Disable dive, show toast "Maximum nesting depth reached" |

### Publish Visibility
- Publish button hidden when nested (can only publish the root world)
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
| **Right-click** | Context menu: Open World, Remove from Parent, Move Up/Down |
| **Drag** from Library view onto Outline | Add token as child world at specific position |
| **Drag** within Outline | Reorder nodes |
| **[+] button** | Add child from library (token picker popover) |
| **[-] button** | Remove selected node |

Matches **GNOME Builder project tree** and **Blender Outliner** pattern.

---

## Inspector — Dual Mode

Right sidebar. Appears on node selection, hidden when nothing selected. Pushes viewport (doesn't overlay).

### Mode 1: Regular Mesh Node

```
┌──────────────────────────┬──────────────────┐
│                          │ Selection        │
│  3D Viewport             │ ──────────────── │
│                          │ Type: Mesh       │
│                          │ Name: Table_01   │
│                          │ ──────────────── │
│                          │ Color: [       ] │
│                          │ Scale X: ═══════ │
│                          │ Scale Y: ═══════ │
│                          │ Scale Z: ═══════ │
│                          │                  │
│                          │ [Save Variant]   │
│                          │ [Cancel]         │
└──────────────────────────┴──────────────────┘
```

### Mode 2: Token Child World Node

```
┌──────────────────────────┬──────────────────┐
│                          │ Selection        │
│  3D Viewport             │ ──────────────── │
│                          │ Type: Child      │
│                          │  World           │
│                          │ Token: #42       │
│                          │ Name: Living Rm  │
│                          │ Chain: 314159    │
│                          │ ──────────────── │
│                          │ Transform:       │
│                          │ Position X: [  ] │
│                          │ Position Y: [  ] │
│                          │ Position Z: [  ] │
│                          │ Rotation Y: [  ] │
│                          │ Scale:      [  ] │
│                          │ ──────────────── │
│                          │ [Open This       │
│                          │  World →]        │
│                          │ [Remove]         │
└──────────────────────────┴──────────────────┘
```

---

## Selection Sync

| Trigger | Result |
|---|---|
| Click node in Outline | Viewport highlights it + inspector opens |
| Click mesh in viewport | Outline highlights it + inspector opens |
| Click empty space in viewport | Inspector closes |

Width: 260px (`--inspector-width`).

---

## Overlay Changes

| Current | Proposed |
|---|---|
| Welcome Overlay | Inline empty state with "Start New Asset" + "Open From Library" buttons |
| Waiting/Generation Overlay | Inline spinner on generate button + status text "Generating…" in bottom bar |
| Asset Drop Overlay | Viewport border highlight + matching highlight on target Outliner row |
| Settings Accordion | Always-visible in Create view (no toggle) |
| Dive into child world | Smooth fade transition (200ms, respects `prefers-reduced-motion`) |

---

## New JS Modules

| Module | Purpose |
|---|---|
| `ui/sidebar.js` | Unified 4-view sidebar controller, collapse state, responsive behavior |
| `ui/outliner.js` | Scene hierarchy tree, selection sync, dive/ascend triggers |
| `ui/nesting.js` | Dive/ascend state machine, breadcrumb management, depth gating |
