# Patterns — Arbesk Studio UI / UX

Reusable UI patterns: empty states, drop zones, and spinners.

## 9. Common UI Patterns to Reuse

### Empty state

```pug
#welcomeOverlay.viewport-empty
  .viewport-empty-content
    .viewport-empty-icon ✦
    h2 Welcome to Arbesk
    p Create, compose, and publish tokenized 3D assets.
    .viewport-empty-actions
      button.btn.btn-primary Start New Asset
      p(style="font-size:var(--font-size-0);color:var(--choco-4);margin-top:var(--size-2)")
        | Generate an asset, open one from your library, or drag an asset into the scene.
```

### Drop zone overlay

```pug
#assetDropOverlay.viewport-drop-indicator
  div(style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--accent-bg);font-weight:600")
    .asset-drop-icon ⊕
    p Drop to add linked asset to scene
```

```scss
.viewport-drop-indicator {
  position: absolute;
  inset: var(--size-2);
  border: 2px dashed var(--accent-bg);
  border-radius: var(--radius-3);
  pointer-events: none;
  z-index: 25;
  opacity: 0;
  transition: opacity var(--duration-quick) var(--ease-out-3);
  &.active { opacity: 1; }
}
```

### Spinner

```scss
.viewport-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-bg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```
