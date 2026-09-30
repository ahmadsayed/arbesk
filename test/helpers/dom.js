/**
 * Registers a jsdom window (window, document, HTMLElement, ...) as globals for
 * the current test process.
 *
 * @remarks Loaded as a --preload by scripts/run-tests.mjs for every test file
 *   whose first line is `// @test-env dom`. It must be a preload, not an
 *   import: Bun evaluates CommonJS dependencies (alpinejs) while linking the
 *   module graph, before the test file's own side-effect imports run, so an
 *   in-file import registers the DOM too late. It is opt-in per file because
 *   the API and CLI suites must keep Bun's own globals. Each test file runs in
 *   its own process, so there is nothing to tear down.
 *
 *   jsdom, not happy-dom: happy-dom misparses colon-prefixed attribute names,
 *   so an Alpine `:class` binding leaves `className` stale after classList
 *   updates. The fixtures mirror the production templates, which use `:class`.
 */
import { JSDOM } from "jsdom";

const { window } = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true, // requestAnimationFrame, as in a browser
});

/**
 * Runtime primitives Bun already provides and the code under test shares with
 * non-DOM callers. jsdom's versions come from its own realm, so taking them
 * would break `instanceof` checks (Uint8Array) and swap out Bun's fetch.
 * Blob, File and FormData are NOT kept: jsdom's FileReader only accepts jsdom
 * Blobs, Bun's FormData rejects them, and the frontend reads blobs through
 * FileReader, as it did under Jest.
 */
const KEEP_BUN = new Set([
  "fetch", "Request", "Response", "Headers",
  "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "crypto",
  "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "queueMicrotask", "structuredClone", "atob", "btoa", "AbortController",
  "AbortSignal", "WebSocket", "ReadableStream", "WritableStream",
  "TransformStream", "console", "Worker",
]);

/** jsdom's methods check their receiver; bind them to jsdom's window. */
function fromJsdom(key) {
  const value = window[key];
  return typeof value === "function" && !/^[A-Z]/.test(key) ? value.bind(window) : value;
}

for (const key of Object.getOwnPropertyNames(window)) {
  if (KEEP_BUN.has(key) || key in globalThis) continue;
  try {
    globalThis[key] = fromJsdom(key);
  } catch {
    // read-only on the global object
  }
}

// `window` IS the global object, as in a browser and under Jest's jsdom
// environment: suites set `global.Notyf = ...` and the code reads
// `window.Notyf`, and jest.spyOn(window, "alert") must replace the `alert`
// that code calls bare. (A Proxy over jsdom's window cannot do this: Bun's
// spyOn does not install through a Proxy.)
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.location = window.location;
globalThis.history = window.history;
// Window-level listeners go on jsdom's window: that is where events dispatched
// on document bubble to (keyboard shortcuts, focus traps).
for (const key of [
  "addEventListener", "removeEventListener", "dispatchEvent",
  "getComputedStyle", "matchMedia", "scrollTo", "getSelection",
]) {
  if (window[key]) globalThis[key] = fromJsdom(key);
}

// Bun's alert/confirm/prompt block on stdin; jsdom's only log "not
// implemented", as they did under Jest's jsdom environment.
for (const key of ["alert", "confirm", "prompt"]) globalThis[key] = window[key].bind(window);

// Events must come from jsdom's realm (dispatchEvent rejects foreign ones), and
// so must Blob/File/FormData (jsdom's FileReader rejects Bun's) — Bun defines all of
// these, so the copy loop above skipped them.
for (const key of [
  "Blob", "File", "FileList", "FileReader", "FormData",
  "Event", "EventTarget", "CustomEvent", "KeyboardEvent", "MouseEvent",
  "FocusEvent", "InputEvent", "UIEvent", "PointerEvent", "DragEvent",
  "ErrorEvent", "MessageEvent", "StorageEvent", "HashChangeEvent", "PopStateEvent",
]) {
  if (window[key]) globalThis[key] = window[key];
}
