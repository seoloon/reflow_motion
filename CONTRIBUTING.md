# Contributing

By contributing you agree your work is licensed under GPL-3.0-or-later.

## Ground rules

- Ask of every feature: *does this make creating Remotion motion graphics substantially easier or faster?*
- Do not add abstractions for features that do not exist yet. Simple first, measure, then refactor.
- **Dependencies**: check the license (must be GPLv3-compatible), add a row to `THIRD_PARTY.md`, and note
  the decision in `docs/dependencies.md`. Never import `remotion` / `@remotion/*` into the app (see `docs/licensing.md`).
- Do not copy code from other projects without a verified, compatible license and attribution.
- Errors shown to users have a title and a hint; technical details go to the diagnostics log.
- Anything that executes project code or commands must be triggered by an explicit user action.
- Paths coming from the UI must go through `scope::resolve_in_root`.
- User actions are registered as commands in the central registry (`src/commands/registry.ts`), never bound ad hoc.

## Tests

```bash
pnpm test        # vitest + cargo test --workspace
```

Rust logic lives in crates / modules with unit tests; frontend model logic (stores, registry, formatting) is tested with Vitest.
