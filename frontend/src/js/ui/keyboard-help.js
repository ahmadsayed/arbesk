// @ts-nocheck
import { showInfoDialog } from "./dialog.js";
import { MOD } from "../utils/platform.js";

const SECTIONS = [
  {
    heading: "Viewport",
    rows: [
      ["F", "Frame selected"],
      ["Home", "Frame all"],
      ["1 / 3 / 7", "Front / Side / Top view"],
      ["Esc", "Deselect"],
    ],
  },
  {
    heading: "Navigation",
    rows: [
      [`${MOD}+B`, "Toggle sidebar"],
      [`${MOD}+1 – 5`, "Switch sidebar panel"],
      ["Alt+←", "Go up to parent world"],
    ],
  },
  {
    heading: "Asset",
    rows: [
      [`${MOD}+N`, "New asset"],
      [`${MOD}+S`, "Save draft"],
      [`${MOD}+Z`, "Undo color edit"],
      [`${MOD}+Shift+Z`, "Redo color edit"],
    ],
  },
  {
    heading: "General",
    rows: [
      [`${MOD}+/`, "Show keyboard shortcuts"],
    ],
  },
];

function buildHtml() {
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

export function showKeyboardHelp() {
  return showInfoDialog("Keyboard Shortcuts", buildHtml());
}

document.getElementById("keyboardHelpBtn")?.addEventListener("click", showKeyboardHelp);

// Ctrl+/ (or ⌘/) opens the help dialog from anywhere
document.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && e.key === "/")) return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (document.activeElement?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") return;
  e.preventDefault();
  showKeyboardHelp();
});
