@preconcurrency import AppKit
import Foundation
import CozeaComputerUseCore

@MainActor
final class AppDirectory {
    static let shared = AppDirectory()
    private var apps: [pid_t: AppDescriptor] = [:]
    private var observers: [NSObjectProtocol] = []
    private var updatedAt: ContinuousClock.Instant = .now


    private init() {
        refresh()
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification,
                     NSWorkspace.didActivateApplicationNotification, NSWorkspace.didHideApplicationNotification,
                     NSWorkspace.didUnhideApplicationNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.refresh() }
            })
        }
    }
    func resolve(_ query: String) throws -> AppDescriptor {
        if updatedAt.duration(to: .now) > .seconds(2) { refresh() }
        return try ApplicationExclusions.resolve(query, candidates: Array(apps.values))
    }

    func isCurrent(_ app: AppDescriptor) -> Bool {
        guard let running = NSRunningApplication(processIdentifier: app.pid), !running.isTerminated else { return false }
        return Self.describe(running).launchIdentity == app.launchIdentity
    }
    func list() -> String {
        refresh()
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return ApplicationExclusions.visible(Array(apps.values))
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .map { "\($0.name) — \($0.bundleID ?? "no bundle ID") [pid=\($0.pid)\($0.pid == front ? ", frontmost" : ""), running]" }
            .joined(separator: "\n")
    }
    func frontmostPID() -> pid_t? { NSWorkspace.shared.frontmostApplication?.processIdentifier }
    private func refresh() {
        apps = Dictionary(uniqueKeysWithValues: NSWorkspace.shared.runningApplications.filter { !$0.isTerminated && $0.activationPolicy == .regular }
            .map { ($0.processIdentifier, Self.describe($0)) })
        updatedAt = .now
    }
    private static func describe(_ app: NSRunningApplication) -> AppDescriptor {
        AppDescriptor(pid: app.processIdentifier, name: app.localizedName ?? "pid-\(app.processIdentifier)",
                      bundleID: app.bundleIdentifier,
                      launchIdentity: "\(app.processIdentifier):\(app.launchDate?.timeIntervalSince1970 ?? 0):\(app.bundleIdentifier ?? "")")
    }
}
