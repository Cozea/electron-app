import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dump, load } from "js-yaml";

/**
 * electron-builder writes one update feed per build, listing only the artifacts that
 * build produced. Releasing macOS as one job per architecture therefore produces two
 * feeds with the same name, both uploaded to the same release, and the later upload
 * replaces the earlier one -- leaving the release describing a single architecture.
 *
 * That is not a cosmetic loss. electron-updater's MacUpdater drops arm64 entries
 * before it looks for a zip when it is running on Intel, so a feed left listing only
 * arm64 files gives an Intel client nothing to choose from and it fails with
 * ERR_UPDATER_NO_FILES_PROVIDED. Merging the feeds restores the file list a single
 * dual-architecture build would have written.
 */

const ARM64 = "arm64";

function isArm64(url) {
  return url.includes(ARM64);
}

/**
 * Intel entries sort first so the legacy `path` below lands on one of them. Beyond
 * that, order by url so a rebuild of the same release produces the same file.
 */
function compareEntries(a, b) {
  if (isArm64(a.url) !== isArm64(b.url)) {
    return isArm64(a.url) ? 1 : -1;
  }
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}

export function mergeUpdaterFeeds(docs) {
  if (docs.length === 0) {
    throw new Error("No update feeds to merge.");
  }

  const versions = new Set(docs.map((doc) => doc.version));
  if (versions.size !== 1) {
    throw new Error(`Update feeds disagree on version: ${[...versions].sort().join(", ")}.`);
  }

  const files = [];
  const byUrl = new Map();
  for (const doc of docs) {
    for (const entry of doc.files ?? []) {
      const existing = byUrl.get(entry.url);
      if (existing) {
        // The same artifact built twice with different bytes means the two jobs did
        // not build the same thing, and picking either one would ship a feed whose
        // checksum is wrong for half the downloads.
        if (existing.sha512 !== entry.sha512) {
          throw new Error(`Update feeds disagree on the contents of ${entry.url}.`);
        }
        continue;
      }
      byUrl.set(entry.url, entry);
      files.push(entry);
    }
  }

  if (files.length === 0) {
    throw new Error("Merged update feed lists no files.");
  }

  files.sort(compareEntries);

  // `path` and `sha512` are the pre-`files` form of the same information, still read
  // by updaters old enough to predate per-architecture entries. Those have no way to
  // choose an architecture, so point them at the Intel build, which runs on both under
  // Rosetta.
  const legacy = files.find((entry) => !isArm64(entry.url)) ?? files[0];

  const merged = { ...docs[0], files, path: legacy.url, sha512: legacy.sha512 };

  const releaseDate = docs
    .map((doc) => doc.releaseDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (releaseDate) {
    merged.releaseDate = releaseDate;
  }

  return merged;
}

function findFeeds(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...findFeeds(full));
    } else if (entry.isFile() && entry.name.endsWith("-mac.yml")) {
      found.push(full);
    }
  }
  return found;
}

function main(inputDirectory, outputDirectory) {
  const feeds = findFeeds(inputDirectory);
  if (feeds.length === 0) {
    throw new Error(`No *-mac.yml update feeds found under ${inputDirectory}.`);
  }

  // One channel may be present in every architecture's build or only in some, so group
  // by feed name and merge each channel independently.
  const byChannel = new Map();
  for (const feed of feeds) {
    const name = path.basename(feed);
    const group = byChannel.get(name) ?? [];
    group.push(feed);
    byChannel.set(name, group);
  }

  fs.mkdirSync(outputDirectory, { recursive: true });

  for (const [name, group] of [...byChannel].sort()) {
    const docs = group
      .sort()
      .map((feed) => load(fs.readFileSync(feed, "utf8")));
    const merged = mergeUpdaterFeeds(docs);
    const destination = path.join(outputDirectory, name);
    fs.writeFileSync(destination, dump(merged, { lineWidth: -1 }));
    console.log(
      `${name}: merged ${group.length} feed(s) into ${merged.files.length} file(s) -> ${destination}`,
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [inputDirectory, outputDirectory] = process.argv.slice(2);
  if (!inputDirectory || !outputDirectory) {
    console.error("Usage: merge-updater-feed.mjs <input-directory> <output-directory>");
    process.exit(1);
  }
  main(inputDirectory, outputDirectory);
}
