/**
 * Removes embedded image bytes from GLB buffers once the images are stored as
 * their own IPFS objects.
 * @remarks Shared by the GLB parser and the glTF Web Worker, so it must stay
 *   free of `@gltf-transform/core` and other imports the worker cannot
 *   resolve.
 */

/** Byte range of an embedded image inside its GLB buffer. */
export interface ImageRemoval {
  bufferIndex: number;
  oldBvIndex: number;
  start: number;
  end: number;
}

/**
 * Describes the buffer range a bufferView-backed image occupies, or null for
 * an image that is not stored in a bufferView.
 */
export function imageRemovalFor(composite: any, img: any): ImageRemoval | null {
  if (img?.bufferView === undefined) return null;
  const bv = composite.bufferViews?.[img.bufferView];
  if (!bv) return null;
  const start = bv.byteOffset || 0;
  return {
    bufferIndex: bv.buffer,
    oldBvIndex: img.bufferView,
    start,
    end: start + bv.byteLength,
  };
}

interface ByteRange {
  start: number;
  end: number;
}

/**
 * Rewrites holder.bufferView through fn when present; fn returning a number
 * replaces the reference.
 */
function mapBufferViewSlot(holder: any, fn: (index: number) => number | void): void {
  if (holder?.bufferView === undefined) return;
  const mapped = fn(holder.bufferView);
  if (mapped !== undefined) holder.bufferView = mapped;
}

/**
 * Calls fn with every bufferView index referenced by an accessor (direct +
 * sparse), rewriting the reference when fn returns a number.
 */
function forEachAccessorBufferView(
  accessors: any,
  fn: (index: number) => number | void
): void {
  for (const acc of accessors) {
    mapBufferViewSlot(acc, fn);
    mapBufferViewSlot(acc.sparse?.indices, fn);
    mapBufferViewSlot(acc.sparse?.values, fn);
  }
}

/**
 * Calls fn with every bufferView index referenced by Draco mesh extensions,
 * rewriting the reference when fn returns a number.
 */
function forEachDracoBufferView(
  meshes: any,
  fn: (index: number) => number | void
): void {
  for (const mesh of meshes) {
    for (const prim of mesh.primitives || []) {
      mapBufferViewSlot(prim.extensions?.KHR_draco_mesh_compression, fn);
    }
  }
}

/**
 * Calls fn with every bufferView index referenced by accessors (incl. sparse)
 * or mesh extensions (Draco), rewriting the reference when fn returns a
 * number.
 * @remarks Pruning one of these would corrupt geometry.
 */
function forEachBufferViewRef(
  composite: any,
  fn: (index: number) => number | void
): void {
  forEachAccessorBufferView(composite.accessors || [], fn);
  forEachDracoBufferView(composite.meshes || [], fn);
}

/**
 * Collects the bufferViews referenced by accessors (incl. sparse) or mesh
 * extensions (Draco).
 */
function collectReferencedBufferViews(composite: any): Set<number> {
  const referenced = new Set<number>();
  forEachBufferViewRef(composite, (index) => {
    referenced.add(index);
  });
  return referenced;
}

/**
 * Rewrite every bufferView reference (accessors, sparse, Draco) through the
 * old→new index mapping after bufferViews were compacted.
 */
function renumberBufferViewRefs(composite: any, mapping: Map<number, number>): void {
  forEachBufferViewRef(composite, (index) => mapping.get(index));
}

/** Sort ranges by start and merge overlapping/adjacent ones. */
function mergeRanges(ranges: ByteRange[]): ByteRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: ByteRange[] = [];
  for (const r of sorted) {
    if (merged.length === 0 || r.start > merged[merged.length - 1].end) {
      merged.push({ start: r.start, end: r.end });
    } else {
      merged[merged.length - 1].end = Math.max(
        merged[merged.length - 1].end,
        r.end
      );
    }
  }
  return merged;
}

/**
 * Reports whether any surviving bufferView overlaps a range about to be
 * pruned.
 * @remarks The caller must abort the prune in that case.
 */
function anyRemainingViewOverlaps(
  composite: any,
  bufferIndex: number,
  ranges: ByteRange[]
): boolean {
  for (const bv of composite.bufferViews) {
    if (bv.buffer !== bufferIndex) continue;
    const start = bv.byteOffset || 0;
    const end = start + bv.byteLength;
    for (const r of ranges) {
      if (end <= r.start || start >= r.end) continue;
      return true;
    }
  }
  return false;
}

/**
 * Extends each range over the padding that follows it, then re-merges.
 * @remarks Exporters pad an image to a 4-byte boundary. Left behind, those
 *   1-3 bytes make the buffer's content depend on the image sizes, so the
 *   same geometry with another texture would get a different CID. A gap is
 *   padding when it is under 4 bytes and no remaining bufferView covers it.
 */
