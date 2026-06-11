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
 * Collects string literals assigned to a given property name, e.g. the
 * `channel: 'terminal:output'` option objects passed to IPC broadcast helpers
 * (createIpcOutputBatcher, forEachBroadcastWindow wrappers, ...). These emit
 * via webContents.send internally, so a literal channel property counts as an
 * emitter for coverage purposes.
 */
export function extractStringPropertyAssignments(options: {
  filePath: string
  propertyNames: string[]
}): Set<string> {
  const content = fs.readFileSync(options.filePath, 'utf-8')
  const sourceFile = ts.createSourceFile(options.filePath, content, ts.ScriptTarget.ESNext, true)
  const results = new Set<string>()

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name
      const nameText = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
      if (nameText && options.propertyNames.includes(nameText)) {
        const init = node.initializer
        if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
          results.add(init.text)
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      // const SOME_CHANNEL = 'x:y' consts that are later passed as channels.
      const init = node.initializer
      if (
        init &&
        (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) &&
        /CHANNEL/i.test(node.name.text)
      ) {
        results.add(init.text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return results
}
