# Web & Web 3.0 Standards Audit Report — Arbesk Studio

**Date**: 2026-06-06
**Auditor**: Kimi Code CLI (automated source audit)
**Version**: 3eb5011
**Scope**: Modern web standards, PWA readiness, dApp UX patterns, wallet integration, blockchain interaction quality

---

## Executive Summary

| Domain | Score | Rating |
|--------|-------|--------|
| **Web Standards** | 60/100 | ⚠️ Fair |
| **Web 3.0 / dApp Standards** | 63/100 | ⚠️ Fair |
| **Combined Web Score** | 62/100 | ⚠️ Fair |

**Context**: Arbesk Studio scores **91/100 on GNOME HIG** (visual design + accessibility) but **62/100 on Web/Web 3.0** (architecture + integration). The app is visually polished and accessible, but architecturally behind on modern web performance, bundling, PWA capabilities, and Web3 integration patterns.

> **Note**: This is a **developer tool / studio** running primarily on localhost against a local Hardhat node. Some gaps (PWA, i18n, CSP) are less critical in this context than they would be for a consumer-facing production dApp. Scores are calibrated accordingly.

---

## Part A: Web Standards

### Category W1: HTML5 Semantic Structure & Meta Tags — 65/100

| Check | Status | Notes |
|-------|--------|-------|
| `doctype html` | ✅ | |
| `lang="en"` | ✅ | |
| `charset="utf-8"` | ✅ | |
| `viewport` meta | ✅ | `width=device-width, initial-scale=1` |
| Semantic landmarks (`header`, `aside`, `main`, `footer`, `nav`) | ✅ | GNOME-style shell uses proper landmarks |
| `h1` page title (sr-only) | ✅ | `h1.sr-only Arbesk Studio` |
| Favicon (`logo.webp`) | ✅ | WebP format |
| Apple touch icon | ✅ | `apple-touch-icon.webp` |
| `meta description` | ❌ | Missing — hurts SEO/shareability |
| Open Graph tags (`og:title`, `og:image`, etc.) | ❌ | Missing — no rich link previews |
| Twitter Card tags | ❌ | Missing |
| `theme-color` meta | ❌ | Missing — no browser chrome theming |
| `manifest.json` | ❌ | Missing — no PWA manifest |

**Finding**: The document structure is clean and semantic, but lacks social/meta tags and PWA manifest metadata.

---

### Category W2: CSS3 & Modern Layout — 75/100

| Check | Status | Notes |
|-------|--------|-------|
| CSS Custom Properties (design tokens) | ✅ | Three-layer libadwaita-inspired token system |
| `prefers-color-scheme` media query | ✅ | Light/dark/auto |
| `prefers-reduced-motion` | ✅ | Durations set to 0ms |
| `prefers-contrast: more` | ✅ | Borders become `currentColor`, shadows removed |
| `color-mix()` | ✅ | Used for focus rings and hover states |
| Flexbox layout | ✅ | Studio shell, sidebar, inspector all use flex |
| SCSS with nesting | ✅ | Organized component files |
| Autoprefixer in build | ✅ | `package.json` devDependency |
| CSS Grid | ❌ | Not used anywhere — flexbox only |
| Container queries | ❌ | Not used — could improve responsive component logic |
| `clamp()` for fluid typography | ❌ | Fixed font-size tokens only |
| `@supports` feature queries | ❌ | No progressive enhancement guards |

**Finding**: Strong token architecture and modern CSS features, but misses Grid, container queries, and `clamp()` for fluid sizing.

---

### Category W3: JavaScript Architecture — 85/100

