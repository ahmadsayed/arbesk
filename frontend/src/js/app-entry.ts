/**
 * Single-bundle entry point.
 *
 * Previously app.pug loaded 22 separate <script type="module"> tags so each
 * module's top-level side effects ran in document order. This module imports
 * them in the exact same order, so esbuild can bundle the whole graph into one
 * minified file while preserving identical evaluation order (ESM caches each
 * module, so imports shared with app-init.ts execute once).
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
