const legacyUserPrefix = "oidc.user:";

export function clearLegacyOidcUsers(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
): void {
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  );
  for (const key of keys) {
    if (key?.startsWith(legacyUserPrefix) === true) {
      storage.removeItem(key);
    }
  }
}
