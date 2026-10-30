/**
 * Web implementations of app-core's platform interfaces: key-value store (localStorage), network
 * (navigator.onLine + events), fetch, crypto and the device id. Every localStorage access is wrapped:
 * private windows and blocked storage fall back to memory.
 */
import { MemoryKeyValueStore, type Fetch, type HttpRequestInit, type KeyValueStore, type Network } from "@smriti/app-core";

export class LocalStorageKeyValueStore implements KeyValueStore {
  private readonly fallback = new MemoryKeyValueStore();
  constructor(private readonly prefix = "smriti.") {}
  private ls(): globalThis.Storage | null {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  }
  async get(key: string) {
    try {
      const ls = this.ls();
      if (ls) return ls.getItem(this.prefix + key);
    } catch {
      /* blocked */
    }
    return this.fallback.get(key);
  }
  async set(key: string, value: string) {
    try {
      const ls = this.ls();
      if (ls) return ls.setItem(this.prefix + key, value);
    } catch {
      /* quota or blocked */
    }
    return this.fallback.set(key, value);
  }
  async delete(key: string) {
    try {
      this.ls()?.removeItem(this.prefix + key);
    } catch {
      /* blocked */
    }
    return this.fallback.delete(key);
  }
  /** Removes every key with this store's prefix (sign-out wipe). */
  clearAll() {
    try {
      const ls = this.ls();
      if (!ls) return;
      const keys: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k?.startsWith(this.prefix)) keys.push(k);
      }
      for (const k of keys) ls.removeItem(k);
    } catch {
      /* blocked */
    }
  }
}

/** Synchronous localStorage helpers for UI preferences that must apply before first paint. */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`smriti.pref.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(`smriti.pref.${key}`);
      else localStorage.setItem(`smriti.pref.${key}`, value);
    } catch {
      /* blocked */
    }
  },
};

export class BrowserNetwork implements Network {
  isOnline() {
    return typeof navigator === "undefined" ? true : navigator.onLine !== false;
  }
  subscribe(listener: (online: boolean) => void) {
    const on = () => listener(true);
    const off = () => listener(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }
}

/** A handler that may answer a request in-process (the dev fake API); `undefined` means "not mine". */
export type RequestInterceptor = (request: Request) => Promise<Response | undefined>;

/** Wraps `fetch` to the app-core `Fetch` shape, optionally routing through an interceptor first. */
export function createFetch(interceptor?: RequestInterceptor): Fetch {
  return async (url: string, init?: HttpRequestInit) => {
    const reqInit: RequestInit = { method: init?.method ?? "GET", headers: init?.headers, body: init?.body };
    if (interceptor) {
      const res = await interceptor(new Request(url, reqInit));
      if (res) return res;
    }
    return fetch(url, reqInit);
  };
}

export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

/** A stable, random install id (the X-Device-Id header). Never derived from hardware. */
export function deviceId(): string {
  const existing = prefs.get("device_id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  prefs.set("device_id", id);
  return id;
}
