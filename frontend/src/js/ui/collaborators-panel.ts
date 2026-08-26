/**
 * Arbesk Collaborator Panel - Reusable Merkle Editor UI (Alpine.js)
 *
 * Renders the editor list for a token and optionally allows add/remove/role
 * changes. Used by the Studio read-only indicator and by the Library's
 * collection-level "Manage Collaborators" dialog.
 *
 * The list is a reactive Alpine component: each host injects the static
 * template below, points `x-data` at the registered "collaboratorPanel"
 * component (passing tokenId/editable/id), and initializes the subtree with
 * Alpine.initTree(). Because there are two independent hosts (the Studio
 * #teamPanel and the Library dialog's dynamically-created container), state
 * is per-instance (keyed by the generated id), NOT a single global store.
 *
 * The DOM keeps every id/class byte-identical to the pre-Alpine build (E2E
 * contract): #collaboratorList, #collaboratorAddInput, #collaboratorAddBtn,
 * #collaboratorRoleSelect, .team-item[data-address], .team-role-badge, etc.
 */

import {
  fetchEditors,
  addTeamMember,
  removeTeamMember,
  changeTeamMemberRole,
  resolveCollaboratorInput,
  collaboratorInputEmail,
  isOwner,
  CollaboratorRole,
} from "../services/team.ts";
import { truncateAddress } from "../utils/format.ts";
import { walletState } from "../state/wallet-state.ts";
import { showToast } from "./toasts.ts";
import { Alpine, registerAlpineComponent } from "./alpine.ts";

/** Reactive state for one collaborator panel instance. */
interface CollaboratorPanelState {
  tokenId: string | number;
  editable: boolean;
  isOwner: boolean;
  /** View-model rows rendered by the x-for template. */
  editors: EditorVm[];
  /** lowercased address of the selected row (team-item-selected). */
  selected: string | null;
  /** x-model bound to the add input. */
  draft: string;
}

/** View-model row rendered by the x-for template. */
interface EditorVm {
  /** full address, for change/remove and :title */
  address: string;
  /** lowercased address, for data-address + selection matching */
  addressLower: string;
  /** email (invite tag or self) or truncated address */
  display: string;
  role: number;
  roleLabel: string;
  roleToggleTitle: string;
  roleToggleGlyph: string;
}

const instances = new Map<HTMLElement, string>();
const byId = new Map<string, CollaboratorPanelState>();
let seq = 0;

/**
 * Static Alpine template injected into each host. Written as an HTML string
 * (not a Pug partial) because the Library dialog's host is created at
 * runtime; the Studio #teamPanel placeholder is replaced with this same
 * markup. Role option values match CollaboratorRole (2 = Editor, 1 = Viewer).
 */
const TEMPLATE = `
  <div class="team-header">
    <h5>Collaborators</h5>
    <span class="owner-badge" x-show="isOwner">Owner</span>
  </div>
  <div id="collaboratorList" class="team-list">
    <template x-for="e in editors" :key="e.addressLower">
      <div
        class="team-item"
        :data-address="e.addressLower"
        :class="{ 'team-item-selected': e.addressLower === selected }"
        @click="select(e)"
      >
        <span
          class="team-role-badge"
          :class="'team-role-' + e.roleLabel.toLowerCase()"
          x-text="e.roleLabel"
        ></span>
        <span class="team-addr" :title="e.address" x-text="e.display"></span>
        <template x-if="canEdit">
          <div class="team-actions">
            <button
              type="button"
              class="btn btn-icon btn-xs"
              :title="e.roleToggleTitle"
              x-text="e.roleToggleGlyph"
              @click.stop="toggleRole(e)"
            ></button>
            <button
              type="button"
              class="btn btn-icon btn-xs btn-danger"
              title="Remove collaborator"
              @click.stop="remove(e)"
            >✕</button>
          </div>
        </template>
      </div>
    </template>
    <template x-if="!editors.length">
      <p class="team-empty">No collaborators yet.</p>
    </template>
  </div>
  <div class="team-add" x-show="canEdit">
    <input
      id="collaboratorAddInput"
      type="text"
      class="form-control"
      placeholder="Email or 0x address"
      aria-label="Email or wallet address"
      x-model="draft"
      @keydown.enter="add()"
    />
    <!-- Role select is present for parity with the pre-Alpine UI; the add
         path always adds the default role (addTeamMember takes no role). -->
    <select id="collaboratorRoleSelect" class="form-select" aria-label="Collaborator role">
      <option value="2" selected>Editor</option>
      <option value="1">Viewer</option>
    </select>
    <button id="collaboratorAddBtn" type="button" class="btn btn-secondary" @click="add()">Add</button>
  </div>
`;

function toVm(
  entry: { address: string; role: number; email?: string | null },
  selfAddress: string,
  selfEmail: string | null
): EditorVm {
  const addressLower = entry.address.toLowerCase();
  const roleLabel =
    entry.role === CollaboratorRole.Editor ? "Editor" : "Viewer";
  const displayEmail =
    entry.email || (addressLower === selfAddress ? selfEmail : null);
  return {
    address: entry.address,
    addressLower,
    display: displayEmail || truncateAddress(entry.address),
    role: entry.role,
    roleLabel,
    roleToggleTitle:
      entry.role === CollaboratorRole.Editor
        ? "Downgrade to Viewer"
        : "Upgrade to Editor",
    roleToggleGlyph: entry.role === CollaboratorRole.Editor ? "▼" : "▲",
  };
}

