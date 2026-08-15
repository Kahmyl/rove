# F1 Gate 6 — Validation Runbook

## Purpose

This is the release validation procedure for the frozen F1 browser-perception
architecture.

Run from the repository root.

## Safety

Do not:

- generate another synthetic semantic challenge after Challenge H;
- solve or bypass human verification;
- continue controlled live validation after restriction or human verification;
- commit raw external HTML/body text/screenshots/cookies/storage/credentials;
- commit or push Gate 6 until every final validation section is green.

## Frozen research hash guard

Expected SHA-256:

```text
gate6-candidate-v7.ts
1a8b00981c7d239cc0e8d2c4ce9efcfdf53d1578c9337719d6d16ee2441f36ae

gate6-semantics-v7.ts
82dd4275236e66d891bc0e57ed24430fc664b0a7e496b52af7b3a16f5de1e0da

gate6-challenge-h.ts
359b09fc47b9cccb19f13e557fc0cda7c11495befcca711164cd0bddb4b37c9a
```

## Deterministic semantic validation

Required:

```text
all 166 frozen/remedial/independent production cases
document-role production regression set
production temporal tests
S4R7 tests
Challenge G
Challenge H
```

Challenge H is final. Do not create Challenge I.

## Runtime safety validation

Required:

```text
interaction-policy tests
runtime integration tests
visible-mode pace -> freshness -> operation regression
post-action inspection behavior
human-return invalidation
```

Mutation policy must remain fail-closed.

## Tier-C persistence validation

Exactly five accepted F1 Tier-C replay files are expected.

Every replay must:

- parse as `f1-perception-replay/v1`;
- declare Tier C / recorded provenance;
- contain sanitized external URLs;
- contain no forbidden raw/private evidence.

Do not deliberately add a live human-verification Tier-C record.

## Performance budgets

Release measurement budgets for deterministic/local acquisition:

```text
inspect() p95                         <= 125 ms
inspect() max                         <= 150 ms

pageStateIdentity() p95               <= 10 ms
pageStateIdentity() max               <= 15 ms

page-state metadata payload           <= 1 KiB
minimal no-text/no-target inspection  <= 1.5 KiB
```

Do not encode these as brittle generic CI wall-clock assertions.

The 1000 ms stabilization ceiling is a safety bound, not the normal latency SLA.

## Static validation

Required:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

## Whole-repository validation

Required:

```sh
pnpm test
```

A selected test suite is not a substitute for this command.

## Privacy guard

Confirm no external recorded artifacts contain raw/private evidence families,
including:

```text
rawHtml
bodyText
fullText
requestBody
responseBody
requestHeaders
responseHeaders
cookies
authorization
bearerToken
password
otp
oneTimeCode
localStorage
sessionStorage
indexedDb
formValue
inputValue
```

## Final worktree checks

Required:

```sh
git diff --check
git status --short --branch
```

Temporary diagnostic scripts must not remain in the repository.

## Commit boundary

Only after all final validation is green:

1. create exactly one Gate-6 commit;
2. push the same feature branch;
3. verify exactly six feature commits over `main`;
4. only then open the PR against `main`.
