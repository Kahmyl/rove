import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { Migrator, type MigrationProvider } from "kysely/migration";
import { afterEach, describe, expect, it } from "vitest";

interface LedgerTestDatabase {
  schema_migration: {
    name: string;
    applied_at: string;
  };
  task_instance: {
    task_id: string;
    sequence: number;
    desired_state: string;
  };
  task_command: {
    command_id: string;
    task_id: string;
    status: string;
  };
}

const roots: string[] = [];

function open(path: string) {
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = FULL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  const kysely = new Kysely<LedgerTestDatabase>({
    dialect: new SqliteDialect({ database }),
  });
  return { database, kysely };
}

const provider: MigrationProvider = {
  async getMigrations() {
    return {
      "001_task_integrity_schema": {
        async up(db) {
          await db.schema
            .createTable("task_instance")
            .addColumn("task_id", "text", (column) => column.primaryKey())
            .addColumn("sequence", "integer", (column) => column.notNull())
            .addColumn("desired_state", "text", (column) => column.notNull())
            .execute();
          await db.schema
            .createTable("task_command")
            .addColumn("command_id", "text", (column) => column.primaryKey())
            .addColumn("task_id", "text", (column) =>
              column.notNull().references("task_instance.task_id"),
            )
            .addColumn("status", "text", (column) => column.notNull())
            .execute();
        },
        async down(db) {
          await db.schema.dropTable("task_command").execute();
          await db.schema.dropTable("task_instance").execute();
        },
      },
    };
  },
};

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Kysely + better-sqlite3", () => {
  it("enforces the required durability settings and atomic foreign-key transaction", async () => {
    const root = mkdtempSync(join(tmpdir(), "rove-ledger-integrity-"));
    roots.push(root);
    const path = join(root, "ledger.sqlite");
    const first = open(path);
    const migration = await new Migrator({
      db: first.kysely,
      provider,
    }).migrateToLatest();
    expect(migration.error).toBeUndefined();
    expect(first.database.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(first.database.pragma("synchronous", { simple: true })).toBe(2);
    expect(first.database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(first.database.pragma("busy_timeout", { simple: true })).toBe(5000);

    await expect(
      first.kysely.transaction().execute(async (tx) => {
        await tx
          .insertInto("task_instance")
          .values({
            task_id: "task_atomic",
            sequence: 1,
            desired_state: "open",
          })
          .execute();
        await tx
          .insertInto("task_command")
          .values({
            command_id: "cmd_atomic",
            task_id: "task_atomic",
            status: "pending",
          })
          .execute();
        throw new Error("cut-before-commit");
      }),
    ).rejects.toThrow("cut-before-commit");
    expect(
      await first.kysely.selectFrom("task_instance").selectAll().execute(),
    ).toEqual([]);

    await first.kysely.transaction().execute(async (tx) => {
      await tx
        .insertInto("task_instance")
        .values({
          task_id: "task_committed",
          sequence: 1,
          desired_state: "closed",
        })
        .execute();
      await tx
        .insertInto("task_command")
        .values({
          command_id: "cmd_committed",
          task_id: "task_committed",
          status: "reconcile_required",
        })
        .execute();
    });
    await first.kysely.destroy();

    const reopened = open(path);
    expect(
      await reopened.kysely
        .selectFrom("task_command")
        .selectAll()
        .where("command_id", "=", "cmd_committed")
        .executeTakeFirst(),
    ).toMatchObject({
      status: "reconcile_required",
      task_id: "task_committed",
    });
    await expect(
      reopened.kysely
        .insertInto("task_command")
        .values({
          command_id: "cmd_orphan",
          task_id: "missing",
          status: "pending",
        })
        .execute(),
    ).rejects.toThrow();
    expect(
      (
        await sql<{ integrity_check: string }>`pragma integrity_check`.execute(
          reopened.kysely,
        )
      ).rows,
    ).toEqual([{ integrity_check: "ok" }]);
    reopened.database.pragma("wal_checkpoint(TRUNCATE)");
    await reopened.kysely.destroy();
  });
});
