# Model Clock: Visual Dominance Polish — Design

**Date:** 2026-07-14
**Status:** Approved
**Builds on:** `2026-07-12-model-clock-time-mode-design.md` (Time mode, utility layer, plane drag — all retained)

## Problem

The model clock is the platform's signature feature, but it is styled like a
subdued utility gizmo: a thin gray torus at 35% alpha, small gray ticks, a tiny
cone "arrow" that is indistinguishable from a tick, and a small blue lozenge
handle. Nothing about it reads as important, and the arrow fails at its one
job — communicating which direction along the ring is newer.

## Decision

Restyle the clock to be **restrained but unmistakable**: stronger presence than
the transform gizmos (accent color, a filled progress arc, a prominent knob),
but no glow or entry animation. The standalone arrow is deleted; time direction
is communicated by the progress arc's fill.

## Design

### 1. Visual composition

- **Track:** the existing full-circle torus (`versionRing`), ~3× thicker than
  today (thickness factor 0.005 → ~0.015), gray, alpha raised to ~0.5. The
  translucent face disc is unchanged.
- **Progress arc:** a second torus with identical geometry overlaying the
  track, accent blue, fully opaque, filled **clockwise from v1's tick angle to
  the knob angle**. The filled/unfilled boundary is the current position;
  direction (older → newer) is implied by the fill. New mesh name
  `versionArc`.
- **Arrow:** the `versionArrow` cone mesh is **removed** entirely.
- **Ticks:** same radial box marks but larger. Colors: gray = normal, green =
  published; drag hover highlight behavior unchanged. The "active" accent tick
  color becomes redundant (the knob sits there) but remains for state clarity.
- **Knob:** replaces the tangent lozenge. A flat accent-blue disc with a
  lighter rim, ~2.5× the old handle size, seated on the ring at the arc
  boundary. Mesh name stays `versionHandle` so existing tests keep working.
  Hover switches to gizmo yellow; cursor grab/grabbing unchanged.
- **Version badge travels with the knob:** the `#modelClockBadge` DOM label
  anchors to a label host positioned just outside the knob and shows the
  active version (or the drag-hovered version while scrubbing). The tick label
  that coincides with the knob's tick is hidden to avoid doubling.
- **Tick labels:** all `v1…vN` labels remain but at low opacity (~0.35). The
  published version's label and the label nearest the pointer while dragging
  brighten to full opacity.

### 2. Arc shader (clipped torus)

The arc torus uses a small `BABYLON.ShaderMaterial`:

- Vertex shader passes the mesh-local XY position to the fragment stage.
- Fragment shader computes `atan2(y, x)`, normalizes the clockwise angular
  offset from a `startAngle` uniform (v1's angle) into [0, 2π), and
  `discard`s fragments whose offset exceeds a `sweep` uniform.
- During a drag, only the `sweep` float is updated per frame — no mesh
  rebuilds, no GC churn.

Rejected alternatives: rebuilding a tube arc every frame (GC churn, faceting),
and a 2D SVG/DOM overlay (abandons the utility-layer 3D anchoring and breaks
mesh-name-based tests).

### 3. Unchanged

Drag mechanics (ray/plane intersection, angle lerp smoothing, snap-on-release,
selection preservation via `clockTargetNodeId`), keyboard stepping, camera
billboarding + depth offset, silhouette-based radius scaling, lifecycle/event
wiring, and the version-history store. Mesh names `versionRing`,
`versionTick-*`, `versionHandle` are preserved.

### 4. Testing & cleanup

- **Jest** (`test/frontend/model-clock-gizmo.test.js`): drop `versionArrow`
  assertions; add assertions for the `versionArc` mesh, knob geometry, and the
  badge anchoring to the knob host.
- **E2E:** the `#modelClockBadge` id/text contract is preserved, so
  `e2e/specs/04-parametric-version.spec.js` should pass unmodified; re-run it
  because this is a Studio UI change.
- Remove the `[MODEL-CLOCK-DEBUG]` console.log statements from
  `model-clock-gizmo.js`.
- Gate: `npm run typecheck:frontend` → `npm run test:frontend` →
  `npm run test:e2e -- --project=chromium`.

## Out of scope

- Glow, bloom, or entry animations (declined — "restrained but unmistakable").
- Chevrons or any standalone direction arrow.
- Changes to the scene clock (2D version clock UI), the version-history store,
  or manifest semantics.
