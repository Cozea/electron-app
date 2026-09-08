// Adapted from iFurySt/open-codex-computer-use, revision 41c5294cfe4735baca03f9c82b4de99d191a0b49.
// MIT; see native/computer-use-runtime/LICENSE.upstream.txt and docs/computer-use-v2.md.

@preconcurrency import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import CozeaComputerUseCore

final class ElementRecord {
    let index: Int
    let identifier: String?
    let element: AXUIElement?
    let localFrame: CGRect?
    let rawActions: [String]
    let prettyActions: [String]
    let isSyntheticText: Bool
    let fingerprint: AXElementFingerprint?

    init(
        index: Int,
        identifier: String?,
        element: AXUIElement?,
        localFrame: CGRect?,
        rawActions: [String],
        prettyActions: [String],
        isSyntheticText: Bool = false
    ) {
        self.index = index
        self.identifier = identifier
        self.element = element
        self.localFrame = localFrame
        self.rawActions = rawActions
        self.prettyActions = prettyActions
        self.isSyntheticText = isSyntheticText
        self.fingerprint = element.map(AXAccess.fingerprint)
    }
}

public struct AccessibilityTreeLimits: Equatable, Sendable {
    public static let defaultMaxNodeCount = 1200
    public static let defaultMaxDepth = 64
    public static let defaults = AccessibilityTreeLimits(
        maxNodeCount: defaultMaxNodeCount,
        maxDepth: defaultMaxDepth
    )

    public let maxNodeCount: Int
    public let maxDepth: Int

    public init(maxNodeCount: Int = defaultMaxNodeCount, maxDepth: Int = defaultMaxDepth) {
        self.maxNodeCount = maxNodeCount
        self.maxDepth = maxDepth
    }

    public func replacing(maxNodeCount: Int? = nil, maxDepth: Int? = nil) -> AccessibilityTreeLimits {
        AccessibilityTreeLimits(
            maxNodeCount: maxNodeCount ?? self.maxNodeCount,
            maxDepth: maxDepth ?? self.maxDepth
        )
    }
}

@usableFromInline
let defaultTextLimit = 500

public struct SnapshotTextLimit: Equatable, Sendable {
    public static let maxKeyword = "max"
    public static let defaults = SnapshotTextLimit(maxCount: defaultTextLimit)
    public static let max = SnapshotTextLimit(maxCount: nil)

    public let maxCount: Int?

    public init(maxCount: Int = defaultTextLimit) {
        precondition(maxCount > 0, "text limit must be positive")
        self.maxCount = maxCount
    }

    private init(maxCount: Int?) {
        self.maxCount = maxCount
    }
}

let accessibilityTreeMaxNodeCount = AccessibilityTreeLimits.defaultMaxNodeCount
let accessibilityTreeMaxDepth = AccessibilityTreeLimits.defaultMaxDepth
private let compactGenericActionTargetMaxWidth: CGFloat = 240
private let compactGenericActionTargetMaxHeight: CGFloat = 120
private let axWebAreaRole = "AXWebArea"
private let axContentsAttribute = "AXContents"
private let axVisibleChildrenAttribute = "AXVisibleChildren"

struct RenderContext {
    let cancellation: OperationCancellation
    let deadline: ContinuousClock.Instant
    let windowBounds: CGRect?
    let focusedElement: AXUIElement?
    let textLimit: SnapshotTextLimit
    let treeLimits: AccessibilityTreeLimits
}

struct TreeRenderer {
    var truncated = false
    var visitedCount = 0
    var renderedBytes = 0
    let context: RenderContext
    var nextIndex = 0
    var lines: [String] = []
    var records: [Int: ElementRecord] = [:]
    var identifierIndex: [String: String] = [:]
    var focusedSummary: String?

    init(context: RenderContext) {
        self.context = context
    }