function absorbTrailingPadding(
  composite: any,
  bufferIndex: number,
  ranges: ByteRange[],
  bufferLength: number
): ByteRange[] {
  const boundaries = [bufferLength, ...ranges.map((r) => r.start)];
  for (const bv of composite.bufferViews) {
    if (bv.buffer === bufferIndex) boundaries.push(bv.byteOffset || 0);
  }
  const extended = ranges.map((r) => {
    const next = Math.min(...boundaries.filter((b) => b >= r.end));
    return { start: r.start, end: next - r.end < 4 ? next : r.end };
  });
  return mergeRanges(extended);
}

/** Build new buffer bytes with the given ranges excised. */
function spliceOutRanges(bytes: Uint8Array, ranges: ByteRange[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let last = 0;
  for (const r of ranges) {
    if (r.start > last) parts.push(bytes.subarray(last, r.start));
    last = r.end;
  }
  if (last < bytes.length) parts.push(bytes.subarray(last));

  const newBytes = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    newBytes.set(p, pos);
    pos += p.length;
  }
  return newBytes;
}

/** Shift surviving bufferViews' byteOffsets down past the excised ranges. */
function adjustBufferViewOffsets(
  composite: any,
  bufferIndex: number,
  ranges: ByteRange[]
): void {
  for (const bv of composite.bufferViews) {
    if (bv.buffer !== bufferIndex) continue;
    const oldOffset = bv.byteOffset || 0;
    let adjustment = 0;
    for (const r of ranges) {
      if (r.end <= oldOffset) adjustment += r.end - r.start;
    }
    bv.byteOffset = oldOffset - adjustment;
  }
}

/**
 * Keeps the removals whose bufferView nothing else reads.
 * @remarks A bufferView an accessor or mesh extension also references must
 *   stay in the buffer, or geometry would be corrupted.
 */
function prunableRemovals(
  composite: any,
  removals: ImageRemoval[],
  logPrefix: string
): ImageRemoval[] {
  const referenced = collectReferencedBufferViews(composite);
  return removals.filter((r) => {
    if (!referenced.has(r.oldBvIndex)) return true;
    console.warn(
      `${logPrefix} bufferView ${r.oldBvIndex} is also referenced by accessors/extensions, not pruning`
    );
    return false;
  });
}

/** Drops the given bufferViews and renumbers every reference to the rest. */
function compactBufferViews(composite: any, indicesToRemove: Set<number>): void {
  const oldBufferViews = composite.bufferViews || [];
  const newBufferViews: any[] = [];
  const mapping = new Map<number, number>();
  for (let i = 0; i < oldBufferViews.length; i++) {
    if (indicesToRemove.has(i)) continue;
    mapping.set(i, newBufferViews.length);
    newBufferViews.push(oldBufferViews[i]);
  }
  composite.bufferViews = newBufferViews;
  renumberBufferViewRefs(composite, mapping);
}

/** Groups removals by the buffer they belong to. */
function groupByBuffer(removals: ImageRemoval[]): Map<number, ImageRemoval[]> {
  const byBuffer = new Map<number, ImageRemoval[]>();
  for (const r of removals) {
    const list = byBuffer.get(r.bufferIndex) || [];
    list.push(r);
    byBuffer.set(r.bufferIndex, list);
  }
  return byBuffer;
}

/**
 * Removes image byte ranges from GLB buffers after the images were extracted
 * to separate IPFS objects.
 * @remarks Updates bufferViews, accessors, and byteLength so geometry is
 *   preserved and image bytes aren't stored twice. `composite` and
 *   `bufferBytesByIndex` are mutated.
 */
export function pruneBufferImageData(
  composite: any,
  bufferBytesByIndex: Array<Uint8Array | undefined>,
  removals: ImageRemoval[],
  logPrefix: string
): void {
  const prunable = prunableRemovals(composite, removals, logPrefix);
  if (prunable.length === 0) return;

  compactBufferViews(composite, new Set(prunable.map((r) => r.oldBvIndex)));

  for (const [bufferIndex, ranges] of groupByBuffer(prunable)) {
    const bytes = bufferBytesByIndex[bufferIndex];
    if (!bytes) continue;

    const merged = absorbTrailingPadding(
      composite, bufferIndex, mergeRanges(ranges), bytes.length
    );

    if (anyRemainingViewOverlaps(composite, bufferIndex, merged)) {
      console.warn(
        `${logPrefix} buffer ${bufferIndex}: remaining bufferView overlaps pruned image range, aborting prune`
      );
      continue;
    }

    const newBytes = spliceOutRanges(bytes, merged);
    adjustBufferViewOffsets(composite, bufferIndex, merged);
    bufferBytesByIndex[bufferIndex] = newBytes;
    composite.buffers[bufferIndex].byteLength = newBytes.length;
  }
}
