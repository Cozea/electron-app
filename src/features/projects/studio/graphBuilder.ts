import type { Edge, Node as ReactFlowNode } from "@xyflow/react"
import { parse, type ParserOptions } from "@babel/parser"
import type {
  CallExpression,
  File,
  Identifier,
  ImportDeclaration,
  MemberExpression,
  Node as BabelNode,
  ObjectExpression,
  ObjectProperty,
  StringLiteral,
  TemplateLiteral,
} from "@babel/types"

export type StudioNodeKind = "convex" | "ui" | "db" | "api" | "custom"
export type StudioConvexOperation = "query" | "mutation" | "action"

export interface StudioGraphNodeData extends Record<string, unknown> {
  kind: StudioNodeKind
  label: string
  subtitle?: string
  filePath?: string
  apiPath?: string
  operation?: StudioConvexOperation
  details?: string[]
}

export interface StudioGraph {
  nodes: Array<ReactFlowNode<StudioGraphNodeData, "studio">>
  edges: Edge[]
}

export interface StudioRouteRef {
  name: string
  path: string
  file: string
  type?: "static" | "dynamic"
}

interface BuildBackendStudioGraphParams {
  projectPath: string
  routes?: StudioRouteRef[]
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/")
}

function modulePathFromConvexFile(filePath: string): string {
  return normalizePath(filePath)
    .replace(/^convex\//, "")
    .replace(/\.ts$/, "")
    .replace(/\//g, ".")
}

function extractConvexExports(content: string): Array<{ name: string; operation: StudioConvexOperation }> {
  const results: Array<{ name: string; operation: StudioConvexOperation }> = []

  const re = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)\s*\(/g
  let match: RegExpExecArray | null

  while ((match = re.exec(content))) {
    const name = match[1]
    const rawOp = match[2]
    const operation: StudioConvexOperation =
      rawOp === "mutation" || rawOp === "internalMutation"
        ? "mutation"
        : rawOp === "action" || rawOp === "internalAction"
          ? "action"
          : "query"
    results.push({ name, operation })
  }

  return results
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

function extractDbReads(content: string): string[] {
  const reads: string[] = []
  const re = /\.query\(\s*["']([^"']+)["']\s*\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    reads.push(match[1])
  }
  return uniq(reads)
}

function extractDbWrites(content: string): string[] {
  const writes: string[] = []
  const insertRe = /\.insert\(\s*["']([^"']+)["']\s*,/g
  const replaceRe = /\.replace\(\s*["']([^"']+)["']\s*,/g
  let match: RegExpExecArray | null

  while ((match = insertRe.exec(content))) writes.push(match[1])
  while ((match = replaceRe.exec(content))) writes.push(match[1])

  return uniq(writes)
}

function extractApiPaths(content: string): string[] {
  const paths: string[] = []
  const re = /\bapi\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content))) {
    paths.push(match[1])
  }
  return uniq(paths)
}

function isTextFile(path: string): boolean {
  const p = normalizePath(path)
  return /\.(ts|tsx|js|jsx)$/.test(p)
}

const BABEL_PARSE_OPTIONS: ParserOptions = {
  sourceType: "unambiguous",
  errorRecovery: true,
  plugins: [
    "typescript",
    "jsx",
    "decorators-legacy",
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
    "dynamicImport",
    "importMeta",
    "topLevelAwait",
  ],
}

function parseToAst(code: string): File | null {
  try {
    return parse(code, BABEL_PARSE_OPTIONS)
  } catch {
    return null
  }
}

function isBabelNode(value: unknown): value is BabelNode {
  return typeof value === "object" && value !== null && "type" in value && typeof (value as { type?: unknown }).type === "string"
}

function walkAst(node: BabelNode, visitor: (node: BabelNode, parent: BabelNode | null) => void, parent: BabelNode | null = null) {
  visitor(node, parent)

  for (const key of Object.keys(node)) {
    const value = (node as unknown as Record<string, unknown>)[key]
    if (!value) continue

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isBabelNode(item)) walkAst(item, visitor, node)
      }
      continue
    }

    if (isBabelNode(value)) {
      walkAst(value, visitor, node)
    }
  }
}

function getStaticString(node: BabelNode | null | undefined): string | null {
  if (!node) return null
  if (node.type === "StringLiteral") return (node as StringLiteral).value
  if (node.type === "TemplateLiteral") {
    const tpl = node as TemplateLiteral
    if (tpl.expressions.length === 0) {
      return tpl.quasis.map((q) => q.value.cooked ?? "").join("")
    }
  }
  return null
}

