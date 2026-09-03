/**
 * Single-bundle entry point.
 * @remarks Imports every module in the exact evaluation order the old
 *   per-script page relied on, so bundling preserves identical side-effect order.
 */
import "./engine/scene-graph.ts";
import "./engine/time-travel.ts";
import "./engine/parametric-preview.ts";
import "./engine/animation-preview.ts";
import "./blockchain/token-resolver.ts";
import "./blockchain/wallet.ts";
import "./services/api.ts";
import "./services/team.ts";
import "./ui/toasts.ts";
import "./ui/asset-save.ts";
import "./ui/asset-chrome.ts";
import "./ui/scene-clock.ts";
import "./ui/create-panel.ts";
import "./ui/asset-drop-zone.ts";
import "./services/asset-file-drop.ts";
import "./ui/sidebar.ts";
import "./ui/outliner.ts";
import "./ui/nesting.ts";
import "./ui/collaborators.ts";
import "./ui/wallet-popover.ts";
import "./ui/comments-panel.ts";
import "./app-init.ts";

import { on, off, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";

// Expose the process-wide event bus for page-context tests. The esbuild bundle
// inlines asset-core into app.js, so the old `/js/vendor/asset-core/events/bus.js`
// dynamic-import path no longer resolves; E2E specs subscribe to the same
// in-memory singleton through this hook instead.
(window as any).__arbeskBus = { on, off, emit, EVENTS };
