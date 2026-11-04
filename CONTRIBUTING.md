# Contributing to Ceyrom

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Released code. Only updated by a release pull request from `develop`, then tagged (`v0.1.0`, …). |
| `develop` | Integration branch. Every feature lands here first. |
| `feature/<name>` | New work, branched from `develop`, merged back with a pull request. |
| `fix/<name>` | Bug fixes, same flow as features. |
| `hotfix/<name>` | Urgent fixes branched from `main`, merged into `main` and `develop`. |

Never commit straight to `main` or `develop`. Open a pull request and wait for CI to pass.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(physics): add wall friction and spin
fix(rules): return the queen when the cover shot fouls
test(ai): cover rebound candidates
docs: explain the online protocol
chore: bump vite
```

Scopes in use: `physics`, `rules`, `ai`, `render`, `audio`, `i18n`, `state`, `ui`, `game`, `server`, `net`, `ci`.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
```

- All UI text goes in `locales/{en,si,ta}/translation.json`. Don't hard-code strings.
- Keep `src/core/` free of DOM code. The server runs it too.
- The physics step must stay deterministic: only `+ − × ÷` and `Math.sqrt`, no `Math.hypot` or trig.
