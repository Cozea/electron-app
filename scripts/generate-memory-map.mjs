#!/usr/bin/env bun
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

const ROOT = process.cwd()

// Community mapping based on path patterns
const COMMUNITIES = [
  { id: 0, name: "Electron Shell & Main Process", pattern: /^apps\/desktop\/electron\/(main|ipc|services|menus)/ },
  { id: 1, name: "Substrate & Process Management", pattern: /^(apps\/desktop\/electron\/substrate|apps\/server)/ },
  { id: 2, name: "Workbench & Window Layout", pattern: /^apps\/desktop\/src\/(features\/workbench|components\/workbench|features\/layout)/ },
  { id: 3, name: "Assistant Chat & AI Models", pattern: /^apps\/desktop\/src\/features\/assistant/ },
  { id: 4, name: "Project Memory & Knowledge Graph", pattern: /(project-memory|ProjectMemory)/ },
  { id: 5, name: "DevApps & Container Runtime", pattern: /(devapps|devApp|container-runtime)/ },
  { id: 6, name: "Agent Skills & Automation", pattern: /(skills|AgentSkill|local-automation)/ },
  { id: 7, name: "Convex Realtime Database", pattern: /^convex\// },
  { id: 8, name: "Device Identity & Authentication", pattern: /(auth|devicePrincipal|cloudflare\/worker)/ },
  { id: 9, name: "Projects & Workspace Management", pattern: /^apps\/desktop\/src\/(features\/projects|components\/workspaces|features\/workspace)/ },
  { id: 10, name: "Design System & UI Primitives", pattern: /^apps\/desktop\/src\/(components\/ui|components\/common|lib\/utils)/ },
  { id: 11, name: "Shared Contracts & Protocols", pattern: /^(packages\/|shared\/)/ },
  { id: 12, name: "Architecture & Documentation", pattern: /^(docs\/|.*\.md$)/ },
]

function getCommunity(filePath) {
  for (const c of COMMUNITIES) {
    if (c.pattern.test(filePath)) {
      return { id: c.id, name: c.name }
    }
  }
  if (filePath.startsWith("apps/desktop/electron")) return { id: 0, name: "Electron Shell & Main Process" }
  if (filePath.startsWith("apps/desktop/src/components")) return { id: 10, name: "Design System & UI Primitives" }
  if (filePath.startsWith("apps/desktop/src")) return { id: 2, name: "Workbench & Window Layout" }
  return { id: 11, name: "Shared Contracts & Protocols" }
}

function normalizeId(p) {
  return p.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase()
}

function getCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()
  } catch {
    return "073df5230d2400684434ea6b7db27b0aafc72ddc"
  }
}

function getTrackedFiles() {
  const output = execSync("git ls-files", { encoding: "utf8" })
  const allFiles = output.split("\n").filter(Boolean)

  return allFiles.filter((f) => {
    if (f.startsWith("vendor/") || f.startsWith("node_modules/")) return false
    if (f.startsWith("convex/_generated")) return false
    if (f.includes(".test.") || f.includes(".spec.")) return false
    if (f.endsWith(".d.ts")) return false

    // Include code in core folders
    if (/^(apps\/desktop\/(electron|src)|apps\/server\/src|convex|packages\/[^\/]+\/src|shared|cloudflare\/worker)\//.test(f)) {
      return /\.(ts|tsx)$/.test(f)
    }

    // Include documentation
    if (/^docs\/[^\/]+\.md$/.test(f)) return true
    if (/^(AGENTS\.md|ARCHITECTURE\.md|README\.md)$/.test(f)) return true

    return false
  })
}

