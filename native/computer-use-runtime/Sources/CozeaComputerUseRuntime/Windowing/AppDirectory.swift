@preconcurrency import AppKit
import Foundation
import CozeaComputerUseCore

@MainActor
final class AppDirectory {
    static let shared = AppDirectory()
    private var apps: [pid_t: AppDescriptor] = [:]
    private var observers: [NSObjectProtocol] = []
    private var updatedAt: ContinuousClock.Instant = .now
    private let blocked: Set<String> = [
        "com.1password.1password", "com.1password.safari", "com.bitwarden.desktop",
        "com.dashlane.dashlanephonefinal", "com.lastpass.lastpass", "com.nordsec.nordpass",
        "me.proton.pass.electron", "me.proton.pass.catalyst", "com.apple.passwords",
    ]

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
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !blocked.contains(normalized) else { throw RuntimeFailure(.permissionDenied, "Password managers are excluded from Computer Use.") }
        let matches = apps.values.filter { app in app.aliases.contains { $0.lowercased() == normalized } }
        guard matches.count == 1, let app = matches.first else {
            throw RuntimeFailure(.stateRequired, matches.isEmpty
                ? "The target application is not running. Open it, then call get_app_state."
                : "Multiple applications match. Use a PID from list_apps.")
        }
        guard !blocked.contains(app.bundleID?.lowercased() ?? "") else {
            throw RuntimeFailure(.permissionDenied, "Password managers are excluded from Computer Use.")
        }
        return app
    }
    func isCurrent(_ app: AppDescriptor) -> Bool {
        guard let running = NSRunningApplication(processIdentifier: app.pid), !running.isTerminated else { return false }
        return Self.describe(running).launchIdentity == app.launchIdentity
    }
    func list() -> String {
        refresh()
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return apps.values.filter { !blocked.contains($0.bundleID?.lowercased() ?? "") }
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
