import { describe, expect, it } from "vitest";
import { protectTelegramStorage } from "../../src/platform/telegram-storage.js";

const cacheKey = "__telegram__initParams";
function fixture() {
  const rows = new WeakMap<object, Map<string, string>>();
  let credentialWrites = 0;
  class TestStorage {
    constructor() {
      rows.set(this, new Map());
    }
    getItem(key: string) {
      return rows.get(this)!.get(String(key)) ?? null;
    }
    setItem(key: string, value: string) {
      if (String(value).includes("SYNTHETIC_PRIVATE")) credentialWrites++;
      rows.get(this)!.set(String(key), String(value));
    }
    removeItem(key: string) {
      rows.get(this)!.delete(String(key));
    }
  }
  const sessionStorage = new TestStorage();
  const localStorage = new TestStorage();
  const host = { Storage: TestStorage, sessionStorage, localStorage };
  return {
    host: host as unknown as Parameters<typeof protectTelegramStorage>[0],
    prototype: TestStorage.prototype,
    sessionStorage,
    localStorage,
    writes: () => credentialWrites,
    physical: (storage: TestStorage, key = cacheKey) => rows.get(storage)!.get(key),
  };
}

describe("Telegram launch-cache privacy", () => {
  it("prevents SDK credentials from reaching either underlying storage writer", () => {
    const f = fixture();
    protectTelegramStorage(f.host);
    for (const storage of [f.sessionStorage, f.localStorage]) {
      storage.setItem(cacheKey, "SYNTHETIC_PRIVATE");
      expect(f.physical(storage)).toBeUndefined();
      expect(storage.getItem(cacheKey)).toBeNull();
    }
    expect(f.writes()).toBe(0);
  });

  it("removes physical legacy caches while retaining unrelated values and theme", () => {
    const f = fixture();
    for (const storage of [f.sessionStorage, f.localStorage]) {
      storage.setItem(cacheKey, "SYNTHETIC_PRIVATE");
      storage.setItem("__telegram__themeParams", '{"bg_color":"#ffffff"}');
      storage.setItem("preference", "keep");
    }
    protectTelegramStorage(f.host);
    for (const storage of [f.sessionStorage, f.localStorage]) {
      expect(f.physical(storage)).toBeUndefined();
      expect(storage.getItem("__telegram__themeParams")).toBe('{"bg_color":"#ffffff"}');
      expect(storage.getItem("preference")).toBe("keep");
    }
  });

  it("delegates ordinary read/write/remove and native string conversion", () => {
    const f = fixture();
    protectTelegramStorage(f.host);
    f.sessionStorage.setItem("theme", 123 as unknown as string);
    expect(f.sessionStorage.getItem("theme")).toBe("123");
    f.sessionStorage.removeItem("theme");
    expect(f.sessionStorage.getItem("theme")).toBeNull();
    expect(f.localStorage.getItem("theme")).toBeNull();
  });

  it("normalizes cache keys before delegation without converting blocked values", () => {
    const f = fixture();
    protectTelegramStorage(f.host);
    const key = { toString: () => cacheKey } as unknown as string;
    const value = {
      toString: () => {
        throw new Error("SYNTHETIC_PRIVATE");
      },
    } as unknown as string;
    expect(() => f.sessionStorage.setItem(key, value)).not.toThrow();
    expect(f.sessionStorage.getItem(key)).toBeNull();
    expect(f.physical(f.sessionStorage)).toBeUndefined();
  });

  it("installs once and retains the guard for repeated bootstrap calls", () => {
    const f = fixture();
    protectTelegramStorage(f.host);
    const guarded = f.prototype.setItem;
    protectTelegramStorage(f.host);
    expect(f.prototype.setItem).toBe(guarded);
    expect(Reflect.set(f.prototype, "setItem", () => {})).toBe(false);
    expect(Reflect.deleteProperty(f.prototype, "getItem")).toBe(false);
  });

  it("supports browsers denying access to storage", () => {
    const f = fixture();
    for (const name of ["sessionStorage", "localStorage"]) {
      Object.defineProperty(f.host, name, {
        get() {
          throw new Error("SYNTHETIC_PRIVATE");
        },
      });
    }
    expect(() => protectTelegramStorage(f.host)).not.toThrow();
    f.sessionStorage.setItem(cacheKey, "SYNTHETIC_PRIVATE");
    expect(f.writes()).toBe(0);
  });

  it("fails safely when legacy cleanup throws", () => {
    const f = fixture();
    f.prototype.removeItem = () => {
      throw new Error("SYNTHETIC_PRIVATE");
    };
    expect(() => protectTelegramStorage(f.host)).toThrow("TELEGRAM_BOOTSTRAP_UNAVAILABLE");
  });

  it("verifies physical deletion rather than hiding an undeleted cache", () => {
    const f = fixture();
    f.sessionStorage.setItem(cacheKey, "SYNTHETIC_PRIVATE");
    f.prototype.removeItem = () => {};
    expect(() => protectTelegramStorage(f.host)).toThrow("TELEGRAM_BOOTSTRAP_UNAVAILABLE");
    expect(f.sessionStorage.getItem(cacheKey)).toBe("SYNTHETIC_PRIVATE");
  });

  it("rejects an unmodifiable prototype instead of assuming writes are blocked", () => {
    const f = fixture();
    Object.freeze(f.prototype);
    expect(() => protectTelegramStorage(f.host)).toThrow("TELEGRAM_BOOTSTRAP_UNAVAILABLE");
  });
});
