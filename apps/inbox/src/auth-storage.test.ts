import { describe, expect, it } from "vitest";

import { clearLegacyOidcUsers } from "./auth-storage.js";

describe("clearLegacyOidcUsers", () => {
  it("removes legacy OIDC user records without touching callback state", () => {
    const storage = new Map<string, string>([
      ["oidc.user:https://issuer.example:client", "token"],
      ["oidc.user:https://old-issuer.example:old-client", "old token"],
      ["oidc.state:callback", "state"],
      ["unrelated", "value"],
    ]);
    const localStorage = {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
    } as Pick<Storage, "length" | "key" | "removeItem">;

    clearLegacyOidcUsers(localStorage);

    expect([...storage]).toEqual([
      ["oidc.state:callback", "state"],
      ["unrelated", "value"],
    ]);
  });
});
