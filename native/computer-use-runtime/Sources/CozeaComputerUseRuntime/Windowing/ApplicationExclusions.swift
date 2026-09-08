import Foundation
import CozeaComputerUseCore

/// Exact, case-normalized bundle IDs shared by discovery and every resolution
/// route (name, PID, bundle ID). See docs/computer-use-v2.md for source provenance.
/// This is a native-app guard, not a claim to filter browser password-manager UI.
enum ApplicationExclusions {
    private static let bundleIDs: Set<String> = [
        "com.1password.1password", "com.1password.safari", "com.bitwarden.desktop",
        "com.dashlane.dashlanephonefinal", "com.dashlane.dashlane", "com.dashlane.mac.dashlane",
        "com.lastpass.lastpass", "com.lastpass.lastpassmacdesktop",
        "com.nordsec.nordpass", "me.proton.pass.electron", "me.proton.pass.catalyst",
        "com.apple.passwords",
    ]

    static func contains(_ bundleID: String?) -> Bool {
        guard let bundleID else { return false }
        return bundleIDs.contains(bundleID.lowercased())
    }

    static func visible(_ applications: [AppDescriptor]) -> [AppDescriptor] {
        applications.filter { !contains($0.bundleID) }
    }

    static func resolve(_ query: String, candidates: [AppDescriptor]) throws -> AppDescriptor {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !contains(normalized) else { throw excluded() }
        let matches = candidates.filter { app in app.aliases.contains { $0.lowercased() == normalized } }
        guard matches.count == 1, let app = matches.first else {
            throw RuntimeFailure(.stateRequired, matches.isEmpty
                ? "The target application is not running. Open it, then call get_app_state."
                : "Multiple applications match. Use a PID from list_apps.")
        }
        guard !contains(app.bundleID) else { throw excluded() }
        return app
    }

    private static func excluded() -> RuntimeFailure {
        RuntimeFailure(.permissionDenied, "Password managers are excluded from Computer Use.")
    }
}
