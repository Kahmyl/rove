#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const companion = join(root, "apps/companion");
const requireBrowser = createRequire(
  join(root, "packages/browser/package.json"),
);
const requireCompanion = createRequire(join(companion, "package.json"));
const { _electron: electron } = requireBrowser("playwright");
const executablePath = requireCompanion("electron");
const entry = join(
  companion,
  "dist/main/main/qualification/attachment-main.js",
);
const userData = await mkdtemp(join(tmpdir(), "rove-attachment-renderer-"));

const application = await electron.launch({
  executablePath,
  cwd: companion,
  args: [entry, "--rove-manage-services", `--user-data-dir=${userData}`],
  env: {
    ...process.env,
    ROVE_DESKTOP_HOME: join(userData, "product-home"),
  },
});

try {
  await application.evaluate(({ app }) => app.emit("activate"));
  const page = await application.firstWindow({ timeout: 30_000 });
  const attach = page.getByRole("button", {
    name: "Attach files",
    exact: true,
  });
  await attach.waitFor({ state: "visible" });
  await attach.click();
  await page.waitForTimeout(1_000);
  const attachments = page.getByLabel("Task attachments", { exact: true });
  await attachments.getByText("semantic-upload.txt", { exact: true }).waitFor();
  await attachments.getByText("74 bytes", { exact: true }).waitFor();
  const visible = await attachments.innerText();
  if (visible.includes("/"))
    throw new Error("Attachment renderer exposed a filesystem path.");
  await attachments
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await attachments.getByText("semantic-upload.txt", { exact: true }).waitFor();
  await attachments
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await attachments
    .getByText("semantic-upload.txt", { exact: true })
    .waitFor({ state: "hidden" });
  await page.waitForFunction(async () => {
    const state = await globalThis.rove.getSurfaceSnapshot();
    return state.product?.catalog.account.status !== "unavailable";
  });
  const product = await page.evaluate(() =>
    globalThis.rove.getSurfaceSnapshot(),
  );
  const signedOut = product.product?.catalog.account.status !== "logged_in";
  process.stdout.write(
    `${JSON.stringify({
      status: "passed",
      sourceBuiltSemanticRenderer: true,
      fixtureBytes: 74,
      controls: ["Attach files", "Replace", "Remove"],
      nativeOsPicker: false,
      signedInAppServerAccount: !signedOut,
      productLaunchBlocker: signedOut
        ? "isolated qualification home has no authenticated App Server account"
        : null,
    })}\n`,
  );
} catch (error) {
  const windows = application.windows();
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      windows: await Promise.all(
        windows.map(async (window) => ({
          title: await window.title(),
          body: (await window.locator("body").innerText()).slice(0, 2_000),
        })),
      ),
    })}\n`,
  );
  throw error;
} finally {
  await application.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
