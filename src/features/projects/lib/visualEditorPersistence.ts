import * as ts from 'typescript'

import { resolveProjectSourcePath } from '@/features/projects/lib/projectSourcePath'
import type { InspectedElementContext } from '@/stores/usePageContextStore'
import type {
  DirectEditableAttributes,
  ElementStyles,
  SelectedElement,
} from '@/stores/useVisualEditorStore'

type SupportedSourceExtension = '.tsx' | '.jsx' | '.ts' | '.js'

interface VisualEditSourceTarget {
  columnNumber: number | null
  filePath: string
  lineNumber: number | null
}

interface VisualEditTargetMatch {
  sourceFile: ts.SourceFile
  sourceText: string
  targetNode: ts.JsxOpeningElement | ts.JsxSelfClosingElement
}

interface BuildDirectVisualEditInput {
  currentPageFilePath?: string | null
  inspectedElement: InspectedElementContext | null
  pendingAttributes: DirectEditableAttributes
  pendingChanges: Partial<ElementStyles>
  pendingTextChange: string | null
  projectPath: string
  selectedElement: SelectedElement
}

interface SuccessfulDirectVisualEdit {
  content: string
  filePath: string
  summary: string
}

interface SuccessfulBuildResult {
  ok: true
  value: SuccessfulDirectVisualEdit
}

interface FailureResult {
  error: string
  ok: false
  reason: 'error' | 'unsupported'
}

interface SuccessResult<T> {
  ok: true
  value: T
}

type Result<T> = FailureResult | SuccessResult<T>

export type BuildDirectVisualEditResult =
  | FailureResult
  | SuccessfulBuildResult

function normalizeTextValue(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function isSupportedSourceExtension(filePath: string): filePath is `${string}${SupportedSourceExtension}` {
  return /\.(tsx|jsx|ts|js)$/i.test(filePath)
}

function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function isSupportedHostTagName(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, expectedTagName: string): boolean {
  const tagName = node.tagName.getText(node.getSourceFile()).trim().toLowerCase()
  return tagName === expectedTagName.trim().toLowerCase()
}

function getJsxAttributeStringValue(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  attributeName: string,
): string | null {
  const prop = node.attributes.properties.find(
    (property): property is ts.JsxAttribute => (
      ts.isJsxAttribute(property) && getJsxAttributeNameText(property.name) === attributeName
    ),
  )
  if (!prop?.initializer) return null
  if (ts.isStringLiteral(prop.initializer)) {
    return prop.initializer.text
  }
  if (
    ts.isJsxExpression(prop.initializer) &&
    prop.initializer.expression &&
    ts.isStringLiteralLike(prop.initializer.expression)
  ) {
    return prop.initializer.expression.text
  }
  return null
}

function getSafeJsxAttributeLiteralValue(attribute: ts.JsxAttribute): Result<string> {
  if (!attribute.initializer) {
    return {
      ok: false,
      reason: 'unsupported',
      error: `Direct save cannot safely modify ${getJsxAttributeNameText(attribute.name) ?? 'this'} when it is not a string literal.`,
    }
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return {
      ok: true,
      value: attribute.initializer.text,
    }
  }

  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteralLike(attribute.initializer.expression)
  ) {
    return {
      ok: true,
      value: attribute.initializer.expression.text,
    }
  }

  return {
    ok: false,
    reason: 'unsupported',
    error: `Direct save supports ${getJsxAttributeNameText(attribute.name) ?? 'this'} only when it is a literal string JSX attribute.`,
  }
}

function getJsxAttributeNameText(name: ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(name)) {
    return name.text
  }
  if (ts.isJsxNamespacedName(name)) {
    return `${name.namespace.text}:${name.name.text}`
  }
  return null
}

function matchesSelectedElementSignature(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  selectedElement: SelectedElement,
): boolean {
  if (!isSupportedHostTagName(node, selectedElement.tagName)) {
    return false
  }

  if (selectedElement.id) {
    const sourceId = getJsxAttributeStringValue(node, 'id')
    if (sourceId && sourceId.trim() === selectedElement.id.trim()) {
      return true
    }
  }

  const selectedClasses = selectedElement.className
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (selectedClasses.length > 0) {
    const sourceClasses = (getJsxAttributeStringValue(node, 'className') ?? getJsxAttributeStringValue(node, 'class') ?? '')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
    if (sourceClasses.some((token) => selectedClasses.includes(token))) {
      return true
    }
  }

  return selectedClasses.length === 0 && !selectedElement.id
}

