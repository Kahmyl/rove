import { createHash } from "node:crypto";
import console from "node:console";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pgBin = process.env.ROVE_POSTGRES_BIN ?? "/Library/PostgreSQL/17/bin";
const initdb = join(pgBin, "initdb");
const pgCtl = join(pgBin, "pg_ctl");
const psqlBin = join(pgBin, "psql");
const home = mkdtempSync(join(tmpdir(), "rove-workflow-postgres-"));
const data = join(home, "data");
const socket = join(home, "socket");
const port = "55473";
const database = "rove_workflow_qualification";
const baseEnv = { ...process.env, PGHOST: socket, PGPORT: port };

function command(executable, args, options = {}) {
  const response = spawnSync(executable, args, {
    encoding: "utf8",
    env: baseEnv,
    ...options,
  });
  if (response.status !== 0)
    throw new Error(
      `${executable} ${args.join(" ")} failed\n${response.stdout}${response.stderr}`,
    );
  return response.stdout.trim();
}

function sql(statement, user = "rove_migrator") {
  return command(psqlBin, [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-U",
    user,
    "-d",
    database,
    "-c",
    statement,
  ]);
}

function rejected(statement, pattern, user = "rove_client") {
  const response = spawnSync(
    psqlBin,
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-U",
      user,
      "-d",
      database,
      "-c",
      statement,
    ],
    { encoding: "utf8", env: baseEnv },
  );
  const output = `${response.stdout}${response.stderr}`;
  if (response.status === 0 || !pattern.test(output))
    throw new Error(
      `Expected rejection matching ${pattern}, received:\n${output}`,
    );
}

function asOwner(owner, statement) {
  return sql(
    `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); ${statement}`,
    "rove_client",
  )
    .split("\n")
    .at(-1);
}

function rejectOwner(owner, statement, pattern) {
  rejected(
    `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); ${statement}`,
    pattern,
  );
}

function asAnon(statement) {
  return sql(`set role anon; ${statement}`, "rove_anon_client")
    .split("\n")
    .at(-1);
}

function rejectAnon(statement, pattern) {
  rejected(`set role anon; ${statement}`, pattern, "rove_anon_client");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";

function snapshot(workflowId, purpose, additions = {}) {
  const base = {
    workflowId,
    configurationRevision: 1,
    name: "Qualified Workflow",
    archived: false,
    configuration: {
      purpose,
      preferences: [],
      criteria: [],
      guidance: [],
      procedures: [],
      resourceRequirements: [],
      resultConventions: [],
      approvedKnowledge: [],
    },
    approvedAt: "2026-09-13T12:00:00.000Z",
    ...additions,
  };
  return { schemaVersion: 1, ...base, digest: digest(base) };
}

const literal = (value) => `$json$${JSON.stringify(value)}$json$::jsonb`;
function writeCall(owner, operationId, expected, value, requestOverride) {
  const requestDigest =
    requestOverride ??
    digest({
      expectedRemoteRevision: expected,
      kind: "write",
      ownerId: owner,
      snapshotDigest: value.digest,
    });
  return `select public.rove_workflow_write('${owner}','${operationId}','${requestDigest}',${expected === null ? "null" : expected},${literal(value)},'2000-01-01T00:00:00Z')`;
}

function deleteCall(owner, workflowId, operationId, expected) {
  const requestDigest = digest({
    expectedRemoteRevision: expected,
    kind: "delete",
    ownerId: owner,
    snapshotDigest: null,
    workflowId,
  });
  return `select public.rove_workflow_delete('${owner}','${workflowId}','${operationId}','${requestDigest}',${expected},'2000-01-01T00:00:00Z')`;
}

async function concurrent(statements) {
  return Promise.all(
    statements.map(
      (statement) =>
        new Promise((resolvePromise) => {
          const child = spawn(
            psqlBin,
            [
              "-X",
              "-v",
              "ON_ERROR_STOP=1",
              "-At",
              "-U",
              "rove_client",
              "-d",
              database,
              "-c",
              `set role authenticated; select set_config('request.jwt.claim.sub','${ownerA}',false); ${statement}`,
            ],
            { env: baseEnv, stdio: ["ignore", "pipe", "pipe"] },
          );
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += chunk;
          });
          child.stderr.on("data", (chunk) => {
            output += chunk;
          });
          child.on("close", (status) => resolvePromise({ status, output }));
        }),
    ),
  );
}

