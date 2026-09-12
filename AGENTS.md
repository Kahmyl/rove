# Working on Rove

Read `docs/README.md`, `docs/Products/product-brief.md`, and `docs/Products/product-direction.md` before changing product behavior. Follow the responsible engineering contract. Current code and old Git history are evidence of implementation, not authority to redefine the product.

Rove is a task and workflow assistant, not a browser-first runtime or a separate Hub product. Tasks remain flexible conversations. Stop does not permanently close them. Browser resources attach when needed; UI selection is not execution authority. Portable workflow setup excludes tasks, artifacts, credentials, and browser/live state.

Do not introduce product edition labels, milestone/phase/gate/ticket filenames, or tests named after an implementation plan. Use descriptive capability/domain names. Preserve necessary upstream dependency, wire-format, and database compatibility identifiers; never rewrite installed migration history cosmetically.

Do not add another planner, distributed workflow engine, full task-sync system, paid service, or broad replacement framework without a concrete requirement and explicit decision. Retain working custom behavior when a library replacement would weaken it. No stealth or service-rule bypass is part of Rove.

Inspect actual source and current worktree before edits. Keep documentation status honest: target contracts are not implemented features. Update relevant contracts, source references, tests, and naming checks together. Never weaken a regression assertion to obtain a green build after moving a file.

Use temporary test homes. Never reuse user credentials or run live model/external-service tasks without explicit authorization. Do not copy tokens into logs, fixtures, documentation, or synchronization payloads. Stop and inspect uncertainty before repeating an external effect.

Run repository checks, typecheck, build, and appropriate tests; state exactly what could not be run. Read `CONTRIBUTING.md` for naming, migration, fixture, and evidence rules.
