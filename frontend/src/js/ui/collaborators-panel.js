/**
 * Arbesk Collaborator Panel — Reusable Merkle Editor UI
 *
 * Renders the editor list for a token and optionally allows add/remove/role
 * changes. Used by the Studio read-only indicator and by the Library's
 * collection-level "Manage Collaborators" dialog.
 */

import {
  fetchEditors,
  addTeamMember,
  removeTeamMember,
  changeTeamMemberRole,
  isOwner,
  CollaboratorRole,
} from "../services/team.js";
import { truncateAddress } from "../utils/format.js";
import { showToast } from "./toasts.js";

const instances = new Map();

/**
 * Build (or rebuild) a collaborator panel inside `container` for `tokenId`.
 *
 * @param {HTMLElement} container
 * @param {string|number} tokenId
 * @param {object} [options]
 * @param {boolean} [options.editable=false]
 * @returns {{ refresh: () => Promise<void>, destroy: () => void }}
 */
export function initCollaboratorPanel(container, tokenId, options = {}) {
  destroyCollaboratorPanel(container);

  const state = {
    tokenId,
    editable: Boolean(options.editable),
    isOwner: false,
    abortController: new AbortController(),
  };
  instances.set(container, state);

  container.innerHTML = "";
  container.classList.add("collaborator-panel");

  const header = document.createElement("div");
  header.className = "team-header";

  const title = document.createElement("h5");
  title.textContent = "Collaborators";
  header.appendChild(title);

  const ownerBadge = document.createElement("span");
  ownerBadge.className = "owner-badge";
  ownerBadge.hidden = true;
  ownerBadge.textContent = "Owner";
  header.appendChild(ownerBadge);
  state.ownerBadge = ownerBadge;

  const list = document.createElement("div");
  list.id = "collaboratorList";
  list.className = "team-list";
  state.list = list;

  const controls = document.createElement("div");
  controls.className = "team-add";
  controls.hidden = true;

  const input = document.createElement("input");
  input.id = "collaboratorAddInput";
  input.type = "text";
  input.className = "form-control";
  input.placeholder = "0x… wallet address";
  input.setAttribute("aria-label", "Wallet address");

  const roleSelect = document.createElement("select");
  roleSelect.id = "collaboratorRoleSelect";
  roleSelect.className = "form-select";
  roleSelect.setAttribute("aria-label", "Collaborator role");
  roleSelect.innerHTML = `
    <option value="${CollaboratorRole.Editor}" selected>Editor</option>
    <option value="${CollaboratorRole.Viewer}">Viewer</option>
  `;

  const addBtn = document.createElement("button");
  addBtn.id = "collaboratorAddBtn";
  addBtn.type = "button";
  addBtn.className = "btn btn-secondary";
  addBtn.textContent = "Add";

  controls.appendChild(input);
  controls.appendChild(roleSelect);
  controls.appendChild(addBtn);

  state.controls = controls;
  state.input = input;
  state.roleSelect = roleSelect;

  const signal = state.abortController.signal;

  addBtn.addEventListener(
    "click",
    async () => {
      const addr = input.value.trim();
      if (!addr) return;
      const role = parseInt(roleSelect.value, 10);
      try {
        await addTeamMember(tokenId, addr);
        input.value = "";
        await refresh();
      } catch (err) {
        console.warn("[COLLAB-PANEL] add failed:", err.message);
        showToast({
          type: "error",
          title: "Add Failed",
          message: err.message || "Could not add collaborator.",
        });
      }
    },
    { signal }
  );

  input.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") addBtn.click();
    },
    { signal }
  );

  container.appendChild(header);
  container.appendChild(list);
  container.appendChild(controls);

  async function refresh() {
    if (instances.get(container) !== state) return;

    try {
      state.isOwner = await isOwner(tokenId);
      const editorList = await fetchEditors(tokenId);
      renderList(state, editorList);
    } catch (err) {
      console.warn("[COLLAB-PANEL] refresh failed:", err.message);
      list.innerHTML = "";
    }
  }

  function destroy() {
    destroyCollaboratorPanel(container);
  }

  refresh();
  return { refresh, destroy };
}

function destroyCollaboratorPanel(container) {
  const state = instances.get(container);
  if (!state) return;
  state.abortController?.abort();
  instances.delete(container);
  container.innerHTML = "";
  container.classList.remove("collaborator-panel");
}

function renderList(state, editorList) {
  const { list, ownerBadge, controls } = state;
  list.innerHTML = "";

  const editable = state.editable && state.isOwner;
  ownerBadge.hidden = !state.isOwner;
  controls.hidden = !editable;

  const fragment = document.createDocumentFragment();

  for (const entry of editorList) {
    const el = document.createElement("div");
    el.className = "team-item";
    el.dataset.address = entry.address.toLowerCase();

    const roleLabel =
      entry.role === CollaboratorRole.Editor ? "Editor" : "Viewer";

    const roleBadge = document.createElement("span");
    roleBadge.className = `team-role-badge team-role-${roleLabel.toLowerCase()}`;
    roleBadge.textContent = roleLabel;

    const addrSpan = document.createElement("span");
    addrSpan.className = "team-addr";
    addrSpan.textContent = truncateAddress(entry.address);

    el.appendChild(roleBadge);
    el.appendChild(addrSpan);

    if (editable) {
      const actions = document.createElement("div");
      actions.className = "team-actions";

      const roleBtn = document.createElement("button");
      roleBtn.type = "button";
      roleBtn.className = "btn btn-icon btn-xs";
      roleBtn.title =
        entry.role === CollaboratorRole.Editor
          ? "Downgrade to Viewer"
          : "Upgrade to Editor";
      roleBtn.textContent = entry.role === CollaboratorRole.Editor ? "▼" : "▲";
      roleBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const newRole =
          entry.role === CollaboratorRole.Editor
            ? CollaboratorRole.Viewer
            : CollaboratorRole.Editor;
        await mutate(state, () => changeTeamMemberRole(state.tokenId, entry.address, newRole));
      });
      actions.appendChild(roleBtn);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-icon btn-xs btn-danger";
      removeBtn.title = "Remove collaborator";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await mutate(state, () => removeTeamMember(state.tokenId, entry.address));
      });
      actions.appendChild(removeBtn);

      el.appendChild(actions);

      el.addEventListener("click", () => {
        list
          .querySelectorAll(".team-item")
          .forEach((i) => i.classList.remove("team-item-selected"));
        el.classList.add("team-item-selected");
      });
    }

    fragment.appendChild(el);
  }

  if (!fragment.childNodes.length) {
    const empty = document.createElement("p");
    empty.className = "team-empty";
    empty.textContent = "No collaborators yet.";
    fragment.appendChild(empty);
  }

  list.appendChild(fragment);
}

async function mutate(state, operation) {
  try {
    await operation();
    const editorList = await fetchEditors(state.tokenId);
    renderList(state, editorList);
  } catch (err) {
    console.warn("[COLLAB-PANEL] mutation failed:", err.message);
    showToast({
      type: "error",
      title: "Update Failed",
      message: err.message || "Could not update collaborators.",
    });
  }
}