async function load(state: CollaboratorPanelState): Promise<void> {
  try {
    state.isOwner = await isOwner(state.tokenId);
    const editorList = await fetchEditors(state.tokenId);
    const selfAddress = (walletState.get().walletAddress || "").toLowerCase();
    const selfEmail = walletState.get().email || null;
    state.editors = editorList.map((entry) =>
      toVm(entry, selfAddress, selfEmail)
    );
  } catch (err) {
    console.warn("[COLLAB-PANEL] refresh failed:", (err as Error).message);
    state.editors = [];
  }
}

async function mutate(
  state: CollaboratorPanelState,
  operation: () => Promise<any>
): Promise<void> {
  try {
    await operation();
    await load(state);
  } catch (err) {
    console.warn("[COLLAB-PANEL] mutation failed:", (err as Error).message);
    showToast({
      type: "error",
      title: "Update Failed",
      message: (err as Error).message || "Could not update collaborators.",
    });
  }
}

/** Alpine component object for one panel (x-data="collaboratorPanel(...)"). */
interface CollaboratorPanelComponent {
  readonly canEdit: boolean;
  readonly isOwner: boolean;
  readonly editors: EditorVm[];
  readonly selected: string | null;
  draft: string;
  select(entry: EditorVm): void;
  add(): Promise<void>;
  toggleRole(entry: EditorVm): Promise<void>;
  remove(entry: EditorVm): Promise<void>;
}

/**
 * Alpine data factory for a single collaborator panel. Getters read the
 * reactive per-instance store, so Alpine effects track them; methods
 * delegate to the module functions above.
 */
function collaboratorPanel(params: {
  id: string;
  tokenId: string | number;
  editable: boolean;
}): CollaboratorPanelComponent {
  const state: CollaboratorPanelState = Alpine.reactive({
    tokenId: params.tokenId,
    editable: Boolean(params.editable),
    isOwner: false,
    editors: [],
    selected: null,
    draft: "",
  });
  byId.set(params.id, state);

  return {
    get canEdit() {
      return state.editable && state.isOwner;
    },
    get isOwner() {
      return state.isOwner;
    },
    get editors() {
      return state.editors;
    },
    get selected() {
      return state.selected;
    },
    get draft() {
      return state.draft;
    },
    set draft(value: string) {
      state.draft = value;
    },

    select(entry: EditorVm) {
      state.selected = entry.addressLower;
    },

    async add() {
      const raw = state.draft.trim();
      if (!raw) return;
      try {
        const addr = await resolveCollaboratorInput(raw);
        await addTeamMember(state.tokenId, addr, collaboratorInputEmail(raw));
        state.draft = "";
        await load(state);
      } catch (err) {
        console.warn("[COLLAB-PANEL] add failed:", (err as Error).message);
        showToast({
          type: "error",
          title: "Add Failed",
          message: (err as Error).message || "Could not add collaborator.",
        });
      }
    },

    async toggleRole(entry: EditorVm) {
      const newRole =
        entry.role === CollaboratorRole.Editor
          ? CollaboratorRole.Viewer
          : CollaboratorRole.Editor;
      await mutate(state, () =>
        changeTeamMemberRole(state.tokenId, entry.address, newRole)
      );
    },

    async remove(entry: EditorVm) {
      await mutate(state, () =>
        removeTeamMember(state.tokenId, entry.address)
      );
    },
  };
}

registerAlpineComponent("collaboratorPanel", collaboratorPanel);

/**
 * Build (or rebuild) a collaborator panel inside `container` for `tokenId`.
 * Preserves the legacy return contract { refresh, destroy }.
 */
export function initCollaboratorPanel(
  container: HTMLElement,
  tokenId: string | number,
  options: { editable?: boolean } = {}
): { refresh: () => Promise<void>; destroy: () => void } {
  destroyCollaboratorPanel(container);

  const id = "collab-" + String(tokenId) + "-" + (++seq);
  container.innerHTML = TEMPLATE;
  container.classList.add("collaborator-panel");
  container.setAttribute(
    "x-data",
    "collaboratorPanel(" +
      JSON.stringify({ id, tokenId, editable: Boolean(options.editable) }) +
      ")"
  );
  Alpine.initTree(container);
  instances.set(container, id);

  const state = byId.get(id);
  if (!state) {
    // Defensive: if Alpine failed to instantiate (e.g. not started), clean up.
    container.removeAttribute("x-data");
    container.innerHTML = "";
    throw new Error("collaboratorPanel failed to initialize");
  }

  void load(state);
  return {
    refresh: () => load(state),
    destroy: () => destroyCollaboratorPanel(container),
  };
}

function destroyCollaboratorPanel(container: HTMLElement): void {
  const id = instances.get(container);
  if (id) {
    byId.delete(id);
    instances.delete(container);
  }
  // Remove Alpine bindings before wiping the DOM so listeners/effects teardown.
  if (container.hasAttribute("x-data")) {
    Alpine.destroyTree(container);
    container.removeAttribute("x-data");
  }
  container.innerHTML = "";
  container.classList.remove("collaborator-panel");
}
