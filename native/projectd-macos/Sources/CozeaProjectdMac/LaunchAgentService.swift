import Foundation
import ServiceManagement

public enum LaunchAgentStatusState: String, Codable {
    case enabled
    case disabled
    case notRegistered = "not_registered"
    case requiresApproval = "requires_approval"
    case notFound = "not_found"
    case running
}

public struct LaunchAgentStatusResult: Codable {
    public let plistName: String
    public let status: LaunchAgentStatusState
    public let plistPath: String?
    public let isLoaded: Bool
}

public final class LaunchAgentService: @unchecked Sendable {
    public static let shared = LaunchAgentService()

    private let label = "app.cozea.projectd"
    private let plistFileName = "app.cozea.projectd.plist"

    private init() {}

    private var userLaunchAgentsDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
    }

    private var userPlistURL: URL {
        userLaunchAgentsDirectory.appendingPathComponent(plistFileName)
    }

    public func status() -> LaunchAgentStatusResult {
        // Check SMAppService status if available
        if #available(macOS 13.0, *) {
            let agent = SMAppService.agent(plistName: plistFileName)
            var state: LaunchAgentStatusState = .notRegistered
            switch agent.status {
            case .enabled:
                state = .enabled
            case .notRegistered:
                state = .notRegistered
            case .requiresApproval:
                state = .requiresApproval
            case .notFound:
                state = .notFound
            @unknown default:
                state = .notRegistered
            }

            let plistExists = FileManager.default.fileExists(atPath: userPlistURL.path)
            let isLoaded = checkLaunchctlLoaded()

            return LaunchAgentStatusResult(
                plistName: plistFileName,
                status: isLoaded ? .running : (plistExists ? state : .notRegistered),
                plistPath: plistExists ? userPlistURL.path : nil,
                isLoaded: isLoaded
            )
        }

        let isLoaded = checkLaunchctlLoaded()
        let plistExists = FileManager.default.fileExists(atPath: userPlistURL.path)

        return LaunchAgentStatusResult(
            plistName: plistFileName,
            status: isLoaded ? .running : (plistExists ? .enabled : .notRegistered),
            plistPath: plistExists ? userPlistURL.path : nil,
            isLoaded: isLoaded
        )
    }

    public func register(executablePath: String, socketPath: String) throws {
        // Ensure ~/Library/LaunchAgents directory exists
        try FileManager.default.createDirectory(at: userLaunchAgentsDirectory, withIntermediateDirectories: true)

        let plistContent: [String: Any] = [
            "Label": label,
            "ProgramArguments": [executablePath],
            "EnvironmentVariables": [
                "COZEA_PROJECTD_SOCKET": socketPath
            ],
            "RunAtLoad": true,
            "KeepAlive": true,
            "StandardOutPath": "/tmp/cozea-projectd.stdout.log",
            "StandardErrorPath": "/tmp/cozea-projectd.stderr.log",
            "ProcessType": "Interactive"
        ]

        let data = try PropertyListSerialization.data(fromPropertyList: plistContent, format: .xml, options: 0)
        try data.write(to: userPlistURL, options: .atomic)

        // SMAppService registration if bundled agent
        if #available(macOS 13.0, *) {
            let agent = SMAppService.agent(plistName: plistFileName)
            do {
                try agent.register()
            } catch {
                // If not in bundled app, fallback to launchctl bootstrap
                _ = runLaunchctl(arguments: ["bootstrap", "gui/\(getuid())", userPlistURL.path])
            }
        } else {
            _ = runLaunchctl(arguments: ["bootstrap", "gui/\(getuid())", userPlistURL.path])
        }
    }

    public func unregister() throws {
        if #available(macOS 13.0, *) {
            let agent = SMAppService.agent(plistName: plistFileName)
            try? agent.unregister()
        }

        _ = runLaunchctl(arguments: ["bootout", "gui/\(getuid())/\(label)"])

        if FileManager.default.fileExists(atPath: userPlistURL.path) {
            try? FileManager.default.removeItem(at: userPlistURL)
        }
    }

    private func checkLaunchctlLoaded() -> Bool {
        let output = runLaunchctl(arguments: ["list", label])
        return !output.isEmpty && !output.contains("Could not find service")
    }

    private func runLaunchctl(arguments: [String]) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        } catch {
            return ""
        }
    }
}
