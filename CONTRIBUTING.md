# Contributing to Rove

Rove is under development and has not shipped a production release. Begin with the [documentation index](docs/README.md). Product purpose and direction take precedence over accidental constraints in existing code.

## Naming

Name documents, source files, tests, scripts, and migrations for the responsibility they express. Use names such as `target-grounding.integration.test.ts`, `task-ledger-sqlite-integrity.test.ts`, `browser-control-and-recording.md`, and `add_workflow_configuration`.

Do not use implementation milestone, phase, gate, ticket, or product-edition labels as filenames or script names. A test description should describe the behavior being asserted, not when it was built. Do not merely replace a phase number with another arbitrary sequence or codename.

There are necessary technical identifiers: pinned upstream binaries/generated schemas, wire protocol formats, applied database migration IDs, and package metadata required by tooling. They are not product editions. Preserve them when changing them would break compatibility. An applied migration's ordering prefix is legitimate; its description must identify the schema change. New migration names must not contain ticket or phase labels. A test-only migration in a disposable database can be renamed safely.

An existing persisted compatibility epoch containing historical wording must remain interpretable. Remove it only through an explicit data migration with backup/recovery evidence, not a global string replacement.

## Documentation structure

Keep one current canonical account of product and engineering responsibilities in `docs/Products` and `docs/Engineering`. Active implementation sequencing may live under `docs/Planning`, but it remains subordinate to those canonical contracts and to `docs/Engineering/implementation-status.md`; it must not become a competing architecture, product brief, or implementation-status authority. Use Git history for historical proposals and implementation diaries, not a second legacy documentation collection. Do not label target design as implemented or claim a production qualification from an unrelated old report.

Place primary references next to the decision they support. Link related contracts rather than duplicating them with divergent rules. No document is required merely because another project used that template: Rove has application/capability contracts, not an invented partner platform.

## Fixtures and generated output

Keep reusable, minimized test inputs under `tests/fixtures` or the existing package fixture directories. Preserve negative cases and recorded inputs needed by active tests. Historical screenshots and run reports are not canonical design documents. Write new generated evidence and installers under ignored `artifacts/`.

A fixture relocation must update imports, scripts, CLI defaults, and tests that inspect source text or load recorded files. Moving a test does not justify changing its assertions. Data stored in fixtures must not contain real tokens or unneeded private account content.

## Verification

```bash
pnpm install --frozen-lockfile
node scripts/check-repository.mjs
pnpm typecheck
pnpm build
pnpm test
node --test experiments/agent-execution/*.test.mjs
```

Install/build the selected native modules and Playwright browser when required. Use temporary profile homes. Live model or third-party exercises are opt-in, may consume allowance or perform real actions, and must not run in routine CI by default.

Use meaningful test names and record failures accurately. Do not remove assertions, skip changed tests, or increase broad timeouts simply to hide a regression. Compare with a baseline when the environment exposes existing failures. Preserve the distinction between static checks, deterministic tests, real browser behavior, and installed-package qualification.

## Migrations and compatibility

No schema changes are authorized by a documentation-only target table. Before implementing one, map existing records to the target, back up representative data, verify migration atomicity and restart behavior, and check readers/writers. Prefer additive transitions where they preserve local user work. Never reset a database because the product is pre-release unless the owner explicitly authorizes loss of that data.

Dependency upgrades must be tested as a compatible set. Do not rewrite an upstream generated schema without the selected upstream generator and supporting evidence. Product freedom does not remove the need for real technical compatibility.
