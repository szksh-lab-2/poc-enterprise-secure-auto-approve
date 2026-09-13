import { expect, test } from "bun:test";
import { check, isAllowedFile, parsePrefixes } from "./check.ts";

const prefixes = ["staging/"];

test("a file under staging/ is allowed", () => {
  expect(isAllowedFile({ filename: "staging/foo.tf" }, prefixes)).toBe(true);
});

test("a file out of staging/ isn't allowed", () => {
  expect(isAllowedFile({ filename: "production/foo.tf" }, prefixes)).toBe(false);
});

test("a file whose path only starts with staging isn't allowed", () => {
  expect(isAllowedFile({ filename: "staging.tf" }, prefixes)).toBe(false);
});

test("a file renamed within staging/ is allowed", () => {
  expect(
    isAllowedFile(
      { filename: "staging/new.tf", previous_filename: "staging/old.tf" },
      prefixes,
    ),
  ).toBe(true);
});

test("a file renamed from out of staging/ isn't allowed", () => {
  expect(
    isAllowedFile(
      { filename: "staging/new.tf", previous_filename: "production/old.tf" },
      prefixes,
    ),
  ).toBe(false);
});

test("multiple prefixes are allowed", () => {
  expect(isAllowedFile({ filename: "dev/foo.tf" }, ["staging/", "dev/"])).toBe(
    true,
  );
});

test("parsePrefixes ignores empty lines and spaces", () => {
  expect(parsePrefixes("staging/\n\n  dev/  \n")).toEqual(["staging/", "dev/"]);
});

test("parsePrefixes fails if no prefix is given", () => {
  expect(() => parsePrefixes(" \n ")).toThrow();
});

test("check passes if all files are under staging/", () => {
  expect(
    check(
      [{ filename: "staging/a.tf" }, { filename: "staging/b/c.tf" }],
      prefixes,
    ).ok,
  ).toBe(true);
});

test("check fails if a file is out of staging/", () => {
  const result = check(
    [{ filename: "staging/a.tf" }, { filename: "production/b.tf" }],
    prefixes,
  );
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("production/b.tf");
});

test("check fails if no file is updated", () => {
  expect(check([], prefixes).ok).toBe(false);
});
