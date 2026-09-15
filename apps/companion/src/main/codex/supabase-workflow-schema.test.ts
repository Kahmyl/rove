import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = new URL(
  "../../../../../supabase/migrations/202609130001_workflow_portability.sql",
  import.meta.url,
);

describe("Supabase Workflow schema boundary", () => {
  it("combines revoked table grants, RLS, authenticated-owner checks, and CAS functions", async () => {
    const sql = await readFile(migration, "utf8");
    for (const table of [
      "rove_workflow_configurations",
      "rove_workflow_changes",
      "rove_workflow_operations",
      "rove_workflow_sync_floors",
    ]) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toContain(
        `revoke all on public.${table} from anon, authenticated`,
      );
    }
    expect(sql).toContain("perform rove_private.assert_owner(p_owner_id)");
    expect(sql).toContain("for update");
    expect(sql).toContain("p_expected_remote_revision");
    expect(sql).toContain("primary key (owner_id, operation_id)");
  });

  it("retains tombstones for 30 days, expires stale cursors, and fences deleted accounts", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql.match(/interval '30 days'/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("WORKFLOW_SYNC_CURSOR_EXPIRED");
    expect(sql).toContain("applied_at timestamptz := statement_timestamp()");
    expect(sql).toContain("deleted_owner_hashes");
    expect(sql).toContain("delete from auth.users where id=owner");
    expect(sql).not.toContain("service_role");
  });

  it("defines no organization, team, invitation, task, result, artifact, credential, or browser columns", async () => {
    const sql = await readFile(migration, "utf8");
    const definitions = [...sql.matchAll(/create table ([\s\S]*?)\);/gi)]
      .map((match) => match[0])
      .join("\n");
    expect(definitions).not.toMatch(
      /organization|team|invitation|task_|result_|artifact|credential|cookie|approval|browser|local_path|execution/i,
    );
  });
});
