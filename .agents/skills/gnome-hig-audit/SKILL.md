---
name: gnome-hig-audit
description: Evaluate Arbesk Studio UI/UX against GNOME Human Interface Guidelines. Audits color themes (contrast ratios, dark/light mode), layout (panel sizing, spacing), typography, keyboard navigation, accessibility (ARIA, focus, reduced motion), responsive breakpoints, and interaction patterns. Use when asked to "audit the UI", "check GNOME HIG compliance", "evaluate UX", "review color themes", or "assess accessibility".
---

# GNOME HIG UI/UX Audit — Arbesk Studio

Use this skill when asked to audit, evaluate, or review the Arbesk Studio frontend against GNOME Human Interface Guidelines (HIG). The audit produces a scored report with specific, actionable recommendations per violation.

> **Priority Context**: Arbesk Studio is a **Web 3.0 application** running in a browser, not a native desktop GTK app. GNOME HIG is used as a **design reference and inspiration**, but **WCAG 2.1 is the primary accessibility standard**. Where GNOME HIG and WCAG conflict, WCAG wins.

## Quick Decision

| Question | Action |
|----------|--------|
| Full audit requested? | Run all 10 categories (A–J). See [→ Checklists](./checklists.md) |
| Quick triage only? | Check the 7 high-signal items. See [→ Quick Audit](./quick-audit.md) |
| Need to write a report? | Use the scored report template. See [→ Report Template](./report-template.md) |
| Which app to compare against? | **GNOME Builder** for IDE-like layout; **Nautilus** for sidebar; **GNOME Text Editor** for header bar. See [→ Quick Audit](./quick-audit.md) |

## Audit Categories

| # | Category | Weight | What it covers |
|---|----------|--------|----------------|
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

### Score interpretation

| Range | Rating | Action |
|-------|--------|--------|
| 90–100 | ✅ Excellent | Minor polish only |
| 80–89 | 👍 Good | A few improvements recommended |
| 65–79 | ⚠️ Fair | Several violations need attention |
| 50–64 | 🔶 Poor | Significant HIG gaps |
| <50 | 🔴 Critical | Major rework needed |

## Deep Reference

| Topic | File |
|-------|------|
| Full 10-Category Checklists (A–J), Scoring, How to Run | [→ Checklists](./checklists.md) |
| Scored Report Markdown Template | [→ Report Template](./report-template.md) |
| 5-Minute Triage & GNOME Reference Apps | [→ Quick Audit](./quick-audit.md) |
