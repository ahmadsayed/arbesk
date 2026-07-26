---
name: gnome-hig-audit
description: Use when asked to audit or score the Arbesk Studio UI/UX — "audit the UI", "check GNOME HIG compliance", "evaluate UX", contrast ratios, dark/light themes, layout, typography, keyboard navigation, accessibility (ARIA, focus, reduced motion), "find UI violations", or any broad interface quality assessment.
---

# GNOME HIG UI/UX Audit — Arbesk Studio

Audit the Arbesk Studio frontend against GNOME HIG; output a scored report with actionable recommendations per violation.

**Hard rule**: Studio is a browser Web3 app, not native GTK. GNOME HIG = design reference; **WCAG 2.1 is the primary accessibility standard — on conflict, WCAG wins**.

## References

- Read `references/checklists.md` when running a full audit (10 categories A–J, scoring, how to run).
- Read `references/quick-audit.md` for 5-minute triage (7 high-signal items) and GNOME reference apps: **Builder** = IDE-like layout, **Nautilus** = sidebar, **Text Editor** = header bar.
- Read `references/report-template.md` when writing the scored report.

## Audit Categories

| # | Category | Weight | Covers |
|---|----------|--------|--------|
| A | Color & Theming | 1.0 | Contrast ratios, dark/light parity, semantic color |
| B | Typography | 0.8 | Font hierarchy, line heights, heading levels |
| C | Layout & Spacing | 1.0 | Panel sizing, spacing scale, grid alignment |
| D | Buttons & Controls | 1.0 | Touch targets, states, variants, icon-only |
| E | Keyboard Navigation | 1.2 | Shortcuts, discoverability, focus order, guards |
| F | Accessibility | 1.2 | WCAG 2.1 AA/AAA, ARIA, focus rings, reduced motion |
| G | Forms & Input | 0.8 | Labels, placeholders, errors, help text |
| H | Dialogs & Modals | 0.8 | Focus trap, Escape dismiss, backdrop, animation |
| I | Responsive Design | 0.8 | Breakpoints, touch targets, overflow |
| J | Empty States & Feedback | 0.6 | Welcome, loading, error, idle states |

## Score Interpretation

| Range | Rating | Action |
|-------|--------|--------|
| 90–100 | ✅ Excellent | Minor polish only |
| 80–89 | 👍 Good | A few improvements recommended |
| 65–79 | ⚠️ Fair | Several violations need attention |
| 50–64 | 🔶 Poor | Significant HIG gaps |
| <50 | 🔴 Critical | Major rework needed |
