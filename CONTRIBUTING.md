# Contributing to Darts 180

## First principles

1. A dart score is never silently changed. Human correction is always available.
2. The scoring rules package is deterministic and covered by fixtures before UI work merges.
3. Camera frames and clips are sensitive data. No capture is uploaded without explicit opt-in.
4. A model does not ship because aggregate accuracy looks good; it ships only after the held-out,
   device-diverse evaluation gate in `docs/04-ml-data-and-evaluation.md` passes.

## Local bootstrap

```bash
npm install
npm run verify
npm run dev:api
npm run dev:mobile
```

For mobile camera/CV work, use an Expo development build rather than Expo Go; see
`docs/06-mobile-ux.md` and `docs/09-infra-devops.md`.

## Pull requests

- Keep a PR inside one bounded concern where possible.
- Add or update tests for rules, protocol, and deterministic vision-session behavior.
- Add an ADR for a durable cross-team architectural decision.
- Never commit raw camera captures, personal data, model weights, tokens, or `.env` files.
- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
