import { describe, expect, it } from "vitest";

import {
  isSameGitHubRepository,
  parseGitHubRepository,
} from "../../shared/git/githubRepository";

/**
 * Three paths that authorize one exact repository used to carry their own copy
 * of this pattern, and the copies had drifted: only the scoped network Git
 * layer accepted `ssh://git@github.com/`, so a session on such a remote could
 * fetch and push while no pull request could be opened for it.
 *
 * These pin the accepted set, and the refusals that matter more than the
 * acceptances.
 */
describe("parseGitHubRepository", () => {
  it.each([
    ["https://github.com/team/app.git", "team", "app"],
    ["https://github.com/team/app", "team", "app"],
    ["git@github.com:team/app.git", "team", "app"],
    ["git@github.com:team/app", "team", "app"],
  ])("reads %j", (url, owner, repository) => {
    expect(parseGitHubRepository(url)).toEqual({ owner, repository, full: `${owner}/${repository}` });
  });

  it("accepts the ssh:// form that the pull request path used to refuse", () => {
    expect(parseGitHubRepository("ssh://git@github.com/team/app.git")).toEqual({
      owner: "team",
      repository: "app",
      full: "team/app",
    });
  });

  it("refuses a host that merely starts with github.com", () => {
    // The anchor is the whole point: `github.com.evil.test` is a different host
    // and must never resolve to a repository this may authorize.
    expect(parseGitHubRepository("https://github.com.evil.test/team/app.git")).toBeNull();
    expect(parseGitHubRepository("https://notgithub.com/team/app.git")).toBeNull();
  });

  it("refuses a remote carrying sign-in details", () => {
    // The session layer stores such URLs verbatim, deliberately, so that the
    // product can warn about them. Authorizing a repository is not the place to
    // accept a credential smuggled through a URL.
    expect(parseGitHubRepository("ssh://git:token@github.com/team/app.git")).toBeNull();
    expect(parseGitHubRepository("https://token@github.com/team/app.git")).toBeNull();
  });

  it.each([
    "https://gitlab.com/team/app.git",
    "https://github.com/team",
    "https://github.com/team/app/extra",
    "",
  ])("refuses %j", (url) => {
    expect(parseGitHubRepository(url)).toBeNull();
  });

  it("does not trim, so a caller cannot smuggle whitespace past the anchor", () => {
    expect(parseGitHubRepository(" https://github.com/team/app.git")).toBeNull();
    expect(parseGitHubRepository("https://github.com/team/app.git ")).toBeNull();
  });
});

describe("isSameGitHubRepository", () => {
  it("compares owner and name case-insensitively, as GitHub does", () => {
    expect(
      isSameGitHubRepository({ owner: "Team", repository: "App" }, { owner: "team", repository: "app" }),
    ).toBe(true);
  });

  it("separates different repositories of the same owner", () => {
    expect(
      isSameGitHubRepository({ owner: "team", repository: "app" }, { owner: "team", repository: "other" }),
    ).toBe(false);
  });

  it("separates the same name under different owners", () => {
    expect(
      isSameGitHubRepository({ owner: "team", repository: "app" }, { owner: "other", repository: "app" }),
    ).toBe(false);
  });
});