    mutating func render(_ root: AXUIElement, depth: Int = 0, ancestors: [AXUIElement] = []) {
        guard !context.cancellation.isCancelled, ContinuousClock.now < context.deadline,
              renderedBytes < 512 * 1024, ancestors.count < 128, visitedCount < context.treeLimits.maxNodeCount * 4 else {
            truncated = true
            return
        }
        visitedCount += 1
        AXUIElementSetMessagingTimeout(root, 0.10)
        guard shouldContinueRendering(nextIndex: nextIndex, depth: depth, limits: context.treeLimits) else {
            truncated = true
            return
        }

        guard !ancestors.contains(where: { CFEqual($0, root) }) else {
            return
        }
        let nextAncestors = ancestors + [root]

        let index = nextIndex

        let role = stringValue(of: root, attribute: kAXRoleAttribute) ?? "AXUnknown"
        let subrole = stringValue(of: root, attribute: kAXSubroleAttribute)
        let baseRoleText = roleDescription(of: root, role: role, subrole: subrole)
        let label = stringValue(of: root, attribute: kAXDescriptionAttribute)
            .map { sanitizeText($0, textLimit: context.textLimit) }
        let help = stringValue(of: root, attribute: kAXHelpAttribute)
            .map { sanitizeText($0, textLimit: context.textLimit) }
        let value = subrole == "AXSecureTextField" ? nil : sanitizedValue(of: root, textLimit: context.textLimit)
        let axIdentifier = displayIdentifier(stringValue(of: root, attribute: kAXIdentifierAttribute))
        let traits = summarizeTraits(of: root)
        let actions = copyActions(root) ?? []
        let exposesPrimaryClickAction = hasPrimaryClickAction(actions)
        let prettyActions = meaningfulActions(actions, role: role)
        let placeholder = placeholderValue(of: root, textLimit: context.textLimit)
        let webAreaDepth = webAreaDepth(role: role, ancestors: ancestors)
        let localFrame = resolveLocalFrame(of: root, windowBounds: context.windowBounds)
        let rowTexts = role == kAXRowRole as String ? flattenedRowTexts(of: root, textLimit: context.textLimit) : []
        let childElements = children(of: root)
        let hasActionableLinkDescendant =
            (role == kAXGroupRole as String || role == kAXUnknownRole as String)
            && exposesPrimaryClickAction
            && containsActionableLinkDescendant(
                in: childElements,
                textLimit: context.textLimit
            )
        let rendersCompactGenericActionTarget = shouldRenderCompactGenericActionTarget(
            role: role,
            hasPrimaryClickAction: exposesPrimaryClickAction,
            localFrame: localFrame,
            hasActionableLinkDescendant: hasActionableLinkDescendant
        )
        let genericTextSummary: String?
        if hasActionableLinkDescendant {
            genericTextSummary = nil
        } else {
            genericTextSummary = summarizedGenericText(
                of: root,
                role: role,
                childElements: childElements,
                textLimit: context.textLimit,
                minimumTextCount: rendersCompactGenericActionTarget ? 1 : 2
            )
        }
        let summaryImageChildren = genericTextSummary == nil ? [] : summaryImageDescendants(of: root)
        let rendersSummaryAsChildren = !rendersCompactGenericActionTarget
            && shouldRenderGenericTextSummaryAsChildren(
                genericTextSummary,
                summaryImageCount: summaryImageChildren.count
            )
        let title = preferredDisplayTitle(
            for: root,
            role: role,
            label: label,
            identifier: axIdentifier,
            explicitValue: value,
            rowTexts: rowTexts,
            textLimit: context.textLimit
        )
        let linkText = role == "AXLink" ? markdownLinkText(for: root, title: title, label: label, value: value, textLimit: context.textLimit) : nil
        let displayTitle = linkText ?? title
        let inlineRowSummary = outlineRowSummary(for: root, role: role)
        let hidesChildren = shouldSuppressChildren(
            role: role,
            title: displayTitle,
            label: label,
            help: help,
            value: value,
            identifier: axIdentifier,
            traits: traits,
            actions: prettyActions,
            children: childElements,
            genericTextSummary: genericTextSummary
        )
        let roleText = displayRoleText(
            baseRoleText: baseRoleText,
            role: role,
            title: displayTitle,
            label: label,
            suppressChildren: hidesChildren
        )

        if shouldElideNode(
            role: role,
            title: displayTitle,
            label: label,
            value: value,
            identifier: axIdentifier,
            traits: traits,
            actions: prettyActions,
            childCount: childElements.count,
            genericTextSummary: genericTextSummary,
            webAreaDepth: webAreaDepth,
            preservesCompactGenericActionTarget: rendersCompactGenericActionTarget
        ) {
            for child in childElements {
                render(child, depth: depth, ancestors: nextAncestors)
            }
            return
        }

        nextIndex += 1

        let traitsSegment = traits.isEmpty ? "" : " (\(traits.joined(separator: ", ")))"
        let titleSegment = displayTitle.map { " \($0)" } ?? ""
        let rowSummary = inlineRowSummary ?? (rendersSummaryAsChildren ? nil : genericTextSummary)
        let rowSummarySegment = rowSummary.map { " \($0)" } ?? ""
        let labelSegment = formattedLabelSegment(label, title: displayTitle, linkText: linkText, textLimit: context.textLimit)
        let helpSegment = {
            guard let help else {
                return ""
            }
            if help == displayTitle || help == label {
                return ""
            }
            return " Help: \(help)"
        }()
        let urlSegment = formattedURLSegment(for: root, title: displayTitle, label: label, textLimit: context.textLimit)
        let identifierSegment = displayIdentifierSegment(for: root, role: role, identifier: axIdentifier, title: displayTitle)
        let rawValueSegment = formattedValueSegment(for: root, roleText: roleText, title: displayTitle, value: value)
        let valueSegment = formattedValueSegmentWithSeparator(
            rawValueSegment,
            precedingSegments: [labelSegment, helpSegment, urlSegment, identifierSegment]
        )
        let placeholderSegment = formattedPlaceholderSegment(
            placeholder,
            title: displayTitle,
            label: label,
            value: value,
            precedingSegments: [labelSegment, helpSegment, urlSegment, identifierSegment, valueSegment]
        )
        let frameSegment = rendersCompactGenericActionTarget
            ? localFrame.map { " Frame: \($0.renderedLocalFrame)" } ?? ""
            : ""
        let actionsPrefix = shouldCommaSeparateActions(
            title: displayTitle,
            inlineRowSummary: inlineRowSummary,
            genericTextSummary: genericTextSummary,
            segments: [labelSegment, helpSegment, urlSegment, identifierSegment, valueSegment, placeholderSegment]
        ) ? ", Secondary Actions: " : " Secondary Actions: "
        let actionsSegment = prettyActions.isEmpty ? "" : "\(actionsPrefix)\(prettyActions.joined(separator: ", "))"
        let renderedRoleText = rendersCompactGenericActionTarget ? "button" : roleText
        let linePrefix = renderedRoleText.isEmpty ? "\(index)" : "\(index) \(renderedRoleText)"

        let lineBody = "\(linePrefix)\(traitsSegment)\(titleSegment)\(rowSummarySegment)\(labelSegment)\(helpSegment)\(urlSegment)\(identifierSegment)\(valueSegment)\(placeholderSegment)\(frameSegment)"
        appendLine("\(String(repeating: "\t", count: depth))\(lineBody)\(actionsSegment)")

        let record = ElementRecord(
            index: index,
            identifier: axIdentifier,
            element: root,
            localFrame: localFrame,
            rawActions: actions,
            prettyActions: prettyActions
        )
        records[index] = record

        if let axIdentifier, let localFrame {
            identifierIndex[axIdentifier] = "\(axIdentifier) -> \(index) @ \(localFrame.renderedLocalFrame)"
        }

        if let focusedElement = context.focusedElement, CFEqual(focusedElement, root) {
            focusedSummary = lineBody
        }

        if role == kAXRowRole as String, boolValue(of: root, attribute: kAXSelectedAttribute) != true {
            for text in Array(rowTexts.dropFirst()) {
                appendLine(text)
            }
            return
        }

        if rendersSummaryAsChildren, let genericTextSummary {
            renderSyntheticText(genericTextSummary, representedBy: root, depth: depth + 1)
            for image in summaryImageChildren {
                render(image, depth: depth + 1, ancestors: nextAncestors)
            }
            return
        }

        if hidesChildren {
            return
        }

        for child in childElements {
            render(child, depth: depth + 1, ancestors: nextAncestors)
        }
    }

