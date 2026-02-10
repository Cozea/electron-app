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
