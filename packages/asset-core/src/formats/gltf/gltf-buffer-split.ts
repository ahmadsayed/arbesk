/**
 * Splits embedded glTF buffers into one buffer per mesh.
 * @remarks A buffer is the unit of content addressing: one buffer per file
 *   means any mesh change re-stores every mesh, and two assets that share a
 *   mesh share nothing. With one buffer per mesh, an unchanged mesh keeps its
 *   CID across versions and across assets. Everything no single mesh owns
 *   (animation, skins, accessors used by several meshes, small meshes) goes
 *   to one shared buffer. Bytes are copied, never re-encoded.
 *
 *   Shared by the GLB parser, the glTF decomposer and the glTF Web Worker, so
 *   it must stay free of imports the worker cannot resolve.
 */

/** Most meshes that get a buffer of their own; the rest share one. */
export const MAX_MESH_BUFFERS = 64;

/** Meshes smaller than this share a buffer: a file each would not pay off. */
export const MIN_MESH_BUFFER_BYTES = 32 * 1024;

/** Owner of bytes no single mesh owns. */
const SHARED = -1;

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/** One JSON object that points into a bufferView, and the bytes it reads. */
interface Ref {
  view: number;
  /** Byte range read, relative to the bufferView start. */
  start: number;
  end: number;
  owner: number;
  /** Object carrying `bufferView` (and `byteOffset` for accessor-like refs). */
  holder: any;
  /** False for refs that address the whole bufferView (Draco, images). */
  hasOffset: boolean;
}

/** The byte range one owner reads from one bufferView. */
interface Piece {
  view: number;
  owner: number;
  start: number;
  end: number;
  refs: Ref[];
}

/** Bytes of one accessor element, including glTF matrix column padding. */
function elementBytes(accessor: any): number | null {
  const size = COMPONENT_BYTES[accessor.componentType];
  const count = TYPE_COMPONENTS[accessor.type];
  if (!size || !count) return null;
  if (accessor.type === "MAT2" && size === 1) return 8;
  if (accessor.type === "MAT3" && size <= 2) return 12 * size;
  return size * count;
}

/**
 * Maps each accessor a mesh uses to that mesh, or to SHARED when several
 * meshes use it.
 */
function accessorOwners(composite: any): Map<number, number> {
  const owners = new Map<number, number>();
  const claim = (accessor: unknown, mesh: number) => {
    if (typeof accessor !== "number") return;
    const previous = owners.get(accessor);
    owners.set(accessor, previous === undefined || previous === mesh ? mesh : SHARED);
  };
  (composite.meshes || []).forEach((mesh: any, index: number) => {
    for (const primitive of mesh.primitives || []) {
      claim(primitive.indices, index);
      for (const accessor of Object.values(primitive.attributes || {})) claim(accessor, index);
      for (const target of primitive.targets || []) {
        for (const accessor of Object.values(target || {})) claim(accessor, index);
      }
    }
  });
  return owners;
}

/** Ref for a holder that reads `bytes` from its bufferView at `byteOffset`. */
function offsetRef(holder: any, bytes: number, owner: number): Ref {
  const start = holder.byteOffset || 0;
  return { view: holder.bufferView, start, end: start + bytes, owner, holder, hasOffset: true };
}

/** Refs of a sparse accessor's indices and values, or null when malformed. */
function sparseRefs(sparse: any, elementSize: number, owner: number): Ref[] | null {
  const indexSize = COMPONENT_BYTES[sparse.indices?.componentType];
  if (!indexSize || !sparse.values) return null;
  return [
    offsetRef(sparse.indices, sparse.count * indexSize, owner),
    offsetRef(sparse.values, sparse.count * elementSize, owner),
  ];
}

/** Refs of one accessor: its own data plus sparse indices and values. */
function accessorRefs(accessor: any, owner: number, views: any[]): Ref[] | null {
  const size = elementBytes(accessor);
  if (!size) return null;
  const refs: Ref[] = [];
  if (accessor.bufferView !== undefined) {
    const stride = views[accessor.bufferView]?.byteStride || size;
    const bytes = accessor.count > 0 ? (accessor.count - 1) * stride + size : 0;
    refs.push(offsetRef(accessor, bytes, owner));
  }
  if (!accessor.sparse) return refs;
  const sparse = sparseRefs(accessor.sparse, size, owner);
  return sparse && [...refs, ...sparse];
}

/** Refs that address a whole bufferView: Draco primitives and images. */
function wholeViewRefs(composite: any, views: any[]): Ref[] {
  const refs: Ref[] = [];
  const add = (holder: any, owner: number) => {
    if (holder?.bufferView === undefined) return;
    const end = views[holder.bufferView]?.byteLength || 0;
    refs.push({ view: holder.bufferView, start: 0, end, owner, holder, hasOffset: false });
  };
  (composite.meshes || []).forEach((mesh: any, index: number) => {
    for (const primitive of mesh.primitives || []) {
      add(primitive.extensions?.KHR_draco_mesh_compression, index);
    }
  });
  for (const image of composite.images || []) add(image, SHARED);
  return refs;
}

