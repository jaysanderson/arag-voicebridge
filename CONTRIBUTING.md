# Contributing

Thanks for helping build open-source products on Progress Agentic RAG.

## Ground rules
- Be kind; see `CODE_OF_CONDUCT.md`.
- Never commit secrets. `.env` is git-ignored; use `.env.example` for documentation.
- Use **bun** for tooling (`make install`); do not add `package-lock.json` or run npm.
- Keep runtime dependencies at zero unless a `DECISIONS.md` entry explains why.

## Workflow
1. Fork/branch from `main` (`feat/<topic>`, `fix/<topic>`).
2. `make check` must be green (Biome, `tsc --noEmit`, tests ≥ 80 % coverage).
3. Update docs and `CHANGELOG.md` in the same change. API changes update `src/openapi.ts` **first** — the contract tests fail if a route is missing from the spec.
4. Changes to the turn pipeline must keep a prospect's golden set green (`make eval P=<key>`).
4. Open a PR using the template; one reviewer approval and green CI are required to merge.

## Commit messages
Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.

## Reporting bugs / requesting features
Use the issue templates in `.github/ISSUE_TEMPLATE/`.
