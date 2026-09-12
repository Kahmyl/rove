# Continuation record

Prefer a coherent authorized Git commit when a checkpoint is ready. When work must stop with uncommitted or unresolved state, create `artifacts/engineering-continuation.md` using the structure below. The file is intentionally ignored: it is local operational evidence, not canonical product documentation or an implementation diary.

```markdown
# Engineering continuation

- Objective:
- Repository/worktree:
- Branch and starting commit:
- Current HEAD and working-tree state:

## Established facts

- Product/engineering requirements:
- Implementation truth:
- External compatibility evidence and date:

## Changes made

- Files and behavior:
- Deliberately unchanged boundaries:

## Verification

- Passed commands:
- Failed commands and exact reason:
- Not run and why:

## Resume here

- Next concrete action:
- Remaining risks or hypotheses:
- Decisions requiring human/product authority:
- External actions already attempted and their confirmed/unresolved outcome:
```

Never put credentials, tokens, cookies, private memory contents, or unnecessary user data in a continuation record. Remove the local note after the work is completed and its necessary facts are represented by code, tests, canonical documentation, commits, and the final task report.
