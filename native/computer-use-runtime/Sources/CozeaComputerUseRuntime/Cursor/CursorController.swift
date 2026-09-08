@preconcurrency import AppKit
import QuartzCore
import CoreGraphics
import Foundation
import CozeaComputerUseCore

private struct PlannedMotion: @unchecked Sendable {
    let path: CursorMotionPath
    let duration: CGFloat
}

@MainActor
private final class CursorSurface {
    let panel: NSPanel
    let view: CursorGlyphView
    let root: NSView
    let screen: NSScreen
    let displayID: CGDirectDisplayID
    init(screen: NSScreen, displayID: CGDirectDisplayID) {
        self.screen = screen; self.displayID = displayID
        panel = CursorPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.ignoresMouseEvents = true; panel.animationBehavior = .none
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        root = NSView(frame: CGRect(origin: .zero, size: screen.frame.size))
        root.wantsLayer = true; root.layer?.masksToBounds = true
        view = CursorGlyphView(frame: CGRect(origin: .zero, size: SoftwareCursorGlyphMetrics.windowSize))
        root.addSubview(view); panel.contentView = root
    }
    func present(level: Int) {
        panel.level = NSWindow.Level(rawValue: max(NSWindow.Level.floating.rawValue, level + 1))
        panel.orderFrontRegardless()
    }
    func draw(_ state: CursorVisualRenderState, pulse: CGFloat) {
        let anchor = SoftwareCursorGlyphMetrics.tipAnchor
        let origin = CGPoint(x: state.tipPosition.x - anchor.x - screen.frame.minX,
                             y: state.tipPosition.y - anchor.y - screen.frame.minY)
        CATransaction.begin(); CATransaction.setDisableActions(true)
        view.setFrameOrigin(origin)
        view.renderState = SoftwareCursorGlyphRenderState(rotation: state.rotation, cursorBodyOffset: state.cursorBodyOffset,
            fogOffset: state.fogOffset, fogOpacity: state.fogOpacity, fogScale: state.fogScale, clickProgress: pulse)
        view.needsDisplay = true
        CATransaction.commit()
    }
}

@MainActor
final class CursorController: NSObject {
    static let shared = CursorController()
    private struct Movement {
        let plan: PlannedMotion
        let end: CGPoint
        let started: CFTimeInterval
        let frameHandler: (@MainActor (CGPoint) -> Void)?
        var progress: CGFloat = 0
        var spring = CursorMotionSpringState()
        var arrivedOnPreviousFrame = false
    }
    private struct Pulse { let started: CFTimeInterval; let count: Int; let bias: CGFloat }
    private var surfaces: [CursorSurface] = []
    private var link: CADisplayLink?
    private var watchdog: Timer?
    private var hideTask: Task<Void, Never>?
    private var movement: Movement?
    private var pulse: Pulse?
    private var continuation: CheckedContinuation<Void, any Error>?
    private var owner: String?
    private var control: ActionControl?
    private var displayedTip: CGPoint?
    private var dynamics: CursorVisualDynamicsState?
    private var restingRotation: CGFloat = 0
    private var idleStarted: CFTimeInterval = 0
    private var lastTick: CFTimeInterval = 0
    private var screenObserver: NSObjectProtocol?
    private let planner = NativeWorker("cursor-plan")