/** Every reference into a bufferView, or null when one cannot be measured. */
function collectRefs(composite: any, views: any[]): Ref[] | null {
  const owners = accessorOwners(composite);
  const refs = wholeViewRefs(composite, views);
  const accessors = composite.accessors || [];
  for (let i = 0; i < accessors.length; i++) {
    const found = accessorRefs(accessors[i], owners.get(i) ?? SHARED, views);
    if (!found) return null;
    refs.push(...found);
  }
  return refs;
}

/** True when a ref reads a non-empty range inside its bufferView and buffer. */
function isReadable(ref: Ref, views: any[], bytesByBuffer: Array<Uint8Array | undefined>): boolean {
  const view = views[ref.view];
  if (!view) return false;
  const bytes = bytesByBuffer[view.buffer];
  if (!bytes) return true; // not ours to split; only its index is remapped
  const viewEnd = (view.byteOffset || 0) + view.byteLength;
  return ref.end > ref.start && ref.end <= view.byteLength && viewEnd <= bytes.length;
}

/**
 * Groups the refs of one bufferView into one piece per owner.
 * @remarks When two owners' ranges overlap (data interleaved across meshes)
 *   the whole view becomes one shared piece.
 */
function piecesForView(view: number, refs: Ref[]): Piece[] {
  const byOwner = new Map<number, Piece>();
  for (const ref of refs) {
    const piece = byOwner.get(ref.owner);
    if (!piece) {
      byOwner.set(ref.owner, { view, owner: ref.owner, start: ref.start, end: ref.end, refs: [ref] });
      continue;
    }
    piece.start = Math.min(piece.start, ref.start);
    piece.end = Math.max(piece.end, ref.end);
    piece.refs.push(ref);
  }
  const pieces = [...byOwner.values()].sort((a, b) => a.start - b.start);
  const overlaps = pieces.some((piece, i) => i > 0 && piece.start < pieces[i - 1].end);
  if (!overlaps) return pieces;
  return [{
    view,
    owner: SHARED,
    start: pieces[0].start,
    end: Math.max(...pieces.map((piece) => piece.end)),
    refs,
  }];
}

/**
 * Moves meshes that should not get their own buffer to the shared one: those
 * under the size floor, and the smallest ones beyond the buffer cap.
 */
function demoteSmallMeshes(pieces: Piece[]): void {
  const bytesByMesh = new Map<number, number>();
  for (const piece of pieces) {
    if (piece.owner === SHARED) continue;
    bytesByMesh.set(piece.owner, (bytesByMesh.get(piece.owner) || 0) + piece.end - piece.start);
  }
  const kept = new Set(
    [...bytesByMesh.entries()]
      .filter(([, bytes]) => bytes >= MIN_MESH_BUFFER_BYTES)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, MAX_MESH_BUFFERS)
      .map(([mesh]) => mesh)
  );
  for (const piece of pieces) {
    if (!kept.has(piece.owner)) piece.owner = SHARED;
  }
}

/** A buffer under construction: copied ranges and where each one lands. */
interface Group {
  length: number;
  chunks: Array<{ offset: number; bytes: Uint8Array }>;
}

/**
 * Appends a byte range to a group and returns its offset.
 * @remarks The range keeps its position modulo 4 so every accessor stays
 *   aligned to its component size, whatever the source layout was.
 */
function appendRange(group: Group, bytes: Uint8Array, sourceOffset: number): number {
  const offset = Math.ceil(group.length / 4) * 4 + (sourceOffset % 4);
  group.chunks.push({ offset, bytes });
  group.length = offset + bytes.length;
  return offset;
}

/** Materializes a group, padded to a multiple of 4 so buffers concatenate safely. */
function groupBytes(group: Group): Uint8Array {
  const out = new Uint8Array(Math.ceil(group.length / 4) * 4);
  for (const chunk of group.chunks) out.set(chunk.bytes, chunk.offset);
  return out;
}

/** Points a ref's holder at its new bufferView. */
function retarget(ref: Ref, view: number, pieceStart: number): void {
  ref.holder.bufferView = view;
  if (!ref.hasOffset) return;
  const offset = ref.start - pieceStart;
  if (offset > 0) ref.holder.byteOffset = offset;
  else delete ref.holder.byteOffset;
}

/**
 * Plans the split: one piece per (bufferView, owner) for every view on a
 * buffer we hold bytes for, or null when the document cannot be split safely.
 */
function planPieces(
  refs: Ref[],
  views: any[],
  bytesByBuffer: Array<Uint8Array | undefined>
): Piece[] | null {
  const refsByView = new Map<number, Ref[]>();
  for (const ref of refs) {
    if (!isReadable(ref, views, bytesByBuffer)) return null;
    const list = refsByView.get(ref.view) || [];
    list.push(ref);
    refsByView.set(ref.view, list);
  }
  const pieces: Piece[] = [];
  for (let i = 0; i < views.length; i++) {
    if (!bytesByBuffer[views[i].buffer]) continue;
    const viewRefs = refsByView.get(i);
    // A view nothing known reads, or one an extension (meshopt) redirects,
    // cannot be relocated safely.
    if (!viewRefs || views[i].extensions) return null;
    pieces.push(...piecesForView(i, viewRefs));
  }
  return pieces;
}

