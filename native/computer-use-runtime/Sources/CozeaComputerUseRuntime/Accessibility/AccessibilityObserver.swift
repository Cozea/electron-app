@preconcurrency import ApplicationServices
import CoreFoundation
import Foundation
import CozeaComputerUseCore

private final class ObserverLoop: @unchecked Sendable {
    static let shared = ObserverLoop()
    let runLoop: CFRunLoop
    private init() {
        let ready = DispatchSemaphore(value: 0)
        let value = LockedValue<CFRunLoop?>(nil)
        let thread = Thread {
            let loop = CFRunLoopGetCurrent()!
            var context = CFRunLoopSourceContext(version: 0, info: nil, retain: nil, release: nil,
                copyDescription: nil, equal: nil, hash: nil, schedule: nil, cancel: nil, perform: { _ in })
            let keepAlive = CFRunLoopSourceCreate(nil, 0, &context)!
            CFRunLoopAddSource(loop, keepAlive, .defaultMode)
            value.withLock { $0 = loop }
            ready.signal()
            CFRunLoopRun()
        }
        thread.name = "Cozea AX notifications"
        thread.qualityOfService = .userInitiated
        thread.start()
        ready.wait()
        runLoop = value.withLock { $0! }
    }
    func schedule(_ body: @escaping @Sendable () -> Void) {
        CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue, body)
        CFRunLoopWakeUp(runLoop)
    }
}

private final class ObserverContext: @unchecked Sendable {
    struct Tracked { let window: WindowIdentity; let element: AXUIElement }
    let tracked = LockedValue<[Tracked]>([])
    let clock: StateClock
    init(clock: StateClock) { self.clock = clock }
    func receive(_ element: AXUIElement, _ notification: String) {
        let signal: StateSignal
        switch notification {
        case kAXUIElementDestroyedNotification: signal = .destroyed
        case kAXValueChangedNotification, kAXSelectedTextChangedNotification: signal = .value
        case kAXFocusedWindowChangedNotification, kAXFocusedUIElementChangedNotification: signal = .focus
        default: signal = .layout
        }
        let windows = tracked.withLock { entries in
            let exact = entries.filter { CFEqual($0.element, element) }.map(\.window)
            return Set(exact.isEmpty ? entries.map(\.window) : exact)
        }
        // This callback does not query AX, render text, or touch AppKit.
        for window in windows { Task { await clock.recordObserved(window, signals: signal) } }
    }
}

private func observeAX(_ observer: AXObserver, _ element: AXUIElement, _ notification: CFString, _ refcon: UnsafeMutableRawPointer?) {
    guard let refcon else { return }
    Unmanaged<ObserverContext>.fromOpaque(refcon).takeUnretainedValue().receive(element, notification as String)
}

/// Mutable subscriptions are confined to the accessibility worker. Run-loop
/// installation/removal captures the record so refcon survives in-flight callbacks.
final class AccessibilityObservers: @unchecked Sendable {
    private final class Record: @unchecked Sendable {
        let observer: AXObserver
        let context: ObserverContext
        let launchIdentity: String
        var subscriptions: [(AXUIElement, String)] = []
        var activeWindow: WindowIdentity?
        var activeFocused: AXUIElement?
        init(observer: AXObserver, context: ObserverContext, launchIdentity: String) {
            self.observer = observer; self.context = context; self.launchIdentity = launchIdentity
        }
    }
    private var records: [pid_t: Record] = [:]
    private let clock: StateClock
    init(clock: StateClock) { self.clock = clock }

    func attach(_ window: WindowHandle, focused: AXUIElement?) {
        let record: Record
        if let existing = records[window.app.pid], existing.launchIdentity == window.app.launchIdentity {
            record = existing
        } else {
            if let existing = records.removeValue(forKey: window.app.pid) { remove(existing) }
            if records.count >= 16, let key = records.keys.sorted().first, let old = records.removeValue(forKey: key) { remove(old) }
            var observer: AXObserver?
            guard AXObserverCreate(window.app.pid, observeAX, &observer) == .success, let observer else { return }
            record = Record(observer: observer, context: ObserverContext(clock: clock), launchIdentity: window.app.launchIdentity)
            records[window.app.pid] = record
            ObserverLoop.shared.schedule {
                CFRunLoopAddSource(ObserverLoop.shared.runLoop, AXObserverGetRunLoopSource(record.observer), .defaultMode)
            }
        }
        let sameFocus: Bool
        if let old = record.activeFocused, let focused { sameFocus = CFEqual(old, focused) }
        else { sameFocus = record.activeFocused == nil && focused == nil }
        if record.activeWindow == window.identity && sameFocus { return }
        record.activeWindow = window.identity; record.activeFocused = focused
        // A bounded per-app subscription set is cheaper and safer than retaining
        // every control that has ever received focus during the app's lifetime.
        for (element, notification) in record.subscriptions {
            _ = AXObserverRemoveNotification(record.observer, element, notification as CFString)
        }
        record.subscriptions.removeAll()
        record.context.tracked.withLock { entries in
            entries = [ObserverContext.Tracked(window: window.identity, element: window.element)]
            if let focused { entries.append(ObserverContext.Tracked(window: window.identity, element: focused)) }
        }
        let applicationNotifications = [kAXFocusedWindowChangedNotification, kAXFocusedUIElementChangedNotification, kAXWindowCreatedNotification]
        let windowNotifications = [kAXMovedNotification, kAXResizedNotification, kAXUIElementDestroyedNotification, kAXTitleChangedNotification]
        for n in applicationNotifications { add(window.application, n, record) }
        for n in windowNotifications { add(window.element, n, record) }
        if let focused {
            for n in [kAXValueChangedNotification, kAXSelectedTextChangedNotification, kAXUIElementDestroyedNotification] { add(focused, n, record) }
        }
    }
    func reset() {
        records.values.forEach(remove)
        records.removeAll()
    }
    private func add(_ element: AXUIElement, _ notification: String, _ record: Record) {
        let result = AXObserverAddNotification(record.observer, element, notification as CFString,
                                               Unmanaged.passUnretained(record.context).toOpaque())
        if result == .success || result == .notificationAlreadyRegistered { record.subscriptions.append((element, notification)) }
    }
    private func remove(_ record: Record) {
        ObserverLoop.shared.schedule {
            for (element, notification) in record.subscriptions {
                _ = AXObserverRemoveNotification(record.observer, element, notification as CFString)
            }
            CFRunLoopRemoveSource(ObserverLoop.shared.runLoop, AXObserverGetRunLoopSource(record.observer), .defaultMode)
            record.context.tracked.withLock { $0.removeAll() }
        }
    }
}
