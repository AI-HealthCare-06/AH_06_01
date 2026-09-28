# Working in this repository

- Follow [docs/GIT_FLOW.md](docs/GIT_FLOW.md). The default branch `main` has the Master role in the user's Git Flow diagram; `develop` is the integration branch.
- Before implementation, inspect `git status` and the current branch. Start ordinary changes on a descriptively named `feature/*` branch from up-to-date `develop`. Continue an existing feature branch when it already represents the task.
- Use `release/*` from `develop` for release stabilization, and `hotfix/*` from `main` for urgent corrections. Merge releases/hotfixes into both `main` and `develop` through PRs. Preserve merge commits for this flow.
- Do not implement directly on `main` or `develop`, rewrite shared history, or force-push. The initial repository import is the one-time baseline exception.
- Keep changes focused on the user's request. Preserve local input documents and unrelated user edits. Do not publish `.env`, credentials, dependencies, generated builds or browser artifacts.
- For frontend changes, use `frontend/package-lock.json` with `npm ci`. Run the checks relevant to the change; full verification is `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, and `npm run test:e2e` inside `frontend`.
- Follow the existing Figma assets and visual style unless the user requests a design adjustment. Health predictions remain demo data until an actual service is connected.
- Report the branch used, meaningful verification, and any remaining limitation. Create or publish a release only when the user asks for a release.