/** Refs and pieces of a document that can be split. */
interface SplitPlan {
  refs: Ref[];
  pieces: Piece[];
}

/** Plans the split, or returns null when the document must stay as it is. */
function planSplit(
  composite: any,
  views: any[],
  buffers: any[],
  bytesByBuffer: Array<Uint8Array | undefined>
): SplitPlan | null {
  const embedded = buffers.map((_, i) => !!bytesByBuffer[i]);
  if (!embedded.includes(true)) return null;
  const refs = collectRefs(composite, views);
  const pieces = refs && planPieces(refs, views, bytesByBuffer);
  if (!refs || !pieces) return null;
  // Every embedded buffer must contribute bytes, or it would silently vanish.
  const used = new Set(pieces.map((piece) => views[piece.view].buffer));
  if (embedded.some((isEmbedded, i) => isEmbedded && !used.has(i))) return null;
  return { refs, pieces };
}

/** Mesh owners in index order, the shared owner last. */
function orderedOwners(pieces: Piece[]): number[] {
  const meshes = [...new Set(pieces.map((piece) => piece.owner))].filter((o) => o !== SHARED);
  meshes.sort((a, b) => a - b);
  return pieces.some((piece) => piece.owner === SHARED) ? [...meshes, SHARED] : meshes;
}

/** Groups pieces by the bufferView they were cut from. */
function piecesByView(pieces: Piece[]): Map<number, Piece[]> {
  const byView = new Map<number, Piece[]>();
  for (const piece of pieces) {
    const list = byView.get(piece.view) || [];
    list.push(piece);
    byView.set(piece.view, list);
  }
  return byView;
}

/**
 * Rewrites the composite so each mesh's bytes live in their own buffer.
 * @remarks `bufferBytesByIndex` holds the bytes of the embedded buffers,
 *   indexed like `composite.buffers`; buffers without bytes (ipfs:// refs,
 *   external URIs) are kept as they are. On success `composite.buffers`,
 *   `composite.bufferViews`, every bufferView reference and
 *   `bufferBytesByIndex` are rewritten in place. A document that cannot be
 *   split safely (bufferView extensions such as meshopt, unreadable or
 *   unreferenced views) is left untouched.
 * @returns whether the document was split
 */
export function splitBuffersByMesh(
  composite: any,
  bufferBytesByIndex: Array<Uint8Array | undefined>
): boolean {
  const views: any[] = composite?.bufferViews || [];
  const buffers: any[] = composite?.buffers || [];
  const plan = planSplit(composite, views, buffers, bufferBytesByIndex);
  if (!plan) return false;
  demoteSmallMeshes(plan.pieces);

  // Buffers we do not hold bytes for keep their entry; split ones follow,
  // meshes first (by index) and the shared buffer last.
  const newBuffers: any[] = [];
  const keptBufferIndex = new Map<number, number>();
  buffers.forEach((buffer, i) => {
    if (bufferBytesByIndex[i]) return;
    keptBufferIndex.set(i, newBuffers.length);
    newBuffers.push(buffer);
  });
  const owners = orderedOwners(plan.pieces);
  const groups = new Map<number, Group>(owners.map((owner) => [owner, { length: 0, chunks: [] }]));
  const groupBufferIndex = new Map(owners.map((owner, i) => [owner, newBuffers.length + i]));

  const newViews: any[] = [];
  const byView = piecesByView(plan.pieces);
  views.forEach((view, i) => {
    const source = bufferBytesByIndex[view.buffer];
    if (!source) {
      for (const ref of plan.refs) if (ref.view === i) ref.holder.bufferView = newViews.length;
      newViews.push({ ...view, buffer: keptBufferIndex.get(view.buffer) });
      return;
    }
    for (const piece of byView.get(i) || []) {
      const from = (view.byteOffset || 0) + piece.start;
      const bytes = source.subarray(from, from + piece.end - piece.start);
      const byteOffset = appendRange(groups.get(piece.owner) as Group, bytes, from);
      for (const ref of piece.refs) retarget(ref, newViews.length, piece.start);
      newViews.push({
        ...view,
        buffer: groupBufferIndex.get(piece.owner),
        byteOffset,
        byteLength: bytes.length,
      });
    }
  });

  bufferBytesByIndex.length = 0;
  for (const owner of owners) {
    const bytes = groupBytes(groups.get(owner) as Group);
    bufferBytesByIndex[newBuffers.length] = bytes;
    newBuffers.push({ byteLength: bytes.length });
  }
  composite.buffers = newBuffers;
  composite.bufferViews = newViews;
  return true;
}
