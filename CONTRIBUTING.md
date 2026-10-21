# Contributing

Fun project, small rules.

1. **Keep the honesty rules.** Unknown cost stays `null` (renders as `N/A`), failed requests stay
   in the denominators, a chatty model answer stays `invalid_output`, and secrets never reach
   the browser or the export. If a change makes the game flatter, it is the wrong change.
2. **Test first.** `node:test` only — write the failing test, watch it fail, then make it pass.
   `npm test` must be green before you open a PR.
3. **One lane of thought at a time.** Keep adapters thin, keep the generator deterministic
   (seeded), keep the UI reading measured values only.
4. **No keys in the repo.** Use `apiKeyEnv` and environment variables. If you paste a key into
   a file by accident, rotate it — the fix is rotation, not deletion from git history.
5. **Say what you measured.** If you change a sprite, the renderer, or an adapter, put the new
   numbers in the PR body, not vibes.

Fun to have: screenshots of the game mid-race, weird seeds that produce beautiful haystacks,
and lanes that surprise us.
