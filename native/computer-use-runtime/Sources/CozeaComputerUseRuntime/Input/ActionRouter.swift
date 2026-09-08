@preconcurrency import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import QuartzCore
import Foundation
import CozeaComputerUseCore

private struct PointerPlan: @unchecked Sendable {
    let target: PointerTarget
    let element: ResolvedElement?
    let index: Int?
}

final class ActionRouter: @unchecked Sendable {
    private let gate = InputGate()
    private let events = NativeWorker("input-events")
    private let accessibility: AccessibilityRuntime
    private let clock: StateClock
    let activity: InputActivity
    init(accessibility: AccessibilityRuntime, clock: StateClock, activity: InputActivity) {
        self.accessibility = accessibility; self.clock = clock; self.activity = activity
    }

    func execute(_ request: ToolRequest, lease: ObservationLease, owner: String, control: ActionControl) async throws -> ComputerResult {
        try await gate.withPermit { [self] in
            try control.check()
            guard lease.coherent else { throw RuntimeFailure(.staleObservation, "The UI changed during observation. Call get_app_state again.") }
            try await accessibility.windows.validate(lease.window, control: control)
            let before = await clock.current(lease.window.identity)
            let backend: String
            do {
                backend = try await executeOperation(request.operation, lease: lease, owner: owner, control: control)
            } catch {
                if control.hasDispatched {
                    _ = await clock.recordDispatched(lease.window.identity)
                    activity.end(lease.window.identity, time: CACurrentMediaTime())
                }
                await CursorController.shared.cancel(owner: owner)
                throw nativeFailure(error, control: control)
            }
            if control.hasDispatched { _ = await clock.recordDispatched(lease.window.identity) }
            async let presentation: Void = completePresentation(request.operation, owner: owner)
            let change: StateWaitResult
            do { change = try await clock.waitForObservedChange(lease.window.identity, after: before.observed, timeout: .milliseconds(80)) }
            catch { change = .timedOut }
            try await presentation
            try control.check()
            let revision = await clock.current(lease.window.identity)
            let changed: Bool
            if case .changed = change { changed = true } else { changed = false }
            return try ActionAcknowledgement(window: lease.window.identity, revision: revision, observedChange: changed,
                                         backend: backend, observationID: lease.id).result()
        }
    }

    private func completePresentation(_ operation: ToolOperation, owner: String) async throws {
        if case .click(_, _, let button, let count, _) = operation {
            try await CursorController.shared.clickPulse(owner: owner, button: button, count: count)
        }
    }

