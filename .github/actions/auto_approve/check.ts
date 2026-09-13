// The approval rule.
// Replace this module to approve pull requests by another rule.

import type { PullRequestFile } from "./github.ts";

export type CheckResult = {
  ok: boolean;
  reason: string;
};

export const parsePrefixes = (s: string): string[] => {
  const prefixes = s
    .split("\n")
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix !== "");
  if (prefixes.length === 0) {
    throw new Error("at least one path prefix is required");
  }
  return prefixes;
};

export const isAllowedFile = (
  file: PullRequestFile,
  prefixes: string[],
): boolean => {
  const paths = [file.filename];
  if (file.previous_filename !== undefined) {
    // A renamed file updates both the old path and the new path.
    paths.push(file.previous_filename);
  }
  return paths.every((path) =>
    prefixes.some((prefix) => path.startsWith(prefix)),
  );
};

export const check = (
  files: PullRequestFile[],
  prefixes: string[],
): CheckResult => {
  if (files.length === 0) {
    return { ok: false, reason: "the pull request updates no file" };
  }
  const disallowed = files.filter((file) => !isAllowedFile(file, prefixes));
  if (disallowed.length > 0) {
    return {
      ok: false,
      reason: `the pull request updates files out of [${prefixes.join(", ")}]: ${disallowed
        .map((file) => file.filename)
        .join(", ")}`,
    };
  }
  return {
    ok: true,
    reason: `the pull request updates only files under [${prefixes.join(", ")}]`,
  };
};
