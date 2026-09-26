# Working on Rove

For any engineering objective, use the repository skill at `.agents/skills/rove-engineering/SKILL.md`. Start with `pnpm codex:context`, inspect the current worktree, and read the documents routed by that skill before editing. During the active market-readiness stabilization sprint, also read `docs/Planning/stabilization/continuity-ledger.md`, the current ticket, and its directly upstream handoff before editing; reconcile that continuation state with current repository/runtime truth rather than restarting the investigation. For product behavior, always read `docs/README.md`, `docs/Products/product-brief.md`, and `docs/Products/product-direction.md`. Current code and old Git history are evidence of implementation, not authority to redefine the product.

Rove is a task and workflow assistant, not a browser-first runtime or a separate Hub product. Tasks remain flexible conversations. Stop does not permanently close them. Browser resources attach when needed; UI selection is not execution authority. Portable workflow setup excludes tasks, artifacts, credentials, and browser/live state.

Do not introduce product edition labels or permanent milestone/phase/gate/version taxonomies, and do not name product/runtime code or tests after an implementation plan. Stable ticket IDs/filenames are allowed only inside an explicitly authorized bounded active planning set such as the current stabilization sprint; they remain planning metadata and must be retired with that plan. Use descriptive capability/domain names elsewhere. Preserve necessary upstream dependency, wire-format, and database compatibility identifiers; never rewrite installed migration history cosmetically.

Do not add another planner, distributed workflow engine, full task-sync system, paid service, or broad replacement framework without a concrete requirement and explicit decision. Retain working custom behavior when a library replacement would weaken it. No stealth or service-rule bypass is part of Rove.

Inspect actual source and current worktree before edits. Keep documentation status honest: target contracts are not implemented features. Update relevant contracts, source references, tests, and naming checks together. Never weaken a regression assertion to obtain a green build after moving a file.

Use temporary test homes. Never reuse user credentials or run live model/external-service tasks without explicit authorization. Do not copy tokens into logs, fixtures, documentation, or synchronization payloads. Stop and inspect uncertainty before repeating an external effect.

Codex may use bounded subagents when independent research, disjoint read-only exploration, or review materially improves speed or confidence. The root agent owns architecture, integration, and final verification. Parallel writers require separate branches and worktrees plus isolation of mutable runtime resources.

Ordinary feature and bug work must not modify `AGENTS.md`, `.agents/**`, `.codex/**`, or engineering-agent governance documentation. Change those only when the objective explicitly concerns the engineering environment, or when repeated concrete evidence shows that environment causes a recurring failure and its correction is explicitly in scope. Never weaken policy to bypass task friction. Normal tasks may still update owning product/engineering contracts, implementation status, tests, and code documentation.

Run repository checks, typecheck, build, and appropriate tests; state exactly what could not be run. Before finishing, inspect the complete diff, reconcile relevant documentation, and leave a precise continuation record when work remains. Read `CONTRIBUTING.md` for naming, migration, fixture, and evidence rules.
