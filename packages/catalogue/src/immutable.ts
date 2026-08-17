export function deepFreezeCopy<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item: unknown) => deepFreezeCopy(item)),
    ) as Value;
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          deepFreezeCopy(child),
        ]),
      ),
    ) as Value;
  }
  return value;
}
