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

const target = process.argv[2]
if (target) {
  const { checks, passed } = scoreMemoryMap(JSON.parse(readFileSync(target, "utf8")))
  for (const c of checks) console.log(`${c.ok ? "pass" : "FAIL"}  ${c.name.padEnd(42)} ${c.detail}`)
  console.log(passed ? "\nmap meets the reference profile" : "\nmap falls short")
  process.exit(passed ? 0 : 1)
}
