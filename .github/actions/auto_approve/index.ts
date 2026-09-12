import { getEnv, getPullRequestNumber, notice, setOutput } from "./actions.ts";
import { check, parsePrefixes, type CheckResult } from "./check.ts";
import { Client, maxChangedFiles, parseRepository } from "./github.ts";

const run = async (): Promise<CheckResult> => {
  const repo = parseRepository(getEnv("GITHUB_REPOSITORY"));
  const prNumber = getPullRequestNumber("PULL_REQUEST_NUMBER");
  const prefixes = parsePrefixes(getEnv("PATH_PREFIXES"));
  const client = new Client(
    getEnv("GITHUB_TOKEN"),
    process.env["GITHUB_API_URL"] || undefined,
  );

  const pr = await client.getPullRequest(repo, prNumber);
  if (pr.changed_files > maxChangedFiles) {
    // The updated files can't be listed exhaustively, so the check can't be trusted.
    return {
      ok: false,
      reason: `the pull request updates ${pr.changed_files} files, which exceeds the API limit ${maxChangedFiles}`,
    };
  }

  return check(await client.listPullRequestFiles(repo, prNumber), prefixes);
};

const main = async (): Promise<void> => {
  const result = await run();
  notice(
    result.ok
      ? `Approving the pull request: ${result.reason}`
      : `Not approving the pull request: ${result.reason}`,
  );
  await setOutput("ok", String(result.ok));
};

if (import.meta.main) {
  await main();
}
