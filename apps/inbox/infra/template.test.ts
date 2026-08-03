import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("inbox CloudFormation template", () => {
  it("grants API Gateway permission with its executable source ARN", async () => {
    const template = await readFile(
      new URL("./template.yaml", import.meta.url),
      "utf8",
    );

    expect(template).toContain(
      'SourceArn: !Sub "arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${UploadApi}/*/*"',
    );
  });
});