function getObjectPropertyString(obj: ObjectExpression, keyName: string): string | null {
  for (const prop of obj.properties) {
    if (prop.type !== "ObjectProperty") continue
    const p = prop as ObjectProperty

    const key =
      p.key.type === "Identifier"
        ? (p.key as Identifier).name
        : p.key.type === "StringLiteral"
          ? (p.key as StringLiteral).value
          : null
    if (key !== keyName) continue

    return getStaticString(p.value as unknown as BabelNode)
  }
  return null
}

interface ExtractedExternalRefs {
  supabase: {
    tables: Set<string>
    rpcs: Set<string>
    buckets: Set<string>
  }
  firebase: {
    collections: Set<string>
    functions: Set<string>
  }
  rest: {
    endpoints: Array<{ method: string; url: string }>
  }
}

function extractExternalRefsFromSource(code: string): ExtractedExternalRefs {
  const refs: ExtractedExternalRefs = {
    supabase: { tables: new Set(), rpcs: new Set(), buckets: new Set() },
    firebase: { collections: new Set(), functions: new Set() },
    rest: { endpoints: [] },
  }

  const ast = parseToAst(code)
  if (!ast) return refs

  const supabaseCreateClientNames = new Set<string>()
  const axiosIdentifiers = new Set<string>()
  const firebaseLocalImports = new Map<string, string>() // local -> imported
  let sawSupabaseImport = false
  let sawFirebaseImport = false

  const supabaseClientVars = new Set<string>()

  // 1) Collect imports + known identifiers
  walkAst(ast, (node) => {
    if (node.type !== "ImportDeclaration") return
    const imp = node as ImportDeclaration
    const source = imp.source.value

    if (source === "@supabase/supabase-js" || source === "@supabase/ssr") {
      sawSupabaseImport = true
      for (const spec of imp.specifiers) {
        if (spec.type === "ImportSpecifier" && spec.imported.type === "Identifier") {
          const imported = spec.imported.name
          const local = spec.local.name
          if (imported === "createClient" || imported === "createBrowserClient") {
            supabaseCreateClientNames.add(local)
          }
        }
      }
    }

    if (source === "axios") {
      for (const spec of imp.specifiers) {
        if (spec.type === "ImportDefaultSpecifier" || spec.type === "ImportNamespaceSpecifier") {
          axiosIdentifiers.add(spec.local.name)
        }
      }
    }

    if (source === "firebase" || source.startsWith("firebase/") || source.startsWith("@firebase/")) {
      sawFirebaseImport = true
      for (const spec of imp.specifiers) {
        if (spec.type !== "ImportSpecifier") continue
        if (spec.imported.type !== "Identifier") continue
        firebaseLocalImports.set(spec.local.name, spec.imported.name)
      }
    }
  })

  // 2) Collect supabase client variables created in-file
  if (sawSupabaseImport && supabaseCreateClientNames.size > 0) {
    walkAst(ast, (node) => {
      if (node.type !== "VariableDeclarator") return
      const id = (node as { id: unknown }).id
      const init = (node as { init?: unknown }).init
      if (!isBabelNode(id) || !isBabelNode(init)) return

      if (id.type !== "Identifier") return
      if (init.type !== "CallExpression") return

      const call = init as CallExpression
      if (call.callee.type !== "Identifier") return
      const calleeName = (call.callee as Identifier).name
      if (!supabaseCreateClientNames.has(calleeName)) return

      supabaseClientVars.add((id as Identifier).name)
    })
  }

  const isSupabaseLikeClient = (name: string) =>
    supabaseClientVars.has(name) || /^supabase/i.test(name) || name.toLowerCase().includes("supabase")

  const addRestEndpoint = (method: string, url: string) => {
    const normalizedMethod = method.toUpperCase()
    refs.rest.endpoints.push({ method: normalizedMethod, url })
  }

  // 3) Scan calls
  walkAst(ast, (node) => {
    if (node.type !== "CallExpression") return
    const call = node as CallExpression

    // fetch(url, { method })
    if (call.callee.type === "Identifier" && (call.callee as Identifier).name === "fetch") {
      const url = getStaticString(call.arguments[0] as unknown as BabelNode)
      if (!url) return

      let method = "GET"
      const initArg = call.arguments[1] as unknown as BabelNode | undefined
      if (initArg?.type === "ObjectExpression") {
        const m = getObjectPropertyString(initArg as ObjectExpression, "method")
        if (m) method = m
      }
      addRestEndpoint(method, url)
      return
    }

    // axios.get/post(url) or axios({ url, method })
    if (call.callee.type === "MemberExpression") {
      const callee = call.callee as MemberExpression
      if (callee.object.type === "Identifier" && callee.property.type === "Identifier") {
        const objName = (callee.object as Identifier).name
        const prop = (callee.property as Identifier).name
        if (axiosIdentifiers.has(objName)) {
          const url = getStaticString(call.arguments[0] as unknown as BabelNode)
          if (!url) return
          const method = prop.toUpperCase()
          if (["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
            addRestEndpoint(method, url)
          } else {
            addRestEndpoint("GET", url)
          }
          return
        }
      }
    } else if (call.callee.type === "Identifier" && axiosIdentifiers.has((call.callee as Identifier).name)) {
      const configArg = call.arguments[0] as unknown as BabelNode | undefined
      if (configArg?.type !== "ObjectExpression") return
      const url = getObjectPropertyString(configArg as ObjectExpression, "url")
      if (!url) return
      const method = getObjectPropertyString(configArg as ObjectExpression, "method") ?? "GET"
      addRestEndpoint(method, url)
      return
    }

    // Supabase: supabase.from("table"), supabase.rpc("fn"), supabase.storage.from("bucket")
    if (call.callee.type === "MemberExpression" && call.callee.property.type === "Identifier") {
      const callee = call.callee as MemberExpression
      const propName = (callee.property as Identifier).name

      // supabase.storage.from("bucket")
      if (propName === "from" && callee.object.type === "MemberExpression") {
        const obj = callee.object as MemberExpression
        if (obj.property.type === "Identifier" && (obj.property as Identifier).name === "storage") {
          if (obj.object.type === "Identifier" && isSupabaseLikeClient((obj.object as Identifier).name)) {
            const bucket = getStaticString(call.arguments[0] as unknown as BabelNode)
            if (bucket) refs.supabase.buckets.add(bucket)
          }
        }
      }

      // supabase.from("table") / supabase.rpc("fn")
      if (callee.object.type === "Identifier" && isSupabaseLikeClient((callee.object as Identifier).name)) {
        const arg0 = getStaticString(call.arguments[0] as unknown as BabelNode)
        if (!arg0) return
        if (propName === "from") refs.supabase.tables.add(arg0)
        if (propName === "rpc") refs.supabase.rpcs.add(arg0)
      }
    }

    // Firebase (modular): collection(db, "users"), doc(db, "users", "id"), httpsCallable(funcs, "name")
    if (sawFirebaseImport && call.callee.type === "Identifier") {
      const localName = (call.callee as Identifier).name
      const importedName = firebaseLocalImports.get(localName) ?? localName

      if (importedName === "collection") {
        const path = getStaticString(call.arguments.find((a) => getStaticString(a as unknown as BabelNode)) as unknown as BabelNode)
        if (path) refs.firebase.collections.add(path)
        return
      }

      if (importedName === "doc") {
        const segments = call.arguments
          .map((a) => getStaticString(a as unknown as BabelNode))
          .filter((s): s is string => typeof s === "string" && s.length > 0)
        if (segments.length) refs.firebase.collections.add(segments.join("/"))
        return
      }

      if (importedName === "httpsCallable") {
        const name = getStaticString(call.arguments[1] as unknown as BabelNode) ?? getStaticString(call.arguments[0] as unknown as BabelNode)
        if (name) refs.firebase.functions.add(name)
        return
      }
    }

    // Firebase (compat): firebase.firestore().collection("users")
    if (call.callee.type === "MemberExpression" && call.callee.property.type === "Identifier") {
      const propName = (call.callee.property as Identifier).name
      if (propName !== "collection" && propName !== "httpsCallable") return

      const obj = (call.callee as MemberExpression).object
      if (!isBabelNode(obj)) return

      const arg0 = getStaticString(call.arguments[0] as unknown as BabelNode)
      if (!arg0) return

      if (propName === "collection") {
        refs.firebase.collections.add(arg0)
      } else if (propName === "httpsCallable") {
        refs.firebase.functions.add(arg0)
      }
    }
  })

  // De-dup REST endpoints (method+url)
  const seen = new Set<string>()
  refs.rest.endpoints = refs.rest.endpoints.filter((e) => {
    const k = `${e.method}:${e.url}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return refs
}

function buildColumnLayout(nodes: Array<ReactFlowNode<StudioGraphNodeData, "studio">>) {
  const colX: Record<StudioNodeKind, number> = {
    ui: 80,
    api: 420,
    convex: 760,
    db: 1100,
    custom: 760,
  }

  const orderWeight: Record<StudioNodeKind, number> = {
    ui: 0,
    api: 1,
    convex: 2,
    db: 3,
    custom: 4,
  }

  const sorted = [...nodes].sort((a, b) => {
    const wa = orderWeight[a.data.kind] ?? 99
    const wb = orderWeight[b.data.kind] ?? 99
    if (wa !== wb) return wa - wb
    return a.data.label.localeCompare(b.data.label)
  })

  const counters = new Map<StudioNodeKind, number>()

  return sorted.map((n) => {
    const kind = n.data.kind
    const idx = counters.get(kind) ?? 0
    counters.set(kind, idx + 1)
    return {
      ...n,
      position: { x: colX[kind], y: 80 + idx * 120 },
    }
  })
}

export async function buildBackendStudioGraph({
  projectPath,
  routes,
}: BuildBackendStudioGraphParams): Promise<StudioGraph> {
  const listResult = await window.electronAPI.project.listFiles({ projectPath })
  if (!listResult.success || !listResult.files) {
    throw new Error(listResult.error || "Failed to list project files")
  }

  const files = listResult.files
    .map((f) => ({ ...f, path: normalizePath(f.path) }))
    // Keep scanning reasonably fast
    .filter((f) => f.sizeBytes <= 250_000)

  const convexFiles = files.filter(
    (f) =>
      f.path.startsWith("convex/") &&
      f.path.endsWith(".ts") &&
      !f.path.startsWith("convex/_generated/") &&
      !f.path.startsWith("convex/lib/") &&
      f.path !== "convex/schema.ts"
  )

  const routesByFile = buildRoutesByFileMap(routes)
  const routeFiles = new Set(routesByFile.keys())

  const uiFiles = files.filter(
    (f) =>
      isTextFile(f.path) &&
      !f.path.includes("node_modules/") &&
      !f.path.startsWith("convex/") &&
      !f.path.startsWith("server/") &&
      (f.path.startsWith("src/") || f.path.startsWith("app/") || f.path.startsWith("pages/") || routeFiles.has(f.path))
  )

  const nodes: Array<ReactFlowNode<StudioGraphNodeData, "studio">> = []
  const edges: Edge[] = []

  const nodeIds = new Set<string>()
  const convexFunctionIds = new Set<string>()
  const dbTableIds = new Set<string>()

  const ensureNode = (node: ReactFlowNode<StudioGraphNodeData, "studio">) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }

  const ensureEdge = (edge: Edge) => {
    if (edges.some((e) => e.id === edge.id)) return
    edges.push(edge)
  }

  // 1) Convex functions + DB access
  for (const file of convexFiles) {
    const readResult = await window.electronAPI.project.readFile({
      projectPath,
      filePath: file.path,
    })
    if (!readResult.success || !readResult.content) continue

    const modulePath = modulePathFromConvexFile(file.path)
    const exportedFns = extractConvexExports(readResult.content)
    if (exportedFns.length === 0) continue

    const reads = extractDbReads(readResult.content)
    const writes = extractDbWrites(readResult.content)

    for (const fn of exportedFns) {
      const apiPath = `${modulePath}.${fn.name}`
      const id = `convex:${apiPath}`
      convexFunctionIds.add(id)

      const details: string[] = []
      if (reads.length) details.push(`Reads: ${reads.slice(0, 3).join(", ")}${reads.length > 3 ? "…" : ""}`)
      if (writes.length) details.push(`Writes: ${writes.slice(0, 3).join(", ")}${writes.length > 3 ? "…" : ""}`)

      ensureNode({
        id,
        type: "studio",
        position: { x: 0, y: 0 },
        data: {
          kind: "convex",
          label: fn.name,
          subtitle: modulePath,
          filePath: file.path,
          apiPath,
          operation: fn.operation,
          details: details.length ? details : undefined,
        },
      })

      for (const table of reads) {
        const dbId = `db:${table}`
        dbTableIds.add(dbId)
        ensureNode({
          id: dbId,
          type: "studio",
          position: { x: 0, y: 0 },
          data: {
            kind: "db",
            label: table,
            subtitle: "Convex table",
            filePath: "convex/schema.ts",
            details: ["Used by Convex functions"],
          },
        })

        ensureEdge({
          id: `e:${id}->${dbId}:read`,
          source: id,
          target: dbId,
          type: "smoothstep",
          animated: false,
          label: "reads",
          style: { stroke: "hsl(var(--muted-foreground))" },
          labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
        })
      }

      for (const table of writes) {
        const dbId = `db:${table}`
        dbTableIds.add(dbId)
        ensureNode({
          id: dbId,
          type: "studio",
          position: { x: 0, y: 0 },
          data: {
            kind: "db",
            label: table,
            subtitle: "Convex table",
            filePath: "convex/schema.ts",
            details: ["Used by Convex functions"],
          },
        })

        ensureEdge({
          id: `e:${id}->${dbId}:write`,
          source: id,
          target: dbId,
          type: "smoothstep",
          animated: false,
          label: "writes",
          style: { stroke: "hsl(var(--destructive))" },
          labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
        })
      }
    }
  }

  // 2) UI callers → Convex
  for (const file of uiFiles) {
    const routeInfo = routesByFile.get(file.path) ?? null
    const readResult = await window.electronAPI.project.readFile({
      projectPath,
      filePath: file.path,
    })
    if (!readResult.success || !readResult.content) continue

    const apiPaths = readResult.content.includes("api.") ? extractApiPaths(readResult.content) : []

    // Only keep edges to Convex functions we found (reduces noise)
    const convexTargets = apiPaths
      .map((p) => `convex:${p}`)
      .filter((id) => convexFunctionIds.has(id))

    const external = extractExternalRefsFromSource(readResult.content)
    const hasExternalCalls =
      external.supabase.tables.size > 0 ||
      external.supabase.rpcs.size > 0 ||
      external.supabase.buckets.size > 0 ||
      external.firebase.collections.size > 0 ||
      external.firebase.functions.size > 0 ||
      external.rest.endpoints.length > 0

    if (convexTargets.length === 0 && !routeInfo && !hasExternalCalls) continue

    const fileName = file.path.split("/").pop() ?? file.path
    const uiId = `ui:${file.path}`

    const details: string[] = []
    if (convexTargets.length) {
      details.push(`Calls: ${convexTargets.length} Convex function${convexTargets.length === 1 ? "" : "s"}`)
    }

    if (external.supabase.tables.size || external.supabase.rpcs.size || external.supabase.buckets.size) {
      const parts: string[] = []
      if (external.supabase.tables.size) parts.push(`${external.supabase.tables.size} table${external.supabase.tables.size === 1 ? "" : "s"}`)
      if (external.supabase.rpcs.size) parts.push(`${external.supabase.rpcs.size} RPC${external.supabase.rpcs.size === 1 ? "" : "s"}`)
      if (external.supabase.buckets.size) parts.push(`${external.supabase.buckets.size} bucket${external.supabase.buckets.size === 1 ? "" : "s"}`)
      details.push(`Supabase: ${parts.join(", ")}`)
    }

    if (external.firebase.collections.size || external.firebase.functions.size) {
      const parts: string[] = []
      if (external.firebase.collections.size) parts.push(`${external.firebase.collections.size} collection${external.firebase.collections.size === 1 ? "" : "s"}`)
      if (external.firebase.functions.size) parts.push(`${external.firebase.functions.size} function${external.firebase.functions.size === 1 ? "" : "s"}`)
      details.push(`Firebase: ${parts.join(", ")}`)
    }

    if (external.rest.endpoints.length) {
      details.push(`REST: ${external.rest.endpoints.length} endpoint${external.rest.endpoints.length === 1 ? "" : "s"}`)
    }

    if (!details.length) {
      details.push("No service calls detected")
    }
    if (routeInfo) {
      details.push(`File: ${file.path}`)
      if (routeInfo.type === "dynamic") {
        details.push("Dynamic route")
      }
    }

    ensureNode({
      id: uiId,
      type: "studio",
      position: { x: 0, y: 0 },
      data: {
        kind: "ui",
        label: routeInfo?.name ?? fileName.replace(/\.(tsx|ts|jsx|js)$/, ""),
        subtitle: routeInfo?.path ?? file.path,
        filePath: file.path,
        details,
      },
    })

    for (const targetId of convexTargets) {
      ensureEdge({
        id: `e:${uiId}->${targetId}:call`,
        source: uiId,
        target: targetId,
        type: "smoothstep",
        animated: false,
        label: "calls",
        style: { stroke: "hsl(var(--primary))" },
        labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
      })
    }

    // Supabase
    for (const table of external.supabase.tables) {
      const id = `db:supabase:${table}`
      ensureNode({
        id,
        type: "studio",
        position: { x: 0, y: 0 },
        data: {
          kind: "db",
          label: table,
          subtitle: "Supabase table",
          details: ["Detected via supabase.from(...)"],
        },
      })

      ensureEdge({
        id: `e:${uiId}->${id}:supabase`,
        source: uiId,
        target: id,
        type: "smoothstep",
        animated: false,
        label: "supabase",
        style: { stroke: "hsl(var(--primary))" },
        labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
      })
    }

    for (const rpc of external.supabase.rpcs) {
      const id = `api:supabase:rpc:${rpc}`
      ensureNode({
        id,
        type: "studio",
        position: { x: 0, y: 0 },
        data: {
          kind: "api",
          label: rpc,
          subtitle: "Supabase RPC",
          details: ["Detected via supabase.rpc(...)"],
        },
      })

      ensureEdge({
        id: `e:${uiId}->${id}:supabase`,
        source: uiId,
        target: id,
        type: "smoothstep",
        animated: false,
        label: "rpc",
        style: { stroke: "hsl(var(--primary))" },
        labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
      })
    }

    for (const bucket of external.supabase.buckets) {
      const id = `api:supabase:storage:${bucket}`
      ensureNode({
        id,
        type: "studio",
        position: { x: 0, y: 0 },
        data: {
          kind: "api",
          label: bucket,
          subtitle: "Supabase Storage",
          details: ["Detected via supabase.storage.from(...)"],
        },
      })

      ensureEdge({
        id: `e:${uiId}->${id}:supabase`,
        source: uiId,
        target: id,
        type: "smoothstep",
        animated: false,
        label: "storage",
        style: { stroke: "hsl(var(--primary))" },
        labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
      })
    }

    // Firebase
    for (const collection of external.firebase.collections) {
      const id = `db:firebase:${collection}`
      ensureNode({
        id,
        type: "studio",
        position: { x: 0, y: 0 },
        data: {
          kind: "db",
          label: collection,
          subtitle: "Firebase collection",
          details: ["Detected via Firestore helpers"],
        },
      })

      ensureEdge({
        id: `e:${uiId}->${id}:firebase`,
        source: uiId,
        target: id,
        type: "smoothstep",
        animated: false,
        label: "firebase",
        style: { stroke: "hsl(var(--primary))" },
        labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
      })
    }

    for (const fn of external.firebase.functions) {
      const id = `api:firebase:function:${fn}`
      ensureNode({
        id,
        type: "studio",
        position: { x: 0, y: 0 },
        data: {
          kind: "api",
          label: fn,
          subtitle: "Firebase function",
          details: ["Detected via httpsCallable(...)"],
        },
      })

      ensureEdge({
        id: `e:${uiId}->${id}:firebase`,
        source: uiId,
        target: id,
        type: "smoothstep",
        animated: false,
        label: "calls",
        style: { stroke: "hsl(var(--primary))" },
        labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
      })
    }

    // REST endpoints
    for (const endpoint of external.rest.endpoints) {
      const apiId = `api:http:${endpoint.method}:${endpoint.url}`
      ensureNode({
        id: apiId,
        type: "studio",
        position: { x: 0, y: 0 },
        data: {
          kind: "api",
          label: endpoint.url,
          subtitle: `HTTP ${endpoint.method}`,
          details: ["Detected via fetch/axios"],
        },
      })

      ensureEdge({
        id: `e:${uiId}->${apiId}:http`,
        source: uiId,
        target: apiId,
        type: "smoothstep",
        animated: false,
        label: endpoint.method,
        style: { stroke: "hsl(var(--primary))" },
        labelStyle: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
      })
    }
  }

  // Stable layout for scanned graph (manual nodes handled by caller)
  const laidOut = buildColumnLayout(nodes)

  // Optional: remove DB nodes that are orphaned (edge cases)
  const usedDb = new Set(edges.map((e) => e.target))
  const finalNodes = laidOut.filter((n) => n.data.kind !== "db" || usedDb.has(n.id) || dbTableIds.has(n.id))

  return { nodes: finalNodes, edges }
}

function buildRoutesByFileMap(routes?: StudioRouteRef[] | null): Map<string, StudioRouteRef> {
  const map = new Map<string, StudioRouteRef>()
  for (const route of routes ?? []) {
    const file = normalizePath(route.file)
    map.set(file, { ...route, file })
  }
  return map
}
