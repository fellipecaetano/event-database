import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const readTemplate = (): Promise<string> =>
  readFile(new URL("./template.yaml", import.meta.url), "utf8");

describe("inbox CloudFormation template", () => {
  it("retains stateful resources and keeps data outside CloudFront", async () => {
    const template = await readTemplate();

    for (const resource of ["DataBucket", "UserPool", "WebsiteBucket"]) {
      expect(template).toMatch(
        new RegExp(
          `[ ]{2}${resource}:\\n[ ]{4}Type: [^\\n]+\\n[ ]{4}DeletionPolicy: Retain\\n[ ]{4}UpdateReplacePolicy: Retain`,
        ),
      );
    }
    expect(template).toMatch(
      /[ ]{2}CatalogueBucket:\n[ ]{4}Type: AWS::S3::Bucket/,
    );
    expect(template).toMatch(/[ ]{2}CatalogueOriginAccessControl:\n/);
    expect(template).toMatch(/[ ]{2}CatalogueBucketPolicy:\n/);

    const origins =
      /[ ]{8}Origins:\n([\s\S]*?)[ ]{8}DefaultCacheBehavior:/.exec(
        template,
      )?.[1];
    expect(origins).toContain("CatalogueBucket.RegionalDomainName");
    expect(origins).toContain("WebsiteBucket.RegionalDomainName");
    expect(origins).not.toContain("DataBucket");
  });

  it("uses delegated DNS for the certificate, aliases, and modern IPv6 TLS", async () => {
    const template = await readTemplate();

    expect(template).not.toContain("Type: AWS::Route53::HostedZone");
    expect(template).toContain("HostedZoneId:\n    Type: String");
    expect(template).toContain("Type: AWS::CertificateManager::Certificate");
    expect(template).toContain("Region: us-east-1");
    expect(template).toContain("DomainName: musicaemsp.com.br");
    expect(template).toContain("- www.musicaemsp.com.br");
    expect(template).toContain("IPV6Enabled: true");
    expect(template).toContain("SslSupportMethod: sni-only");
    expect(template).toContain("MinimumProtocolVersion: TLSv1.2_2021");
    expect(template).toMatch(/Type: A\n[\s\S]*Type: AAAA/);
  });

  it("routes the catalogue by default and literal inbox keys through ordered behaviors", async () => {
    const template = await readTemplate();

    expect(template).toMatch(
      /DefaultCacheBehavior:\n\s+TargetOriginId: catalogue/,
    );
    expect(template).toMatch(
      new RegExp(
        'PathPattern: "/inbox/assets/\\*"[\\s\\S]*TargetOriginId: inbox',
      ),
    );
    expect(template).toMatch(
      new RegExp('PathPattern: "/inbox/\\*"[\\s\\S]*TargetOriginId: inbox'),
    );
    expect(template).toMatch(
      new RegExp('PathPattern: "/inbox"[\\s\\S]*TargetOriginId: inbox'),
    );
    expect(template).toContain('Resource: !Sub "${WebsiteBucket.Arn}/inbox/*"');
    expect(template).not.toContain("OriginPath:");
    expect(template).toContain("CatalogueCachePolicy:");
    expect(template).toContain("InboxShellCachePolicy:");
    expect(template).toContain("InboxAssetsCachePolicy:");
    expect(template).toContain("SafeResponseHeadersPolicy:");
    expect(template).not.toContain("ContentSecurityPolicy:");
    expect(template).not.toContain("CustomErrorResponses:");
  });

  it("allows all deployed and development inbox origins", async () => {
    const template = await readTemplate();

    for (const origin of [
      '"https://musicaemsp.com.br"',
      '"https://${Distribution.DomainName}"',
      "!Ref DevelopmentOrigin",
    ]) {
      expect(template.split(origin).length - 1).toBeGreaterThanOrEqual(2);
    }
    expect(template).toContain('"https://musicaemsp.com.br/inbox/"');
    expect(template).toContain('"https://${Distribution.DomainName}/inbox/"');
    expect(template).toContain('"https://${Distribution.DomainName}"');
  });

  it("preserves existing outputs and exposes catalogue hosting outputs", async () => {
    const template = await readTemplate();

    for (const output of [
      "ApiUrl",
      "CognitoAuthority",
      "CognitoClientId",
      "DataBucket",
      "DistributionId",
      "Region",
      "UserPoolId",
      "WebsiteBucket",
      "WebsiteUrl",
      "CatalogueBucket",
      "CatalogueUrl",
      "InboxUrl",
      "DistributionDomainName",
      "HostedZoneId",
      "HostedZoneNameServers",
      "CertificateArn",
    ]) {
      expect(template).toMatch(new RegExp(`^  ${output}:`, "m"));
    }
  });

  it("grants API Gateway permission with its executable source ARN", async () => {
    const template = await readTemplate();

    expect(template).toContain(
      'SourceArn: !Sub "arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${UploadApi}/*/*"',
    );
  });

  it("keeps the tested viewer-request source identical to the inline function", async () => {
    const [template, source] = await Promise.all([
      readTemplate(),
      readFile(new URL("./viewer-request.cff", import.meta.url), "utf8"),
    ]);
    const inline = /FunctionCode: \|\n([\s\S]*?)\n[ ]{6}FunctionConfig:/.exec(
      template,
    )?.[1];

    expect(inline?.replace(/^[ ]{8}/gm, "")).toBe(source.trimEnd());
  });
});
