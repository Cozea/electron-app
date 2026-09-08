@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import CozeaComputerUseCore

final class AccessibilityRuntime: @unchecked Sendable {
    let windows: WindowRegistry
    private let observers: AccessibilityObservers
    init(windows: WindowRegistry, clock: StateClock) {
        self.windows = windows; observers = AccessibilityObservers(clock: clock)
    }
    func watch(window: WindowHandle, control: ActionControl) async throws {
        try await windows.worker.run { [self] in
            try control.check()
            try WindowRegistry.validateNow(window)
            observers.attach(window, focused: AXAccess.element(window.application, kAXFocusedUIElementAttribute))
        }
    }
    func snapshot(window: WindowHandle, options: ObservationOptions, control: ActionControl) async throws -> TreeObservation {
        try await windows.worker.run { [self] in
            let span = NativeTelemetry.span("ax.snapshot")
            defer { span.end() }
            try control.check()
            try WindowRegistry.validateNow(window)
            let focused = AXAccess.element(window.application, kAXFocusedUIElementAttribute)
            observers.attach(window, focused: focused)
            var renderer = TreeRenderer(context: RenderContext(
                cancellation: control.cancellation, deadline: min(control.cancellation.deadline, ContinuousClock.now.advanced(by: .seconds(2))),
                windowBounds: window.bounds, focusedElement: focused,
                textLimit: options.textLimit.map { SnapshotTextLimit(maxCount: $0) } ?? .max,
                treeLimits: AccessibilityTreeLimits(maxNodeCount: options.maxNodes, maxDepth: options.maxDepth)))
            let readBudget = AXReadBudget(cancellation: control.cancellation, deadline: renderer.context.deadline)
            readBudget.withScope {
                renderer.render(window.element)
                if let menu = AXAccess.element(window.application, kAXMenuBarAttribute) { renderer.render(menu) }
            }
            renderer.truncated = renderer.truncated || readBudget.exhausted
            try control.check()
            var lines = ["App=\(window.app.bundleID ?? window.app.name) (pid \(window.app.pid))", "Window: \(window.title)"] + renderer.lines
            if let focus = renderer.focusedSummary { lines.append("Focused element: \(focus)") }
            if renderer.truncated { lines.append("[Accessibility tree truncated by node/depth/time budget.]") }
            NativeTelemetry.count("ax.nodes", renderer.records.count)
            return TreeObservation(window: window, text: lines.joined(separator: "\n"), elements: renderer.records,
                                   truncated: renderer.truncated, nodeCount: renderer.records.count)
        }
    }

    func resolve(index: Int, lease: ObservationLease, control: ActionControl) async throws -> ResolvedElement {
        try await windows.worker.run {
            try control.check()
            guard let record = lease.tree?.elements[index], let element = record.element else {
                throw RuntimeFailure(.staleElement, "This index has no live accessibility handle. Request a text observation.")
            }
            let role = try AXAccess.validate(element, pid: lease.window.app.pid)
            guard let frame = AXAccess.frame(element), frame.intersects(lease.window.bounds) || role.hasPrefix("AXMenu") else {
                throw RuntimeFailure(.staleElement, "The element has no visible target rectangle. Call get_app_state.")
            }
            if let fingerprint = record.fingerprint, AXAccess.fingerprint(element) != fingerprint {
                throw RuntimeFailure(.staleElement, "The indexed element changed identity or label. Call get_app_state.")
            }
            // Do not silently retarget an old index after reflow. The caller must
            // observe new geometry instead of clicking a recycled list row.
            if let old = record.localFrame {
                let expected = old.offsetBy(dx: lease.window.bounds.minX, dy: lease.window.bounds.minY)
                guard frame.coreRectangle.approximatelyEquals(expected.coreRectangle, tolerance: 2) else {
                    throw RuntimeFailure(.staleElement, "The element moved since the observation. Call get_app_state.")
                }
            }
            return ResolvedElement(element: element, role: role, actions: AXAccess.actions(element), bounds: frame)
        }
    }

    func focused(window: WindowHandle, control: ActionControl) async throws -> ResolvedElement {
        try await windows.worker.run { [self] in
            try control.check()
            guard let element = AXAccess.element(window.application, kAXFocusedUIElementAttribute) else {
                throw RuntimeFailure(.focusChanged, "The target app has no focused element. Click an editable control first.")
            }
            let role = try AXAccess.validate(element, pid: window.app.pid)
            if let owner = AXAccess.element(element, kAXWindowAttribute), !CFEqual(owner, window.element) {
                throw RuntimeFailure(.focusChanged, "Keyboard focus belongs to a different window. Call get_app_state.")
            }
            observers.attach(window, focused: element)
            return ResolvedElement(element: element, role: role, actions: AXAccess.actions(element), bounds: AXAccess.frame(element) ?? window.bounds)
        }
    }
    func reset() async { _ = try? await windows.worker.run { [self] in observers.reset() } }
}