| Check | Status | Notes |
|-------|--------|-------|
| ES modules (`import`/`export`) | ✅ | All frontend JS is modular |
| Vanilla JS (no framework bloat) | ✅ | Appropriate for a 3D studio |
| Clean separation of concerns | ✅ | `engine/`, `ui/`, `blockchain/`, `services/` |
| Custom events for decoupling | ✅ | `wallet:connected`, `scene:empty`, `nesting:didDive`, etc. |
| Dynamic `import()` for code splitting | ✅ | `token-resolver.js`, `explorer.js` lazy-loaded |
| No global namespace pollution | ✅ | Only minimal `window.*` exports for inline handlers |
| Babylon.js as 3D engine | ✅ | CDN-loaded |
| Web3.js for blockchain | ✅ | v1.10.0 |
| Web3Modal for wallet connection | ✅ | v1.9.12 |
| TypeScript | ❌ | Pure JS — acceptable for this project |
| Service Worker | ❌ | None |
| Web Workers | ❌ | None — heavy 3D/GLTF operations run on main thread |

**Finding**: Excellent modular architecture with clean decoupling via custom events. Missing service workers and web workers for background processing.

---

### Category W4: Performance & Asset Delivery — 45/100

| Check | Status | Notes |
|-------|--------|-------|
| Single CSS file (`styles.css`) | ✅ | One request for all styles |
| WebP images | ✅ | Logo, favicon, apple-touch-icon |
| No render-blocking resources | ⚠️ | CSS is render-blocking; scripts are `type="module"` (deferred) |
| JavaScript bundler | ❌ | **No bundler** — `render-scripts.js` literally copies `src/js → dist/js` |
| Tree-shaking | ❌ | Impossible without a bundler |
| Code splitting | ❌ | No dynamic chunks beyond 2 lazy imports |
| Minification | ❌ | JS files are unminified in dist |
| `preload` / `preconnect` hints | ❌ | No `<link rel="preload">` or `dns-prefetch` |
| Subresource Integrity (SRI) | ❌ | CDN scripts (`babylon.js`, `web3.min.js`, `web3modal`) have no `integrity` hash |
| Lazy loading for images | ❌ | Asset library card thumbnails load eagerly |
| Critical CSS inlining | ❌ | Not implemented |
| Resource count | ⚠️ | **35+ individual JS module files** + 5 CDN scripts + 1 CSS file |

**Finding**: The build system (`render-scripts.js`) performs a raw `cp -R` of source JS to dist. This means 35+ unminified module files are served individually. For localhost development this is acceptable, but for production this would be a critical performance issue. CDN scripts lack SRI hashes, creating a supply-chain vulnerability.

---

### Category W5: PWA Readiness — 25/100

| Check | Status | Notes |
|-------|--------|-------|
| Favicon | ✅ | |
| Apple touch icon | ✅ | |
| `manifest.json` | ❌ | Missing |
| Service Worker | ❌ | Missing |
| `theme-color` meta | ❌ | Missing |
| Offline support | ❌ | None |
| Install prompt | ❌ | None |
| Standalone display mode | ❌ | None |

**Finding**: Arbesk Studio is not a PWA. For a desktop-first 3D studio tool, this is acceptable, but a manifest and service worker would enable offline asset viewing and installation as a desktop-like app.

---

### Category W6: Security & Privacy — 50/100

