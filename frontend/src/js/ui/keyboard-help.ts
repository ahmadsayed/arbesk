import { showInfoDialog } from "./dialog.ts";
import { MOD } from "../utils/platform.ts";

const SECTIONS = [
  {
    heading: "Viewport",
    rows: [
      ["F", "Frame selected"],
      ["Home", "Frame all"],
      ["0", "Reset view (forget saved camera position)"],
      ["G", "Toggle grid & axes"],
      ["Esc", "Deselect"],
    ],
  },
  {
    heading: "Navigation",
    rows: [
      [`${MOD}+B`, "Toggle sidebar"],
      [`${MOD}+1 – 5`, "Switch sidebar panel"],
      ["Alt+←", "Go up to parent asset"],
    ],
  },
  {
    heading: "Asset",
    rows: [
      [`${MOD}+N`, "New asset"],
      [`${MOD}+S`, "Save draft"],
      ["Delete", "Unlink selected child asset"],
      [`${MOD}+Z`, "Undo edit"],
      [`${MOD}+Shift+Z / ${MOD}+Y`, "Redo edit"],
    ],
  },
  {
    heading: "General",
    rows: [
      [`${MOD}+/`, "Show keyboard shortcuts"],
    ],
  },
];

function buildHtml(): string {
  const sections = SECTIONS.map(({ heading, rows }) => {
    const rowsHtml = rows
      .map(
        ([key, desc]) => `
        <tr>
          <td style="padding:3px var(--size-3) 3px 0;white-space:nowrap">
            <kbd style="font-family:var(--font-mono);font-size:var(--font-size-0);background:var(--view-bg);border:1px solid var(--border-color);border-radius:var(--radius-1);padding:1px 5px">${key}</kbd>
          </td>
          <td style="padding:3px 0;color:var(--window-fg);font-size:var(--font-size-1)">${desc}</td>
        </tr>`
      )
      .join("");
    return `
      <p style="margin:var(--size-3) 0 var(--size-1);font-size:var(--font-size-0);font-weight:var(--font-weight-6);color:var(--dim-fg);text-transform:uppercase;letter-spacing:0.05em">${heading}</p>
      <table style="width:100%;border-collapse:collapse">${rowsHtml}</table>`;
  }).join("");

  return `<div style="margin-top:calc(-1 * var(--size-2))">${sections}</div>`;
}

function showKeyboardHelp(): Promise<void> {
  return showInfoDialog("Keyboard Shortcuts", buildHtml());
}

document.getElementById("keyboardHelpBtn")?.addEventListener("click", showKeyboardHelp);

// Ctrl+/ (or ⌘/) opens the help dialog from anywhere
document.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && e.key === "/")) return;
  const active = document.activeElement as HTMLElement | null;
  const tag = active?.tagName?.toLowerCase();
  if (active?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") return;
  e.preventDefault();
  showKeyboardHelp();
});
