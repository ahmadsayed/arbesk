# Web & Web 3.0 Standards Audit Report — Arbesk Studio

**Date**: 2026-06-16  
**Auditor**: Kimi Code CLI (automated source audit)  
**Version**: `2036538`  
**Scope**: Modern web standards, PWA readiness, dApp UX patterns, wallet integration, blockchain interaction quality

---

## Executive Summary

| Domain | Score | Rating |
|--------|-------|--------|
| **Web Standards** | 62/100 | ⚠️ Fair |
| **Web 3.0 / dApp Standards** | 72/100 | 👍 Good |
| **Combined Web Score** | 67/100 | 👍 Good |

**Context**: Arbesk Studio is a **developer tool / studio** running primarily on localhost against a local Hardhat node. Since the last audit (2026-06-06, score 62), the wallet integration was modernized (EIP-6963 + WalletConnect v2), a report-only CSP was added, and the frontend architecture was cleaned up with a `mitt` event bus and typed state stores. The biggest remaining gaps are production bundling/PWA, enforcing CSP/SRI, and a richer multi-chain UI.

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
| Favicon (`logo.webp` + `favicon.ico`) | ✅ | WebP + ICO formats |
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
| `prefers-color-scheme` media query | ✅ | Light/dark/auto + manual `data-theme` override |
| `prefers-reduced-motion` | ✅ | Durations set to 0ms, animations gated |
| `prefers-contrast: more` | ✅ | Borders become `currentColor`, shadows removed |
| `color-mix()` | ✅ | Used for focus rings, hover states, glass surfaces |
| Flexbox layout | ✅ | Studio shell, sidebar, inspector all use flex |
| SCSS with nesting | ✅ | Organized component files |
| Autoprefixer in build | ✅ | `package.json` devDependency |
| CSS Grid | ❌ | Not used anywhere — flexbox only |
| Container queries | ❌ | Not used — could improve responsive component logic |
| `clamp()` for fluid typography | ❌ | Fixed font-size tokens only |
| `@supports` feature queries | ❌ | No progressive enhancement guards |

**Finding**: Strong token architecture and modern CSS features, but misses Grid, container queries, and `clamp()` for fluid sizing.

---

### Category W3: JavaScript Architecture — 88/100

| Check | Status | Notes |
|-------|--------|-------|
| ES modules (`import`/`export`) | ✅ | All frontend JS is modular |
| Vanilla JS (no framework bloat) | ✅ | Appropriate for a 3D studio |
| Clean separation of concerns | ✅ | `engine/`, `ui/`, `blockchain/`, `services/`, `state/` |
| Typed event bus for decoupling | ✅ | `mitt` singleton in `events/bus.js` with `EVENTS` constants |
| Typed state layer | ✅ | `asset-state.js`, `wallet-state.js`, `ui-state.js` replace `window.*` globals |
| Dynamic `import()` for code splitting | ✅ | `token-resolver.js`, `explorer.js` lazy-loaded |
| No global namespace pollution | ✅ | Minimal `window.*` exports removed |
| Babylon.js as 3D engine | ✅ | CDN-loaded v9.12.0 |
| Web3.js for blockchain | ✅ | v1.10.0 |
| TypeScript | ❌ | Pure JS — acceptable for this project |
| Service Worker | ❌ | None |
| Web Workers | ❌ | None — heavy 3D/GLTF operations run on main thread |

**Finding**: Excellent modular architecture. The move from `document.dispatchEvent` to `mitt` and the introduction of typed state stores are significant improvements. Missing service workers and web workers for background processing.

---

### Category W4: Performance & Asset Delivery — 45/100

| Check | Status | Notes |
|-------|--------|-------|
| Single CSS file (`styles.css`) | ✅ | One request for all styles |
| WebP images | ✅ | Logo, favicon, apple-touch-icon |
| No render-blocking resources | ⚠️ | CSS is render-blocking; scripts are `type="module"` (deferred) |
| JavaScript bundler | ❌ | **No bundler** — `build-scripts.js` copies `src/js → dist/js` |
| Tree-shaking | ❌ | Impossible without a bundler |
| Code splitting | ❌ | No dynamic chunks beyond 2 lazy imports |
| Minification | ❌ | JS files are unminified in dist |
| `preload` / `preconnect` hints | ❌ | No `<link rel="preload">` or `dns-prefetch` |
| Subresource Integrity (SRI) | ❌ | CDN scripts lack `integrity` attributes |
| Lazy loading for images | ✅ | Asset library thumbnails use `loading="lazy"` |
| Critical CSS inlining | ❌ | Not implemented |
| Resource count | ⚠️ | **35+ individual JS module files** + 5 CDN scripts + 1 CSS file |