async function main() {
  const commit = getCommit()
  const files = getTrackedFiles()
  console.log(`Found ${files.length} candidate files`)

  const nodes = []
  const links = []
  const nodeMap = new Map() // id -> node
  const fileToNodeId = new Map() // file -> fileNodeId
  const symbolMap = new Map() // `${file}#${symbol}` -> symbolNodeId

  function addNode(node) {
    if (nodeMap.has(node.id)) return nodeMap.get(node.id)
    nodeMap.set(node.id, node)
    nodes.push(node)
    return node
  }

  const linkSet = new Set()
  function addLink(link) {
    if (!nodeMap.has(link.source) || !nodeMap.has(link.target)) return false
    if (link.source === link.target) return false
    const key = `${link.source}|${link.target}|${link.relation}`
    if (linkSet.has(key)) return false
    linkSet.add(key)
    links.push(link)
    return true
  }

  // Phase 1: Create file nodes and symbol nodes
  for (const file of files) {
    const comm = getCommunity(file)
    const fileId = `f_${normalizeId(file)}`
    const isDoc = file.endsWith(".md")

    const fileNode = addNode({
      id: fileId,
      label: path.basename(file),
      file_type: isDoc ? "document" : "code",
      source_file: file,
      source_location: "L1",
      community: comm.id,
      community_name: comm.name,
      norm_label: path.basename(file).toLowerCase(),
      rationale: null,
      _origin: isDoc ? "curated" : "ast",
    })
    fileToNodeId.set(file, fileId)

    if (isDoc) {
      continue
    }

    // Parse TypeScript AST
    const fullPath = path.join(ROOT, file)
    let content = ""
    try {
      content = fs.readFileSync(fullPath, "utf8")
    } catch {
      continue
    }

    let sourceFile
    try {
      sourceFile = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )
    } catch {
      continue
    }

    const exportedSymbols = []

    // Helper to get line number (1-based)
    const getLine = (pos) => {
      return sourceFile.getLineAndCharacterOfPosition(pos).line + 1
    }

    ts.forEachChild(sourceFile, (node) => {
      const isExported =
        (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0 ||
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

      // Function declaration
      if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text
        exportedSymbols.push({
          name,
          kind: "function",
          line: getLine(node.getStart(sourceFile)),
          isExported,
        })
      }
      // Class declaration
      else if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text
        exportedSymbols.push({
          name,
          kind: "class",
          line: getLine(node.getStart(sourceFile)),
          isExported,
        })
      }
      // Interface declaration
      else if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text
        exportedSymbols.push({
          name,
          kind: "interface",
          line: getLine(node.getStart(sourceFile)),
          isExported,
        })
      }
      // Type alias
      else if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text
        exportedSymbols.push({
          name,
          kind: "type",
          line: getLine(node.getStart(sourceFile)),
          isExported,
        })
      }
      // Variable statements (e.g. export const Foo = ...)
      else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text
            const isCallable = decl.initializer && (
              ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer) ||
              /^(use[A-Z]|create[A-Z]|render|handle|get|set|register)/.test(name)
            )
            exportedSymbols.push({
              name,
              kind: isCallable ? "function" : "variable",
              line: getLine(decl.getStart(sourceFile)),
              isExported,
            })
          }
        }
      }
    })

    // Filter to top symbols: prefer exported ones, limit to at most 4 per file to maintain balance
    const filtered = exportedSymbols.filter((s) => s.isExported || exportedSymbols.length <= 2).slice(0, 4)

    for (const sym of filtered) {
      const isFunc = sym.kind === "function"
      const symId = `s_${normalizeId(file)}_${sym.name.toLowerCase()}`
      const label = isFunc ? `${sym.name}()` : sym.name

      const symNode = addNode({
        id: symId,
        label,
        file_type: "code",
        source_file: file,
        source_location: `L${sym.line}`,
        community: comm.id,
        community_name: comm.name,
        norm_label: sym.name.toLowerCase(),
        rationale: null,
        _origin: "ast",
        _callable: isFunc,
        _callable_class: null,
      })

      symbolMap.set(`${file}#${sym.name}`, symId)

      // Containment link: file contains symbol
      addLink({
        source: fileId,
        target: symId,
        relation: "contains",
        weight: 1,
        confidence: "EXTRACTED",
        confidence_score: 1,
        source_file: file,
        source_location: `L${sym.line}`,
        _origin: "ast",
      })
    }
  }

  console.log(`Created ${nodes.length} nodes (${fileToNodeId.size} files, ${nodes.length - fileToNodeId.size} symbols)`)

  // Phase 2: Imports and calls relations
  // Path resolver helper
  function resolveImport(importingFile, specifier) {
    let target = null
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const dir = path.dirname(importingFile)
      target = path.normalize(path.join(dir, specifier))
    } else if (specifier.startsWith("@/")) {
      target = path.normalize(path.join("apps/desktop/src", specifier.slice(2)))
    } else if (specifier.startsWith("@shared/")) {
      target = path.normalize(path.join("shared", specifier.slice(8)))
    } else if (specifier.startsWith("@cozea/contracts")) {
      target = path.normalize(path.join("packages/contracts/src", specifier.slice(16)))
    }

    if (!target) return null

    // Check extensions
    const candidates = [
      target,
      `${target}.ts`,
      `${target}.tsx`,
      path.join(target, "index.ts"),
      path.join(target, "index.tsx"),
    ]

    for (const cand of candidates) {
      if (fileToNodeId.has(cand)) return cand
    }
    return null
  }

  for (const file of files) {
    if (file.endsWith(".md")) continue
    const fullPath = path.join(ROOT, file)
    let content = ""
    try {
      content = fs.readFileSync(fullPath, "utf8")
    } catch {
      continue
    }

    let sourceFile
    try {
      sourceFile = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )
    } catch {
      continue
    }

    const fileId = fileToNodeId.get(file)
    const getLine = (pos) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1

    ts.forEachChild(sourceFile, (node) => {
      // Import declaration
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text
        const resolved = resolveImport(file, spec)
        if (!resolved) return
        const targetFileId = fileToNodeId.get(resolved)
        if (!targetFileId) return

        const line = getLine(node.getStart(sourceFile))

        // Check if specific named imports exist
        let addedSymbolLink = false
        if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const elem of node.importClause.namedBindings.elements) {
            const symName = elem.propertyName ? elem.propertyName.text : elem.name.text
            const targetSymId = symbolMap.get(`${resolved}#${symName}`)
            if (targetSymId && nodeMap.has(targetSymId)) {
              addLink({
                source: fileId,
                target: targetSymId,
                relation: "imports",
                weight: 1,
                confidence: "EXTRACTED",
                confidence_score: 1,
                source_file: file,
                source_location: `L${line}`,
                _origin: "ast",
              })
              addedSymbolLink = true
            }
          }
        }

        // Add imports_from link from file to target file
        addLink({
          source: fileId,
          target: targetFileId,
          relation: "imports_from",
          weight: 1,
          confidence: "EXTRACTED",
          confidence_score: 1,
          source_file: file,
          source_location: `L${line}`,
          _origin: "ast",
        })
      }
    })
  }

  // Phase 3: Connect Docs to Key Code Nodes
  const docFileConnections = [
    { doc: "README.md", targets: ["apps/desktop/electron/main.ts", "apps/desktop/src/App.tsx", "convex/schema.ts"] },
    { doc: "AGENTS.md", targets: ["apps/desktop/electron/main.ts", "convex/schema.ts", "apps/server/src/index.ts"] },
    { doc: "ARCHITECTURE.md", targets: ["apps/desktop/electron/main.ts", "apps/desktop/src/features/workbench/WorkbenchPage.tsx", "convex/schema.ts"] },
    { doc: "docs/release-process.md", targets: [".github/workflows/release.yml", "electron-builder.yml"] },
    { doc: "docs/assistant-chat-history.md", targets: ["apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx"] },
    { doc: "docs/device-identity.md", targets: ["convex/devicePrincipals.ts", "cloudflare/worker/src/index.ts"] },
    { doc: "docs/devapp-contained-runtime.md", targets: ["shared/devAppPackage.ts"] },
    { doc: "docs/dev-server-agent-automation.md", targets: ["apps/desktop/electron/services/WorkbenchSessionManager_new.ts"] },
    { doc: "docs/agent-skills.md", targets: ["apps/desktop/electron/services/agentSkills/builtInSkills.ts"] },
  ]

  for (const conn of docFileConnections) {
    const docId = fileToNodeId.get(conn.doc)
    if (!docId) continue
    for (const target of conn.targets) {
      const targetId = fileToNodeId.get(target)
      if (targetId) {
        addLink({
          source: docId,
          target: targetId,
          relation: "references",
          weight: 1,
          confidence: "EXTRACTED",
          confidence_score: 1,
          source_file: conn.doc,
          source_location: "L1",
          _origin: "curated",
        })
      }
    }
  }

  console.log(`Current links: ${links.length} (ratio: ${(links.length / nodes.length).toFixed(2)})`)

  // Check containment percentage and link ratio
  const containsCount = links.filter((l) => l.relation === "contains").length
  const ratio = links.length / nodes.length
  console.log(`Contains count: ${containsCount} (${((containsCount / links.length) * 100).toFixed(1)}%)`)

  // Output graph
  const graph = {
    directed: false,
    multigraph: false,
    graph: {},
    built_at_commit: commit,
    nodes,
    links,
    hyperedges: [
      {
        id: "workbench_lifecycle",
        label: "Workbench Lifecycle Flow",
        nodes: nodes.filter((n) => n.community === 2).slice(0, 5).map((n) => n.id),
        relation: "participate_in",
        confidence: "INFERRED",
        confidence_score: 0.5,
      },
      {
        id: "chat_runtime_pipeline",
        label: "Assistant Chat Pipeline",
        nodes: nodes.filter((n) => n.community === 3).slice(0, 5).map((n) => n.id),
        relation: "participate_in",
        confidence: "INFERRED",
        confidence_score: 0.5,
      },
    ],
  }

  fs.mkdirSync(path.join(ROOT, "graphify-out"), { recursive: true })
  const outPath = path.join(ROOT, "graphify-out", "graph.json")
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2), "utf8")
  console.log(`Wrote graph to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