    private func executeOperation(_ operation: ToolOperation, lease: ObservationLease, owner: String, control: ActionControl) async throws -> String {
        switch operation {
        case .click(_, let target, let button, let count, let strategy):
            let backend = try await CausalPointerSequence.perform(control: control,
                resolve: { [self] in try await pointerPlan(target, lease: lease, control: control) },
                arrive: { plan in try await CursorController.shared.move(to: plan.target, owner: owner, control: control) },
                revalidate: { [self] plan in try await revalidate(plan, lease: lease, control: control) },
                dispatch: { [self] plan in try await dispatchClick(plan, lease: lease, button: button, count: count, strategy: strategy, control: control) })
            return backend
        case .setValue(_, let index, let value):
            return try await indexedAction(index, lease: lease, owner: owner, control: control) { [self] plan in
                guard let element = plan.element else { throw RuntimeFailure(.staleElement, "Value setting requires an accessibility element.") }
                return try await accessibility.windows.worker.run {
                    try control.check()
                    guard AXAccess.settable(element.element, kAXValueAttribute) else { throw RuntimeFailure(.invalidArguments, "The element's value is not settable.") }
                    self.activity.begin(lease.window.identity)
                    defer { self.activity.end(lease.window.identity, time: CACurrentMediaTime()) }
                    try control.markDispatch()
                    guard AXUIElementSetAttributeValue(element.element, kAXValueAttribute as CFString, value as CFString) == .success else {
                        throw RuntimeFailure(.ambiguousDelivery, "Accessibility did not confirm value delivery.", delivery: .unknown)
                    }
                    return "ax-value"
                }
            }
        case .secondary(_, let index, let action):
            return try await indexedAction(index, lease: lease, owner: owner, control: control) { [self] plan in
                guard let element = plan.element else { throw RuntimeFailure(.staleElement, "A secondary action requires an accessibility element.") }
                let record = lease.tree?.elements[index]
                let normalized = action.lowercased().filter { $0.isLetter || $0.isNumber }
                let raw = element.actions.first { $0.lowercased() == action.lowercased() || $0.dropFirst(2).lowercased().filter { $0.isLetter || $0.isNumber } == normalized }
                    ?? zip(record?.rawActions ?? [], record?.prettyActions ?? []).first { $0.1.caseInsensitiveCompare(action) == .orderedSame }?.0
                guard let raw, element.actions.contains(raw) else { throw RuntimeFailure(.invalidArguments, "The requested secondary action is not exposed by this element.") }
                return try await performAX(element.element, action: raw, window: lease.window, control: control)
            }
        case .scroll(_, let index, let direction, let pages):
            return try await indexedAction(index, lease: lease, owner: owner, control: control) { [self] plan in
                let action = "AXScroll\(direction.rawValue.capitalized)ByPage"
                if pages.rounded() == pages, let element = plan.element, element.actions.contains(action) {
                    for _ in 0..<Int(pages) { _ = try await performAX(element.element, action: action, window: lease.window, control: control) }
                    return "ax-scroll"
                }
                return try await events.run {
                    try control.check()
                    self.activity.begin(lease.window.identity)
                    defer { self.activity.end(lease.window.identity, time: CACurrentMediaTime()) }
                    try PublicEventBackend.scroll(plan.target, direction: direction, pages: pages, control: control)
                    return "pid-scroll"
                }
            }
        case .drag(_, let from, let to):
            return try await drag(from: from, to: to, lease: lease, owner: owner, control: control)
        case .typeText(_, let text):
            let focused = try await accessibility.focused(window: lease.window, control: control)
            guard [kAXTextFieldRole as String, "AXTextArea", "AXTextView", kAXComboBoxRole as String].contains(focused.role) else {
                throw RuntimeFailure(.focusChanged, "Click an editable text control before typing.")
            }
            // Keyboard text preserves the caret/selection. Never append a stale
            // snapshot value or replace a document's entire AXValue.
            for chunk in UnicodeInput.chunks(text) {
                let current = try await accessibility.focused(window: lease.window, control: control)
                guard CFEqual(current.element, focused.element) else { throw RuntimeFailure(.focusChanged, "Keyboard focus changed while typing.") }
                try await events.run {
                    self.activity.begin(lease.window.identity)
                    defer { self.activity.end(lease.window.identity, time: CACurrentMediaTime()) }
                    try PublicEventBackend.typeChunk(chunk, pid: lease.window.app.pid, control: control)
                }
                try await Task.sleep(for: .milliseconds(2))
            }
            return "pid-keyboard"
        case .pressKey(_, let key):
            // A shortcut may be valid without a focused text field, but it must
            // still target the observed window rather than a newly opened dialog.
            try await accessibility.windows.worker.run {
                try control.check()
                guard let focusedWindow = AXAccess.element(lease.window.application, kAXFocusedWindowAttribute),
                      CFEqual(focusedWindow, lease.window.element) else { throw RuntimeFailure(.focusChanged, "The focused window changed. Call get_app_state.") }
            }
            return try await events.run {
                self.activity.begin(lease.window.identity)
                defer { self.activity.end(lease.window.identity, time: CACurrentMediaTime()) }
                try PublicEventBackend.key(key, pid: lease.window.app.pid, control: control)
                return "pid-keyboard"
            }
        case .listApps, .observe:
            throw RuntimeFailure(.internalError, "An observation was incorrectly routed as an input operation.")
        }
    }

