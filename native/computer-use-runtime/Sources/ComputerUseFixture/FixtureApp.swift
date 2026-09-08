import AppKit
import WebKit

/// A real AppKit/WKWebView target for permissioned live tests. No synthetic AX
/// command bridge: automation must go through the same OS APIs as third-party apps.
@MainActor
final class FixtureDelegate: NSObject, NSApplicationDelegate, NSTextFieldDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var status: NSTextField!
    private var clicks = 0
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 160, y: 180, width: 760, height: 650),
                          styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Cozea CU Fixture"
        let stack = NSStackView(); stack.orientation = .vertical; stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        let button = NSButton(title: "Increment native counter", target: self, action: #selector(increment))
        button.setAccessibilityIdentifier("fixture-increment")
        let check = NSButton(checkboxWithTitle: "Fixture checkbox", target: nil, action: nil)
        check.setAccessibilityIdentifier("fixture-check")
        let input = NSTextField(string: "alpha beta")
        input.placeholderString = "Fixture text input"; input.delegate = self
        input.setAccessibilityIdentifier("fixture-input")
        status = NSTextField(labelWithString: "Native clicks: 0")
        status.setAccessibilityIdentifier("fixture-status")
        let webConfig = WKWebViewConfiguration()
        webConfig.userContentController.add(self, name: "counter")
        let web = WKWebView(frame: .zero, configuration: webConfig)
        web.setAccessibilityIdentifier("fixture-web")
        web.loadHTMLString("""
          <!doctype html><meta charset="utf-8"><style>body{font:17px system-ui;padding:12px}button,input{font:inherit;margin:8px;padding:8px}#scroll{height:100px;overflow:auto;border:1px solid}</style>
          <button id="increment" onclick="this.textContent='Web clicks: '+(++window.count);window.webkit.messageHandlers.counter.postMessage(window.count)">Web clicks: 0</button>
          <input aria-label="Web text input" value="gamma delta"><div contenteditable aria-label="Rich text">Editable fixture text</div>
          <div id="scroll" role="region" aria-label="Web scroll area"><div style="height:900px">Scroll start<br><br><br>More content</div></div>
          <div draggable="true" ondragstart="event.dataTransfer.setData('text/plain','fixture')">Drag fixture</div>
          <div style="height:60px;border:1px solid" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent='Dropped'">Drop fixture here</div>
          <script>window.count=0;</script>
          """, baseURL: nil)
        for view in [button, check, input, status, web] as [NSView] { stack.addArrangedSubview(view) }
        web.heightAnchor.constraint(greaterThanOrEqualToConstant: 350).isActive = true
        window.contentView = stack
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc private func increment() { clicks += 1; status.stringValue = "Native clicks: \(clicks)" }
    func controlTextDidChange(_ notification: Notification) { status.stringValue = "Text changed; native clicks: \(clicks)" }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let count = message.body as? Int { status.stringValue = "Web clicks: \(count); native clicks: \(clicks)" }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
@main
struct ComputerUseFixtureApp {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = FixtureDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