**Finding**: The build system still performs a raw copy of source JS to dist. This is acceptable for localhost development but would be a critical production issue. CDN scripts still lack SRI hashes. Thumbnails now lazy-load.

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

### Category W6: Security & Privacy — 55/100

| Check | Status | Notes |
|-------|--------|-------|
| `rel="noopener noreferrer"` on external links | ✅ | Wallet explorer link has it |
| No analytics / tracking scripts | ✅ | No Google Analytics, Mixpanel, etc. |
| No third-party cookies | ✅ | No cookie usage |
| Content Security Policy (CSP) | ⚠️ | Report-only header added (`src/index.js`), not enforcing |
| Subresource Integrity (SRI) | ❌ | CDN scripts lack `integrity` attributes |
| HTTPS enforcement | ❌ | Localhost only — no `upgrade-insecure-requests` |
| Hardcoded private key in source | ❌ | Hardhat dev account key embedded in `wallet.js` — acceptable for local dev only |
| Input sanitization | ⚠️ | `escapeHtml()` used in dialogs and toasts; API inputs rely on backend validation |
| `X-Frame-Options` / frame ancestors | ❌ | No clickjacking protection headers |
| `X-Content-Type-Options: nosniff` | ❌ | Not set |
| `Referrer-Policy` | ❌ | Not set |

**Finding**: CSP is now in report-only mode, which is progress. Lack of enforcing CSP, SRI, and additional security headers remains a concern before any production deployment. No tracking is a privacy win.

---

### Category W7: Cross-Browser Compatibility — 70/100

| Check | Status | Notes |
|-------|--------|-------|
| `system-ui` font stack | ✅ | Falls back through Segoe UI, Roboto, Helvetica |
| `-webkit-` / `-moz-` prefixes for range slider | ✅ | Both engines covered |
| `appearance: none` for form controls | ✅ | |
| Web3.js v1.10.0 | ⚠️ | Stable but aging; v4 is current |
| Web3Modal v1 | ✅ | **Removed** — replaced with custom EIP-6963 + WalletConnect v2 modal |
| WalletConnect v2 | ✅ | Supported via `@walletconnect/ethereum-provider` |
| EIP-6963 (multi-injection) | ✅ | `wallet-discovery.js` discovers and connects multiple injected wallets |
| Coinbase Wallet / Rainbow | ⚠️ | Supported if they emit `eip6963:announceProvider`; no explicit deep links |
| `@supports` feature queries | ❌ | No progressive enhancement guards |
| Safari-specific quirks | ⚠️ | `color-mix()` supported in Safari 16.2+; Babylon.js WebGL compatibility varies |

**Finding**: Wallet integration was modernized and now supports EIP-6963 and WalletConnect v2. This removes the biggest compatibility concern from the previous audit. Web3.js v1 remains the next aging dependency.

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
| Toast notifications for errors | ✅ | Notyf-based, with action buttons (Retry, View on Explorer) |
| `fetch` with `AbortController` | ❌ | No request cancellation |
| Exponential backoff retry | ❌ | No retry logic |
| Offline detection (`navigator.onLine`) | ❌ | Not implemented |
| Request deduplication | ❌ | Not implemented |
| Connection status indicator | ❌ | Not implemented |

**Finding**: Error handling is well-structured at the presentation layer (toasts, ApiError), but lacks network-level resilience (retries, cancellation, offline handling).

---

## Part B: Web 3.0 / dApp Standards

### Category D1: Wallet Connection UX — 82/100

