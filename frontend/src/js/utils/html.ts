/**
 * Escape HTML special characters in a string.
 */
export function escapeHtml(str: any): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
