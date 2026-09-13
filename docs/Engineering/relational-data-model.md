# Relational Data Model

**Status:** Target storage contract plus implemented local Workflow/result mappings. Proposed relation names below are not a requirement to rename compatible installed tables.

## Storage boundaries

Use a separate local database/artifact partition for each Rove profile on a device. Keep tasks and execution data local. Only an explicit workflow-configuration projection may cross the synchronization boundary. Do not upload the SQLite file, task ledger, general event log, or arbitrary rows.

Keep SQLite with better-sqlite3/Kysely where appropriate. The application service owns writes; the renderer cannot issue arbitrary SQL. Enable foreign keys on every connection, use short transactions, and preserve an explicit durability policy. [SQLite foreign-key documentation](https://www.sqlite.org/foreignkeys.html) explains why constraints cannot be assumed active by default.

## Proposed local relations

Names describe domain responsibilities. Implementations may retain existing tables where they satisfy these constraints rather than migrating for cosmetic equivalence.

| Relation                | Essential columns                                                                                          | Constraints and ownership                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `profile`               | `profile_id`, remote subject reference, display name, timestamps                                           | One local partition owner; never keyed by a Codex token/account.                                                        |
| `workflow`              | `workflow_id`, `profile_id`, name, current revision, archive/deletion state                                | Owner-scoped identity; deleting setup does not delete local tasks.                                                      |
| `workflow_revision`     | `workflow_id`, revision, approved configuration JSON, digest, approval time                                | Composite primary key; immutable after approval; validated portable schema.                                             |
| `workflow_sync`         | `workflow_id`, acknowledged remote revision, pending local revision, state, conflict payload               | Configuration only; no execution instructions. One current sync state per workflow.                                     |
| `task`                  | `task_id`, optional `workflow_id`, title, organization state, timestamps                                   | Conversation persists independently of engine or browser. Workflow removal uses a nullable live reference.              |
| `task_turn`             | `turn_id`, `task_id`, request operation ID, state, context snapshot/digest, timestamps                     | Request operation unique within the profile. A stopped/completed turn does not close its task.                          |
| `conversation_entry`    | `entry_id`, `task_id`, optional `turn_id`, sequence, kind, display payload                                 | Unique `(task_id, sequence)`; stable upstream item identity deduplicates delivery.                                      |
| `engine_association`    | association ID, task ID, thread ID, connection epoch, compatibility identity, attachment state             | Local mapping; credentials live outside the table. No cross-account thread reuse by assumption.                         |
| `operation`             | operation ID, task/turn IDs, kind, request digest, approval reference, dispatch state, outcome, timestamps | Stable idempotency key; same key with different payload is rejected. Unknown outcomes cannot become success by timeout. |
| `attention_request`     | request ID, task/operation IDs, generation, kind, scope digest, state, response                            | Exact live generation required; terminal requests cannot be accepted twice.                                             |
| `capability_grant`      | grant ID, task or profile scope, capability, resource reference, permitted operations, expiry/revocation   | Local, revocable, explicitly authorized; no portable secret values.                                                     |
| `capability_attachment` | attachment ID, task ID, capability kind, local resource/host identity, generation, state                   | Attachment absence does not invalidate task existence. Revalidate live authority after restart.                         |
| `result`                | result ID, task ID, optional turn ID, kind, structured payload, source references, timestamps              | Local; selection refers to stable records rather than rendered text.                                                    |
| `artifact`              | artifact ID, task ID, managed relative path, MIME type, size, digest, origin, availability                 | Path resolves under owned artifact storage; metadata does not imply bytes exist.                                        |
| `local_change`          | sequence, entity identity, revision, event kind, bounded payload, time                                     | Durable notification/recovery facts only where needed; not a second authoritative lifecycle engine.                     |

A workflow's skills and resource requirements may be validated JSON within its approved configuration for this MVP. Do not create independent services or tables for every form field. Normalize further only for concrete query, integrity, or update requirements.

Browser pages and host ownership can continue in the Runtime's existing local store. The application attachment references that authority; it must not create a second contradictory page registry. A result-to-artifact join table is justified when multiple artifacts/results share references; otherwise an explicit bounded list may suffice initially.

## Example constraints

The following SQL illustrates required properties, not a migration to execute alongside the current stores:

```sql
CREATE UNIQUE INDEX operation_request_identity
  ON operation(operation_id);
CREATE UNIQUE INDEX conversation_task_sequence
  ON conversation_entry(task_id, sequence);
CREATE UNIQUE INDEX workflow_approved_revision
  ON workflow_revision(workflow_id, revision);
```

Schema definitions must also enforce non-null ownership keys, valid enum values, positive revisions/sequences, foreign keys for task-owned records, and JSON validity where JSON columns are used. Application validation supplies semantic checks that SQL cannot express, including grant scope and workflow allowlists.

Do not use unrestricted cascading deletion for operation evidence while work is active. Explicit task deletion settles running work, removes or anonymizes references according to the chosen retention behavior, and deletes only owned artifacts no longer referenced elsewhere.

## Portable representation

Remote storage needs the authenticated Rove owner, workflow ID, revision, validated approved configuration, deletion/tombstone state, and update metadata. The provider may represent this with fewer tables. It does not need task, turn, message, result, artifact, browser, or credential relations.

Use conditional updates against the known remote revision. Local revision and remote acknowledged revision are different concepts. Timestamps are informational, not a conflict-resolution authority. Tombstones or an equivalent cursor-invalidating deletion mechanism must prevent an offline device from resurrecting deleted setup. See [workflow portability](workflow-context-and-portability.md).

## Existing persistence and migration

The reviewed source contains `SqliteTaskStore`/task-ledger storage and `SqliteTaskEngineStore` in `apps/companion/src/main/codex`. Existing migrations include `0001_durable_task_ledger`, `0002_task_engine_event_aggregate_outbox`, `0003_add_workflow_configuration`, and `0004_add_task_results`. The third migration adds local Workflow environments, immutable configuration revisions, idempotent operation records, and local conversation-item promotion provenance. The fourth adds task-owned stable results, immutable result revisions, idempotent result operations, and exact result-revision Workflow-promotion provenance. These describe actual storage history and are not product release versions. Keep their identities for existing local databases.

Task/Workflow association plus applied per-turn Workflow and selected-result snapshots remain in the durable task event/aggregate/outbox records rather than introducing another task authority. Result rows retain only local source/evidence references and bounded action material; Runtime's effect journal remains authoritative for external dispatch and observed outcome. Future portable synchronization still requires a deliberate migration/provider boundary and must not upload these local execution records. Do not create a second task authority in parallel without a defined cutover, data mapping, backup, and reconciliation plan. Existing compatibility epochs must remain interpretable even when their historical string contains a milestone label.

New migration names identify their effect, such as `0003_add_workflow_configuration`. The numeric prefix is application order, not a product edition. Never relabel an already-applied migration or change its checksum just to clean naming. A test-only temporary migration label may be renamed because it is not an installed database's history. [Kysely migrations](https://kysely.dev/docs/migrations) document the relevant migration model.

## Backup and recovery

A consistent backup uses the supported SQLite backup mechanism or another verified snapshot method, plus an artifact manifest. Copying a live database file without accounting for WAL is not an adequate backup procedure. [SQLite Online Backup](https://www.sqlite.org/backup.html) describes supported approaches.

Backup/export excludes credentials by default, identifies missing local artifacts, and is distinct from workflow synchronization. Restore validates format, ownership partition, checksums, paths, and compatibility before replacing live data. Never overwrite active local work with an unvalidated archive.
