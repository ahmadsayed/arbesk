---
name: gnome-hig-audit
description: Use when asked to audit or score the Arbesk Studio UI/UX (WCAG 2.2, web conventions, Arbesk design language) — "audit the UI", "check GNOME HIG compliance", "check the design language", "evaluate UX", contrast ratios, dark/light themes, layout, typography, keyboard navigation, accessibility (ARIA, focus, reduced motion), wallet/transaction UX, "find UI violations", or any broad interface quality assessment.
---

# Arbesk Studio UI/UX Audit

Audit the Arbesk Studio frontend against four complementary references; output a scored report with actionable recommendations per violation.

**Hard rule**: Studio is a browser dApp, not native GTK. Four references, each owning one job — never let one overreach:

- **WCAG 2.2** (2.1 AA is the regulatory baseline) = accessibility truth. On conflict with any other reference, WCAG wins.
- **Web/browser conventions** = interaction truth (keyboard, forms, focus; WAI-ARIA APG patterns — menus use `ui/menu-button.ts`). Desktop shortcuts (e.g. `Alt+←`) only where they don't fight the browser default.
- **Arbesk design language** (`docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md`) = visual/layout authority: Graphite/Paper themes, flat surfaces, `--hairline` structure, one accent only on the primary action, sentence case, Inter for UI, JetBrains Mono (`.tabular`) only for data.
- **Web3 / dApp UX** = domain guidance (wallet clarity, transaction feedback, on/off-chain transparency, trust cues). See `references/web3-ux.md`.

**GNOME HIG** is optional layout heuristics only (header bar, view switcher, 4px spacing, minimal chrome) — never a reason to flag a violation on its own.

## References

- Read `references/checklists.md` when running a full audit (categories A–K, scoring, how to run).
- Read `references/quick-audit.md` for 5-minute triage (its GNOME reference apps — Builder, Nautilus, Text Editor — are layout heuristics, not rules).
- Read `references/web3-ux.md` for category K (wallet, transaction, trust, on/off-chain clarity).
- Read `references/report-template.md` when writing the scored report.

## Audit Categories

| # | Category | Weight | Covers |
|---|----------|--------|--------|
| A | Color & Theming | 1.0 | Theme contract (`frontend/src/scss/themes/`), Graphite/Paper parity, accent discipline, semantic color — contrast enforced by `test/frontend/theme-contrast.test.js` |
| B | Typography | 0.8 | Font hierarchy, line heights, heading levels |
| C | Layout & Spacing | 1.0 | Panel sizing, spacing scale, grid alignment |
| D | Buttons & Controls | 1.0 | Touch targets, states, variants, icon-only |
| E | Keyboard Navigation | 1.2 | Shortcuts, discoverability, focus order, guards, shortcut pragmatism |
| F | Accessibility | 1.2 | WCAG 2.2 AA/AAA, ARIA, focus rings, reduced motion |
| G | Forms & Input | 0.8 | Labels, placeholders, errors, help text |
| H | Dialogs & Modals | 0.8 | Focus trap, Escape dismiss, backdrop, animation |
| I | Responsive Design | 0.8 | Breakpoints, touch targets, overflow |
| J | Empty States & Feedback | 0.6 | Welcome, loading, error, idle states |
| K | Web3 & Trust | 0.8 | Wallet, transaction, on/off-chain, trust cues |

## Score Interpretation

| Range | Rating | Action |
|-------|--------|--------|
| 90–100 | ✅ Excellent | Minor polish only |
| 80–89 | 👍 Good | A few improvements recommended |
| 65–79 | ⚠️ Fair | Several violations need attention |
| 50–64 | 🔶 Poor | Significant design-language or accessibility gaps |
| <50 | 🔴 Critical | Major rework needed |