| Check | Status | Notes |
|-------|--------|-------|
| `rel="noopener noreferrer"` on external links | ✅ | Wallet explorer link has it |
| No analytics / tracking scripts | ✅ | No Google Analytics, Mixpanel, etc. |
| No third-party cookies | ✅ | No cookie usage |
| Content Security Policy (CSP) | ❌ | No `Content-Security-Policy` meta tag or header |
| Subresource Integrity (SRI) | ❌ | CDN scripts lack `integrity` attributes |
| HTTPS enforcement | ❌ | Localhost only — no `upgrade-insecure-requests` |
| Hardcoded private key in source | ❌ | Hardhat dev account key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` is embedded in `wallet.js` (lines 134-135, 421-422) |
| Input sanitization | ⚠️ | `escapeHtml()` used in dialogs and toasts; API inputs rely on backend validation |
| `X-Frame-Options` / frame ancestors | ❌ | No clickjacking protection headers |

**Finding**: The hardcoded Hardhat dev private key is acceptable for local development but must be removed before any production deployment. Lack of CSP and SRI on CDN scripts creates XSS and supply-chain risks. No tracking is a privacy win.

---

### Category W7: Cross-Browser Compatibility — 65/100

| Check | Status | Notes |
|-------|--------|-------|
| `system-ui` font stack | ✅ | Falls back through Segoe UI, Roboto, Helvetica |
| `-webkit-` / `-moz-` prefixes for range slider | ✅ | Both engines covered |
| `appearance: none` for form controls | ✅ | |
| Web3.js v1.10.0 | ⚠️ | Stable but aging; v4 is current |
| Web3Modal v1.9.12 | ❌ | **Deprecated** — v2 (now Reown AppKit) is the modern standard |
| `@supports` feature queries | ❌ | No progressive enhancement guards |
| Safari-specific quirks | ⚠️ | `color-mix()` supported in Safari 16.2+; Babylon.js WebGL compatibility varies |

**Finding**: Web3Modal v1 is the biggest compatibility concern. It lacks modern wallet support (WalletConnect v2, Coinbase Smart Wallet, Rainbow) and may break as wallets drop legacy injection patterns.

---

### Category W8: Input Methods & Touch — 65/100

| Check | Status | Notes |
|-------|--------|-------|
| Touch targets ≥ 36×36px | ✅ | Buttons, switcher icons all meet minimum |
| Pointer events disabled on gizmo | ✅ | `pointer-events: none` on `#viewportGizmo` |
| Wheel event for zoom | ✅ | Custom orthographic zoom handler |
| Drag & drop for asset cards | ✅ | `draggable="true"` on library cards |
| Canvas orbit controls | ✅ | Babylon.js ArcRotateCamera |
| Pinch-to-zoom on touch | ❌ | Not implemented for canvas |
| Pen / stylus support | ❌ | Not implemented |
| Right-click context menu | ❌ | No custom context menus |

**Finding**: Mouse and basic touch are well-supported. Missing advanced input methods (pinch, pen, right-click menus) expected in a 3D studio.

---

### Category W9: Internationalization — 15/100

| Check | Status | Notes |
|-------|--------|-------|
| `lang="en"` | ✅ | |
| `dir="rtl"` support | ❌ | None |
| i18n framework or translation files | ❌ | All strings hardcoded in English |
| `Intl` API usage | ❌ | No `Intl.DateTimeFormat`, `Intl.NumberFormat`, etc. |
| RTL layout testing | ❌ | Not implemented |

**Finding**: The app is English-only with no i18n infrastructure. For a developer tool this is common, but it limits global accessibility.

---

### Category W10: Network Resilience — 35/100

| Check | Status | Notes |
|-------|--------|-------|
| `ApiError` custom error class | ✅ | Status code + error code |
| `parseErrorBody` for standardized errors | ✅ | Handles nested and legacy formats |
| Toast notifications for errors | ✅ | With action buttons (Retry, View on Explorer) |
| `fetch` with `AbortController` | ❌ | No request cancellation |
| Exponential backoff retry | ❌ | No retry logic |
| Offline detection (`navigator.onLine`) | ❌ | Not implemented |
| Request deduplication | ❌ | Not implemented |
| Connection status indicator | ❌ | Not implemented |

**Finding**: Error handling is well-structured at the presentation layer (toasts, ApiError), but lacks network-level resilience (retries, cancellation, offline handling).

---

## Part B: Web 3.0 / dApp Standards

### Category D1: Wallet Connection UX — 70/100

| Check | Status | Notes |
|-------|--------|-------|
| Web3Modal integration | ✅ | `cacheProvider: true` |
| Auto-connect via `eth_accounts` (silent) | ✅ | No popup on page load |
| `accountsChanged` listener | ✅ | Updates UI, checks balance |
| `chainChanged` → page reload | ✅ | Standard pattern |
| Direct `window.ethereum` fallback | ✅ | Works without Web3Modal |
| No wallet installed handling | ✅ | Toast: "Please install MetaMask or Rabby" |
| User rejection handled silently | ✅ | Error code 4001 → no toast spam |
| Web3Modal v1 | ❌ | **Deprecated** — should migrate to Reown AppKit (v2) |
| WalletConnect v2 | ❌ | Not supported |
| Coinbase Wallet / Rainbow | ❌ | Not supported |
| EIP-6963 (multi-injection) | ❌ | Not supported — may fail with multiple wallets |

