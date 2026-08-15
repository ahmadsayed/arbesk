const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * Rewrites all [title] attributes that contain "Ctrl+" to use the platform
 * modifier. On Mac: "New asset (Ctrl+N)" → "New asset (⌘N)".
 * On Linux/Windows this is a no-op.
 */
export function rewriteShortcutTitles(): void {
  if (!isMac) return;
  document.querySelectorAll('[title]').forEach(el => {
    const target = el as HTMLElement;
    target.title = target.title.replace(/Ctrl\+/g, '⌘');
  });
}