    private func pointerPlan(_ target: ActionTarget, lease: ObservationLease, control: ActionControl) async throws -> PointerPlan {
        try await accessibility.windows.validate(lease.window, control: control)
        let point: CGPoint; let element: ResolvedElement?; let index: Int?
        switch target {
        case .element(let i):
            let resolved = try await accessibility.resolve(index: i, lease: lease, control: control)
            element = resolved; index = i
            point = CGPoint(x: resolved.bounds.midX, y: resolved.bounds.midY)
        case .screenshot(let pixel):
            guard activity.status(lease.window.identity).revision == lease.inputRevision else {
                throw RuntimeFailure(.staleObservation, "Input occurred after this screenshot. Observe before another coordinate action.")
            }
            guard let geometry = lease.imageGeometry else { throw RuntimeFailure(.stateRequired, "Coordinate actions require a screenshot observation.") }
            point = try geometry.globalPoint(from: pixel).cgPoint; element = nil; index = nil
        }
        let level = element?.role.hasPrefix("AXMenu") == true ? NSWindow.Level.popUpMenu.rawValue : lease.window.layer
        return PointerPlan(target: PointerTarget(window: lease.window.identity, globalPoint: point,
            localPoint: CGPoint(x: point.x - lease.window.bounds.minX, y: point.y - lease.window.bounds.minY),
            windowBounds: lease.window.bounds, layer: level), element: element, index: index)
    }
    private func revalidate(_ plan: PointerPlan, lease: ObservationLease, control: ActionControl) async throws {
        try await accessibility.windows.validate(lease.window, control: control)
        if let index = plan.index, let original = plan.element {
            let fresh = try await accessibility.resolve(index: index, lease: lease, control: control)
            guard CFEqual(original.element, fresh.element), original.bounds.coreRectangle.approximatelyEquals(fresh.bounds.coreRectangle) else {
                throw RuntimeFailure(.staleElement, "The target changed during cursor travel. Call get_app_state.")
            }
        } else if activity.status(lease.window.identity).revision != lease.inputRevision {
            throw RuntimeFailure(.staleObservation, "The screenshot became stale while the action was queued.")
        }
    }
    private func indexedAction(_ index: Int, lease: ObservationLease, owner: String, control: ActionControl,
                               dispatch: @escaping @Sendable (PointerPlan) async throws -> String) async throws -> String {
        let backend = try await CausalPointerSequence.perform(control: control,
            resolve: { [self] in try await pointerPlan(.element(index), lease: lease, control: control) },
            arrive: { plan in try await CursorController.shared.move(to: plan.target, owner: owner, control: control) },
            revalidate: { [self] plan in try await revalidate(plan, lease: lease, control: control) }, dispatch: dispatch)
        await CursorController.shared.settle(owner: owner)
        return backend
    }
    private func performAX(_ element: AXUIElement, action: String, window: WindowHandle, control: ActionControl) async throws -> String {
        // The handle is retained in this immutable wrapper across the queue hop.
        let reference = ResolvedElement(element: element, role: "", actions: [], bounds: .zero)
        return try await accessibility.windows.worker.run {
            try control.check(); try WindowRegistry.validateNow(window)
            self.activity.begin(window.identity)
            defer { self.activity.end(window.identity, time: CACurrentMediaTime()) }
            try control.markDispatch()
            guard AXUIElementPerformAction(reference.element, action as CFString) == .success else {
                throw RuntimeFailure(.ambiguousDelivery, "The application did not confirm the accessibility action. Observe before retrying.", delivery: .unknown)
            }
            return "ax"
        }
    }
    private func dispatchClick(_ plan: PointerPlan, lease: ObservationLease, button: MouseButton, count: Int,
                               strategy: ClickStrategy, control: ActionControl) async throws -> String {
        if strategy == .auto || strategy == .accessibility, count == 1, let element = plan.element {
            let roles: Set<String> = [kAXButtonRole as String, kAXPopUpButtonRole as String, kAXMenuItemRole as String,
                                     kAXMenuBarItemRole as String, kAXCheckBoxRole as String, kAXRadioButtonRole as String,
                                     kAXDisclosureTriangleRole as String, "AXLink"]
            let actions = button == .right ? [kAXShowMenuAction as String] : button == .left ? [kAXPressAction as String, kAXConfirmAction as String, "AXOpen"] : []
            if roles.contains(element.role), let action = actions.first(where: element.actions.contains) {
                return try await performAX(element.element, action: action, window: lease.window, control: control)
            }
        }
        if strategy == .accessibility { throw RuntimeFailure(.backendUnavailable, "No unambiguous semantic accessibility action is available.") }
        guard CGRect(origin: .zero, size: plan.target.windowBounds.size).contains(plan.target.localPoint) else {
            throw RuntimeFailure(.backendUnavailable, "A physical click must remain inside its observed window.")
        }
        let frontmost = await AppDirectory.shared.frontmostPID()
        if strategy == .global {
            guard control.allowGlobalPointer else { throw RuntimeFailure(.permissionDenied, "Global pointer delivery is disabled.") }
            guard frontmost == lease.window.app.pid else { throw RuntimeFailure(.focusChanged, "Bring the target app to the foreground before a global click.") }
        }
        return try await events.run {
            try control.check()
            self.activity.begin(lease.window.identity)
            defer { self.activity.end(lease.window.identity, time: CACurrentMediaTime()) }
            if strategy == .sky || (strategy == .auto && button == .left && count <= 2) {
                do {
                    try SkyClickBackend.click(plan.target, count: count, frontmostPID: frontmost, control: control)
                    return "sky-conservative"
                } catch {
                    let failure = nativeFailure(error, control: control)
                    guard strategy == .auto, failure.permitsFallback else { throw failure }
                    NativeTelemetry.count("sky.predispatch_fallback", 1)
                }
            }
            try control.check()
            try PublicEventBackend.click(plan.target, button: button, count: count, global: strategy == .global, control: control)
            return strategy == .global ? "global-hid" : "pid"
        }
    }

