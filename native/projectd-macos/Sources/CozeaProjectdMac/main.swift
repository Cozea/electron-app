import Foundation

struct HelperRequest: Codable {
    let id: String
    let command: String
    let params: [String: String]?
}

struct HelperResponse<T: Codable>: Codable {
    let id: String
    let success: Bool
    let result: T?
    let error: String?
}

func printJSON<T: Codable>(_ response: HelperResponse<T>) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(response), let str = String(data: data, encoding: .utf8) {
        print(str)
        fflush(stdout)
    }
}

/// Secrets (identity JSON, private keys) arrive on stdin so they never appear in the
/// process list the way argv does.
func readStandardInput() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}

func runCLI() {
    let args = CommandLine.arguments.dropFirst()
    let command = args.first ?? "help"

    switch command {
    case "keychain-save":
        let json = readStandardInput()
        guard !json.isEmpty else {
            fputs("Usage: cozea-projectd-mac-helper keychain-save < identity.json\n", stderr)
            exit(1)
        }
        do {
            try KeychainService.shared.saveIdentity(jsonString: json)
            printJSON(HelperResponse(id: "1", success: true, result: ["status": "saved"], error: nil))
        } catch {
            printJSON(HelperResponse<[String: String]>(id: "1", success: false, result: nil, error: error.localizedDescription))
            exit(1)
        }

    case "keychain-load":
        do {
            if let identity = try KeychainService.shared.loadIdentity() {
                printJSON(HelperResponse(id: "1", success: true, result: ["identity": identity], error: nil))
            } else {
                printJSON(HelperResponse<[String: String?]>(id: "1", success: true, result: ["identity": nil], error: nil))
            }
        } catch {
            printJSON(HelperResponse<[String: String?]>(id: "1", success: false, result: nil, error: error.localizedDescription))
            exit(1)
        }

    case "keychain-delete":
        do {
            try KeychainService.shared.deleteIdentity()
            printJSON(HelperResponse(id: "1", success: true, result: ["status": "deleted"], error: nil))
        } catch {
            printJSON(HelperResponse<[String: String]>(id: "1", success: false, result: nil, error: error.localizedDescription))
            exit(1)
        }

    case "sign-challenge":
        var challenge = ""
        let subArgs = Array(args.dropFirst())
        for i in 0..<subArgs.count where subArgs[i] == "--challenge" && i + 1 < subArgs.count {
            challenge = subArgs[i + 1]
        }
        let keyD = readStandardInput()
        guard !challenge.isEmpty, !keyD.isEmpty else {
            fputs("Usage: cozea-projectd-mac-helper sign-challenge --challenge <str> < base64url-d\n", stderr)
            exit(1)
        }
        do {
            let signature = try KeychainService.shared.signChallenge(challenge: challenge, privateKeyBase64UrlD: keyD)
            printJSON(HelperResponse(id: "1", success: true, result: ["signature": signature], error: nil))
        } catch {
            printJSON(HelperResponse<[String: String]>(id: "1", success: false, result: nil, error: error.localizedDescription))
            exit(1)
        }

    case "volume-probe":
        let path = args.count >= 2 ? Array(args)[1] : "/"
        let result = VolumeCapabilities.probe(path: path)
        printJSON(HelperResponse(id: "1", success: true, result: result, error: nil))

    case "launchagent-status":
        let status = LaunchAgentService.shared.status()
        printJSON(HelperResponse(id: "1", success: true, result: status, error: nil))

    case "launchagent-register":
        var execPath = ""
        var socketPath = ""
        let subArgs = Array(args.dropFirst())
        for i in 0..<subArgs.count {
            if subArgs[i] == "--exec" && i + 1 < subArgs.count {
                execPath = subArgs[i + 1]
            }
            if subArgs[i] == "--socket" && i + 1 < subArgs.count {
                socketPath = subArgs[i + 1]
            }
        }
        guard !execPath.isEmpty, !socketPath.isEmpty else {
            fputs("Usage: cozea-projectd-mac-helper launchagent-register --exec <path> --socket <path>\n", stderr)
            exit(1)
        }
        do {
            try LaunchAgentService.shared.register(executablePath: execPath, socketPath: socketPath)
            printJSON(HelperResponse(id: "1", success: true, result: ["status": "registered"], error: nil))
        } catch {
            printJSON(HelperResponse<[String: String]>(id: "1", success: false, result: nil, error: error.localizedDescription))
            exit(1)
        }

    case "launchagent-unregister":
        do {
            try LaunchAgentService.shared.unregister()
            printJSON(HelperResponse(id: "1", success: true, result: ["status": "unregistered"], error: nil))
        } catch {
            printJSON(HelperResponse<[String: String]>(id: "1", success: false, result: nil, error: error.localizedDescription))
            exit(1)
        }

    case "fsevents-smoke":
        let path = args.count >= 2 ? Array(args)[1] : "/tmp"
        let streamId = FSEventsService.shared.startStream(path: path, latency: 0.05) { events in
            for event in events {
                if let data = try? JSONEncoder().encode(event), let str = String(data: data, encoding: .utf8) {
                    print("EVENT: \(str)")
                    fflush(stdout)
                }
            }
        }
        printJSON(HelperResponse(id: "1", success: true, result: ["streamId": "\(streamId)", "path": path], error: nil))
        // Run runloop for 2 seconds to smoke test
        RunLoop.current.run(until: Date().addingTimeInterval(2.0))
        FSEventsService.shared.stopStream(streamId: streamId)

    case "fsevents-stream":
        let path = args.count >= 2 ? Array(args)[1] : "/tmp"
        var latency = 0.05
        let subArgs = Array(args.dropFirst())
        for i in 0..<subArgs.count {
            if subArgs[i] == "--latency" && i + 1 < subArgs.count, let l = Double(subArgs[i + 1]) {
                latency = l
            }
        }

        var currentStreamId: UInt64 = 0
        let streamId = FSEventsService.shared.startStream(path: path, latency: latency) { events in
            struct EventBatchMsg: Codable {
                let type: String
                let streamId: UInt64
                let items: [FSEventItem]
            }
            let msg = EventBatchMsg(type: "events", streamId: currentStreamId, items: events)
            if let data = try? JSONEncoder().encode(msg), let str = String(data: data, encoding: .utf8) {
                print(str)
                fflush(stdout)
            }
        }
        currentStreamId = streamId

        print("{\"type\":\"ready\",\"streamId\":\(streamId),\"path\":\"\(path)\"}")
        fflush(stdout)

        DispatchQueue.global().async {
            while let line = readLine() {
                if line.trimmingCharacters(in: .whitespacesAndNewlines) == "stop" {
                    break
                }
            }
            FSEventsService.shared.stopStream(streamId: streamId)
            exit(0)
        }

        RunLoop.current.run()

    case "help":
        fallthrough
    default:
        print("""
        cozea-projectd-mac-helper commands:
          keychain-save < identity.json
          keychain-load
          keychain-delete
          sign-challenge --challenge <str> < base64url-d
          volume-probe <path>
          launchagent-status
          launchagent-register --exec <path> --socket <path>
          launchagent-unregister
          fsevents-smoke <path>
        """)
    }
}

runCLI()