    private mutating func renderSyntheticText(_ text: String, representedBy element: AXUIElement, depth: Int) {
        guard shouldContinueRendering(nextIndex: nextIndex, depth: depth, limits: context.treeLimits) else {
            truncated = true
            return
        }

        let index = nextIndex
        nextIndex += 1
        appendLine("\(String(repeating: "\t", count: depth))\(index) text \(text)")

        records[index] = ElementRecord(
            index: index,
            identifier: nil,
            element: element,
            localFrame: resolveLocalFrame(of: element, windowBounds: context.windowBounds),
            rawActions: [],
            prettyActions: [],
            isSyntheticText: true
        )
    }

    private func opaqueIdentifier(for element: AXUIElement) -> String {
        String(CFHash(element))
    }

    private func webAreaDepth(role: String, ancestors: [AXUIElement]) -> Int? {
        if role == axWebAreaRole {
            return 0
        }

        guard let webAreaIndex = ancestors.firstIndex(where: { ancestor in
            stringValue(of: ancestor, attribute: kAXRoleAttribute) == axWebAreaRole
        }) else {
            return nil
        }

        return ancestors.count - webAreaIndex
    }

    private mutating func appendLine(_ line: String) {
        let remaining = max(0, 512 * 1024 - renderedBytes)
        guard remaining > 0 else { truncated = true; return }
        let bounded = String(line.prefix(min(remaining / 4, 32_768)))
        renderedBytes += bounded.utf8.count
        if bounded.count < line.count { truncated = true }
        lines.append(bounded)
    }

    private func children(of element: AXUIElement) -> [AXUIElement] {
        let role = stringValue(of: element, attribute: kAXRoleAttribute)
        let rows = copyArray(element, attribute: kAXRowsAttribute) ?? []
        let visibleChildren = copyArray(element, attribute: axVisibleChildrenAttribute) ?? []
        let attributes = childTraversalAttributes(
            role: role,
            hasRows: !rows.isEmpty,
            hasVisibleChildren: !visibleChildren.isEmpty
        )
        var children: [AXUIElement] = []

        for attribute in attributes {
            let sourceValues: [AXUIElement]
            if attribute == kAXRowsAttribute {
                sourceValues = rows
            } else if attribute == axVisibleChildrenAttribute {
                sourceValues = visibleChildren
            } else {
                sourceValues = copyArray(element, attribute: attribute) ?? []
            }

            let values = attribute == kAXRowsAttribute ? visibleRows(in: sourceValues, parent: element) : sourceValues

            for child in values {
                if shouldSkipChild(child, of: element) {
                    continue
                }

                if !children.contains(where: { CFEqual($0, child) }) {
                    children.append(child)
                }
            }
        }

        return children
    }

    private func containsActionableLinkDescendant(
        in elements: [AXUIElement],
        textLimit: SnapshotTextLimit,
        ancestors: [AXUIElement] = [],
        depth: Int = 0
    ) -> Bool {
        guard depth < 8 else {
            return false
        }

        for element in elements {
            guard !ancestors.contains(where: { CFEqual($0, element) }) else {
                continue
            }

            let role = stringValue(of: element, attribute: kAXRoleAttribute) ?? ""
            if role == "AXLink",
               let url = urlValue(of: element, attribute: kAXURLAttribute, textLimit: textLimit),
               !url.isEmpty
            {
                return true
            }

            if containsActionableLinkDescendant(
                in: children(of: element),
                textLimit: textLimit,
                ancestors: ancestors + [element],
                depth: depth + 1
            ) {
                return true
            }
        }

        return false
    }
}

func childTraversalAttributes(role: String?, hasRows: Bool, hasVisibleChildren: Bool) -> [String] {
    var attributes: [String] = []
    if !(hasRows && usesRowsAsPrimaryRole(role)) && !(hasVisibleChildren && usesVisibleChildrenAsPrimaryRole(role)) {
        attributes.append(kAXChildrenAttribute)
    }
    attributes.append(kAXRowsAttribute)
    attributes.append(axContentsAttribute)
    attributes.append(axVisibleChildrenAttribute)
    return attributes
}

private func usesRowsAsPrimaryRole(_ role: String?) -> Bool {
    return [
        kAXOutlineRole as String,
        kAXListRole as String,
        kAXTableRole as String,
        "AXBrowser",
    ].contains(role)
}

