import fs from 'node:fs'
import ts from 'typescript'

export function extractStringArgCalls(options: {
  filePath: string
  methodNames: string[]
  rootObjectNames?: string[]
  calleeNames?: string[]
}): Set<string> {
  const content = fs.readFileSync(options.filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(options.filePath, content, ts.ScriptTarget.ESNext, true)
  const results = new Set<string>()

  function getLeftMostIdentifierText(node: ts.Expression): string | null {
    let current: ts.Expression = node
    // Unwrap optional chains / property access chains.
    while (ts.isPropertyAccessExpression(current) || ts.isPropertyAccessChain(current)) {
      current = current.expression
    }
    if (ts.isIdentifier(current)) return current.text
    return null
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression
      if (options.calleeNames && ts.isIdentifier(expr) && options.calleeNames.includes(expr.text)) {
        const firstArg = node.arguments[0]
        if (firstArg && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))) {
          results.add(firstArg.text)
        }
        ts.forEachChild(node, visit)
        return
      }

      const isProp =
        ts.isPropertyAccessExpression(expr) ||
        ts.isPropertyAccessChain(expr)

      if (isProp) {
        const method = expr.name.text
        if (options.methodNames.includes(method)) {
          if (options.rootObjectNames) {
            const rootName = getLeftMostIdentifierText(expr.expression)
            if (!rootName || !options.rootObjectNames.includes(rootName)) {
              // Not a call on a root object we care about.
              ts.forEachChild(node, visit)
              return
            }
          }

          const firstArg = node.arguments[0]
          if (firstArg && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))) {
            results.add(firstArg.text)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return results
}

/**
 * Collects channel names that are actually emitted from a single source file,
 * covering the two indirect emit patterns that `extractStringArgCalls` with
 * `methodNames: ['send']` misses on its own:
 *
 *  - A `*CHANNEL` const whose identifier is later passed to a send/emit call,
 *    e.g. `const FOO_CHANNEL = 'a:b'` + `webContents.send(FOO_CHANNEL, …)`.
 *  - A `channel: 'terminal:output'` option on an object literal passed to an
 *    IPC broadcast/batcher helper (createIpcOutputBatcher, forEachBroadcastWindow
 *    wrappers, …), which forwards that channel to `sender.send(channel, …)`
 *    internally — usually in a different file.
 *
 * Crucially, a channel only counts as emitted when there is evidence it reaches
 * a send/emit: a const must be passed to a send/emit call, and a `channel:`
 * literal must sit on an options object handed to a helper call. A name that is
 * merely declared or referenced (e.g. a `*CHANNEL` const whose send was deleted,
 * or a `channel:` field on an unrelated data structure) is NOT treated as
 * emitted, so this helper cannot mask a preload listener that is never sent.
 */
export function extractStringPropertyAssignments(options: {
  filePath: string
  propertyNames: string[]
}): Set<string> {
  const content = fs.readFileSync(options.filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(options.filePath, content, ts.ScriptTarget.ESNext, true)
  const results = new Set<string>()

  // First pass: identifiers passed as the channel argument to a send/emit call,
  // so a `*CHANNEL` const only counts once it is actually emitted.
  const SEND_METHODS = ['send', 'emit']
  const emittedIdentifiers = new Set<string>()
  function collectEmittedIdentifiers(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression
      if (
        (ts.isPropertyAccessExpression(expr) || ts.isPropertyAccessChain(expr)) &&
        SEND_METHODS.includes(expr.name.text)
      ) {
        const firstArg = node.arguments[0]
        if (firstArg && ts.isIdentifier(firstArg)) {
          emittedIdentifiers.add(firstArg.text)
        }
      }
    }
    ts.forEachChild(node, collectEmittedIdentifiers)
  }
  collectEmittedIdentifiers(sourceFile)

  // True when the property assignment lives on an object literal that is itself
  // a call argument, i.e. an options bag passed to a broadcast/batcher helper
  // that forwards the channel to a real send. A bare `channel:` field on an
  // unrelated object does not qualify.
  function isHelperOptionProperty(node: ts.PropertyAssignment): boolean {
    const objectLiteral = node.parent
    if (!objectLiteral || !ts.isObjectLiteralExpression(objectLiteral)) return false
    return ts.isCallExpression(objectLiteral.parent)
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name
      const nameText = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
      if (nameText && options.propertyNames.includes(nameText) && isHelperOptionProperty(node)) {
        const init = node.initializer
        if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
          results.add(init.text)
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      // const SOME_CHANNEL = 'x:y' consts — counted only when the const
      // identifier is actually passed to a send/emit call somewhere in the file.
      const init = node.initializer
      if (
        init &&
        (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) &&
        /CHANNEL/i.test(node.name.text) &&
        emittedIdentifiers.has(node.name.text)
      ) {
        results.add(init.text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return results
}
