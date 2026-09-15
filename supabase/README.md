# Rove Workflow synchronization

This directory is the complete hosted boundary for optional personal Rove accounts and portable Workflow configuration. It is not a task, result, artifact, browser, credential, approval, or execution-state backend.

## Private exploratory environment

1. Create one Supabase Free project in Frankfurt (`eu-central-1`). Do not enable paid compute, replicas, PITR, add-ons, or another hosted service.
2. Enable Email and Google Auth. Configure the email template as an OTP template containing `{{ .Token }}` rather than a magic-link-only template.
3. Register `rove://auth/callback` as an allowed redirect URL and configure the same callback in the Google provider.
4. Apply `migrations/202609130001_workflow_portability.sql`.
5. Supply Desktop with only `ROVE_SUPABASE_URL` and `ROVE_SUPABASE_PUBLISHABLE_KEY`. No service-role secret is used by Desktop or another hosted runtime.

The database revokes direct table access, enables RLS, and exposes authenticated RPCs that re-check `auth.uid()`. Account deletion is a no-argument function that can delete only the current `auth.uid()`; a one-way subject hash fences the access JWT until it expires. The adapter purges deletion tombstones only before capturing a new scan anchor. After 30 days, purge removes every retained change/operation row for that Workflow, advances the owner cursor floor, and retains a minimal owner-scoped Workflow hash that prevents stale resurrection.

Run `pnpm test:workflow-sync:postgres` to create an isolated native PostgreSQL cluster, apply the real migration as a non-superuser migration owner, and exercise grants, RLS, owner denial, RPC schema validation, CAS concurrency, idempotency, paging, tombstones, purge, and account deletion as a non-`BYPASSRLS` client. Set `ROVE_POSTGRES_BIN` when PostgreSQL 17 binaries are not installed at the macOS default path. The harness simulates Supabase `auth.uid()` from a request claim; it does not qualify real JWT or gateway behavior.

Before enabling synchronization for users, qualify two real devices, denied cross-owner/anonymous requests, offline concurrent edits, account switching, stale writes after deletion, 30-day purge/cursor expiry, Google and email OTP, provider pause/outage recovery, portable export, and account deletion. Account deletion must remove hosted configuration while leaving all device-local data untouched.
