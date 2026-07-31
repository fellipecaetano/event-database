const uuidV7Layout = {
  byteCount: 16,
  timestampBytes: 6,
  versionBits: 0x70,
  counter: {
    maximum: 0xfff,
    randomBytes: 2,
    highByte: 6,
    lowByte: 7,
    highBitShift: 8,
  },
  variant: {
    byte: 8,
    mask: 0x3f,
    bits: 0x80,
  },
} as const;
const byteEncoding = {
  mask: 0xff,
  radix: 0x100,
  nibbleBits: 4,
} as const;
const uuidTextLayout = {
  radix: 16,
  paddedByteLength: 2,
  firstSegmentEnd: 8,
  secondSegmentEnd: 12,
  thirdSegmentEnd: 16,
  fourthSegmentEnd: 20,
} as const;

interface UuidV7Dependencies {
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
}

export function createUuidV7Generator({
  now,
  randomBytes,
}: UuidV7Dependencies): () => string {
  let lastMillisecond = -1;
  let counter = 0;

  return () => {
    let millisecond = Math.max(Math.floor(now()), lastMillisecond);
    if (millisecond === lastMillisecond) {
      if (counter === uuidV7Layout.counter.maximum) {
        millisecond += 1;
        counter = 0;
        lastMillisecond = millisecond;
      } else {
        counter += 1;
      }
    } else {
      const randomCounter = randomBytes(uuidV7Layout.counter.randomBytes);
      counter =
        ((randomCounter[0] ?? 0) << byteEncoding.nibbleBits) |
        ((randomCounter[1] ?? 0) >> byteEncoding.nibbleBits);
      lastMillisecond = millisecond;
    }

    const bytes = randomBytes(uuidV7Layout.byteCount);
    if (bytes.length !== uuidV7Layout.byteCount) {
      throw new Error("randomBytes returned an invalid byte count");
    }

    let timestamp = millisecond;
    for (let index = uuidV7Layout.timestampBytes - 1; index >= 0; index -= 1) {
      bytes[index] = timestamp & byteEncoding.mask;
      timestamp = Math.floor(timestamp / byteEncoding.radix);
    }
    bytes[uuidV7Layout.counter.highByte] =
      uuidV7Layout.versionBits | (counter >> uuidV7Layout.counter.highBitShift);
    bytes[uuidV7Layout.counter.lowByte] = counter & byteEncoding.mask;
    bytes[uuidV7Layout.variant.byte] =
      ((bytes[uuidV7Layout.variant.byte] ?? 0) & uuidV7Layout.variant.mask) |
      uuidV7Layout.variant.bits;

    return formatUuid(bytes);
  };
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes]
    .map((byte) =>
      byte
        .toString(uuidTextLayout.radix)
        .padStart(uuidTextLayout.paddedByteLength, "0"),
    )
    .join("");
  return [
    hex.slice(0, uuidTextLayout.firstSegmentEnd),
    hex.slice(uuidTextLayout.firstSegmentEnd, uuidTextLayout.secondSegmentEnd),
    hex.slice(uuidTextLayout.secondSegmentEnd, uuidTextLayout.thirdSegmentEnd),
    hex.slice(uuidTextLayout.thirdSegmentEnd, uuidTextLayout.fourthSegmentEnd),
    hex.slice(uuidTextLayout.fourthSegmentEnd),
  ].join("-");
}
