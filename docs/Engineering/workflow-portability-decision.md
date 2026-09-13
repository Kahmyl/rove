# Workflow Portability Decision

**Status:** Provider-neutral data and conflict contracts are implemented. Production identity, hosted storage, retention, and operations require explicit authority before Rove enables synchronization.

## Decision required

Choose the Rove owner/authentication system and hosted Workflow-configuration provider as one reviewed product boundary. The decision authorizes which service receives approved reusable Workflow configuration, which sign-in methods Rove supports, applicable regions and retention, account export/deletion behavior, operating budget, and production support responsibility.

This decision does not authorize cloud task history, results, artifacts, screenshots, recordings, downloads, browser profiles, credentials, local paths, approvals, or execution state. Those remain device-local.

## Recommendation

Qualify Supabase Auth plus one Postgres schema protected by grants and row-level security first. It aligns owner identity and conditional row updates in one system, supports common sign-in methods, and makes owner-scoped policies and revision compare-and-set behavior directly testable. Its current Free plan is useful for qualification but pauses inactive projects and omits production backup/support guarantees; production should budget at least the applicable paid plan rather than treating the free tier as an availability commitment. See the official [Auth](https://supabase.com/docs/guides/auth), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), and [pricing](https://supabase.com/pricing) documentation.

Before adoption, prove authenticated owner isolation, denied anonymous access, conditional revisions, operation idempotency, tombstone retention, stale-client non-resurrection, export/account deletion, region selection, token storage/logout behavior, inactivity behavior, quotas, and recovery from provider outage. Use only the portable schema already validated in the application.

## Credible alternatives

| Option                                                | Advantages                                                                                                         | Costs and risks                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase Auth + Postgres/RLS                          | Integrated authentication and relational conditional updates; direct owner-row policies; conventional export path. | Free projects can pause; paid operation starts from the provider's current plan price; grants and RLS must both be correct, and service-role credentials must never ship in Desktop.                                                                                                                                                                                                         |
| Firebase Authentication + Cloud Firestore             | Mature client authentication and Security Rules; offline client support.                                           | Document/read/write billing and rule-evaluation reads require cost modeling; rules are not query filters; server SDKs bypass Security Rules and therefore require a separately secured backend/IAM boundary. Official sources: [billing](https://firebase.google.com/docs/firestore/pricing) and [security](https://firebase.google.com/docs/firestore/security/overview).                   |
| Cloudflare Worker + D1 + separately selected identity | Scale-to-zero SQL storage, explicit row-based pricing, Time Travel, and generous qualification limits.             | D1 does not itself settle Rove consumer identity; a Worker authorization layer and identity provider become additional operated components. Free daily limits fail requests when exceeded, and each database is single-threaded. Official sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [limits](https://developers.cloudflare.com/d1/platform/limits/). |
| Self-operated API + Postgres                          | Maximum policy and migration control with portable SQL semantics.                                                  | Highest operational burden: identity, email abuse, secrets, upgrades, backup, monitoring, incident response, deletion/export, and availability all become Rove responsibilities. This is not recommended for the first MVP.                                                                                                                                                                  |

## Engineering already completed

`workflow-portability.ts` defines and validates the only portable projection: Workflow identity/name, approved configuration, archive state, configuration revision, digest, and approval time. Unknown internal fields, recognized secrets, and local paths are rejected. The provider interface is owner-scoped and supports idempotent compare-and-set writes, tombstone/non-resurrection semantics, bounded stable pagination, and invalid-cursor recovery through authoritative refresh. A deterministic in-memory provider proves those contract semantics, owner isolation, revision conflicts, operation replay, deletion non-resurrection, and upload/download/conflict planning without network access or task dispatch. It does not prove storage durability across process restarts.

No production adapter is registered, no user identity is invented from the Codex account, no remote endpoint is configured, and the UI continues to describe Workflows as local. The local task database remains the source of task/execution truth.

## Work after the decision

1. Implement the selected Rove sign-in and a non-secret local profile partition identity independent of the Codex account.
2. Implement the provider adapter and server-side owner enforcement; never embed administrative credentials in Desktop.
3. Persist per-Workflow acknowledged remote revision/digest, pending state, conflict payload, and tombstone cursor in the local profile database.
4. Add an explicit UI for local/pending/synchronized/conflicted/unavailable state and keep-local, keep-remote, or create-copy conflict choices.
5. Exercise two devices, offline edits, stale writes after deletion, expired cursors, account switch, provider outage, export/deletion, and secret-field rejection against an isolated deployed qualification environment.
6. Update the implementation matrix only after those real boundaries pass; do not infer production portability from the deterministic fake.