| Check | Status | Notes |
|-------|--------|-------|
| EIP-6963 multi-wallet discovery | ✅ | `wallet-discovery.js` listens for announced providers |
| WalletConnect v2 | ✅ | Mobile wallet support via `@walletconnect/ethereum-provider` |
| Auto-connect via `eth_accounts` (silent) | ✅ | No popup on page load |
| `accountsChanged` listener | ✅ | Updates UI, checks balance |
| `chainChanged` → page reload | ✅ | Standard pattern |
| Direct `window.ethereum` fallback | ✅ | Works without EIP-6963 |
| No wallet installed handling | ✅ | Toast: "Please install MetaMask or Rabby" |
| User rejection handled silently | ✅ | Error code 4001 → no toast spam |
| Custom wallet picker modal | ✅ | GNOME HIG-styled, focus-trapped |
| Coinbase Wallet / Rainbow deep links | ❌ | No explicit wallet deep links |
| Reown AppKit / RainbowKit | ❌ | Custom modal is maintained in-house |

**Finding**: Wallet connection was significantly modernized. The custom EIP-6963 + WalletConnect v2 modal removes the Web3Modal v1 deprecation risk and supports modern multi-injection wallets.

---

### Category D2: Network / Chain Management — 70/100

| Check | Status | Notes |
|-------|--------|-------|
| `wallet_switchEthereumChain` | ✅ | Prompts user to switch |
| `wallet_addEthereumChain` | ✅ | Adds chains if not present |
| Wrong network detection | ✅ | Dialog prompts to switch |
| Chain ID badge in headerbar | ✅ | Shows network name |
| Network switch in headerbar | ✅ | `<select>` with Hardhat, SEI Testnet, and (disabled) Optimism options |
| Multi-network config object | ✅ | `NETWORK_CONFIGS` covers Hardhat, Optimism Sepolia, Optimism Mainnet, SEI Testnet |
| Production network support (Mainnet, Sepolia) | ⚠️ | Configured but contracts not deployed on Optimism mainnet |
| Custom RPC endpoint input | ❌ | Not implemented |

**Finding**: Network configuration expanded significantly (added SEI Testnet and Optimism configs). The UI now exposes a network selector, though some production networks lack deployed contracts.

---

### Category D3: Transaction UX — 75/100

| Check | Status | Notes |
|-------|--------|-------|
| Gas estimation with buffer | ✅ | 1.2× buffer on all transactions |
| Transaction lifecycle toasts | ✅ | Notyf wrapper — pending → submitting → confirmed / failed |
| Explorer links in toasts | ✅ | "View on Explorer" for confirmed txs |
| Retry action on failure | ✅ | Retry button in error toasts |
| User rejection silent handling | ✅ | No toast on code 4001 |
| Specific error messages | ✅ | "Insufficient Funds", "User denied" classified |
| Transaction simulation (Tenderly/Alchemy) | ❌ | Not implemented |
| Gas price display to user | ❌ | Not shown before signing |
| Custom nonce support | ❌ | Not implemented |
| Speed-up / cancel pending tx | ❌ | Not implemented |
| Transaction queue / batching | ❌ | Not implemented |

**Finding**: Transaction feedback is clear and modernized via Notyf. Missing: gas price preview, simulation, and advanced nonce management.

---

### Category D4: Token Standards — 55/100

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

### Category D6: Session & Authentication — 78/100

| Check | Status | Notes |
|-------|--------|-------|
| Session-based auth | ✅ | Reduces wallet popups after first use |
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

### Category D7: Multi-Chain Support — 60/100

| Check | Status | Notes |
|-------|--------|-------|
| `NETWORK_CONFIGS` for mainnet/Sepolia/SEI | ✅ | `eth.llamarpc.com`, `https://sepolia.optimism.io`, SEI testnet RPC |
| External RPC fallback | ✅ | Token resolver creates new Web3 instance for different chains |
| Hardhat local dev | ✅ | Primary network |
| Calibration / Filecoin Mainnet | ⚠️ | Chain IDs in constants but no RPC configured |
| Polygon / Arbitrum / Base | ❌ | No RPC or UI support |
| Chain switch UI | ✅ | Headerbar `<select>` |
| Cross-chain asset references | ⚠️ | `child_ref` stores `chainId` but resolution only works for known RPCs |