function getTargetPosition(
  sourceFile: ts.SourceFile,
  lineNumber: number | null,
  columnNumber: number | null,
): number | null {
  if (!lineNumber || lineNumber <= 0) return null
  const zeroBasedLine = Math.max(0, lineNumber - 1)
  const zeroBasedColumn = Math.max(0, (columnNumber ?? 1) - 1)
  const lineStarts = sourceFile.getLineStarts()
  if (zeroBasedLine >= lineStarts.length) return null
  return ts.getPositionOfLineAndCharacter(sourceFile, zeroBasedLine, zeroBasedColumn)
}

function collectMatchingJsxNodes(
  sourceFile: ts.SourceFile,
  selectedElement: SelectedElement,
): Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> {
  const matches: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = []

  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && matchesSelectedElementSignature(node, selectedElement)) {
      matches.push(node)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return matches
}

function findSingleTextChild(element: ts.JsxElement): ts.JsxText | null {
  const meaningfulChildren = element.children.filter((child) => {
    if (!ts.isJsxText(child)) return false
    return normalizeTextValue(child.getText(element.getSourceFile())) !== ''
  })

  if (meaningfulChildren.length !== 1) {
    return null
  }

  return meaningfulChildren[0] as ts.JsxText
}

function chooseTargetNode(
  sourceFile: ts.SourceFile,
  selectedElement: SelectedElement,
  lineNumber: number | null,
  columnNumber: number | null,
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
  const matches = collectMatchingJsxNodes(sourceFile, selectedElement)
  if (matches.length === 0) return null

  const targetPosition = getTargetPosition(sourceFile, lineNumber, columnNumber)
  if (targetPosition !== null) {
    const containingMatches = matches
      .filter((node) => node.getStart(sourceFile) <= targetPosition && node.getEnd() >= targetPosition)
      .sort((left, right) => (left.getEnd() - left.getStart(sourceFile)) - (right.getEnd() - right.getStart(sourceFile)))

    if (containingMatches.length > 0) {
      return containingMatches[0] ?? null
    }
  }

  const normalizedSelectedText = normalizeTextValue(selectedElement.textContent)
  if (normalizedSelectedText) {
    const textMatches = matches.filter((node) => {
      if (!ts.isJsxOpeningElement(node)) return false
      if (!ts.isJsxElement(node.parent) || node.parent.openingElement !== node) return false
      const textChild = findSingleTextChild(node.parent)
      if (!textChild) return false
      return normalizeTextValue(textChild.getText(sourceFile)) === normalizedSelectedText
    })

    if (textMatches.length === 1) {
      return textMatches[0] ?? null
    }
  }

  return matches.length === 1 ? (matches[0] ?? null) : null
}

function getStyleAttribute(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): ts.JsxAttribute | null {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && getJsxAttributeNameText(property.name) === 'style',
  ) ?? null
}

function getJsxAttribute(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  attributeName: string,
): ts.JsxAttribute | null {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute => (
      ts.isJsxAttribute(property) && getJsxAttributeNameText(property.name) === attributeName
    ),
  ) ?? null
}

function createStringLiteralAttribute(attributeName: string, value: string): ts.JsxAttribute {
  return ts.factory.createJsxAttribute(
    ts.factory.createIdentifier(attributeName),
    ts.factory.createStringLiteral(value),
  )
}

function createStylePropertyAssignment(name: string, value: string): ts.PropertyAssignment {
  const propertyName = /^[A-Za-z_$][\w$]*$/.test(name)
    ? ts.factory.createIdentifier(name)
    : ts.factory.createStringLiteral(name)
  return ts.factory.createPropertyAssignment(propertyName, ts.factory.createStringLiteral(value))
}

