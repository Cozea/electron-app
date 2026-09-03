import { MacUpdater } from "electron-updater";
// Not re-exported from the package index, but the package publishes no `exports`
// map, so the module that actually chooses the download is reachable directly.
import { findFile } from "electron-updater/out/providers/Provider.js";
import { describe, expect, it } from "vitest";

import { mergeUpdaterFeeds, type UpdaterFeed } from "../../scripts/merge-updater-feed.mjs";

const ARM64_FEED = {
  version: "0.2.1",
  files: [
    { url: "Cozea-0.2.1-arm64-mac.zip", sha512: "arm64-zip", size: 320650279 },
    { url: "Cozea-0.2.1-arm64.dmg", sha512: "arm64-dmg", size: 315329034 },
  ],
  path: "Cozea-0.2.1-arm64-mac.zip",
  sha512: "arm64-zip",
  releaseDate: "2026-09-03T19:31:10.351Z",
};

const X64_FEED = {
  version: "0.2.1",
  files: [
    { url: "Cozea-0.2.1-mac.zip", sha512: "x64-zip", size: 330650279 },
    { url: "Cozea-0.2.1.dmg", sha512: "x64-dmg", size: 325329034 },
  ],
  path: "Cozea-0.2.1-mac.zip",
  sha512: "x64-zip",
  releaseDate: "2026-09-03T18:02:00.000Z",
};

/** The shape electron-updater resolves a feed's `files` into before choosing one. */
function resolveFiles(feed: Pick<UpdaterFeed, "files">) {
  return feed.files.map((info) => ({
    url: new URL(info.url, "https://example.test/releases/"),
    info,
  }));
}

type ResolvedFile = ReturnType<typeof resolveFiles>[number];

// `filterFilesForArch` is protected, so it is not part of the type the package
// exports even though it is the step that decides what a Mac is offered. Reach it
// deliberately rather than reimplementing the rule the test exists to check.
const architectureFilter = MacUpdater as unknown as {
  filterFilesForArch(files: ResolvedFile[], isArm64Mac: boolean): ResolvedFile[];
};

/** What electron-updater would download on a Mac of the given architecture. */
function download(feed: Pick<UpdaterFeed, "files">, isArm64Mac: boolean): string {
  const files = architectureFilter.filterFilesForArch(resolveFiles(feed), isArm64Mac);
  return findFile(files, "zip", ["pkg", "dmg"])?.info.url ?? "(none)";
}

describe("updater feed merge", () => {
  it("leaves Intel Macs with nothing to download when the feeds are not merged", () => {
    // Why this script exists: each architecture's build writes its own feed under the
    // same name, both are uploaded to the one release, and the later upload replaces
    // the earlier. A release left describing only arm64 is not a partial feed to an
    // Intel client -- it is an empty one, because arm64 entries are filtered out first.
    expect(architectureFilter.filterFilesForArch(resolveFiles(ARM64_FEED), false)).toEqual([]);
    expect(() => download(ARM64_FEED, false)).toThrow(/no files provided/i);
  });

  it("gives each architecture its own build", () => {
    const merged = mergeUpdaterFeeds([ARM64_FEED, X64_FEED]);

    expect(download(merged, true)).toBe("Cozea-0.2.1-arm64-mac.zip");
    expect(download(merged, false)).toBe("Cozea-0.2.1-mac.zip");
  });

  it("keeps every artifact and orders them the same way whatever order it merges in", () => {
    const merged = mergeUpdaterFeeds([ARM64_FEED, X64_FEED]);
    const reversed = mergeUpdaterFeeds([X64_FEED, ARM64_FEED]);

    expect(merged.files.map((file) => file.url)).toEqual([
      "Cozea-0.2.1-mac.zip",
      "Cozea-0.2.1.dmg",
      "Cozea-0.2.1-arm64-mac.zip",
      "Cozea-0.2.1-arm64.dmg",
    ]);
    expect(reversed.files).toEqual(merged.files);
  });

  it("points the pre-`files` fields at the build that runs on both architectures", () => {
    const merged = mergeUpdaterFeeds([ARM64_FEED, X64_FEED]);

    expect(merged.path).toBe("Cozea-0.2.1-mac.zip");
    expect(merged.sha512).toBe("x64-zip");
  });

  it("reports the most recent build's release date", () => {
    expect(mergeUpdaterFeeds([X64_FEED, ARM64_FEED]).releaseDate).toBe(ARM64_FEED.releaseDate);
  });

  it("merges a channel only one architecture produced", () => {
    const merged = mergeUpdaterFeeds([X64_FEED]);

    expect(merged.files).toEqual(X64_FEED.files);
    expect(download(merged, false)).toBe("Cozea-0.2.1-mac.zip");
  });

  it("refuses feeds that disagree", () => {
    expect(() => mergeUpdaterFeeds([ARM64_FEED, { ...X64_FEED, version: "0.2.2" }])).toThrow(
      /disagree on version/,
    );

    const tampered = {
      ...ARM64_FEED,
      files: ARM64_FEED.files.map((file) => ({ ...file, sha512: "different" })),
    };
    expect(() => mergeUpdaterFeeds([ARM64_FEED, tampered])).toThrow(/disagree on the contents/);
  });

  it("refuses a feed set it cannot merge", () => {
    expect(() => mergeUpdaterFeeds([])).toThrow(/No update feeds/);
    expect(() => mergeUpdaterFeeds([{ version: "0.2.1", files: [] }])).toThrow(/lists no files/);
  });
});
