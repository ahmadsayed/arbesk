/**
 * WAI-ARIA APG menu button: a button that opens a role="menu" popup.
 * @remarks Shared by the theme picker (Phase 1) and the New ▾ menu (Phase 2).
 *   Keyboard: Enter/Space (native click)/ArrowDown open on the first item, ArrowUp on the
 *   last; in the menu ArrowUp/Down cycle, Home/End jump, Enter/Space select,
 *   Escape/Tab close. Focus returns to the button on close-by-key or select.
 *   The menu is fixed-positioned under the button so clipping ancestors
 *   (the headerbar is overflow: hidden) can't cut it off.
 */

const ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** Gap between the button and the menu, and minimum distance from the window edge. */
const MENU_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

export interface MenuButtonOptions {
  onSelect: (item: HTMLElement) => void;
  /** Runs before the menu is shown (refresh item visibility here). */
  onOpen?: () => void;
  /** Which button edge the menu lines up with. Default "end" (right edges). */
  align?: "start" | "end";
}

export interface MenuButtonHandle {
  open(focus?: "first" | "last"): void;
  close(): void;
  destroy(): void;
}

export function initMenuButton(
  button: HTMLElement,
  menu: HTMLElement,
  opts: MenuButtonOptions,
): MenuButtonHandle {
  const items = (): HTMLElement[] =>
    Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
      (el) => !el.hidden && el.getAttribute("aria-disabled") !== "true",
    );

  const isOpen = () => !menu.hidden;

  function focusAt(index: number) {
    const list = items();
    if (!list.length) return;
    const i = ((index % list.length) + list.length) % list.length;
    // preventScroll: focusing inside a clipping ancestor would scroll it.
    list[i].focus({ preventScroll: true });
  }

  // Line the menu up under the button (per opts.align), kept inside the window.
  function place() {
    const b = button.getBoundingClientRect();
    const width = menu.getBoundingClientRect().width;
    const preferred = opts.align === "start" ? b.left : b.right - width;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX;
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(preferred, maxLeft));
    menu.style.position = "fixed";
    menu.style.top = `${b.bottom + MENU_GAP_PX}px`;
    menu.style.left = `${left}px`;
  }

  function open(focus: "first" | "last" = "first") {
    opts.onOpen?.();
    menu.hidden = false;
    place();
    button.setAttribute("aria-expanded", "true");
    focusAt(focus === "first" ? 0 : -1);
  }

  function close(returnFocus = false) {
    if (!isOpen()) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus({ preventScroll: true });
  }

  function select(item: HTMLElement) {
    if (item.getAttribute("aria-disabled") === "true" || item.hidden) return;
    close(true);
    opts.onSelect(item);
  }

  const onButtonClick = () => (isOpen() ? close() : open("first"));

  // Enter/Space on a native <button> already fire "click" (handled above);
  // handling them here too would open-then-toggle-closed.
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    open(e.key === "ArrowDown" ? "first" : "last");
  };

  // Keys inside the open menu belong to it: stop them reaching the
  // document-level viewport shortcuts (Home = frame all, Escape = deselect…).
  const activate = (list: HTMLElement[], current: number) => {
    if (current >= 0) select(list[current]);
  };

  // Key → action on the focused item. Tab is absent: it closes the menu but
  // keeps its default so focus moves on naturally.
  const MENU_KEYS: Record<string, (list: HTMLElement[], current: number) => void> = {
    ArrowDown: (_l, current) => focusAt(current + 1),
    ArrowUp: (_l, current) => focusAt(current - 1),
    Home: () => focusAt(0),
    End: () => focusAt(-1),
    Enter: activate,
    " ": activate,
    Escape: () => close(true),
  };

  const onMenuKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Tab") {
      close();
      return;
    }
    const action = Object.hasOwn(MENU_KEYS, e.key) ? MENU_KEYS[e.key] : undefined;
    if (!action) return;
    e.preventDefault();
    const list = items();
    action(list, list.indexOf(document.activeElement as HTMLElement));
  };

  const onMenuClick = (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(ITEM_SELECTOR);
    if (item && menu.contains(item)) select(item);
  };

  const onResize = () => close();

  const onDocPointer = (e: Event) => {
    const t = e.target as Node;
    if (isOpen() && !menu.contains(t) && !button.contains(t)) close();
  };

  button.addEventListener("click", onButtonClick);
  button.addEventListener("keydown", onButtonKey);
  menu.addEventListener("keydown", onMenuKey);
  menu.addEventListener("click", onMenuClick);
  document.addEventListener("pointerdown", onDocPointer);
  window.addEventListener("resize", onResize);

  return {
    open,
    close: () => close(),
    destroy() {
      button.removeEventListener("click", onButtonClick);
      button.removeEventListener("keydown", onButtonKey);
      menu.removeEventListener("keydown", onMenuKey);
      menu.removeEventListener("click", onMenuClick);
      document.removeEventListener("pointerdown", onDocPointer);
      window.removeEventListener("resize", onResize);
    },
  };
}
