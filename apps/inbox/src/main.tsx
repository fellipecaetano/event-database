import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import { createBrowserUploadService } from "./upload.js";
import "./styles.css";

interface BrowserConfiguration {
  readonly apiUrl: string;
  readonly cognitoAuthority: string;
  readonly cognitoClientId: string;
}

async function start(): Promise<void> {
  const configuration = readConfiguration();
  const browserStore = window.localStorage;
  const manager = new UserManager({
    authority: configuration.cognitoAuthority,
    client_id: configuration.cognitoClientId,
    redirect_uri: window.location.origin,
    post_logout_redirect_uri: window.location.origin,
    response_type: "code",
    scope: "openid",
    stateStore: new WebStorageStateStore({ store: browserStore }),
    userStore: new WebStorageStateStore({ store: browserStore }),
  });
  if (hasAuthorizationResponse()) {
    await manager.signinRedirectCallback();
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  const user = await manager.getUser();
  if (user === null || user.expired || user.access_token.length === 0) {
    await manager.signinRedirect();
    return;
  }
  createRoot(document.querySelector("#root") ?? document.body).render(
    <App
      accessToken={user.access_token}
      uploadService={createBrowserUploadService(configuration.apiUrl)}
    />,
  );
}

function readConfiguration(): BrowserConfiguration {
  return {
    apiUrl: requiredBuildVariable("VITE_API_URL"),
    cognitoAuthority: requiredBuildVariable("VITE_COGNITO_AUTHORITY"),
    cognitoClientId: requiredBuildVariable("VITE_COGNITO_CLIENT_ID"),
  };
}

function requiredBuildVariable(name: string): string {
  const environment: unknown = import.meta.env;
  if (typeof environment !== "object" || environment === null) {
    throw new Error(`missing required build variable: ${name}`);
  }
  const value = (environment as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing required build variable: ${name}`);
  }
  return value;
}

function hasAuthorizationResponse(): boolean {
  const query = new URLSearchParams(window.location.search);
  return query.has("code") && query.has("state");
}

void start().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "could not start uploader";
  document.body.textContent = message;
});