**Finding**: The architecture supports multi-chain via `child_ref.chainId` and external RPC fallbacks, and the UI now exposes a network selector. Adding more production networks is primarily a config change, not a code change.

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

### Category D9: Data Privacy & Permissions — 70/100

| Check | Status | Notes |
|-------|--------|-------|
| No analytics / tracking | ✅ | No Google Analytics, Segment, etc. |
| No third-party data sharing | ✅ | |
| No cookies | ✅ | |
| Wallet address not in URL | ✅ | Not exposed in query params |
| `navigator.clipboard` with fallback | ✅ | Secure context + textarea fallback |
| Hardcoded dev private key | ⚠️ | In `wallet.js` source — acceptable for local dev only |
| Privacy policy | ❌ | None |
| Terms of service | ❌ | None |

**Finding**: No tracking is a strong privacy win. The hardcoded Hardhat dev key is a development-only convenience that must be removed for production.

---

### Category D10: Contract Interaction Patterns — 68/100

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
| 1 | **No enforcing CSP / no SRI on CDN scripts** | XSS and supply-chain attack if CDN is compromised | Promote CSP to enforcing and add `integrity` + `crossorigin="anonymous"` to CDN `<script>` tags |
| 2 | **Hardcoded dev private key in source** | Accidental mainnet deployment could leak funds | Move to environment variable or dev-only config file |
| 3 | **No production contract deployment on Optimism mainnet** | App cannot publish on production network | Deploy contracts and populate `NETWORK_CONFIGS` |
| 4 | **No transaction revert reason decoding** | Users see raw hex/errors instead of human-readable revert reasons | Parse `error.data` and map to contract error definitions |
| 5 | **No SIWE (EIP-4361)** | Non-standard auth message; not interoperable with SIWE-verifying backends | Replace custom `arbesk-session:` message with SIWE format |
| 6 | **No PWA / service worker / manifest** | Cannot install as desktop app or work offline | Add `manifest.json` and a minimal service worker for asset caching |
| 7 | **No bundler / minification / SRI** | 35+ unminified modules served individually in production | Add a production bundler (e.g., Rollup) with SRI generation |

---

## What's Done Well (Web 3.0)

- **Modern wallet integration**: Custom EIP-6963 discovery + WalletConnect v2 modal replaces the deprecated Web3Modal v1.
- **Multi-network config**: Hardhat, Optimism Sepolia, Optimism Mainnet, and SEI Testnet are all configured.
- **Session auth reduces friction**: Clever session token system cuts wallet popups after the first generation.
- **Transaction lifecycle UX**: Notyf-based toasts give clear feedback through pending → confirmed/failed states with explorer links.
- **Token resolver architecture**: Clean separation with caching, external RPC fallback, and URI normalization for cross-contract compatibility.
- **Role-based collaboration**: Full Viewer/Editor/Owner role system wired through the contract.
- **Burn → unpin lifecycle**: Thoughtful cleanup that resolves the manifest CID before burning, then unpins IPFS content afterward.
- **USDC payment flow**: Proper two-step ERC-20 approval pattern with gas estimation.

---

## What's Done Well (Web Standards)

- **Semantic HTML**: Proper landmarks, heading hierarchy, and ARIA coverage.
- **Modern CSS**: Custom properties, `color-mix()`, `prefers-*` media queries.
- **Modular JS architecture**: Clean ES modules with typed `mitt` event bus and state stores.
- **Responsive design**: Fully responsive sidebar, inspector, and touch targets.
- **Zero tracking**: No analytics, cookies, or third-party data sharing.

---

## Score Comparison

| Audit | Score | Gap |
|-------|-------|-----|
| GNOME HIG (Visual + A11y) | 90/100 | — |
| Web Standards | 62/100 | -28 |
| Web 3.0 / dApp | 72/100 | -18 |
| **Combined Web** | **67/100** | **-23** |

**Interpretation**: Arbesk Studio is now a **visually excellent and increasingly mature** web application. The Web 3.0 score improved from 63 to 72 thanks to the wallet modernization and multi-chain work. The remaining gaps are expected for a dev tool but must be addressed before any public mainnet deployment: enforcing CSP/SRI, contract deployment, revert decoding, SIWE, and production bundling.