**Finding**: Wallet connection works well for MetaMask/Rabby but uses deprecated Web3Modal v1. Modern wallets (Coinbase Smart Wallet, Rainbow, Frame) may not connect reliably. Migrating to Reown AppKit or RainbowKit is recommended.

---

### Category D2: Network / Chain Management — 55/100

| Check | Status | Notes |
|-------|--------|-------|
| `wallet_switchEthereumChain` | ✅ | Prompts user to switch |
| `wallet_addEthereumChain` | ✅ | Adds Hardhat if not present |
| Wrong network detection | ✅ | Dialog prompts to switch |
| Chain ID badge in headerbar | ✅ | Shows "Hardhat", "Calibration", "Mainnet" |
| Network switch in wallet popover | ⚠️ | Only "Hardhat Local" option — no production networks |
| Multi-network config object | ✅ | `NETWORKS` object exists but only has Hardhat |
| Production network support (Mainnet, Sepolia, Polygon) | ❌ | Not in UI |
| Custom RPC endpoint input | ❌ | Not implemented |

**Finding**: Network switching works for the Hardhat local dev environment, but the UI offers no production network options. The backend supports multi-chain, but the frontend doesn't expose it.

---

### Category D3: Transaction UX — 70/100

| Check | Status | Notes |
|-------|--------|-------|
| Gas estimation with buffer | ✅ | 1.2× buffer on all transactions |
| Transaction lifecycle toasts | ✅ | `showTxToast()` — pending → submitting → confirmed / failed |
| Explorer links in toasts | ✅ | "View on Explorer" for confirmed txs |
| Retry action on failure | ✅ | Retry button in error toasts |
| User rejection silent handling | ✅ | No toast on code 4001 |
| Specific error messages | ✅ | "Insufficient Funds", "User denied" classified |
| Transaction simulation (Tenderly/Alchemy) | ❌ | Not implemented |
| Gas price display to user | ❌ | Not shown before signing |
| Custom nonce support | ❌ | Not implemented |
| Speed-up / cancel pending tx | ❌ | Not implemented |
| Transaction queue / batching | ❌ | Not implemented |

**Finding**: Transaction feedback is good — users see clear toasts with explorer links and retry actions. Missing: gas price preview, simulation, and advanced nonce management.

---

### Category D4: Token Standards — 50/100

| Check | Status | Notes |
|-------|--------|-------|
| ERC-721 `tokenURI` support | ✅ | Minimal ABI for external contracts |
| Token resolver with caching | ✅ | 30-second in-memory cache |
| URI normalization | ✅ | `normalizeTokenURI()` handles ipfs://, ar://, https:// |
| ERC-1155 support | ❌ | Not implemented |
| ENS resolution | ❌ | Not implemented |
| Address checksum validation | ❌ | Not visible in UI code |
| Token metadata display (name, symbol) | ❌ | Not fetched from contract |

**Finding**: ERC-721 support is solid with caching and URI normalization. Missing ERC-1155, ENS, and token metadata reads (name, symbol, owner).

---

### Category D5: IPFS Integration — 65/100

| Check | Status | Notes |
|-------|--------|-------|
| Private Kubo node | ✅ | Dockerized, loopback-only |
| Gateway reads | ✅ | `http://127.0.0.1:8080/ipfs/` |
| Backend API for writes | ✅ | POST `/api/v1/generations`, `/api/v1/manifests` |
| Manifest chain walking | ✅ | `getManifestChain()` up to 50 depth |
| CID validation | ✅ | `extractCid()` in transforms.js |
| Browser caching toggle | ✅ | `IPFS_CACHE_ENABLED` flag (disabled for dev) |
| Pinata fallback env vars | ⚠️ | `PINATA_API_KEY` in `.env` but unused in frontend |
| Browser IPFS node (js-ipfs/helia) | ❌ | Not implemented |
| IPFS content routing (DHT) | ❌ | Disabled in Kubo config |
| CAR file import/export | ❌ | Not implemented |

**Finding**: IPFS integration is appropriate for a private-node architecture. All writes go through the backend; reads hit the gateway directly. No browser-native IPFS for peer-to-peer sharing.