private func usesVisibleChildrenAsPrimaryRole(_ role: String?) -> Bool {
    role == kAXListRole as String
}

private func shouldSkipChild(_ child: AXUIElement, of parent: AXUIElement) -> Bool {
    let parentRole = stringValue(of: parent, attribute: kAXRoleAttribute)
    guard parentRole == kAXMenuBarRole as String else {
        return false
    }

    return stringValue(of: child, attribute: kAXTitleAttribute) == "Apple"
}

func shouldContinueRendering(
    nextIndex: Int,
    depth: Int,
    limits: AccessibilityTreeLimits = .defaults
) -> Bool {
    nextIndex < limits.maxNodeCount && depth < limits.maxDepth
}

private func summarizeTraits(of element: AXUIElement) -> [String] {
    var values: [String] = []

    if boolValue(of: element, attribute: kAXSelectedAttribute) == true {
        values.append("selected")
    }

    if boolValue(of: element, attribute: kAXExpandedAttribute) == true {
        values.append("expanded")
    }

    if boolValue(of: element, attribute: kAXEnabledAttribute) == false {
        values.append("disabled")
    }

    if isSettable(of: element, attribute: kAXValueAttribute) {
        values.append("settable")
    }

    if let valueType = valueTypeTrait(of: element) {
        values.append(valueType)
    }

    return values
}

private func valueTypeTrait(of element: AXUIElement) -> String? {
    guard isSettable(of: element, attribute: kAXValueAttribute) else {
        return nil
    }

    guard let value = attributeValue(of: element, attribute: kAXValueAttribute) else {
        return nil
    }

    if CFGetTypeID(value) == CFStringGetTypeID() {
        return "string"
    }

    if value is NSNumber {
        if numericValueRepresentsBoolean(for: element, value: value) {
            return "boolean"
        }

        return "float"
    }

    return nil
}

private func copyElement(_ element: AXUIElement, attribute: String) -> AXUIElement? {
    AXAccess.element(element, attribute)
}

private func copyArray(_ element: AXUIElement, attribute: String) -> [AXUIElement]? {
    AXAccess.value(element, attribute) as? [AXUIElement]
}

private func copyActions(_ element: AXUIElement) -> [String]? {
    AXAccess.actions(element)
}

private func attributeValue(of element: AXUIElement, attribute: String) -> CFTypeRef? {
    AXAccess.value(element, attribute)
}

private func stringValue(of element: AXUIElement, attribute: String) -> String? {
    guard let value = attributeValue(of: element, attribute: attribute) else {
        return nil
    }

    if CFGetTypeID(value) == CFStringGetTypeID() {
        guard let string = value as? String else {
            return nil
        }

        return string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : string
    }

    return nil
}

private func copySelectedText(_ element: AXUIElement, textLimit: SnapshotTextLimit = .defaults) -> String? {
    guard let value = stringValue(of: element, attribute: kAXSelectedTextAttribute) else {
        return nil
    }

    let sanitized = sanitizeText(value, textLimit: textLimit)
    return sanitized.isEmpty ? nil : sanitized
}

private func boolValue(of element: AXUIElement, attribute: String) -> Bool? {
    guard let value = attributeValue(of: element, attribute: attribute) else {
        return nil
    }

    return value as? Bool
}

private func pid(of element: AXUIElement) -> pid_t {
    var processIdentifier: pid_t = 0
    AXUIElementGetPid(element, &processIdentifier)
    return processIdentifier
}

private func isSettable(of element: AXUIElement, attribute: String) -> Bool {
    AXAccess.settable(element, attribute)
}

private func sanitizedValue(of element: AXUIElement, textLimit: SnapshotTextLimit = .defaults) -> String? {
    if let string = stringValue(of: element, attribute: kAXValueAttribute) {
        let sanitized = sanitizeText(string, textLimit: textLimit)
        return sanitized.isEmpty ? nil : sanitized
    }

    guard let value = attributeValue(of: element, attribute: kAXValueAttribute) else {
        return nil
    }

    if let number = value as? NSNumber {
        if numericValueRepresentsBoolean(for: element, value: value) {
            return number.boolValue ? "on" : "off"
        }

        return number.stringValue
    }

    return nil
}

private func placeholderValue(of element: AXUIElement, textLimit: SnapshotTextLimit = .defaults) -> String? {
    for attribute in ["AXPlaceholderValue", "AXPlaceholder"] {
        if let string = stringValue(of: element, attribute: attribute) {
            let sanitized = sanitizeText(string, textLimit: textLimit)
            if !sanitized.isEmpty {
                return sanitized
            }
        }
    }

    return nil
}

private func numericValueRepresentsBoolean(for element: AXUIElement, value: CFTypeRef) -> Bool {
    guard let number = value as? NSNumber else {
        return false
    }

    guard number == 0 || number == 1 else {
        return false
    }

    let role = stringValue(of: element, attribute: kAXRoleAttribute) ?? ""
    let roleText = roleDescription(
        of: element,
        role: role,
        subrole: stringValue(of: element, attribute: kAXSubroleAttribute)
    )

    return roleText == "tab"
        || role == kAXCheckBoxRole as String
        || role == kAXRadioButtonRole as String
}

