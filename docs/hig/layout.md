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
┌──────────────────────────────────────────────────────────────────────────┐
│ [✦] Arbesk  [Library][Studio]  My World · 3 nodes  [Save][Besk] [Wallet] │ HDR
├──────────┬───────────────────────────────────────────────────────┬───────┤
│          │                                                       │       │
│ ✦ AI Gen │            3D Viewport                                │       │
│ ⚙ Settings│            (Babylon.js canvas)                        │ Insp  │
│ 🌳 Outln │                                                       │ (coll)│
│ 📚 Gallery│                                                       │       │
│ 📋 Activity│          [Inspector — open by default]             │       │
│          │                                                       │       │
├──────────┴───────────────────────────────────────────────────────┴───────┤
│ Draft · 3 nodes · 1 child · Depth 0/5                       [?]          │ BAR
└──────────────────────────────────────────────────────────────────────────┘
```

**Nested view (inside a child world):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [✦] [←] My World ▸ Living Room  · 2 nodes  [Save]                [Wallet]│ HDR
├──────────┬───────────────────────────────────────────────────────┬───────┤
│          │                                                       │       │
│ ✦ AI Gen │            3D Viewport                                │       │
│ ⚙ Settings│            (Living Room's canvas)                     │ Insp  │
│ 🌳 Outln │                                                       │ (coll)│
│ 📚 Gallery│                                                       │       │
│ 📋 Activity│          [Inspector — open by default]             │       │
│          │                                                       │       │
├──────────┴───────────────────────────────────────────────────────┴───────┤
│ Depth 1/5 · 2 nodes · Token #42 · Living Room               [?]          │ BAR
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Zones

| Zone | What it replaces | Content |
|---|---|---|
| **Header Bar** | Current `.arabesque-topbar` | Brand icon, page switcher (Library/Studio), back button (nested), breadcrumb path bar, document title, history timeline pill, Save/Besk it buttons, wallet button |
| **Left Sidebar** | `.chat-sidebar` + `.asset-library-panel` + `.ledger-panel` | Unified sidebar with View Switcher (5 icons) |
| **Content Area** | `.main-stage` + `.viewport` | 3D canvas (prompt input lives in the AI Generation sidebar view) |
| **Right Inspector** | Floating `#inspector` | Right sidebar. Open by default; content is contextual to the selected node. Collapsible via the X button. Modes: parametric color editor, token child info, asset comments. |
| **Bottom Bar** | New | Document state, nesting depth, node/child counts, keyboard-shortcuts button |

---

## View Switcher — 5 Views

The sidebar uses a vertical icon stack to switch between five views:

| # | View | `data-view` | Content |
|---|---|---|---|
| 1 | **AI Generation** | `chat` | Prompt input, generation history/status, provider select (Mock (Local) / Tripo 3D) with API-key dialog via the key icon |
| 2 | **Settings** | `settings` | Asset settings (name, collection, tier, collaborators) |
| 3 | **Outline** | `outline` | Scene tree showing nodes and child worlds. Click to select, double-click to dive. |
| 4 | **Gallery** | `library` | "My Assets" + "Shared Assets" with draggable asset cards |
| 5 | **Activity** | `ledger` | Operation filter + stats + log entries derived from the manifest chain |

**Sidebar width** — user-resizable on wide layouts (> 900px): drag the strip on the sidebar's right edge (or focus it and use ←/→, 16px steps), clamped 260–560px, persisted via `arbesk-sidebar-width`; double-click or Home restores the 340px token default. Hidden and inert at ≤900px where the sidebar is an overlay.

---

## Header Bar

**Root level:**
```
[✦ Arbesk]  [Library][Studio]  My World · 3 nodes     [◐][◐][◐]  [Save][Besk] [Wallet]
```

**Nested (inside child world):**
```
[✦ Arbesk]  [Library][Studio]  [←] My World  ▸  Living Room  · 2 nodes   [◐][◐]   [Save] [Wallet]
                                ^ back  ^────────── path bar ──────────
```

| Element | When visible |
|---|---|
| Brand icon only (no text) | Always |
| Page switcher (Library/Studio) | Always |
| Back button (←) | Nested only |
| Path bar (clickable breadcrumbs) | Nested only |
| Document title + counts | Always |
| History timeline pill | When asset has history |
| Save button | Always when asset is open |
| Besk it (Publish) button | Hidden only when nested in a non-token world |
| Wallet button | Always in headerbar actions |

Dive/Ascend: Double-click child world → dive. Back button / `Alt+Left` / `Escape` → ascend. Breadcrumb click → jump to ancestor.

---

## Prompt Input (AI Generation View)

Lives at the bottom of the AI Generation sidebar view, co-located with the conversation it feeds. Expands on multi-line input. Generate button inline.

```
┌──────────────────┐
│ AI Generation    │
│                  │
│ (chat history)   │
│                  │
│ [Describe…]  [✦] │
└──────────────────┘
```

---

## Bottom Bar

```
Draft · 3 nodes · 1 child · Depth 0/5          [?]
```

Shows document state, depth, node/child counts. Keyboard-shortcuts button lives here.

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
| `#assetStatus` block | Replaced by `#assetStatusName` / `#assetStatusMeta` in headerbar |
| `#newAssetTopBtn` | Superseded by `#newAssetBtn` in headerbar (still `Ctrl+N`) |
| Bootstrap 5 dependency | Replaced by token system |
| `.chat-editor` wrapper | Replaced by the AI Generation prompt input |
| `.welcome-overlay` | Replaced by inline empty state |
| `.waiting-overlay` | Replaced by inline spinner + status |
| `.arabesque-spinner` | Replaced by inline spinner on button |

---

## Progress Feedback (Save / Besk)

Long-running save/publish operations show a **viewport-top progress banner** (`#taskProgress`, `ui/task-progress.js`) — the GNOME infobar pattern applied to the 3D viewport.

- **Placement: top of the viewport, not the bottom bar.** GNOME HIG places transient operation feedback in infobars/banners at the top of the content area; the bottom bar is reserved for persistent state (Draft · node count · depth). Web3 convention likewise keeps staged transaction feedback (sign → confirm → finalize) persistently visible and non-blocking — a top banner survives the user's attention leaving the action button.
- **Non-blocking:** `pointer-events: none`; the scene stays interactive.
- **Stage hints:** each orchestrator stage advances the stepped fill with a plain-language label ("saving new version to IPFS…", "confirm the transaction in your wallet…"). No fake indeterminate animation — the bar only moves at real stage boundaries.
- **Outcome:** success fades out after ~2 s; failures switch to destructive red and linger ~4 s. Screen-reader announcements stay on the existing `srStatus` live region (`announceStatus`) — the banner itself is `aria-hidden` to avoid double-speech.