---

### Category D6: Session & Authentication — 75/100

| Check | Status | Notes |
|-------|--------|-------|
| Session-based auth | ✅ | Reduces MetaMask popups from 3 → 2 after first use |
| `personal.sign` for session creation | ✅ | One signature = 24h token |
| `localStorage` session cache | ✅ | With expiry check |
| `Session` auth header scheme | ✅ | `Authorization: Session <token>` |
| Auto-clear on disconnect | ✅ | Event listener clears session |
| Clock skew grace period | ✅ | 60-second buffer |
| Address-bound sessions | ✅ | Token tied to wallet address |
| SIWE (EIP-4361 / Sign-In with Ethereum) | ❌ | Not implemented — uses custom message format |
| JWT / structured tokens | ❌ | Opaque UUIDs only |
| Session revocation API | ✅ | `DELETE /api/v1/sessions` exists |

**Finding**: Session auth is well-implemented for reducing wallet friction. Missing SIWE compliance, which is the modern standard for Ethereum authentication.

---

### Category D7: Multi-Chain Support — 45/100

| Check | Status | Notes |
|-------|--------|-------|
| `KNOWN_RPC_ENDPOINTS` for mainnet/Sepolia | ✅ | `eth.llamarpc.com`, `ethereum-sepolia.publicnode.com` |
| External RPC fallback | ✅ | Token resolver creates new Web3 instance for different chains |
| Hardhat local dev | ✅ | Primary network |
| Calibration / Filecoin Mainnet | ⚠️ | Chain IDs in event handler (314159, 314) but no RPC configured |
| Polygon / Arbitrum / Base | ❌ | No RPC or UI support |
| Chain switch UI | ❌ | Only Hardhat in wallet popover select |
| Cross-chain asset references | ⚠️ | `child_ref` stores `chainId` but resolution only works for known RPCs |

**Finding**: The architecture supports multi-chain via `child_ref.chainId` and external RPC fallbacks, but the UI is hardcoded to Hardhat local. Adding production networks requires config changes, not code changes.

---

### Category D8: Error Handling & Recovery — 70/100

| Check | Status | Notes |
|-------|--------|-------|
| `ApiError` with status + code | ✅ | Structured error class |
| `parseErrorBody` standardization | ✅ | Handles nested `{ error: { message, code } }` |
| Toast notifications with actions | ✅ | Retry, View on Explorer |
| User rejection silent handling | ✅ | No spam on cancel |
| Specific error classification | ✅ | Insufficient funds, wrong network, user denied |
| Transaction revert reason parsing | ❌ | Raw error message shown, no decoded revert reason |
| Automatic retry with backoff | ❌ | Not implemented |
| Circuit breaker for failed RPC | ❌ | Not implemented |
| RPC fallback rotation | ❌ | Single RPC per chain |

**Finding**: Error handling is user-friendly at the UI layer. Missing: revert reason decoding, automatic retries, and RPC failover.

---

### Category D9: Data Privacy & Permissions — 65/100

| Check | Status | Notes |
|-------|--------|-------|
| No analytics / tracking | ✅ | No Google Analytics, Segment, etc. |
| No third-party data sharing | ✅ | |
| No cookies | ✅ | |
| Wallet address not in URL | ✅ | Not exposed in query params |
| `navigator.clipboard` with fallback | ✅ | Secure context + textarea fallback |
| Hardcoded dev private key | ❌ | In `wallet.js` source — acceptable for local dev only |
| Privacy policy | ❌ | None |
| Terms of service | ❌ | None |

**Finding**: No tracking is a strong privacy win. The hardcoded Hardhat dev key is a development-only convenience that must be removed for production.

---

### Category D10: Contract Interaction Patterns — 65/100

