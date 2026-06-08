# Quick Audit — GNOME HIG UI/UX Audit

5-minute triage checklist and GNOME reference application comparisons.

## 15. Quick Audit (5-Minute Triage)

For a fast first-pass, check only these items — they reveal the most about overall HIG health:

1. **A.1.1** Body text contrast (WCAG AA) — the most fundamental accessibility requirement.
2. **D.1.1** Button touch targets ≥ 36px — indicates whether mobile/touch was considered.
3. **E.1.11** Tab focus order — reveals if keyboard-only users can navigate.
4. **F.1.1** ARIA labels on all icon-only buttons — the minimum screen reader bar.
5. **F.3.1** `prefers-reduced-motion` support — shows whether accessibility was designed-in or bolted-on.
6. **H.2.3** Dialog focus trap — the most common modal bug that traps keyboard users.
7. **J.1.1** Welcome/empty state exists — shows whether idle states were designed.

If any of these 7 fail, the audit score will almost certainly be below 70.

---

## 16. Known HIG Patterns to Compare Against

When assessing the Arbesk Studio, compare it to these GNOME reference applications:

| App | What to compare |
|-----|-----------------|
| **GNOME Builder** | Header bar layout, view switcher, panel collapse |
| **GNOME Files (Nautilus)** | Sidebar with places, list/grid toggle, context menus |
| **GNOME Text Editor** | Document title in header, save indicator |
| **GNOME Settings** | View switcher with icon-only sidebar, search |
| **GNOME Console** | Bottom input bar, monospace output |

Arbesk Studio is closest to **GNOME Builder** (IDE-like, 3D viewport, multiple panels, keyboard shortcuts) in its *visual aesthetic and panel layout*, but remember it is a **browser-based Web 3.0 application**. When in doubt about a pattern:
- For **visual design and layout**: ask "What would Builder do?"
- For **accessibility**: ask "Does this meet WCAG 2.1 AA?"
- For **interaction and keyboard behavior**: ask "Does this follow web application conventions?"
- For **responsive and touch**: ask "Does this work on a modern web browser with mixed input?"
