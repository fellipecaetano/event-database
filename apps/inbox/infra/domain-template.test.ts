import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("catalogue domain CloudFormation template", () => {
  it("retains the public hosted zone and exposes delegation values", async () => {
    const template = await readFile(
      new URL("./domain-template.yaml", import.meta.url),
      "utf8",
    );

    expect(template).toMatch(
      /HostedZone:\n\s+Type: AWS::Route53::HostedZone\n\s+DeletionPolicy: Retain\n\s+UpdateReplacePolicy: Retain/,
    );
    expect(template).toContain("HostedZoneId:");
    expect(template).toContain("HostedZoneNameServers:");
  });
});