function buildUpdatedStyleNode(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  pendingChanges: Partial<ElementStyles>,
): Result<ts.JsxOpeningElement | ts.JsxSelfClosingElement> {
  const styleEntries = Object.entries(pendingChanges).filter(([, value]) => typeof value === 'string' && value.length > 0)
  if (styleEntries.length === 0) {
    return {
      ok: true,
      value: node,
    }
  }

  const existingStyleAttribute = getStyleAttribute(node)
  const nextProperties = [...node.attributes.properties]
  const styleAssignments = new Map<string, ts.ObjectLiteralElementLike>()

  if (existingStyleAttribute?.initializer) {
    if (
      !ts.isJsxExpression(existingStyleAttribute.initializer) ||
      !existingStyleAttribute.initializer.expression ||
      !ts.isObjectLiteralExpression(existingStyleAttribute.initializer.expression)
    ) {
      return {
        ok: false,
        reason: 'unsupported',
        error: 'Direct save currently supports only inline JSX style objects.',
      }
    }

    for (const property of existingStyleAttribute.initializer.expression.properties) {
      if (!ts.isPropertyAssignment(property)) {
        return {
          ok: false,
          reason: 'unsupported',
          error: 'Direct save cannot safely modify complex inline style expressions yet.',
        }
      }

      const propertyName = property.name.getText(node.getSourceFile()).replace(/^['"]|['"]$/g, '')
      styleAssignments.set(propertyName, property)
    }
  }

  for (const [propertyName, propertyValue] of styleEntries) {
    styleAssignments.set(propertyName, createStylePropertyAssignment(propertyName, propertyValue))
  }

  const styleObject = ts.factory.createObjectLiteralExpression(Array.from(styleAssignments.values()), true)
  const nextStyleAttribute = ts.factory.createJsxAttribute(
    ts.factory.createIdentifier('style'),
    ts.factory.createJsxExpression(undefined, styleObject),
  )

  const existingStyleIndex = nextProperties.findIndex(
    (property) => ts.isJsxAttribute(property) && getJsxAttributeNameText(property.name) === 'style',
  )

  if (existingStyleIndex >= 0) {
    nextProperties.splice(existingStyleIndex, 1, nextStyleAttribute)
  } else {
    nextProperties.push(nextStyleAttribute)
  }

  const nextAttributes = ts.factory.updateJsxAttributes(node.attributes, nextProperties)
  const nextNode = ts.isJsxOpeningElement(node)
    ? ts.factory.updateJsxOpeningElement(node, node.tagName, node.typeArguments, nextAttributes)
    : ts.factory.updateJsxSelfClosingElement(node, node.tagName, node.typeArguments, nextAttributes)

  return {
    ok: true,
    value: nextNode,
  }
}

function resolveSourceAttributeName(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  requestedAttributeName: string,
): string {
  if (requestedAttributeName !== 'className') {
    return requestedAttributeName
  }

  return getJsxAttribute(node, 'class') ? 'class' : 'className'
}

function buildUpdatedAttributeNode(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  pendingAttributes: DirectEditableAttributes,
): Result<ts.JsxOpeningElement | ts.JsxSelfClosingElement> {
  const attributeEntries = Object.entries(pendingAttributes).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )

  if (attributeEntries.length === 0) {
    return {
      ok: true,
      value: node,
    }
  }

  const nextProperties = [...node.attributes.properties]

  for (const [requestedAttributeName, nextValue] of attributeEntries) {
    const sourceAttributeName = resolveSourceAttributeName(node, requestedAttributeName)
    const existingIndex = nextProperties.findIndex(
      (property) => ts.isJsxAttribute(property) && getJsxAttributeNameText(property.name) === sourceAttributeName,
    )

    if (existingIndex >= 0) {
      const existingAttribute = nextProperties[existingIndex]
      if (!ts.isJsxAttribute(existingAttribute)) {
        return {
          ok: false,
          reason: 'unsupported',
          error: `Direct save cannot safely modify ${sourceAttributeName} when JSX spread attributes are involved.`,
        }
      }

      const currentLiteralValue = getSafeJsxAttributeLiteralValue(existingAttribute)
      if (!currentLiteralValue.ok) {
        return currentLiteralValue
      }

      if (currentLiteralValue.value === nextValue) {
        continue
      }

      if (nextValue.length === 0) {
        nextProperties.splice(existingIndex, 1)
        continue
      }

      nextProperties.splice(existingIndex, 1, createStringLiteralAttribute(sourceAttributeName, nextValue))
      continue
    }

    if (nextValue.length === 0) {
      continue
    }

    nextProperties.push(createStringLiteralAttribute(sourceAttributeName, nextValue))
  }

  const nextAttributes = ts.factory.updateJsxAttributes(node.attributes, nextProperties)
  const nextNode = ts.isJsxOpeningElement(node)
    ? ts.factory.updateJsxOpeningElement(node, node.tagName, node.typeArguments, nextAttributes)
    : ts.factory.updateJsxSelfClosingElement(node, node.tagName, node.typeArguments, nextAttributes)

  return {
    ok: true,
    value: nextNode,
  }
}

function buildTextReplacement(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  pendingTextChange: string | null,
): Result<{ end: number; start: number; text: string } | null> {
  if (pendingTextChange === null) {
    return {
      ok: true,
      value: null,
    }
  }

  if (!ts.isJsxOpeningElement(node) || !ts.isJsxElement(node.parent) || node.parent.openingElement !== node) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'Direct save currently supports text changes only for standard JSX elements.',
    }
  }

  const textChild = findSingleTextChild(node.parent)
  if (!textChild) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'Direct save can only update elements with a single plain text child right now.',
    }
  }

  return {
    ok: true,
    value: {
      start: textChild.getStart(node.getSourceFile()),
      end: textChild.getEnd(),
      text: pendingTextChange,
    },
  }
}

