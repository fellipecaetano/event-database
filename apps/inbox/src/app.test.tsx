// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./app.js";
import type { UploadService } from "./upload.js";

function createService(): UploadService {
  return {
    createIntents: (files) =>
      Promise.resolve({
        uploads: files.map((file) => ({
          name: file.name,
          url: `https://uploads.example/${file.name}`,
          headers: { "Content-Type": "image/png", "If-None-Match": "*" },
        })),
      }),
    putFile: () => Promise.resolve(),
  };
}

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  it("uploads files selected through the native input", async () => {
    const user = userEvent.setup();
    render(<App accessToken="token" uploadService={createService()} />);

    await user.upload(
      screen.getByLabelText("Choose files"),
      new File(["source"], "flyer.png", { type: "image/png" }),
    );

    expect(await screen.findByText("Uploaded flyer.png")).toBeTruthy();
  });

  it("explains filename validation failures", async () => {
    const user = userEvent.setup();
    render(<App accessToken="token" uploadService={createService()} />);

    await user.upload(
      screen.getByLabelText("Choose files"),
      new File(["source"], ".hidden.png", { type: "image/png" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "invalid inbox filename",
    );
  });
});
