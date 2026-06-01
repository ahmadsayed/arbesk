/**
 * Arbesk Micro-Ledger Schema
 *
 * Typed operation record definitions and validation for the append-only
 * audit trail. Every manifest mutation, generation, parametric edit,
 * save, publish, mint, and team-editor change is recorded as a LedgerEntry.
 */

/**
 * Valid operation types.
 * @enum {string}
 */
export const OP_TYPE = {
  GENERATION: "GENERATION",
  PARAMETRIC: "PARAMETRIC",
  SAVE: "SAVE",
  PUBLISH: "PUBLISH",
  THUMBNAIL: "THUMBNAIL",
  MINT: "MINT",
  TOKEN_URI_UPDATE: "TOKEN_URI_UPDATE",
  TEAM_EDIT: "TEAM_EDIT",
  LOAD: "LOAD",
  REVERT: "REVERT",
  SNAPSHOT: "SNAPSHOT",
};

const VALID_OP_TYPES = new Set(Object.values(OP_TYPE));

/**
 * @typedef {Object} LedgerEntry
 * @property {string} id - ULID or ISO-timestamp sortable ID
 * @property {number} timestamp - Unix milliseconds
 * @property {string} opType - One of OP_TYPE values
 * @property {string} manifestId - The manifest asset_id affected
 * @property {string} cid - IPFS CID of the resulting manifest
 * @property {string|null} prevCid - Previous manifest CID (null for genesis)
 * @property {'USER'|'SYSTEM'|'CONTRACT'} actorType
 * @property {string} actorAddress - Wallet address or 'system'
 * @property {Object} payload - Op-type-specific data
 */

/**
 * Generate a sortable, monotonic entry ID.
 * Format: <timestamp>-<random> ensuring lexicographic sort = time sort.
 */
export function generateEntryId() {
  const ts = String(Date.now()).padStart(16, "0");
  const rand = Math.random().toString(36).substring(2, 10);
  return `${ts}-${rand}`;
}

/**
 * Validate a LedgerEntry against the schema.
 * Returns { valid: false, errors: [...] } or { valid: true }.
 */
export function validateLedgerEntry(entry) {
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push("entry must be an object");
    return { valid: false, errors };
  }

  if (!entry.id || typeof entry.id !== "string") {
    errors.push("entry.id is required (string)");
  }
  if (typeof entry.timestamp !== "number" || entry.timestamp <= 0) {
    errors.push("entry.timestamp must be a positive number");
  }
  if (!entry.opType || !VALID_OP_TYPES.has(entry.opType)) {
    errors.push(
      `entry.opType must be one of: ${Object.values(OP_TYPE).join(", ")}`
    );
  }
  if (!entry.manifestId || typeof entry.manifestId !== "string") {
    errors.push("entry.manifestId is required (string)");
  }
  if (!entry.cid || typeof entry.cid !== "string") {
    errors.push("entry.cid is required (string)");
  }
  // prevCid can be null or string
  if (entry.prevCid !== undefined && entry.prevCid !== null && typeof entry.prevCid !== "string") {
    errors.push("entry.prevCid must be null or string");
  }
  if (!["USER", "SYSTEM", "CONTRACT"].includes(entry.actorType)) {
    errors.push('entry.actorType must be USER, SYSTEM, or CONTRACT');
  }
  if (!entry.actorAddress || typeof entry.actorAddress !== "string") {
    errors.push("entry.actorAddress is required (string)");
  }
  if (!entry.payload || typeof entry.payload !== "object") {
    errors.push("entry.payload is required (object)");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Create a LedgerEntry with defaults.
 * @param {Object} params
 * @returns {LedgerEntry}
 */
export function createLedgerEntry({
  opType,
  manifestId,
  cid,
  prevCid = null,
  actorType = "USER",
  actorAddress = "system",
  payload = {},
}) {
  return {
    id: generateEntryId(),
    timestamp: Date.now(),
    opType,
    manifestId,
    cid,
    prevCid,
    actorType,
    actorAddress,
    payload,
  };
}
