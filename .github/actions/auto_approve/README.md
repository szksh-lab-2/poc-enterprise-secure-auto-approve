# auto_approve

A composite action which approves a pull request automatically if the pull request updates only files under `staging/`.

## Structure

The check is separated from everything else so that the check is easy to test and the rest is reusable by other approve logic.

| File | Description |
| --- | --- |
| `check.ts` | The approval rule. Replace this module to approve pull requests by another rule |
| `github.ts` | A thin GitHub REST API client |
| `actions.ts` | Helpers for the GitHub Actions runtime (environment variables, outputs, logs) |
| `index.ts` | Wires them up: read the environment variables, list the updated files, run the check, and set the output |

`index.ts` only decides whether the pull request can be approved and sets the output `ok` (`true` or `false`).
Approving the pull request is done by the following steps of [action.yaml](action.yaml), so that an approval can be sent by an access token other than `GITHUB_TOKEN`.

## How it works

1. `aquaproj/aqua-installer` installs [bun](https://bun.com) based on [aqua/aqua.yaml](aqua/aqua.yaml)
1. `bun run index.ts` lists the updated files of the pull request via GitHub API, checks them, and sets the output `ok`
1. If `ok` is `true`, the following steps get an access token and approve the pull request

A renamed file is treated as an update of both the old path and the new path, so a file moved into `staging/` from the outside isn't approved.
If the pull request updates no file, or updates more files than the GitHub API can list (3000), `ok` is `false`.

## Environment variables of index.ts

| Name | Description |
| --- | --- |
| `GITHUB_TOKEN` | GitHub Access Token. `pull-requests:read` is required |
| `GITHUB_REPOSITORY` | `<owner>/<repo>`. GitHub Actions sets this automatically |
| `PULL_REQUEST_NUMBER` | A pull request number to check |
| `PATH_PREFIXES` | Newline separated path prefixes which can be approved automatically |
| `GITHUB_API_URL` | Optional. The GitHub API endpoint. GitHub Actions sets this automatically |

## Note

This action doesn't dismiss approvals when a pull request is updated after being approved.
Enable the branch protection rule `Dismiss stale pull request approvals when new commits are pushed` so that an approval for `staging/` only changes isn't reused for other changes.

## Development

```bash
bun install
bun test
bunx tsc --noEmit
```

To run the check locally:

```bash
GITHUB_TOKEN=<token> GITHUB_REPOSITORY=szksh-lab-2/test-auto-approve PULL_REQUEST_NUMBER=1 PATH_PREFIXES=staging/ bun run index.ts
```