private func preferredDisplayTitle(
    for element: AXUIElement,
    role: String,
    label: String?,
    identifier: String?,
    explicitValue: String?,
    rowTexts: [String],
    textLimit: SnapshotTextLimit = .defaults
) -> String? {
    if let title = stringValue(of: element, attribute: kAXTitleAttribute), !title.isEmpty {
        return sanitizeText(title, textLimit: textLimit)
    }

    if role == kAXRowRole as String {
        return rowTexts.first
    }

    if (role == kAXOutlineRole as String || role == kAXListRole as String), let identifier {
        return identifier
    }

    if (role == kAXButtonRole as String || role == kAXPopUpButtonRole as String), let label, !label.isEmpty {
        return sanitizeText(label, textLimit: textLimit)
    }

    if role == kAXImageRole as String, let label, !label.isEmpty {
        return sanitizeText(label, textLimit: textLimit)
    }

    if (role == kAXGroupRole as String || role == kAXUnknownRole as String || role == "AXWebArea"),
       let label,
       !label.isEmpty
    {
        return sanitizeText(label, textLimit: textLimit)
    }

    guard roleDescription(of: element, role: role, subrole: stringValue(of: element, attribute: kAXSubroleAttribute)) == "search text field" else {
        return nil
    }

    return explicitValue
}

private func markdownLinkText(
    for element: AXUIElement,
    title: String?,
    label: String?,
    value: String?,
    textLimit: SnapshotTextLimit = .defaults
) -> String? {
    guard let url = urlValue(of: element, attribute: kAXURLAttribute, textLimit: textLimit), !url.isEmpty else {
        return nil
    }

    let text = [label, title, value]
        .compactMap { candidate -> String? in
            guard let candidate else {
                return nil
            }
            let sanitized = sanitizeText(candidate, textLimit: textLimit)
            return sanitized.isEmpty ? nil : sanitized
        }
        .first

    guard let text else {
        return nil
    }

    return "[\(markdownEscapedLinkText(text))](\(url))"
}

private func markdownEscapedLinkText(_ text: String) -> String {
    text
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "[", with: "\\[")
        .replacingOccurrences(of: "]", with: "\\]")
}

private func outlineRowSummary(for element: AXUIElement, role: String) -> String? {
    guard role == kAXOutlineRole as String || role == kAXListRole as String else {
        return nil
    }

    guard let allRows = copyArray(element, attribute: kAXRowsAttribute), !allRows.isEmpty else {
        return nil
    }

    let visibleRows = visibleRows(in: allRows, parent: element)
    guard !visibleRows.isEmpty, visibleRows.count < allRows.count else {
        return nil
    }

    return "(showing 0-\(visibleRows.count - 1) of \(allRows.count) items)"
}

private func formattedValueSegment(for element: AXUIElement, roleText: String, title: String?, value: String?) -> String {
    guard let value, !value.isEmpty else {
        return ""
    }

    if roleText == "search text field", title == value {
        return ""
    }

    if title == nil, let role = stringValue(of: element, attribute: kAXRoleAttribute), role == kAXStaticTextRole as String {
        return " \(value)"
    }

    if ["scroll bar", "value indicator"].contains(roleText) {
        return " \(value)"
    }

    if roleText == "text entry area" {
        return " \(value)"
    }

    return " Value: \(value)"
}

func formattedLabelSegment(
    _ label: String?,
    title: String?,
    linkText: String?,
    textLimit: SnapshotTextLimit = .defaults
) -> String {
    guard let label, label != title else {
        return ""
    }

    let sanitizedLabel = sanitizeText(label, textLimit: textLimit)
    guard !sanitizedLabel.isEmpty, sanitizedLabel != title else {
        return ""
    }

    let comparableLabel = markdownEscapedLinkText(sanitizedLabel)
    if let linkText, linkText.hasPrefix("[\(comparableLabel)](") {
        return ""
    }

    return " Description: \(sanitizedLabel)"
}

private func formattedValueSegmentWithSeparator(_ valueSegment: String, precedingSegments: [String]) -> String {
    guard valueSegment.hasPrefix(" Value:"), precedingSegments.contains(where: { !$0.isEmpty }) else {
        return valueSegment
    }

    return ",\(valueSegment)"
}

func formattedPlaceholderSegment(_ placeholder: String?, title: String?, label: String?, value: String?, precedingSegments: [String]) -> String {
    guard let placeholder, !placeholder.isEmpty else {
        return ""
    }

    if placeholder == title || placeholder == label || placeholder == value {
        return ""
    }

    let prefix = precedingSegments.contains(where: { !$0.isEmpty }) || title != nil ? ", Placeholder: " : " Placeholder: "
    return "\(prefix)\(placeholder)"
}

private func shouldCommaSeparateActions(
    title: String?,
    inlineRowSummary: String?,
    genericTextSummary: String?,
    segments: [String]
) -> Bool {
    title != nil
        || inlineRowSummary != nil
        || genericTextSummary != nil
        || segments.contains(where: { !$0.isEmpty })
}

private func formattedURLSegment(
    for element: AXUIElement,
    title: String?,
    label: String?,
    textLimit: SnapshotTextLimit = .defaults
) -> String {
    guard stringValue(of: element, attribute: kAXRoleAttribute) == "AXWebArea" else {
        return ""
    }

    guard let url = urlValue(of: element, attribute: kAXURLAttribute, textLimit: textLimit), !url.isEmpty else {
        return ""
    }

    if url == title || url == label {
        return ""
    }

    return ", URL: \(url)"
}

