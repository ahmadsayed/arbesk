// @ts-nocheck
/**
 * ESM shim for the vendored workerpool UMD bundle.
 *
 * Web Workers don't inherit the page's import map, so we vendor a browser
 * bundle alongside the glTF worker. This module loads the UMD build and
 * re-exports its API as ES modules so both the main thread and the worker
 * can import it with a relative path.
 *
 * In a browser module context the UMD populates globalThis.workerpool; in
 * Node it populates module.exports, which static import exposes as
 * moduleExports.default. The shim works in both environments without a
 * top-level await so it does not delay dependent module execution.
 */

import * as moduleExports from "./workerpool-10.0.2.js";

const wp = globalThis.workerpool || moduleExports.default;

if (!wp) {
  throw new Error("workerpool bundle failed to load");
}

export const pool = wp.pool;
export const worker = wp.worker;
export const Transfer = wp.Transfer;
export const Promise = wp.Promise;
export const TerminateError = wp.TerminateError;
export const platform = wp.platform;
export const cpus = wp.cpus;
export const isMainThread = wp.isMainThread;
export const workerEmit = wp.workerEmit;
export default wp;
