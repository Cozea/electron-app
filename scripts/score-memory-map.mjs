#!/usr/bin/env node
/**
 * Score a project memory map against what real maps of this shape measure.
 *
 * The memory skill is prose an agent follows, so the only way to know whether
 * it produced a map as detailed as the reference tooling is to measure the
 * output. The thresholds below were calibrated against two real graphify maps
 * (500 nodes / 858 links, and 20,954 nodes / 45,147 links), which both pass.
 *
 *   node scripts/score-memory-map.mjs <path to graph.json>
 *
 * An update is supposed to touch only what changed, so it can also compare two
 * maps and confirm the untouched part came through byte for byte:
 *
 *   node scripts/score-memory-map.mjs --incremental <old.json> <new.json> <changed file>...
 *
 * Exits non-zero when a check fails, so it can gate an update.
 */
import { readFileSync } from "node:fs"

const RELATION_FAMILIES = {
  containment: new Set(["contains"]),
  call: new Set(["calls", "indirect_call", "method"]),
  imports: new Set(["imports", "imports_from", "re_exports"]),
}

export function scoreMemoryMap(graph) {
  const nodes = (graph?.nodes ?? []).filter(Boolean)
  const links = (graph?.links ?? []).filter(Boolean)
  const ids = new Set(nodes.map((n) => n.id))
  const total = links.length
  const share = (predicate) =>
    total === 0 ? 0 : links.filter((l) => predicate(l)).length / total

  const withCommunity = nodes.filter(
    (n) => n.community !== undefined && n.community !== null && String(n.community_name ?? "").trim(),
  ).length
  const dangling = links.filter((l) => !ids.has(l.source) || !ids.has(l.target))
  const fileNodes = nodes.filter((n) => n.source_location === "L1").length
  const sourceFiles = new Set(nodes.map((n) => n.source_file).filter(Boolean)).size
  const linksWithFile = links.filter((l) => l.source_file).length

  const checks = [
    {
      name: "has nodes and links",
      ok: nodes.length > 0 && total > 0,
      detail: `${nodes.length} nodes, ${total} links`,
    },
    {
      name: "links per node in 1.5..2.5",
      ok: nodes.length === 0 ? false : total / nodes.length >= 1.5 && total / nodes.length <= 2.5,
      detail: nodes.length ? (total / nodes.length).toFixed(2) : "n/a",
    },
    {
      name: "contains is 20..50% of links",
      ok: share((l) => RELATION_FAMILIES.containment.has(l.relation)) >= 0.2 &&
        share((l) => RELATION_FAMILIES.containment.has(l.relation)) <= 0.5,
      detail: `${(share((l) => RELATION_FAMILIES.containment.has(l.relation)) * 100).toFixed(1)}%`,
    },
    {
      name: "a node per source file that holds symbols",
      ok: sourceFiles === 0 ? false : fileNodes >= sourceFiles * 0.6,
      detail: `${fileNodes} file nodes for ${sourceFiles} source files`,
    },
    {
      name: "structural edges dominate (EXTRACTED >= 70%)",
      ok: share((l) => l.confidence === "EXTRACTED") >= 0.7,
      detail: `${(share((l) => l.confidence === "EXTRACTED") * 100).toFixed(1)}%`,
    },
    {
      name: "every node is in a named community",
      ok: nodes.length > 0 && withCommunity === nodes.length,
      detail: `${withCommunity}/${nodes.length}`,
    },
    {
      name: "every link records the file it was read from",
      ok: total > 0 && linksWithFile === total,
      detail: `${linksWithFile}/${total}`,
    },
    {
      name: "no dangling links",
      ok: dangling.length === 0,
      detail: dangling.length ? `${dangling.length}, e.g. ${dangling[0].source} -> ${dangling[0].target}` : "0",
    },
    {
      name: "built_at_commit recorded",
      ok: Boolean(graph?.built_at_commit),
      detail: String(graph?.built_at_commit ?? "missing"),
    },
  ]
  return { checks, passed: checks.every((c) => c.ok) }
}

/**
 * Confirm an update rewrote only the files that changed. Anything owned by an
 * untouched file must survive identically, or the Memory tile repaints nodes as
 * changed when nothing about them moved.
 */
export function scoreIncrementalUpdate(oldGraph, newGraph, changedFiles) {
  const touched = new Set(changedFiles)
  const owned = (item) => touched.has(item.source_file)
  const key = (item) => JSON.stringify(item, Object.keys(item).sort())
  const frozen = (graph, list) => new Map(graph[list].filter((i) => !owned(i)).map((i) => [i.id ?? key(i), key(i)]))

  const beforeNodes = frozen(oldGraph, "nodes")
  const afterNodes = frozen(newGraph, "nodes")
  const drifted = [...beforeNodes].filter(([id, v]) => afterNodes.has(id) && afterNodes.get(id) !== v)
  const lost = [...beforeNodes.keys()].filter((id) => !afterNodes.has(id))
  const ids = new Set(newGraph.nodes.map((n) => n.id))
  const dangling = newGraph.links.filter((l) => !ids.has(l.source) || !ids.has(l.target))
  const staleLinks = newGraph.links.filter((l) => owned(l) && !newGraph.nodes.some((n) => n.id === l.source))

  const checks = [
    {
      name: "untouched nodes came through unchanged",
      ok: drifted.length === 0,
      detail: drifted.length ? `${drifted.length} rewritten, e.g. ${drifted[0][0]}` : `${beforeNodes.size} preserved`,
    },
    {
      name: "untouched nodes were not dropped",
      ok: lost.length === 0,
      detail: lost.length ? `${lost.length} lost, e.g. ${lost[0]}` : "0",
    },
    {
      name: "no links left pointing at removed nodes",
      ok: dangling.length === 0 && staleLinks.length === 0,
      detail: dangling.length ? `${dangling.length}, e.g. ${dangling[0].source} -> ${dangling[0].target}` : "0",
    },
    {
      name: "the changed files were actually re-read",
      ok: changedFiles.length === 0 || newGraph.nodes.some((n) => owned(n)) || oldGraph.nodes.every((n) => !owned(n)),
      detail: `${newGraph.nodes.filter(owned).length} nodes from ${changedFiles.length} changed files`,
    },
  ]
  return { checks, passed: checks.every((c) => c.ok) }
}

const report = ({ checks, passed }, heading) => {
  if (heading) console.log(heading)
  for (const c of checks) console.log(`${c.ok ? "pass" : "FAIL"}  ${c.name.padEnd(42)} ${c.detail}`)
  return passed
}

if (process.argv[2] === "--incremental") {
  const [oldPath, newPath, ...changed] = process.argv.slice(3)
  const load = (p) => JSON.parse(readFileSync(p, "utf8"))
  const older = load(oldPath)
  const newer = load(newPath)
  const incremental = report(scoreIncrementalUpdate(older, newer, changed), "incremental update")
  const quality = report(scoreMemoryMap(newer), "\nresulting map")
  console.log(incremental && quality ? "\nupdate is sound" : "\nupdate is not sound")
  process.exit(incremental && quality ? 0 : 1)
}

const target = process.argv[2]
if (target) {
  const passed = report(scoreMemoryMap(JSON.parse(readFileSync(target, "utf8"))))
  console.log(passed ? "\nmap meets the reference profile" : "\nmap falls short")
  process.exit(passed ? 0 : 1)
}
