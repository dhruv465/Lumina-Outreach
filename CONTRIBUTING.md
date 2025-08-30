# Contributing to Lumina Outreach

Thanks for contributing! This file explains how to set up a local dev environment, run tests, and the project's expectations for PRs and code quality.

## Getting started

1. Fork the repository and create a branch from `main`:

```bash
git checkout -b feat/my-feature main
```

2. Implement changes and add tests for backend logic under `server/tests/` and for UI components under `client/src` as appropriate.

3. Run tests and linters locally (see Useful commands below).

4. Push your branch and open a Pull Request against `main`.

## Branching & commit messages

- Branch names: `feat/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`.
- Commit messages should be concise and in the style: `type(scope): short description` e.g. `feat(server): add campaign import endpoint`.

## PR checklist

Before requesting review, ensure:

- Code builds and passes tests locally.
- New code includes unit tests where applicable.
- Any public API changes are documented.
- Update `README.md`, docs, or code comments for behavior changes.
- Provide a short description and testing steps in the PR description.

## Testing

- Server tests: `cd server && npm test`
- Client tests: depends on client setup; run `cd client && npm test` if present

Add basic smoke tests for new endpoints and important business logic.

## Code style

Follow TypeScript best practices. Use existing lint configuration; run linters before opening a PR.

## Review process

PRs should include a clear description, related ticket/issue (if any), and screenshots for UI changes. Maintain backwards compatibility where possible and call out breaking changes.

## Contact

If you need help, mention maintainers in the PR or use the project communication channel.

---
Small contributions are welcome — thank you for helping improve Lumina Outreach.
