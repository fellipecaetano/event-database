export function buildAuthenticationRedirectUrl(
  location: string,
  basePath: string,
): string {
  return new URL(basePath, new URL(location).origin).toString();
}
