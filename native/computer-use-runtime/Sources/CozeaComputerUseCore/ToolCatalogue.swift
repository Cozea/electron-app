import Foundation

public enum ToolCatalogue {
    public static func jsonText() throws -> String {
        let descriptions: [ComputerTool: String] = [
            .listApps: "List running applications and their PIDs. Computer Use is macOS-only.",
            .getAppState: "Observe the target window. Returns an immutable snapshot_id, an accessibility tree and/or screenshot. Does not activate or launch applications.",
            .click: "Move the visible Cozea cursor to a known element or screenshot coordinate, then click. Returns an acknowledgement, NOT a new screenshot. Observe changed UI before choosing another target.",
            .secondaryAction: "Perform an exposed accessibility secondary action after visible cursor arrival. Returns an acknowledgement only.",
            .scroll: "Scroll the observed region after visible cursor arrival. Observe again before using coordinates from the old screenshot.",
            .drag: "Drag between coordinates from the same screenshot. Events follow the visible cursor. Returns an acknowledgement only.",
            .typeText: "Type text at the current caret/selection in the observed window's focused editable control. Click that control first. Returns an acknowledgement only.",
            .pressKey: "Press a key or shortcut in the observed focused window. Returns an acknowledgement only; observe navigation or dialogs afterward.",
            .setValue: "Set AXValue on a settable indexed element after visible cursor arrival. Does not fall back to typing. Returns an acknowledgement only.",
        ]
        let tools = ComputerTool.allCases.map { tool -> JSONValue in
            .object(["name": .string(tool.rawValue), "description": .string(descriptions[tool] ?? ""),
                     "annotations": .object(["readOnlyHint": .bool(!tool.mutatesDesktop), "idempotentHint": .bool(!tool.mutatesDesktop)]),
                     "inputSchema": .object(["type": .string("object"), "additionalProperties": .bool(true)])])
        }
        return try JSONValue.object(["tools": .array(tools), "runtime": .string("cozea-macos-v2"), "version": .string("2.0.0")]).jsonText()
    }
}