| Check | Status | Notes |
|-------|--------|-------|
| ABI fetched dynamically from backend | ✅ | `/api/v1/contracts/:name/abi` |
| `estimateGas` before `send` | ✅ | All mutating calls estimate first |
| Gas buffer (1.2×) | ✅ | Consistent pattern |
| USDC approval + payment flow | ✅ | Two-step ERC-20 pattern |
| Role-based access (Viewer/Editor/Owner) | ✅ | `CollaboratorRole` enum + contract methods |
| Burn with IPFS unpin lifecycle | ✅ | Resolves CID before burn, unpins after |
| Custom events for contract actions | ✅ | `wallet:generationPaid`, `asset:published`, `asset:burned` |
| Contract read caching | ❌ | No caching for `tokenURI`, `costPerGeneration`, etc. |
| Multicall for batch reads | ❌ | Not implemented |
| Event listening (logs) | ❌ | No `contract.events` or `web3.eth.subscribe` |
| Read-only call error handling | ⚠️ | Basic try/catch; no fallback on RPC failure |

**Finding**: Contract interactions follow safe patterns (estimateGas → send, approval → transfer). Missing: multicall for batch operations, event listening for real-time updates, and read caching.

---

## Critical Web 3.0 Gaps (must fix before mainnet)

| # | Gap | Risk | Fix |
|---|-----|------|-----|
| 1 | **Web3Modal v1 is deprecated** | Wallets may stop supporting legacy injection; users cannot connect with modern wallets | Migrate to Reown AppKit (v2) or RainbowKit |
| 2 | **Hardcoded dev private key in source** | Accidental mainnet deployment could leak funds | Move to environment variable or dev-only config file |
| 3 | **No production network config in UI** | App only works on Hardhat local; mainnet users cannot connect | Add Mainnet, Sepolia, Polygon, etc. to `NETWORKS` and wallet popover |
| 4 | **No transaction revert reason decoding** | Users see raw hex/errors instead of human-readable revert reasons | Parse `error.data` and map to contract error definitions |
| 5 | **No SIWE (EIP-4361)** | Non-standard auth message; not interoperable with SIWE-verifying backends | Replace custom `arbesk-session:` message with SIWE format |
| 6 | **CDN scripts lack SRI** | Supply-chain attack if CDN is compromised | Add `integrity` and `crossorigin="anonymous"` to all CDN `<script>` tags |
| 7 | **No CSP** | XSS vulnerability if malicious script is injected | Add `Content-Security-Policy` meta tag |

---

## What's Done Well (Web 3.0)

- **Session auth reduces friction**: Clever session token system cuts MetaMask popups from 3 to 2 after the first generation.
- **Transaction lifecycle UX**: `showTxToast()` gives clear feedback through pending → confirmed/failed states with explorer links.
- **Token resolver architecture**: Clean separation with caching, external RPC fallback, and URI normalization for cross-contract compatibility.
- **Role-based collaboration**: Full Viewer/Editor/Owner role system wired through the contract.
- **Burn → unpin lifecycle**: Thoughtful cleanup that resolves the manifest CID before burning, then unpins IPFS content afterward.
- **USDC payment flow**: Proper two-step ERC-20 approval pattern with gas estimation.

---

## What's Done Well (Web Standards)

- **Semantic HTML**: Proper landmarks, heading hierarchy, and ARIA coverage.
- **Modern CSS**: Custom properties, `color-mix()`, `prefers-*` media queries.
- **Modular JS architecture**: Clean ES modules with custom event decoupling.
- **Responsive design**: Fully responsive sidebar, inspector, and touch targets.
- **Zero tracking**: No analytics, cookies, or third-party data sharing.

---

## Score Comparison

| Audit | Score | Gap |
|-------|-------|-----|
| GNOME HIG (Visual + A11y) | 91/100 | — |
| Web Standards | 60/100 | -31 |
| Web 3.0 / dApp | 63/100 | -28 |
| **Combined Web** | **62/100** | **-29** |

**Interpretation**: Arbesk Studio is a **visually excellent but architecturally immature** web application. The GNOME HIG score of 91 reflects world-class UI/UX design and accessibility. The Web score of 62 reflects that the app is built as a local development tool without production-grade bundling, PWA support, modern wallet SDKs, or multi-chain UI configuration. These gaps are **expected and acceptable for a Phase 5.1 dev tool** but must be addressed before any public mainnet deployment.