function applyReplacements(
  sourceText: string,
  replacements: Array<{ end: number; start: number; text: string }>,
): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce((current, replacement) => (
      `${current.slice(0, replacement.start)}${replacement.text}${current.slice(replacement.end)}`
    ), sourceText)
}

async function resolveSourceTarget(input: BuildDirectVisualEditInput): Promise<Result<VisualEditSourceTarget>> {
  const candidateFileReference = input.inspectedElement?.reactSource?.fileName ?? input.currentPageFilePath ?? null
  if (!candidateFileReference) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'No source file could be resolved for this preview selection.',
    }
  }

  const resolvedFilePath = await resolveProjectSourcePath(candidateFileReference, input.projectPath)
  if (!resolvedFilePath) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'Direct save could not map this selection back to a project source file.',
    }
  }

  if (!isSupportedSourceExtension(resolvedFilePath)) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'Direct save currently supports TSX, JSX, TS, and JS source files only.',
    }
  }

  return {
    ok: true,
    value: {
      filePath: resolvedFilePath,
      lineNumber: input.inspectedElement?.reactSource?.lineNumber ?? null,
      columnNumber: input.inspectedElement?.reactSource?.columnNumber ?? null,
    },
  }
}

async function resolveTargetMatch(
  input: BuildDirectVisualEditInput,
  sourceTarget: VisualEditSourceTarget,
): Promise<Result<VisualEditTargetMatch>> {
  const readResult = await window.electronAPI.project.readFile({
    projectPath: input.projectPath,
    filePath: sourceTarget.filePath,
  })

  if (!readResult.success || typeof readResult.content !== 'string') {
    return {
      ok: false,
      reason: 'error',
      error: readResult.error ?? 'Failed to read the source file for direct save.',
    }
  }

  const sourceText = readResult.content
  const sourceFile = ts.createSourceFile(
    sourceTarget.filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(sourceTarget.filePath),
  )

  const targetNode = chooseTargetNode(
    sourceFile,
    input.selectedElement,
    sourceTarget.lineNumber,
    sourceTarget.columnNumber,
  )

  if (!targetNode) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'Direct save could not confidently identify the matching JSX element in source.',
    }
  }

  return {
    ok: true,
    value: {
      sourceFile,
      sourceText,
      targetNode,
    },
  }
}

export async function buildDirectVisualEdit(
  input: BuildDirectVisualEditInput,
): Promise<BuildDirectVisualEditResult> {
  const sourceTargetResult = await resolveSourceTarget(input)
  if (!sourceTargetResult.ok) {
    return sourceTargetResult
  }

  const targetMatchResult = await resolveTargetMatch(input, sourceTargetResult.value)
  if (!targetMatchResult.ok) {
    return targetMatchResult
  }

  const { sourceFile, sourceText, targetNode } = targetMatchResult.value
  const updatedStyleNodeResult = buildUpdatedStyleNode(targetNode, input.pendingChanges)
  if (!updatedStyleNodeResult.ok) {
    return updatedStyleNodeResult
  }
  const updatedAttributeNodeResult = buildUpdatedAttributeNode(
    updatedStyleNodeResult.value,
    input.pendingAttributes,
  )
  if (!updatedAttributeNodeResult.ok) {
    return updatedAttributeNodeResult
  }

  const textReplacementResult = buildTextReplacement(targetNode, input.pendingTextChange)
  if (!textReplacementResult.ok) {
    return textReplacementResult
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  const replacements: Array<{ end: number; start: number; text: string }> = []

  const updatedOpeningNode = updatedAttributeNodeResult.value
  if (updatedOpeningNode !== targetNode) {
    replacements.push({
      start: targetNode.getStart(sourceFile),
      end: targetNode.getEnd(),
      text: printer.printNode(ts.EmitHint.Unspecified, updatedOpeningNode, sourceFile),
    })
  }

  if (textReplacementResult.value) {
    replacements.push(textReplacementResult.value)
  }

  if (replacements.length === 0) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'There are no direct source changes to save yet.',
    }
  }

  const updatedContent = applyReplacements(sourceText, replacements)
  if (updatedContent === sourceText) {
    return {
      ok: false,
      reason: 'unsupported',
      error: 'Direct save did not produce any source changes.',
    }
  }

  return {
    ok: true,
    value: {
      filePath: sourceTargetResult.value.filePath,
      content: updatedContent,
      summary: `Saved visual edits to ${sourceTargetResult.value.filePath}`,
    },
  }
}
