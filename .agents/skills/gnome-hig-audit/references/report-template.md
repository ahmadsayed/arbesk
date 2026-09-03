# Report Template — GNOME HIG UI/UX Audit

Markdown template for producing scored audit reports.

## 15. Report Template

When the audit is complete, produce a report in this format:

```markdown
# Arbesk Studio UI/UX Audit Report

**Date**: YYYY-MM-DD
**Auditor**: [name]
**Version**: [git commit hash]

> **Evidence rule**: only report numbers or FAILs you actually measured or verified in source. Mark anything unverified as "unverified" — never invent a contrast ratio or state a violation you didn't check.

---

## Overall Score: XX/100 — [Rating]

| Category | Score | Rating |
|----------|-------|--------|
| A. Color & Theming | XX/100 | |
| B. Typography | XX/100 | |
| C. Layout & Spacing | XX/100 | |
| D. Buttons & Controls | XX/100 | |
| E. Keyboard Navigation | XX/100 | |
| F. Accessibility | XX/100 | |
| G. Forms & Input | XX/100 | |
| H. Dialogs & Modals | XX/100 | |
| I. Responsive Design | XX/100 | |
| J. Empty States & Feedback | XX/100 | |
| K. Web3 & Trust | XX/100 | |

---

## Critical Violations (must fix)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | | | | |

---

## Warnings (should fix)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | | | | |

---

## Suggestions (nice to have)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | | | | |

---

## What's Already Excellent

- [list 3–5 things done well]

---

## GNOME HIG Principles Scoring

| Principle | Adherence | Notes |
|-----------|-----------|-------|
| Simplicity & clarity | ```/10``` | |
| Keyboard accessibility | ```/10``` | |
| Consistency | ```/10``` | |
| Discoverability | ```/10``` | |
| Direct manipulation | ```/10``` | |
| Responsive feedback | ```/10``` | |
| Forgiving | ```/10``` | |
| Minimal chrome | ```/10``` | |
```
