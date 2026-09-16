import { describe, expect, it } from "vitest";

import {
  isMissingRemoteBranchFailure,
  isRepositoryAccessFailure,
} from "../../shared/git/failureConditions";

/**
 * Two screens used to answer this question with their own regular expressions,
 * and they disagreed: only the Changes header recognised a bare `401`, and only
 * the invite flow recognised "access denied" and "could not read username". The
 * same failure was read differently depending on where the person was looking.
 *
 * These pin the union, and the two cases that used to diverge in particular.
 */
describe("isRepositoryAccessFailure", () => {
  it.each([
    "fatal: could not access the repository",
    "fatal: Authentication failed for 'https://github.com/acme/app.git/'",
    "remote: Repository not found.",
    "remote: Permission denied",
  ])("recognises %j, which both callers already agreed on", (detail) => {
    expect(isRepositoryAccessFailure(detail)).toBe(true);
  });

  it("recognises a bare 401, which the invite flow used to miss", () => {
    expect(isRepositoryAccessFailure("The requested URL returned error: 401")).toBe(true);
  });

  it.each([
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "remote: access denied",
  ])("recognises %j, which the Changes header used to miss", (detail) => {
    expect(isRepositoryAccessFailure(detail)).toBe(true);
  });

  it("leaves an unrelated failure alone, so the raw message still reaches the reader", () => {
    expect(isRepositoryAccessFailure("some unexpected failure")).toBe(false);
  });

  it("does not claim a missing branch is an access failure", () => {
    // sessionCopy asks this question first, so a false positive here would
    // report a credentials problem for a branch that simply is not there.
    expect(
      isRepositoryAccessFailure(
        "warning: Remote branch mml-rebuild not found in upstream origin",
      ),
    ).toBe(false);
  });

  it("treats nothing as no answer rather than a failure", () => {
    expect(isRepositoryAccessFailure(null)).toBe(false);
    expect(isRepositoryAccessFailure(undefined)).toBe(false);
    expect(isRepositoryAccessFailure("")).toBe(false);
  });
});

describe("isMissingRemoteBranchFailure", () => {
  it.each([
    "warning: Remote branch mml-rebuild not found in upstream origin",
    "fatal: couldn't find remote ref refs/heads/feature",
    "fatal: no such ref was fetched",
  ])("recognises %j", (detail) => {
    expect(isMissingRemoteBranchFailure(detail)).toBe(true);
  });

  it("leaves an access failure to the question above it", () => {
    expect(isMissingRemoteBranchFailure("remote: Repository not found.")).toBe(false);
  });

  it("treats nothing as no answer", () => {
    expect(isMissingRemoteBranchFailure(null)).toBe(false);
  });
});