    private func drag(from: Point, to: Point, lease: ObservationLease, owner: String, control: ActionControl) async throws -> String {
        let source = try await pointerPlan(.screenshot(from), lease: lease, control: control)
        let destination = try await pointerPlan(.screenshot(to), lease: lease, control: control)
        try await CursorController.shared.move(to: source.target, owner: owner, control: control)
        try await revalidate(source, lease: lease, control: control)
        let sequence = DragSequence(pid: lease.window.app.pid, start: source.target.globalPoint, control: control, worker: events)
        activity.begin(lease.window.identity)
        do {
            try await sequence.begin()
            try await CursorController.shared.move(to: destination.target, owner: owner, control: control, frameHandler: { point in sequence.submit(point) })
            try await sequence.finish()
            activity.end(lease.window.identity, time: CACurrentMediaTime())
            await CursorController.shared.settle(owner: owner)
            return "pid-drag"
        } catch {
            try? await sequence.finish()
            activity.end(lease.window.identity, time: CACurrentMediaTime())
            throw error
        }
    }
}

/// All mutable drag state is confined to the event queue. Frame samples are taken
/// from the visible cursor; a queue barrier drains them before the final mouse-up.
private final class DragSequence: @unchecked Sendable {
    let pid: pid_t; let control: ActionControl; let worker: NativeWorker
    private var point: CGPoint; private var pressed = false; private var failure: RuntimeFailure?
    init(pid: pid_t, start: CGPoint, control: ActionControl, worker: NativeWorker) {
        self.pid = pid; point = start; self.control = control; self.worker = worker
    }
    func begin() async throws {
        try await worker.run { [self] in
            let event = try PublicEventBackend.mouseEvent(.leftMouseDown, at: point)
            try control.markDispatch(); pressed = true; event.postToPid(pid)
        }
    }
    func submit(_ next: CGPoint) {
        worker.enqueue { [self] in
            guard pressed, failure == nil else { return }
            do {
                try control.check()
                let event = try PublicEventBackend.mouseEvent(.leftMouseDragged, at: next)
                try control.markDispatch(); point = next; event.postToPid(pid)
            } catch { failure = nativeFailure(error, control: control) }
        }
    }
    func finish() async throws {
        try await worker.run { [self] in
            if pressed {
                let event = try PublicEventBackend.mouseEvent(.leftMouseUp, at: point)
                event.postToPid(pid); pressed = false
            }
            if let failure { throw failure }
            try control.check()
        }
    }
}