    override private init() {
        super.init()
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.stop(error: RuntimeFailure(.cursorUnavailable, "Display configuration changed during the action.")) }
            }
    }

    func move(to target: PointerTarget, owner: String, control: ActionControl,
              frameHandler: (@MainActor (CGPoint) -> Void)? = nil) async throws {
        try control.check()
        guard continuation == nil else { throw RuntimeFailure(.busy, "The software cursor is already in use.") }
        try prepareSurfaces(level: target.layer)
        let end = try appKitPoint(target.globalPoint)
        let start: CGPoint
        if let displayedTip { start = displayedTip }
        else {
            let proposed = SoftwareCursorGlyphMetrics.tipAnchor
            start = surfaces.contains { $0.screen.frame.contains(proposed) } ? proposed : CGPoint(x: end.x - 40, y: end.y - 40)
        }
        let bounds = surfaces.reduce(CGRect.null) { $0.union($1.screen.visibleFrame) }
        let forward = CGVector(dx: cos(-SoftwareCursorGlyphMetrics.targetNeutralHeading - restingRotation),
                               dy: sin(-SoftwareCursorGlyphMetrics.targetNeutralHeading - restingRotation))
        let endForward = CGVector(dx: cos(-SoftwareCursorGlyphMetrics.targetNeutralHeading), dy: sin(-SoftwareCursorGlyphMetrics.targetNeutralHeading))
        let plan = try await planner.run {
            let candidates = HeadingDrivenCursorMotionModel.makeCandidates(start: start, end: end, bounds: bounds,
                                                                            startForward: forward, endForward: endForward)
            let chosen = HeadingDrivenCursorMotionModel.chooseBestCandidate(from: candidates)
            let path = chosen?.path ?? CursorMotionPath(start: start, end: end)
            let measurement = chosen?.measurement ?? path.measure(bounds: bounds)
            let duration = hypot(end.x - start.x, end.y - start.y) <= 2 ? CGFloat(0) :
                OfficialCursorMotionModel.calibratedTravelDuration(distance: hypot(end.x - start.x, end.y - start.y), measurement: measurement)
            return PlannedMotion(path: path, duration: duration)
        }
        try control.check()
        self.owner = owner; self.control = control
        hideTask?.cancel(); hideTask = nil
        if dynamics == nil { dynamics = CursorVisualDynamicsAnimator.state(at: start, time: CGFloat(CACurrentMediaTime())) }
        movement = Movement(plan: plan, end: end, started: CACurrentMediaTime(), frameHandler: frameHandler)
        pulse = nil
        let span = NativeTelemetry.span("cursor.travel")
        defer { span.end() }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                startDisplayLink(near: end)
            }
        } onCancel: {
            Task { @MainActor in self.cancel(owner: owner) }
        }
        try control.check()
    }

    func clickPulse(owner: String, button: MouseButton, count: Int) async throws {
        guard self.owner == owner, displayedTip != nil, continuation == nil else {
            throw RuntimeFailure(.cursorUnavailable, "The software cursor lost ownership.")
        }
        try control?.check()
        pulse = Pulse(started: CACurrentMediaTime(), count: max(1, count), bias: button == .right ? 0.82 : 1)
        try await withCheckedThrowingContinuation { continuation in self.continuation = continuation }
    }

    func settle(owner: String) {
        guard self.owner == owner else { return }
        idleStarted = CACurrentMediaTime()
        hideTask?.cancel()
        hideTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(30)) } catch { return }
            guard self?.owner == owner else { return }
            self?.stop(error: nil)
        }
    }

    func cancelSession(_ session: String) {
        let prefix = Data(session.utf8).base64EncodedString() + ":"
        guard owner?.hasPrefix(prefix) == true else { return }
        stop(error: RuntimeFailure(.cancelled, "The cursor session ended."))
    }

    func cancel(owner: String? = nil) {
        guard owner == nil || self.owner == owner else { return }
        stop(error: RuntimeFailure(.cancelled, "The cursor action was cancelled."))
    }

    private func prepareSurfaces(level: Int) throws {
        guard !NSScreen.screens.isEmpty, NSScreen.screens.count <= 8 else {
            throw RuntimeFailure(.cursorUnavailable, "An active supported display configuration is required.")
        }
        if surfaces.isEmpty {
            surfaces = NSScreen.screens.compactMap { screen in
                guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
                return CursorSurface(screen: screen, displayID: id.uint32Value)
            }
        }
        guard !surfaces.isEmpty else { throw RuntimeFailure(.cursorUnavailable, "No display is available for the software cursor.") }
        surfaces.forEach { $0.present(level: level) }
    }

    private func startDisplayLink(near point: CGPoint) {
        link?.invalidate()
        guard let surface = surfaces.first(where: { $0.screen.frame.contains(point) }) else {
            stop(error: RuntimeFailure(.cursorUnavailable, "The target is outside all active displays.")); return
        }
        let link = surface.root.displayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
        lastTick = CACurrentMediaTime()
        watchdog?.invalidate()
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.control?.cancellation.isCancelled == true {
                    self.stop(error: RuntimeFailure(.cancelled, "The cursor request was revoked."))
                } else if CACurrentMediaTime() - self.lastTick > 1 {
                    self.stop(error: RuntimeFailure(.cursorUnavailable, "Display presentation stopped; no input was dispatched."))
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common); watchdog = timer
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = CACurrentMediaTime(); lastTick = now
        do { try control?.check() } catch { stop(error: error); return }
        if var motion = movement {
            if motion.arrivedOnPreviousFrame {
                movement = nil; idleStarted = now
                let finished = continuation; continuation = nil
                finished?.resume()
                settle(owner: owner ?? "")
                return
            }
            let elapsed = CGFloat(now - motion.started)
            let t = motion.plan.duration == 0 ? 1 : min(max(elapsed / motion.plan.duration, 0), 1)
            (motion.progress, motion.spring) = CursorMotionProgressAnimator.advance(current: motion.progress, state: motion.spring,
                                                                                  to: t * OfficialCursorMotionModel.closeEnoughTime)
            let targetPoint = motion.plan.path.sample(at: motion.progress).point
            var render = advance(toward: targetPoint, at: now)
            if t >= 1 {
                // Pin the exact tip, not the artwork's bounds, and wait for a
                // further display callback before admitting the actual action.
                render = CursorVisualRenderState(tipPosition: motion.end, rotation: render.rotation,
                    cursorBodyOffset: render.cursorBodyOffset, fogOffset: render.fogOffset,
                    fogOpacity: render.fogOpacity, fogScale: render.fogScale)
                motion.arrivedOnPreviousFrame = true
            }
            draw(render, pulse: 0)
            if let point = try? quartzPoint(render.tipPosition) { motion.frameHandler?(point) }
            movement = motion
        } else if let pulse {
            let elapsed = now - pulse.started
            let cycle = 0.21
            let index = Int(elapsed / cycle)
            let progress = min(max((elapsed - Double(index) * cycle) / 0.16, 0), 1)
            if elapsed >= Double(pulse.count - 1) * cycle + 0.16 {
                self.pulse = nil; idleStarted = now
                let finished = continuation; continuation = nil; finished?.resume()
                settle(owner: owner ?? "")
            } else if let tip = displayedTip {
                draw(advance(toward: tip, at: now), pulse: sin(progress * .pi) * pulse.bias)
            }
        } else if let tip = displayedTip {
            draw(advance(toward: tip, at: now, idle: sin((now - idleStarted) * 2.4) * 0.09), pulse: 0)
        }
    }

    private func advance(toward point: CGPoint, at now: CFTimeInterval, idle: CGFloat = 0) -> CursorVisualRenderState {
        let result = CursorVisualDynamicsAnimator.advance(
            state: dynamics ?? CursorVisualDynamicsAnimator.state(at: point, time: CGFloat(now)),
            targetTipPosition: point, targetTime: CGFloat(now), idleAngleOffset: idle,
            baseHeading: SoftwareCursorGlyphMetrics.targetNeutralHeading, renderYAxisMultiplier: -1)
        dynamics = result.state
        return result.renderState
    }
    private func draw(_ render: CursorVisualRenderState, pulse: CGFloat) {
        displayedTip = render.tipPosition; restingRotation = render.rotation
        surfaces.forEach { $0.draw(render, pulse: pulse) }
    }
    private func appKitPoint(_ quartz: CGPoint) throws -> CGPoint {
        for surface in surfaces {
            let bounds = CGDisplayBounds(surface.displayID)
            if bounds.contains(quartz) {
                return CGPoint(x: surface.screen.frame.minX + quartz.x - bounds.minX,
                               y: surface.screen.frame.maxY - (quartz.y - bounds.minY))
            }
        }
        throw RuntimeFailure(.cursorUnavailable, "The target is outside all active displays.")
    }
    private func quartzPoint(_ appKit: CGPoint) throws -> CGPoint {
        for surface in surfaces where surface.screen.frame.contains(appKit) {
            let bounds = CGDisplayBounds(surface.displayID)
            return CGPoint(x: bounds.minX + appKit.x - surface.screen.frame.minX,
                           y: bounds.minY + surface.screen.frame.maxY - appKit.y)
        }
        throw RuntimeFailure(.cursorUnavailable, "The cursor is between displays.")
    }
    private func stop(error: (any Error)?) {
        link?.invalidate(); link = nil; watchdog?.invalidate(); watchdog = nil
        hideTask?.cancel(); hideTask = nil
        movement = nil; pulse = nil; control = nil; owner = nil
        surfaces.forEach { $0.panel.orderOut(nil) }; surfaces.removeAll()
        displayedTip = nil; dynamics = nil
        let finished = continuation; continuation = nil
        if let finished { finished.resume(throwing: error ?? RuntimeFailure(.cancelled, "Cursor presentation ended.")) }
    }
}

@MainActor private final class CursorPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
@MainActor private final class CursorGlyphView: NSView {
    var renderState = SoftwareCursorGlyphRenderState(rotation: 0, cursorBodyOffset: .zero, fogOffset: .zero,
                                                      fogOpacity: 0.12, fogScale: 1, clickProgress: 0)
    override init(frame frameRect: NSRect) { super.init(frame: frameRect); wantsLayer = true }
    required init?(coder: NSCoder) { nil }
    override var isOpaque: Bool { false }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill(); dirtyRect.fill()
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        SoftwareCursorGlyphRenderer.draw(in: bounds, context: context, state: renderState)
    }
}