private func urlValue(
    of element: AXUIElement,
    attribute: String,
    textLimit: SnapshotTextLimit = .defaults
) -> String? {
    guard let value = attributeValue(of: element, attribute: attribute) else {
        return nil
    }

    if CFGetTypeID(value) == CFStringGetTypeID(), let string = value as? String {
        let sanitized = sanitizeText(string, textLimit: textLimit)
        return sanitized.isEmpty ? nil : sanitized
    }

    if CFGetTypeID(value) == CFURLGetTypeID(), let url = value as? URL {
        let sanitized = sanitizeText(url.absoluteString, textLimit: textLimit)
        return sanitized.isEmpty ? nil : sanitized
    }

    return nil
}

private func displayIdentifierSegment(for element: AXUIElement, role: String, identifier: String?, title: String?) -> String {
    guard let identifier else {
        return ""
    }

    if (role == kAXOutlineRole as String || role == kAXListRole as String), title == identifier {
        return ""
    }

    return " ID: \(identifier)"
}

private func resolveLocalFrame(of element: AXUIElement, windowBounds: CGRect?) -> CGRect? {
    guard
        let positionValue = AXAccess.value(element, kAXPositionAttribute),
        let sizeValue = AXAccess.value(element, kAXSizeAttribute)
    else {
        return nil
    }

    guard CFGetTypeID(positionValue) == AXValueGetTypeID(), CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
    let positionAXValue = positionValue as! AXValue
    let sizeAXValue = sizeValue as! AXValue
    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionAXValue, .cgPoint, &position), AXValueGetValue(sizeAXValue, .cgSize, &size) else {
        return nil
    }

    let frame = CGRect(origin: position, size: size)

    guard let windowBounds else {
        return frame
    }

    return windowRelativeFrame(elementFrame: frame, windowBounds: windowBounds)
}

func shouldElideNode(
    role: String,
    title: String?,
    label: String?,
    value: String?,
    identifier: String?,
    traits: [String],
    actions: [String],
    childCount: Int,
    genericTextSummary: String? = nil,
    webAreaDepth: Int? = nil,
    preservesCompactGenericActionTarget: Bool = false
) -> Bool {
    let genericRoles = [kAXGroupRole as String, kAXUnknownRole as String]
    guard genericRoles.contains(role) else {
        return false
    }

    if preservesCompactGenericActionTarget {
        return false
    }

    if genericTextSummary != nil {
        return false
    }

    if shouldPreserveWebAreaGenericContainer(childCount: childCount, webAreaDepth: webAreaDepth) {
        return false
    }

    if childCount == 1,
       title == nil,
       label == nil,
       value == nil,
       identifier == nil,
       actions.isEmpty,
       traitsAreNonDescriptiveWrapperTraits(traits)
    {
        return true
    }

    return title == nil
        && label == nil
        && value == nil
        && identifier == nil
        && traits.isEmpty
        && actions.isEmpty
}

func shouldPreserveWebAreaGenericContainer(childCount: Int, webAreaDepth: Int?) -> Bool {
    guard childCount > 0, webAreaDepth != nil else {
        return false
    }

    return childCount > 1
}

private func traitsAreNonDescriptiveWrapperTraits(_ traits: [String]) -> Bool {
    traits.isEmpty || traits == ["settable", "string"]
}

func hasPrimaryClickAction(_ actions: [String]) -> Bool {
    let primaryActions = [
        kAXPressAction as String,
        kAXConfirmAction as String,
        "AXOpen",
    ]

    return actions.contains { action in
        primaryActions.contains { $0.caseInsensitiveCompare(action) == .orderedSame }
    }
}

func shouldRenderCompactGenericActionTarget(
    role: String,
    hasPrimaryClickAction: Bool,
    localFrame: CGRect?,
    hasActionableLinkDescendant: Bool = false
) -> Bool {
    guard hasPrimaryClickAction else {
        return false
    }

    // A URL-bearing AXLink is the navigation target. Do not hide it behind a
    // generic action wrapper that happens to expose AXPress as well.
    guard !hasActionableLinkDescendant else {
        return false
    }

    guard role == kAXGroupRole as String || role == kAXUnknownRole as String else {
        return false
    }

    guard let localFrame,
          localFrame.width > 0,
          localFrame.height > 0,
          localFrame.width <= compactGenericActionTargetMaxWidth,
          localFrame.height <= compactGenericActionTargetMaxHeight
    else {
        return false
    }

    return true
}

private func shouldSuppressChildren(
    role: String,
    title: String?,
    label: String?,
    help: String?,
    value: String?,
    identifier: String?,
    traits: [String],
    actions: [String],
    children: [AXUIElement],
    genericTextSummary: String?
) -> Bool {
    if role == kAXMenuBarItemRole as String {
        return true
    }

    if role == "AXLink", title?.hasPrefix("[") == true {
        return true
    }

    return genericTextSummary != nil
}

private func summarizedGenericText(
    of element: AXUIElement,
    role: String,
    childElements: [AXUIElement],
    textLimit: SnapshotTextLimit = .defaults,
    minimumTextCount: Int = 2
) -> String? {
    guard role == kAXGroupRole as String || role == kAXUnknownRole as String else {
        return nil
    }

    guard !childElements.isEmpty else {
        return nil
    }

    guard isPlainGenericTextContainer(element, children: childElements) else {
        return nil
    }

    let texts = descendantTextsForSummary(of: element, textLimit: textLimit)
    guard texts.count >= minimumTextCount else {
        return nil
    }

    guard shouldMergeTextOnlySiblings(texts) else {
        return nil
    }

    let joined = sanitizeText(texts.joined(separator: " "), textLimit: textLimit)
        .replacingOccurrences(of: " : ", with: " :  ")
    return joined.isEmpty ? nil : joined
}

