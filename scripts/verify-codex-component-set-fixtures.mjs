import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { verifyCodexCodeModeHost } from "./package-desktop.mjs";

const root = await mkdtemp(join(tmpdir(), "rove-code-mode-validation-"));
try {
  await assert.rejects(
    verifyCodexCodeModeHost(join(root, "missing-code-mode-host")),
    /code-mode host is unavailable/,
  );

  const changed = join(root, "changed-code-mode-host");
  await writeFile(changed, "changed helper");
  await assert.rejects(
    verifyCodexCodeModeHost(changed),
    /code-mode host digest does not match/,
  );

  process.stdout.write(
    "Codex component-set missing/changed-helper probes passed.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