let started = false;
try {
  command(initdb, ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"]);
  command("mkdir", ["-p", socket]);
  command(pgCtl, [
    "-D",
    data,
    "-l",
    join(home, "postgres.log"),
    "-o",
    `-k ${socket} -p ${port} -c listen_addresses=`,
    "start",
  ]);
  started = true;
  command(psqlBin, [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-d",
    "postgres",
    "-c",
    "create role anon nologin",
    "-c",
    "create role authenticated nologin",
    "-c",
    "create role rove_migrator login nosuperuser nocreatedb nocreaterole nobypassrls",
    "-c",
    "create role rove_client login nosuperuser nocreatedb nocreaterole nobypassrls",
    "-c",
    "grant authenticated to rove_client",
    "-c",
    "create role rove_anon_client login nosuperuser nocreatedb nocreaterole nobypassrls",
    "-c",
    "grant anon to rove_anon_client",
    "-c",
    `create database ${database} owner rove_migrator`,
  ]);
  sql(
    "create schema extensions; create extension pgcrypto with schema extensions; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to public",
  );
  command(psqlBin, [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "rove_migrator",
    "-d",
    database,
    "-f",
    join(root, "supabase/migrations/202609130001_workflow_portability.sql"),
  ]);
  sql(`insert into auth.users(id) values('${ownerA}'),('${ownerB}')`);

  const acl = sql(`select
    (select rolbypassrls=false and rolsuper=false from pg_roles where rolname='rove_client') and
    (select relrowsecurity from pg_class where oid='public.rove_workflow_configurations'::regclass) and
    (select relrowsecurity from pg_class where oid='public.rove_workflow_changes'::regclass) and
    (select relrowsecurity from pg_class where oid='public.rove_workflow_operations'::regclass) and
    (select relrowsecurity from pg_class where oid='public.rove_workflow_sync_floors'::regclass) and
    not has_table_privilege('authenticated','public.rove_workflow_configurations','select') and
    not has_table_privilege('authenticated','public.rove_workflow_changes','select') and
    not has_table_privilege('authenticated','public.rove_workflow_operations','select') and
    not has_table_privilege('authenticated','public.rove_workflow_sync_floors','select') and
    has_function_privilege('authenticated','public.rove_workflow_write(uuid,text,text,bigint,jsonb,timestamptz)','execute') and
    not has_function_privilege('anon','public.rove_workflow_write(uuid,text,text,bigint,jsonb,timestamptz)','execute')`);
  if (acl !== "t") throw new Error("Migration ACL/RLS qualification failed.");
  if (asAnon("select current_user") !== "anon")
    throw new Error("Anonymous qualification client did not assume anon.");
  if (asAnon("select auth.uid() is null") !== "t")
    throw new Error("Anonymous qualification unexpectedly had an auth owner.");
  rejectAnon(
    "select * from public.rove_workflow_configurations",
    /permission denied/,
  );
  rejectAnon(
    "insert into public.rove_workflow_configurations(owner_id,workflow_id,remote_revision,change_sequence,state,snapshot,updated_at) values('11111111-1111-4111-8111-111111111111','workflow_anon00000',1,0,'active','{}',now())",
    /permission denied/,
  );
  rejectAnon(
    "select public.rove_workflow_sync_position('11111111-1111-4111-8111-111111111111')",
    /permission denied/,
  );
  rejectOwner(
    ownerA,
    "select * from public.rove_workflow_configurations",
    /permission denied/,
  );
  rejectOwner(
    ownerA,
    "select public.rove_workflow_sync_position('22222222-2222-4222-8222-222222222222')",
    /owner mismatch/,
  );
  rejected(
    "set role authenticated; select public.rove_workflow_sync_position('11111111-1111-4111-8111-111111111111')",
    /owner mismatch/,
  );

  sql(
    "grant select,insert,update,delete on public.rove_workflow_configurations to authenticated",
  );
  if (
    asOwner(
      ownerA,
      "select count(*) from public.rove_workflow_configurations",
    ) !== "0"
  )
    throw new Error("Owner A initial visibility failed.");
  rejectOwner(
    ownerA,
    `insert into public.rove_workflow_configurations(owner_id,workflow_id,remote_revision,change_sequence,state,snapshot,updated_at) values('${ownerB}','workflow_forged00',1,0,'active','{}',now())`,
    /row-level security/,
  );
  sql(
    "revoke select,insert,update,delete on public.rove_workflow_configurations from authenticated",
  );

  const main = snapshot("workflow_main0000", "Original purpose");
  const created = JSON.parse(
    asOwner(ownerA, writeCall(ownerA, "sync_create_main0", null, main)),
  );
  if (created.remoteRevision !== 1 || created.snapshot.digest !== main.digest)
    throw new Error("Create/digest qualification failed.");
  const sparse = snapshot("workflow_sparse00", "");
  const sparseCreated = JSON.parse(
    asOwner(ownerA, writeCall(ownerA, "sync_create_sparse", null, sparse)),
  );
  if (
    sparseCreated.remoteRevision !== 1 ||
    sparseCreated.snapshot.configuration.purpose !== ""
  )
    throw new Error("Sparse name-only Workflow qualification failed.");
  sql(
    "grant select,insert,update,delete on public.rove_workflow_configurations to authenticated",
  );
  if (
    asOwner(
      ownerB,
      "select count(*) from public.rove_workflow_configurations",
    ) !== "0" ||
    asOwner(
      ownerB,
      `with changed as (update public.rove_workflow_configurations set updated_at=updated_at where owner_id='${ownerA}' returning 1) select count(*) from changed`,
    ) !== "0" ||
    asOwner(
      ownerB,
      `with removed as (delete from public.rove_workflow_configurations where owner_id='${ownerA}' returning 1) select count(*) from removed`,
    ) !== "0" ||
    asOwner(
      ownerA,
      "select count(*) from public.rove_workflow_configurations where workflow_id='workflow_main0000'",
    ) !== "1"
  )
    throw new Error("Cross-owner SELECT/UPDATE/DELETE RLS isolation failed.");
  sql(
    "revoke select,insert,update,delete on public.rove_workflow_configurations from authenticated",
  );
  rejectOwner(
    ownerB,
    `select public.rove_workflow_read('${ownerA}','workflow_main0000')`,
    /owner mismatch/,
  );
  rejectOwner(
    ownerA,
    writeCall(ownerA, "sync_bad_digest00", null, {
      ...main,
      workflowId: "workflow_bad00000",
      digest: "0".repeat(64),
    }),
    /digest does not match/,
  );
  rejectOwner(
    ownerA,
    writeCall(
      ownerA,
      "sync_bad_request0",
      null,
      snapshot("workflow_badreq00", "Valid"),
      "0".repeat(64),
    ),
    /request digest is invalid/,
  );
  rejectOwner(
    ownerA,
    `select public.rove_workflow_write('${ownerA}','sync_null_digest0',null,null,${literal(snapshot("workflow_nulldgst0", "Valid"))},now())`,
    /request digest is invalid/,
  );
  rejectOwner(
    ownerA,
    `select public.rove_workflow_write('${ownerA}','sync_null_record0','${"0".repeat(64)}',null,null,now())`,
    /snapshot fields are invalid/,
  );
  for (const [name, mutate, pattern] of [
    [
      "task metadata",
      (v) => ({ ...v, task: { id: "task_private" } }),
      /snapshot fields/,
    ],
    [
      "nested object",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          guidance: [{ id: "g1", text: { result: "private" }, appliesTo: [] }],
        },
      }),
      /must be text/,
    ],
    [
      "browser state",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          preferences: [
            {
              id: "p1",
              text: "browser state",
              appliesTo: [],
              browserState: {},
            },
          ],
        },
      }),
      /item fields/,
    ],
    [
      "local path",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          purpose: "/Users/alice/private.txt",
        },
      }),
      /local path/,
    ],
    [
      "parenthesized Unix path",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          purpose: "Open(/var/lib/private.txt)",
        },
      }),
      /local path/,
    ],
    [
      "colon Unix path",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          purpose: "file: /Users/example/private.txt",
        },
      }),
      /local path/,
    ],
    [
      "equals Unix path",
      (v) => ({
        ...v,
        configuration: { ...v.configuration, purpose: "path=/tmp/foo" },
      }),
      /local path/,
    ],
    [
      "quoted Windows path",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          purpose: String.raw`"C:\Users\example\private.txt"`,
        },
      }),
      /local path/,
    ],
    [
      "UNC local path",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          purpose: "\\\\workstation\\private\\result.txt",
        },
      }),
      /local path/,
    ],
    [
      "path in identity",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          guidance: [
            { id: "/Users/alice/private", text: "Valid", appliesTo: [] },
          ],
        },
      }),
      /local path/,
    ],
    [
      "resource kind",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          resourceRequirements: [
            { id: "r1", kind: "credential", label: "Secret" },
          ],
        },
      }),
      /kind is invalid/,
    ],
    [
      "null resource kind",
      (v) => ({
        ...v,
        configuration: {
          ...v.configuration,
          resourceRequirements: [{ id: "r1", kind: null, label: "Valid" }],
        },
      }),
      /kind is invalid/,
    ],
    ["oversized", (v) => ({ ...v, name: "x".repeat(121) }), /invalid length/],
  ]) {
    const raw = mutate(
      snapshot(`workflow_${digest(name).slice(0, 12)}`, "Valid"),
    );
    const base = { ...raw };
    delete base.schemaVersion;
    delete base.digest;
    const value = { ...raw, digest: digest(base) };
    rejectOwner(
      ownerA,
      writeCall(ownerA, `sync_${digest(name).slice(0, 12)}`, null, value),
      pattern,
    );
  }

  const benign = snapshot(
    "workflow_slashes00",
    "Compare input/output ratios and https://example.com/a/b",
  );
  const benignResult = JSON.parse(
    asOwner(ownerA, writeCall(ownerA, "sync_slashes0000", null, benign)),
  );
  if (benignResult.snapshot.digest !== benign.digest)
    throw new Error("Benign slash-bearing portable text was rejected.");

  rejectOwner(
    ownerA,
    writeCall(ownerA, "sync_wrong_cas00", 9, main),
    /revision conflict/,
  );
  const updatedBase = {
    ...main,
    configurationRevision: 2,
    configuration: { ...main.configuration, purpose: "Updated purpose" },
  };
  const digestBase = { ...updatedBase };
  delete digestBase.schemaVersion;
  delete digestBase.digest;
  const updated = { ...updatedBase, digest: digest(digestBase) };
  const updateStatement = writeCall(ownerA, "sync_update_main0", 1, updated);
  const firstUpdate = JSON.parse(asOwner(ownerA, updateStatement));
  const replay = JSON.parse(asOwner(ownerA, updateStatement));
  if (firstUpdate.remoteRevision !== 2 || replay.remoteRevision !== 2)
    throw new Error("Update CAS/idempotency failed.");
  const nullDeleteDigest = digest({
    expectedRemoteRevision: null,
    kind: "delete",
    ownerId: ownerA,
    snapshotDigest: null,
    workflowId: "workflow_main0000",
  });
  rejectOwner(
    ownerA,
    `select public.rove_workflow_delete('${ownerA}','workflow_main0000','sync_null_delete0','${nullDeleteDigest}',null,now())`,
    /Expected Workflow revision is invalid/,
  );
  if (
    JSON.parse(
      asOwner(
        ownerA,
        `select public.rove_workflow_read('${ownerA}','workflow_main0000')`,
      ),
    ).state !== "active"
  )
    throw new Error("Null delete revision mutated the remote Workflow.");

  const raceA = snapshot("workflow_race0000", "Race A");
  const raceB = snapshot("workflow_race0000", "Race B");
  const race = await concurrent([
    writeCall(ownerA, "sync_race_a00000", null, raceA),
    writeCall(ownerA, "sync_race_b00000", null, raceB),
  ]);
  if (
    race.filter(({ status }) => status === 0).length !== 1 ||
    race.filter(({ status }) => status !== 0).length !== 1 ||
    !race
      .find(({ status }) => status !== 0)
      .output.includes("revision conflict")
  )
    throw new Error(
      `First-create race was not exclusive: ${JSON.stringify(race)}`,
    );

  const pageA = snapshot("workflow_pagea000", "Page A old");
  const pageZ = snapshot("workflow_pagez000", "Page Z old");
  asOwner(ownerA, writeCall(ownerA, "sync_page_a00000", null, pageA));
  asOwner(ownerA, writeCall(ownerA, "sync_page_z00000", null, pageZ));
  const anchor = JSON.parse(
    asOwner(ownerA, `select public.rove_workflow_sync_position('${ownerA}')`),
  );
  const pageZ2Base = {
    ...pageZ,
    configurationRevision: 2,
    configuration: { ...pageZ.configuration, purpose: "Page Z new" },
  };
  const pageZDigestBase = { ...pageZ2Base };
  delete pageZDigestBase.schemaVersion;
  delete pageZDigestBase.digest;
  const pageZ2 = { ...pageZ2Base, digest: digest(pageZDigestBase) };
  asOwner(ownerA, writeCall(ownerA, "sync_page_z_update", 1, pageZ2));
  const oldAtWatermark = asOwner(
    ownerA,
    `select record->'snapshot'->'configuration'->>'purpose' from public.rove_workflow_list('${ownerA}',10,'workflow_pagea000',null,${anchor.highWatermark},'${anchor.snapshotAt}') where workflow_id='workflow_pagez000'`,
  );
  const laterChange = asOwner(
    ownerA,
    `select record->'snapshot'->'configuration'->>'purpose' from public.rove_workflow_list('${ownerA}',10,null,${anchor.highWatermark},(select (public.rove_workflow_sync_position('${ownerA}')->>'highWatermark')::bigint),'${anchor.snapshotAt}') where workflow_id='workflow_pagez000' order by cursor_position desc limit 1`,
  );
  if (oldAtWatermark !== "Page Z old" || laterChange !== "Page Z new")
    throw new Error("Snapshot-stable pagination qualification failed.");

  const deletion = JSON.parse(
    asOwner(
      ownerA,
      deleteCall(ownerA, "workflow_main0000", "sync_delete_main0", 2),
    ),
  );
  if (
    deletion.deletedAt.startsWith("2000-") ||
    Date.parse(deletion.deletedAt) < Date.now() - 60_000
  )
    throw new Error("Deletion did not use authoritative server time.");
  rejectOwner(
    ownerA,
    writeCall(ownerA, "sync_resurrect000", null, main),
    /cannot be resurrected/,
  );
  sql(
    `update public.rove_workflow_configurations set deleted_at=now()-interval '31 days' where owner_id='${ownerA}' and workflow_id='workflow_main0000'; update public.rove_workflow_changes set record=jsonb_set(record,'{deletedAt}',to_jsonb(to_char(now()-interval '31 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where owner_id='${ownerA}' and workflow_id='workflow_main0000' and record->>'state'='deleted'`,
  );
  if (
    asOwner(
      ownerA,
      "select public.rove_purge_expired_workflow_tombstones()",
    ) !== "1"
  )
    throw new Error("Tombstone purge count failed.");
  const purged = sql(
    `select count(*)=0 from public.rove_workflow_changes where owner_id='${ownerA}' and workflow_id='workflow_main0000'`,
  );
  if (purged !== "t")
    throw new Error("Tombstone history was not fully purged.");
  rejectOwner(
    ownerA,
    `select * from public.rove_workflow_list('${ownerA}',10,null,0,(public.rove_workflow_sync_position('${ownerA}')->>'highWatermark')::bigint,now())`,
    /WORKFLOW_SYNC_CURSOR_EXPIRED/,
  );
  rejectOwner(
    ownerA,
    `select * from public.rove_workflow_list('${ownerA}',10,null,null,${anchor.highWatermark},'${anchor.snapshotAt}')`,
    /WORKFLOW_SYNC_CURSOR_EXPIRED/,
  );
  const postPurgeAnchor = JSON.parse(
    asOwner(ownerA, `select public.rove_workflow_sync_position('${ownerA}')`),
  );
  asOwner(
    ownerA,
    `select count(*) from public.rove_workflow_list('${ownerA}',10,null,null,${postPurgeAnchor.highWatermark},'${postPurgeAnchor.snapshotAt}')`,
  );
  rejectOwner(
    ownerA,
    writeCall(ownerA, "sync_resurrect002", null, main),
    /cannot be resurrected/,
  );

  asOwner(
    ownerB,
    writeCall(
      ownerB,
      "sync_owner_b00000",
      null,
      snapshot("workflow_ownerb00", "Owner B"),
    ),
  );
  asOwner(ownerB, "select public.rove_delete_account()");
  if (sql(`select count(*) from auth.users where id='${ownerB}'`) !== "0")
    throw new Error("Cloud account deletion failed.");
  rejectOwner(
    ownerB,
    `select public.rove_workflow_sync_position('${ownerB}')`,
    /account is deleted/,
  );

  console.log("Workflow synchronization PostgreSQL qualification passed.");
  console.log(
    "Proved: real migration; anon request-context denial; non-superuser ACL/RLS; owner isolation; RPC portable-path validation; server digests; CAS race/idempotency; stable paging; server-timed tombstones/purge/non-resurrection; account deletion.",
  );
  console.log(
    "Simulated auth.uid via a request GUC. Real JWT expiry/revocation and Supabase gateway behavior remain live-qualification items.",
  );
} finally {
  if (started)
    spawnSync(pgCtl, ["-D", data, "stop", "-m", "fast"], {
      encoding: "utf8",
      env: baseEnv,
    });
  rmSync(home, { recursive: true, force: true });
}
