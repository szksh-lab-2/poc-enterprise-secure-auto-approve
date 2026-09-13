# auto_approve

A composite action which checks whether a pull request updates only files under `staging/`.

This action implements the approval rule of this repository.
It never approves a pull request itself and never handles an access token which can approve one,
so the privileged part is isolated in the reusable workflow [auto_approve.yaml](../../workflows/auto_approve.yaml).

| | This action | The reusable workflow |
| --- | --- | --- |
| Responsibility | The approval rule of this repository | Getting the access token and approving |
| Access token | `GITHUB_TOKEN` (`pull-requests:read`) | A PAT from AWS Secrets Manager |
| Expected to differ per repository | Yes | No |

## Outputs

| Name | Description |
| --- | --- |
| `ok` | `true` if the pull request updates only files under `staging/`, otherwise `false` |

## Structure

The check is separated from everything else so that the check is easy to test and the rest is reusable by other approve logic.

| File | Description |
| --- | --- |
| `check.ts` | The approval rule. Replace this module to approve pull requests by another rule |
| `github.ts` | A thin GitHub REST API client |
| `actions.ts` | Helpers for the GitHub Actions runtime (environment variables, outputs, logs) |
| `index.ts` | Wires them up: read the environment variables, list the updated files, run the check, and set the output |

## How it works

1. `aquaproj/aqua-installer` installs [bun](https://bun.com) based on [aqua/aqua.yaml](aqua/aqua.yaml)
1. `bun run index.ts` lists the updated files of the pull request via GitHub API, checks them, and sets the output `ok`

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
Enable the organization ruleset `Dismiss stale pull request approvals when new commits are pushed`
and `Require approval of the most recent reviewable push`.

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
