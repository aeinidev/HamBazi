const launchCacheKey = "__telegram__initParams";
const protectedPrototypes = new WeakSet<object>();

type StorageHost = Pick<Window, "sessionStorage" | "localStorage"> & {
  Storage: typeof Storage;
};

// The reviewed SDK caches the entire launch, including raw initData, under this key.
// Install before loading the SDK. Keep the guard for the lifetime of the document.
export function protectTelegramStorage(host: StorageHost = window): void {
  try {
    const prototype = host.Storage.prototype;
    if (protectedPrototypes.has(prototype)) return;
    const { getItem, setItem, removeItem } = prototype;
    if (![getItem, setItem, removeItem].every((method) => typeof method === "function"))
      throw new Error();

    for (const name of ["sessionStorage", "localStorage"] as const) {
      let storage: Storage;
      try {
        storage = host[name];
      } catch {
        // A browser may deny storage entirely. The SDK catches that denial too.
        continue;
      }
      // Delete through the original methods and verify before reads are masked.
      removeItem.call(storage, launchCacheKey);
      if (getItem.call(storage, launchCacheKey) !== null) throw new Error();
    }

    Object.defineProperties(prototype, {
      getItem: {
        configurable: false,
        writable: false,
        value: function (this: Storage, key: string): string | null {
          const name = String(key);
          return name === launchCacheKey ? null : getItem.call(this, name);
        },
      },
      setItem: {
        configurable: false,
        writable: false,
        value: function (this: Storage, key: string, value: string): void {
          const name = String(key);
          if (name !== launchCacheKey) setItem.call(this, name, value);
        },
      },
    });
    protectedPrototypes.add(prototype);
  } catch {
    // No raw browser error, stored value or launch data crosses this boundary.
    throw new Error("TELEGRAM_BOOTSTRAP_UNAVAILABLE");
  }
}
