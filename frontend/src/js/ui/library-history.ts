/**
 * Back / forward / up navigation between Library locations (Home and the
 * collections), modelled on a file browser such as GNOME Files: every change
 * of `currentCollectionTokenId` is recorded, Back and Forward walk that
 * trail, and going back or up to Home re-selects the collection just left.
 */

import { libraryState } from "../state/library-state.ts";
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { announce } from "./library-announce.ts";

/** A Library location: a collection token id, or null for Home. */
type Location = string | number | null;

const backStack: Location[] = [];
const forwardStack: Location[] = [];
let current: Location = null;
/** set while goBack/goForward moves, so the move isn't recorded as a new visit */
let travelling = false;

function normalize(loc: Location | undefined): Location {
  return loc === undefined || loc === "" ? null : loc;
}

function sameLocation(a: Location, b: Location): boolean {
  return String(a ?? "") === String(b ?? "");
}

function locationName(loc: Location): string {
  if (loc === null) return "collections";
  const collection = libraryState
    .get()
    .collections.find((c) => String(c.tokenId) === String(loc));
  return collection?.name || "collection";
}

/** Grid ids to select on arrival: the collection we came from, when it's listed. */
function selectionOnArrival(target: Location, from: Location): Array<string | number> {
  if (target !== null || from === null) return [];
  const collection = libraryState
    .get()
    .collections.find((c) => String(c.tokenId) === String(from));
  return collection ? [collection.id] : [];
}

function moveTo(target: Location): void {
  const from = current;
  travelling = true;
  try {
    libraryState.set({
      currentCollectionTokenId: target,
      selectedIds: selectionOnArrival(target, from),
    });
  } finally {
    travelling = false;
  }
}

function syncButtons(): void {
  const back = document.getElementById("libraryBackBtn") as HTMLButtonElement | null;
  const forward = document.getElementById("libraryForwardBtn") as HTMLButtonElement | null;
  if (back) back.disabled = backStack.length === 0;
  if (forward) forward.disabled = forwardStack.length === 0;
}

function onStateChanged(state: any): void {
  const next = normalize(state?.currentCollectionTokenId);
  if (sameLocation(next, current)) return;
  if (!travelling) {
    backStack.push(current);
    forwardStack.length = 0;
  }
  current = next;
  syncButtons();
}

export function goBack(): boolean {
  if (!backStack.length) return false;
  const target = backStack.pop() as Location;
  forwardStack.push(current);
  moveTo(target);
  announce(`Back to ${locationName(target)}`);
  return true;
}

export function goForward(): boolean {
  if (!forwardStack.length) return false;
  const target = forwardStack.pop() as Location;
  backStack.push(current);
  moveTo(target);
  announce(`Forward to ${locationName(target)}`);
  return true;
}

/** Up to Home (collections are one level deep). Recorded as a new visit. */
export function goUp(): boolean {
  if (current === null) return false;
  const from = current;
  libraryState.set({
    currentCollectionTokenId: null,
    selectedIds: selectionOnArrival(null, from),
  });
  announce("Returned to collections");
  return true;
}

/** Forget the trail (sign-out, or a different library subject). */
export function resetLibraryHistory(): void {
  backStack.length = 0;
  forwardStack.length = 0;
  current = normalize(libraryState.get().currentCollectionTokenId);
  syncButtons();
}

export function initLibraryHistory(): void {
  current = normalize(libraryState.get().currentCollectionTokenId);
  on(EVENTS.LIBRARY_STATE_CHANGED, onStateChanged);
  document.getElementById("libraryBackBtn")?.addEventListener("click", goBack);
  document.getElementById("libraryForwardBtn")?.addEventListener("click", goForward);
  syncButtons();
}
