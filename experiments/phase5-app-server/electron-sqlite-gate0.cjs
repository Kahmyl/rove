/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { createRequire } = require("node:module");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { app } = require("electron");

const root = resolve(__dirname, "../..");
const requireCompanion = createRequire(
  join(root, "apps/companion/package.json"),
);
const Database = requireCompanion("better-sqlite3");

app.whenReady().then(() => {
  const directory = mkdtempSync(join(tmpdir(), "rove-electron-sqlite-gate0-"));
  try {
    const database = new Database(join(directory, "gate0.sqlite"));
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = FULL");
    database.pragma("foreign_keys = ON");
    database.exec(
      "create table gate0 (id text primary key); insert into gate0 values ('loaded');",
    );
    const loaded = database.prepare("select id from gate0").pluck().get();
    console.log(
      `ROVE_SQLITE_GATE0 ${JSON.stringify({ loaded, electron: process.versions.electron, modules: process.versions.modules })}`,
    );
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
    app.quit();
  }
});
