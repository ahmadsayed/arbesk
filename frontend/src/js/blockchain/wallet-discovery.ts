/**
 * Detects browser-installed wallets via eip6963:announceProvider and
 * maintains a registry of available wallets to choose from.
 */

export interface EIP6963Wallet {
  /** Reverse domain name (e.g., "io.metamask") */
  rdns: string;
  /** Human-readable name (e.g., "MetaMask") */
  name: string;
  /** Base64 SVG icon */
  icon: string;
  /** EIP-1193 provider instance */
  provider: any;
}

const wallets = new Map<string, EIP6963Wallet>();

const listeners = new Set<(wallets: EIP6963Wallet[]) => void>();

/**
 * Notify all registered listeners with the current wallet list.
 */
function notify() {
  const list = Array.from(wallets.values());
  listeners.forEach((fn) => {
    try {
      fn(list);
    } catch (e) {
      console.error("[WALLET-DISCOVERY] listener error:", e);
    }
  });
}

/**
 * Handle an EIP-6963 announceProvider event.
 */
function onAnnounceProvider(event: Event) {
  const detail = (event as CustomEvent).detail;
  if (!detail?.info || !detail?.provider) return;

  const { info, provider } = detail;
  const rdns = info.rdns;

  if (!rdns) {
    console.warn("[WALLET-DISCOVERY] wallet announced without rdns:", info.name);
    return;
  }

  // Update or add wallet
  wallets.set(rdns, {
    rdns,
    name: info.name || rdns,
    icon: info.icon || "",
    provider,
  });

  console.log(`[WALLET-DISCOVERY] discovered: ${info.name} (${rdns})`);
  notify();
}

/**
 * Starts listening for wallet announcements.
 */
export function startDiscovery() {
  if (typeof window === "undefined") return;

  window.addEventListener("eip6963:announceProvider", onAnnounceProvider);

  // Request already-initialized wallets to announce themselves
  requestWallets();
}

/**
 * Requests all wallets to announce themselves.
 */
export function requestWallets() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/**
 * Registers a callback for wallet list updates.
 * @returns unsubscribe function.
 */
export function onWalletsUpdated(
  callback: (wallets: EIP6963Wallet[]) => void
): () => void {
  listeners.add(callback);
  // Immediately call with current state
  callback(Array.from(wallets.values()));
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Get the current list of discovered wallets.
 */
export function getWallets(): EIP6963Wallet[] {
  return Array.from(wallets.values());
}

/**
 * Get a single wallet by its rdns.
 */
export function getWalletByRdns(rdns: string): EIP6963Wallet | null {
  return wallets.get(rdns) || null;
}