private func summaryImageDescendants(of element: AXUIElement, depth: Int = 0) -> [AXUIElement] {
    guard depth < 4 else {
        return []
    }

    let children = copyArray(element, attribute: kAXChildrenAttribute) ?? []
    var images: [AXUIElement] = []

    for child in children {
        let role = stringValue(of: child, attribute: kAXRoleAttribute) ?? ""
        if role == kAXImageRole as String {
            if !images.contains(where: { CFEqual($0, child) }) {
                images.append(child)
            }
        } else {
            for image in summaryImageDescendants(of: child, depth: depth + 1) {
                if !images.contains(where: { CFEqual($0, image) }) {
                    images.append(image)
                }
            }
        }

        if images.count >= 4 {
            return Array(images.prefix(4))
        }
    }

    return images
}

func shouldRenderGenericTextSummaryAsChildren(_ genericTextSummary: String?, summaryImageCount: Int) -> Bool {
    genericTextSummary != nil && summaryImageCount > 0
}

func shouldMergeTextOnlySiblings(_ texts: [String]) -> Bool {
    if texts.contains("日期") && texts.contains("时间") {
        return false
    }

    if texts.contains(where: isSiblingCounterText(_:)) {
        return false
    }

    if texts.contains(where: isStandaloneTimeRangeText(_:)) {
        return false
    }

    let totalLength = texts.reduce(0) { $0 + $1.count }
    return texts.count <= 8 && totalLength <= 220
}

