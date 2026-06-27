// Minimal ambient type declarations for backend dependencies that do not ship
// their own TypeScript declarations. These are intentionally narrow — just
// enough to satisfy `noImplicitAny` in the API code without inventing runtime
// behavior.

declare module "ipfs-http-client" {
  export interface KuboAddResult {
    cid: { toString(): string };
    path?: string;
  }

  export interface KuboPinEntry {
    cid: { toString(): string };
  }

  export interface KuboClient {
    add(
      data: string | Uint8Array,
      options?: { filename?: string },
    ): Promise<KuboAddResult>;
    addAll(
      source: Iterable<{ path: string; content: Uint8Array | string }>,
      options?: { wrapWithDirectory?: boolean },
    ): AsyncIterable<KuboAddResult>;
    pin: {
      add(cid: string): Promise<void>;
      rm(cid: string): Promise<void>;
      ls(): AsyncIterable<KuboPinEntry>;
    };
    cat(
      cid: string,
      options?: { signal?: AbortSignal },
    ): AsyncIterable<Uint8Array | string>;
  }

  export function create(url: URL | string): KuboClient;
}

declare module "pinata" {
  export interface PinataFile {
    id: string;
    cid: string;
  }

  export interface PinataListResponse {
    files: PinataFile[];
    next_page_token: string | null;
  }

  export interface PinataFileListBuilder
    extends PromiseLike<PinataListResponse> {
    cid(cid: string): Promise<PinataListResponse>;
    limit(limit: number): PinataFileListBuilder;
    pageToken(token: string): PinataFileListBuilder;
  }

  export class PinataSDK {
    constructor(opts: { pinataJwt?: string; pinataGateway?: string });
    upload: {
      public: {
        file(file: File): Promise<{ cid: string }>;
        fileArray(files: File[]): Promise<{ cid: string }>;
        createSignedURL(opts: { expires: number }): Promise<string>;
      };
    };
    files: {
      public: {
        list(): PinataFileListBuilder;
        delete(fileIds: string[]): Promise<void>;
      };
    };
  }
}

declare module "nostr-tools" {
  export interface NostrEvent {
    kind: number;
    created_at: number;
    content: string;
    tags: string[][];
    id?: string;
    sig?: string;
    pubkey?: string;
  }

  export interface SignedNostrEvent extends NostrEvent {
    id: string;
    sig: string;
    pubkey: string;
  }

  export interface RelaySubscriptionParams {
    onevent(event: NostrEvent): void;
    oneose?(): void;
    onclose?(): void;
    onnotice?(message: string): void;
    eoseTimeout?: number;
  }

  export class Relay {
    constructor(
      url: string,
      opts: {
        websocketImplementation?: typeof import("ws").WebSocket;
        verifyEvent?: (event: NostrEvent) => boolean;
        enablePing?: boolean;
        enableReconnect?: boolean;
        [key: string]: unknown;
      },
    );
    onclose?: () => void;
    connect(): Promise<void>;
    subscribe(
      filters: unknown[],
      params: RelaySubscriptionParams,
    ): { close(): void };
    publish(event: NostrEvent): Promise<void>;
    close(): void;
  }

  export function finalizeEvent(
    template: Partial<NostrEvent>,
    secretKey: Uint8Array,
  ): SignedNostrEvent;

  export function getPublicKey(secretKey: Uint8Array): string;

  export const utils: {
    hexToBytes(hex: string): Uint8Array;
  };
}
