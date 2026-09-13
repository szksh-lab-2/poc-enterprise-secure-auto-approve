// Helpers for the GitHub Actions runtime.
// This module is independent of the approval rule, so it can be reused by other approve logic.

import { appendFile } from "node:fs/promises";

export const getEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`the environment variable ${name} is required`);
  }
  return value;
};

export const getPullRequestNumber = (name: string): number => {
  const s = getEnv(name);
  const prNumber = Number(s);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`${name} must be a positive integer: ${s}`);
  }
  return prNumber;
};

export const notice = (message: string): void => {
  console.log(`::notice::${message}`);
};

export const setOutput = async (name: string, value: string): Promise<void> => {
  const file = process.env["GITHUB_OUTPUT"];
  if (!file) {
    // Running outside of GitHub Actions.
    console.log(`${name}=${value}`);
    return;
  }
  await appendFile(file, `${name}=${value}\n`);
};