private func isSiblingCounterText(_ text: String) -> Bool {
    text.range(of: #"^\d+\s*/\s*\d+$"#, options: .regularExpression) != nil
}

private func isStandaloneTimeRangeText(_ text: String) -> Bool {
    text.range(of: #"^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$"#, options: .regularExpression) != nil
}

private func isPlainGenericTextContainer(_ element: AXUIElement, children: [AXUIElement], depth: Int = 0) -> Bool {
    for child in children {
        let childRole = stringValue(of: child, attribute: kAXRoleAttribute) ?? ""

        if childRole == kAXStaticTextRole as String || childRole == kAXImageRole as String {
            continue
        }

        if childRole == "AXLink", summaryTextForLink(child) != nil {
            continue
        }

        if childRole == kAXGroupRole as String || childRole == kAXUnknownRole as String {
            // Crossing this boundary would collapse the actionable child into its parent's text summary.
            if isGenericPrimaryActionSummaryBoundary(
                role: childRole,
                actions: copyActions(child) ?? []
            ) {
                return false
            }

            guard depth < 3 else {
                return false
            }

            if isPlainGenericTextContainer(child, children: copyArray(child, attribute: kAXChildrenAttribute) ?? [], depth: depth + 1) {
                continue
            }
        }

        return false
    }

    return true
}

func isGenericPrimaryActionSummaryBoundary(role: String, actions: [String]) -> Bool {
    let genericRoles = [kAXGroupRole as String, kAXUnknownRole as String]
    return genericRoles.contains(role) && hasPrimaryClickAction(actions)
}

func displayRoleText(
    baseRoleText: String,
    role: String,
    title: String?,
    label: String?,
    suppressChildren: Bool
) -> String {
    if role == kAXMenuBarItemRole as String {
        return ""
    }

    if role == "AXLink" {
        return baseRoleText
    }

    if suppressChildren {
        return "container"
    }

    if baseRoleText == "radio group", role == kAXRadioGroupRole as String, title == nil, label != nil {
        return ""
    }

    return baseRoleText
}

func windowRelativeFrame(elementFrame: CGRect, windowBounds: CGRect) -> CGRect {
    CGRect(
        x: elementFrame.minX - windowBounds.minX,
        y: elementFrame.minY - windowBounds.minY,
        width: elementFrame.width,
        height: elementFrame.height
    )
}

private func roleDescription(of element: AXUIElement, role: String, subrole: String?) -> String {
    if role == kAXRowRole as String {
        return "row"
    }

    if role == kAXGroupRole as String {
        return "container"
    }

    if role == kAXMenuBarItemRole as String {
        return ""
    }

    if role == "AXLink" {
        return "link"
    }

    if role == "AXWebArea" {
        return stringValue(of: element, attribute: kAXRoleDescriptionAttribute) ?? "HTML 内容"
    }

    if let roleDescription = stringValue(of: element, attribute: kAXRoleDescriptionAttribute), !roleDescription.isEmpty {
        return roleDescription.lowercased()
    }

    if let subrole, subrole == kAXStandardWindowSubrole as String {
        return "standard window"
    }

    return humanizeAXToken(role)
}

func meaningfulActions(_ values: [String], role: String) -> [String] {
    values
        .filter {
            var ignored = [
                kAXPressAction as String,
                "AXShowDefaultUI",
                "AXShowAlternateUI",
                "AXShowMenu",
                "AXConfirm",
                "AXScrollToVisible",
            ]

            if [
                kAXMenuBarRole as String,
                kAXMenuBarItemRole as String,
                kAXMenuRole as String,
                kAXMenuItemRole as String,
            ].contains(role) {
                ignored.append(contentsOf: ["AXCancel", "AXPick"])
            }

            return !ignored.contains($0)
        }
        .filter {
            guard role == kAXScrollAreaRole as String else {
                return true
            }

            if values.contains("AXScrollUpByPage") || values.contains("AXScrollDownByPage") {
                return $0 != "AXScrollLeftByPage" && $0 != "AXScrollRightByPage"
            }

            return true
        }
        .map(prettyActionName(_:))
}

private func prettyActionName(_ value: String) -> String {
    if value == "AXZoomWindow" {
        return "zoom the window"
    }

    let stripped = value.hasPrefix("AX") ? String(value.dropFirst(2)) : value
    let withoutPage = stripped.replacingOccurrences(of: "ByPage", with: "")
    return splitCamelCase(withoutPage)
}

private func humanizeAXToken(_ value: String) -> String {
    let stripped = value.hasPrefix("AX") ? String(value.dropFirst(2)) : value
    return splitCamelCase(stripped).lowercased()
}

private func splitCamelCase(_ value: String) -> String {
    var result = ""
    for character in value {
        if character.isUppercase, !result.isEmpty {
            result.append(" ")
        }
        result.append(character)
    }
    return result
}

func sanitizeText(_ value: String, textLimit: SnapshotTextLimit = .defaults) -> String {
    let boundedValue = String(value.prefix(32_768))
    let collapsed = boundedValue
        .replacingOccurrences(of: "\n", with: "\\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    if let maxCount = textLimit.maxCount, collapsed.count > maxCount {
        return String(collapsed.prefix(maxCount)) + "..."
    }

    return collapsed
}

private func flattenedRowTexts(
    of element: AXUIElement,
    textLimit: SnapshotTextLimit = .defaults
) -> [String] {
    let cells = copyArray(element, attribute: kAXChildrenAttribute) ?? []
    let texts = cells
        .flatMap { descendantTexts(of: $0, textLimit: textLimit) }
        .map { sanitizeText($0, textLimit: textLimit) }
        .filter { !$0.isEmpty }

    var unique: [String] = []
    var seen: Set<String> = []
    for text in texts {
        if seen.insert(text).inserted {
            unique.append(text)
        }
    }

    return unique
}

private func descendantTexts(
    of element: AXUIElement,
    depth: Int = 0,
    textLimit: SnapshotTextLimit = .defaults
) -> [String] {
    guard depth < 4 else {
        return []
    }

    var values: [String] = []
    let role = stringValue(of: element, attribute: kAXRoleAttribute) ?? ""
    if role == kAXStaticTextRole as String || role == kAXTextFieldRole as String {
        if let value = sanitizedValue(of: element, textLimit: textLimit) {
            values.append(value)
        } else if let title = stringValue(of: element, attribute: kAXTitleAttribute) {
            values.append(sanitizeText(title, textLimit: textLimit))
        }
    }

    for child in copyArray(element, attribute: kAXChildrenAttribute) ?? [] {
        values.append(contentsOf: descendantTexts(of: child, depth: depth + 1, textLimit: textLimit))
    }

    return values
}

private func descendantTextsForSummary(
    of element: AXUIElement,
    depth: Int = 0,
    textLimit: SnapshotTextLimit = .defaults
) -> [String] {
    guard depth < 8 else {
        return []
    }

    let role = stringValue(of: element, attribute: kAXRoleAttribute) ?? ""
    if role == "AXLink", let linkText = summaryTextForLink(element, textLimit: textLimit) {
        return [linkText]
    }

    if role == kAXStaticTextRole as String || role == kAXTextFieldRole as String {
        if let value = sanitizedValue(of: element, textLimit: textLimit), !value.isEmpty {
            return [value]
        }

        if let title = stringValue(of: element, attribute: kAXTitleAttribute) {
            let sanitized = sanitizeText(title, textLimit: textLimit)
            return sanitized.isEmpty ? [] : [sanitized]
        }
    }

    return (copyArray(element, attribute: kAXChildrenAttribute) ?? [])
        .flatMap { descendantTextsForSummary(of: $0, depth: depth + 1, textLimit: textLimit) }
}

private func summaryTextForLink(
    _ element: AXUIElement,
    textLimit: SnapshotTextLimit = .defaults
) -> String? {
    guard let url = urlValue(of: element, attribute: kAXURLAttribute, textLimit: textLimit), !url.isEmpty else {
        return nil
    }

    let childText = (copyArray(element, attribute: kAXChildrenAttribute) ?? [])
        .flatMap { descendantTextsForSummary(of: $0, textLimit: textLimit) }
        .joined(separator: " ")
    let sanitized = sanitizeText(childText, textLimit: textLimit)
    guard !sanitized.isEmpty else {
        return nil
    }

    return summaryMarkdownLinkText(text: sanitized, url: url)
}

func summaryMarkdownLinkText(text: String, url: String) -> String {
    "[\(markdownEscapedLinkText(text))](\(url))"
}

private func visibleRows(in rows: [AXUIElement], parent: AXUIElement) -> [AXUIElement] {
    guard let parentFrame = resolveLocalFrame(of: parent, windowBounds: nil) else {
        return Array(rows.prefix(20))
    }

    let visible = rows.filter { row in
        guard let rowFrame = resolveLocalFrame(of: row, windowBounds: nil) else {
            return false
        }

        return rowFrame.intersects(parentFrame)
    }

    if visible.isEmpty {
        return Array(rows.prefix(20))
    }

    return Array(visible.prefix(20))
}

private func displayIdentifier(_ value: String?) -> String? {
    guard let value, !value.isEmpty, !value.hasPrefix("_NS:") else {
        return nil
    }

    return value
}

private func displayWindowTitle(_ value: String?, appName: String) -> String {
    guard let value, !value.isEmpty else {
        return appName
    }

    if value.hasPrefix("\(appName) –") {
        return appName
    }

    return value
}

private func quoted(_ value: String) -> String {
    "\"\(value)\""
}

private extension CGRect {
    var renderedLocalFrame: String {
        "x=\(Int(origin.x)), y=\(Int(origin.y)), w=\(Int(width)), h=\(Int(height))"
    }
}
