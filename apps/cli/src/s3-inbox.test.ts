import { describe, expect, it, vi } from "vitest";

import {
  inboxFilenameForKey,
  pullInbox,
  type LocalInbox,
  type RemoteInbox,
} from "./s3-inbox.js";

function remoteInbox(): RemoteInbox {
  return {
    list: async function* () {
      await Promise.resolve();
      yield { key: "inbox/flyer.png" };
    },
    download: vi.fn(() =>
      Promise.resolve({ contents: chunks("source"), versionId: "version-1" }),
    ),
    delete: vi.fn(() => Promise.resolve()),
  };
}

describe("inboxFilenameForKey", () => {
  it("accepts direct inbox keys", () => {
    expect(inboxFilenameForKey("inbox/flyer.png")).toBe("flyer.png");
  });

  it.each(["artefacts/flyer.png", "inbox/nested/flyer.png", "inbox/.hidden"])(
    "rejects invalid remote key %s",
    (key) => {
      expect(() => inboxFilenameForKey(key)).toThrow(
        "invalid remote inbox key",
      );
    },
  );
});

describe("pullInbox", () => {
  it("installs an object then deletes its exact downloaded version", async () => {
    const remote = remoteInbox();
    const local: LocalInbox = {
      installInboxArtefact: vi.fn(() =>
        Promise.resolve({ status: "installed" as const, hash: "a".repeat(64) }),
      ),
    };

    await expect(pullInbox(remote, local)).resolves.toEqual({
      pulled: 1,
      alreadyPresent: 0,
      conflicts: 0,
    });
    expect(remote.delete).toHaveBeenCalledWith("inbox/flyer.png", "version-1");
  });

  it("retains an object when local bytes conflict", async () => {
    const remote = remoteInbox();
    const local: LocalInbox = {
      installInboxArtefact: () =>
        Promise.resolve({ status: "conflict" as const, hash: "a".repeat(64) }),
    };

    await expect(pullInbox(remote, local)).resolves.toEqual({
      pulled: 0,
      alreadyPresent: 0,
      conflicts: 1,
    });
    expect(remote.delete).not.toHaveBeenCalled();
  });
});

async function* chunks(value: string): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield new TextEncoder().encode(value);
}
