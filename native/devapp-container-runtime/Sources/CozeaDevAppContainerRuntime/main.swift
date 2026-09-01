import Containerization
import ContainerizationEXT4
import ContainerizationOCI
import ContainerizationOS
import Darwin
import Foundation
import SystemPackage

private let protocolVersion = 1
private let minimumMemoryBytes: UInt64 = 256 * 1024 * 1024
private let maximumMemoryBytes: UInt64 = 4 * 1024 * 1024 * 1024
private let maximumRootfsBytes: UInt64 = 8 * 1024 * 1024 * 1024
private let maximumWritableBytes: UInt64 = 2 * 1024 * 1024 * 1024
private let maximumMounts = 8
private let maximumEnvironment = 64
private let maximumLogBytes = 64 * 1024

private func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
}

private struct RuntimeIdentity: Codable, Sendable {
    let organizationId: String
    let publicationId: String
    let releaseId: String
    let releaseVersion: Int
    let contentHash: String
}

private struct RuntimeImage: Codable, Sendable {
    let reference: String
    let manifestDigest: String
    let platformDigest: String
    let platform: String
    let signature: String
    let attestationDigest: String
}

private struct RuntimeResources: Codable, Sendable {
    let cpus: Int
    let memoryBytes: UInt64
    let rootfsBytes: UInt64
    let writableLayerBytes: UInt64
}

private struct FolderGrant: Codable, Sendable {
    let grantId: String
    let publicationId: String
    let releaseId: String
    let canonicalHostPath: String
    let guestPath: String
    let access: String
    let expiresAt: Double
}

private struct StartSpec: Codable, Sendable {
    let runtimeId: String
    let identity: RuntimeIdentity
    let location: String
    let state: String
    let image: RuntimeImage
    let command: [String]
    let environment: [String: String]
    let workingDirectory: String
    let servicePort: Int?
    let network: Bool
    let resources: RuntimeResources
    let folderGrants: [FolderGrant]
}

private struct HelperRequest: Codable, Sendable {
    let protocolVersion: Int
    let requestId: String
    let task: String
    let start: StartSpec?
    let runtimeId: String?
}

private struct Availability: Codable, Sendable {
    let available: Bool
    let adapter: String
    let protocolVersion: Int
    let reason: String?
}

private struct RuntimeState: Codable, Sendable {
    let runtimeId: String
    let status: String
    let location: String
    let state: String
    let publicationId: String
    let releaseId: String
    let imageDigest: String
    let guestAddress: String?
    let servicePort: Int?
    let startedAt: Double?
    let exitedAt: Double?
    let exitCode: Int32?
    let error: String?
}

private struct HelperResponse: Codable, Sendable {
    let protocolVersion: Int
    let requestId: String
    let success: Bool
    let availability: Availability?
    let state: RuntimeState?
    let error: String?
}

private struct HelperEvent: Codable, Sendable {
    let protocolVersion: Int
    let event: String
    let runtimeId: String
    let stream: String?
    let message: String?
    let state: RuntimeState?
}

private final class LineEmitter: @unchecked Sendable {
    private let lock = NSLock()

    func emit<T: Encodable>(_ value: T) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }

    func event(runtimeId: String, stream: String, message: String) {
        let bounded = String(decoding: message.utf8.prefix(maximumLogBytes), as: UTF8.self)
        emit(HelperEvent(
            protocolVersion: protocolVersion,
            event: "log",
            runtimeId: runtimeId,
            stream: stream,
            message: bounded,
            state: nil
        ))
    }

    func state(_ state: RuntimeState) {
        emit(HelperEvent(
            protocolVersion: protocolVersion,
            event: "state",
            runtimeId: state.runtimeId,
            stream: nil,
            message: nil,
            state: state
        ))
    }
}

private final class RuntimeLogWriter: Writer, @unchecked Sendable {
    private let emitter: LineEmitter
    private let runtimeId: String
    private let stream: String

    init(emitter: LineEmitter, runtimeId: String, stream: String) {
        self.emitter = emitter
        self.runtimeId = runtimeId
        self.stream = stream
    }

    func write(_ data: Data) throws {
        guard !data.isEmpty else { return }
        emitter.event(
            runtimeId: runtimeId,
            stream: stream,
            message: String(decoding: data.prefix(maximumLogBytes), as: UTF8.self)
        )
    }

    func close() throws {}
}

private struct ActiveRuntime: Sendable {
    let container: LinuxContainer
    var state: RuntimeState
}

private actor RuntimeCoordinator {
    private let root: URL
    private let kernelPath: URL
    private let initfsReference: String
    private let emitter: LineEmitter
    private var manager: ContainerManager?
    private var runtimes: [String: ActiveRuntime] = [:]

    init(root: URL, kernelPath: URL, initfsReference: String, emitter: LineEmitter) {
        self.root = root
        self.kernelPath = kernelPath
        self.initfsReference = initfsReference
        self.emitter = emitter
    }

    func availability() -> Availability {
        guard #available(macOS 26, *) else {
            return Availability(
                available: false,
                adapter: "unavailable",
                protocolVersion: protocolVersion,
                reason: "The device runtime requires macOS 26 or newer."
            )
        }
        guard FileManager.default.fileExists(atPath: kernelPath.path) else {
            return Availability(
                available: false,
                adapter: "unavailable",
                protocolVersion: protocolVersion,
                reason: "The signed Linux kernel resource is missing."
            )
        }
        return Availability(
            available: true,
            adapter: "apple-containerization",
            protocolVersion: protocolVersion,
            reason: nil
        )
    }

    private func ensureManager() async throws {
        if manager != nil { return }
        guard availability().available else {
            throw RuntimeError.invalid("The Apple Containerization runtime is unavailable.")
        }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        manager = try await ContainerManager(
            kernel: Kernel(path: kernelPath, platform: .linuxArm),
            initfsReference: initfsReference,
            root: root,
            network: try VmnetNetwork()
        )
    }

    func start(_ spec: StartSpec) async throws -> RuntimeState {
        try validate(spec)
        if let active = runtimes[spec.runtimeId], active.state.status == "running" {
            return active.state
        }
        try await ensureManager()
        guard var currentManager = manager else {
            throw RuntimeError.invalid("The container manager did not initialize.")
        }

        let stdout = RuntimeLogWriter(emitter: emitter, runtimeId: spec.runtimeId, stream: "stdout")
        let stderr = RuntimeLogWriter(emitter: emitter, runtimeId: spec.runtimeId, stream: "stderr")
        let stateMount = try stateMount(for: spec)
        let grants = try spec.folderGrants.map { try folderMount($0, spec: spec) }
        let container = try await currentManager.create(
            spec.runtimeId,
            reference: spec.image.reference,
            rootfsSizeInBytes: spec.resources.rootfsBytes,
            writableLayerSizeInBytes: spec.resources.writableLayerBytes,
            readOnly: true,
            networking: spec.network
        ) { config in
            config.cpus = spec.resources.cpus
            config.memoryInBytes = spec.resources.memoryBytes
            config.hostname = "cozea-\(spec.runtimeId)"
            config.process.arguments = spec.command
            config.process.environmentVariables = ["PATH=\(LinuxProcessConfiguration.defaultPath)"]
                + spec.environment.sorted(by: { $0.key < $1.key }).map { "\($0.key)=\($0.value)" }
            config.process.workingDirectory = spec.workingDirectory
            config.process.noNewPrivileges = true
            config.process.capabilities = LinuxCapabilities()
            config.process.stdout = stdout
            config.process.stderr = stderr
            config.process.rlimits = [
                LinuxRLimit(kind: .openFiles, limit: 4096),
                LinuxRLimit(kind: .numberOfProcesses, limit: 512),
                LinuxRLimit(kind: .coreFileSize, limit: 0),
            ]
            if let stateMount { config.mounts.append(stateMount) }
            config.mounts.append(contentsOf: grants)
            config.useInit = true
        }
        manager = currentManager

        let starting = stateFor(spec, status: "starting")
        runtimes[spec.runtimeId] = ActiveRuntime(container: container, state: starting)
        emitter.state(starting)
        do {
            try await container.create()
            try await container.start()
        } catch {
            try? await container.stop()
            try? currentManager.delete(spec.runtimeId)
            manager = currentManager
            runtimes.removeValue(forKey: spec.runtimeId)
            throw error
        }

        let address = container.config.interfaces.first?.ipv4Address.address.description
        let running = RuntimeState(
            runtimeId: spec.runtimeId,
            status: "running",
            location: spec.location,
            state: spec.state,
            publicationId: spec.identity.publicationId,
            releaseId: spec.identity.releaseId,
            imageDigest: spec.image.manifestDigest,
            guestAddress: address,
            servicePort: spec.servicePort,
            startedAt: Date().timeIntervalSince1970 * 1000,
            exitedAt: nil,
            exitCode: nil,
            error: nil
        )
        runtimes[spec.runtimeId] = ActiveRuntime(container: container, state: running)
        emitter.state(running)
        Task { [container] in
            do {
                let status = try await container.wait()
                await self.recordExit(runtimeId: spec.runtimeId, status: status, error: nil)
            } catch {
                await self.recordExit(
                    runtimeId: spec.runtimeId,
                    status: nil,
                    error: "The contained process exited unexpectedly."
                )
            }
        }
        return running
    }

    func inspect(_ runtimeId: String) -> RuntimeState? {
        runtimes[runtimeId]?.state
    }

    func stop(_ runtimeId: String) async throws -> RuntimeState {
        guard var active = runtimes[runtimeId] else {
            throw RuntimeError.invalid("The contained runtime does not exist.")
        }
        if active.state.status == "stopped" || active.state.status == "failed" {
            return active.state
        }
        active.state = RuntimeState(
            runtimeId: active.state.runtimeId,
            status: "stopping",
            location: active.state.location,
            state: active.state.state,
            publicationId: active.state.publicationId,
            releaseId: active.state.releaseId,
            imageDigest: active.state.imageDigest,
            guestAddress: active.state.guestAddress,
            servicePort: active.state.servicePort,
            startedAt: active.state.startedAt,
            exitedAt: nil,
            exitCode: nil,
            error: nil
        )
        runtimes[runtimeId] = active
        emitter.state(active.state)
        try? await active.container.kill(.term)
        let status = try? await active.container.wait(timeoutInSeconds: 10)
        if status == nil {
            try? await active.container.kill(.kill)
        }
        try await active.container.stop()
        await recordExit(runtimeId: runtimeId, status: status, error: nil)
        guard let stopped = runtimes[runtimeId]?.state else {
            throw RuntimeError.invalid("The contained runtime disappeared during stop.")
        }
        return stopped
    }

    func delete(_ runtimeId: String) async throws -> RuntimeState? {
        if let active = runtimes[runtimeId], active.state.status != "stopped" && active.state.status != "failed" {
            _ = try await stop(runtimeId)
        }
        let previous = runtimes.removeValue(forKey: runtimeId)?.state
        if var currentManager = manager {
            try currentManager.delete(runtimeId)
            manager = currentManager
        }
        return previous
    }

    private func recordExit(runtimeId: String, status: ExitStatus?, error: String?) async {
        guard var active = runtimes[runtimeId] else { return }
        try? await active.container.stop()
        active.state = RuntimeState(
            runtimeId: active.state.runtimeId,
            status: error == nil ? "stopped" : "failed",
            location: active.state.location,
            state: active.state.state,
            publicationId: active.state.publicationId,
            releaseId: active.state.releaseId,
            imageDigest: active.state.imageDigest,
            guestAddress: nil,
            servicePort: active.state.servicePort,
            startedAt: active.state.startedAt,
            exitedAt: (status?.exitedAt ?? Date()).timeIntervalSince1970 * 1000,
            exitCode: status?.exitCode,
            error: error
        )
        runtimes[runtimeId] = active
        emitter.state(active.state)
    }

    private func stateFor(_ spec: StartSpec, status: String) -> RuntimeState {
        RuntimeState(
            runtimeId: spec.runtimeId,
            status: status,
            location: spec.location,
            state: spec.state,
            publicationId: spec.identity.publicationId,
            releaseId: spec.identity.releaseId,
            imageDigest: spec.image.manifestDigest,
            guestAddress: nil,
            servicePort: spec.servicePort,
            startedAt: nil,
            exitedAt: nil,
            exitCode: nil,
            error: nil
        )
    }

    private func stateMount(for spec: StartSpec) throws -> Containerization.Mount? {
        guard spec.state == "device" else { return nil }
        let stateRoot = root.appendingPathComponent("state", isDirectory: true)
        try FileManager.default.createDirectory(at: stateRoot, withIntermediateDirectories: true)
        let statePath = stateRoot.appendingPathComponent("\(spec.identity.publicationId).ext4")
        if !FileManager.default.fileExists(atPath: statePath.path) {
            let filesystem = try EXT4.Formatter(
                FilePath(statePath.path),
                minDiskSize: min(max(spec.resources.writableLayerBytes, minimumMemoryBytes), maximumWritableBytes)
            )
            try filesystem.close()
        }
        return .block(
            format: "ext4",
            source: statePath.path,
            destination: "/cozea/state"
        )
    }

    private func folderMount(_ grant: FolderGrant, spec: StartSpec) throws -> Containerization.Mount {
        guard grant.publicationId == spec.identity.publicationId,
              grant.releaseId == spec.identity.releaseId,
              grant.expiresAt > Date().timeIntervalSince1970 * 1000 else {
            throw RuntimeError.invalid("A folder grant does not match this release or has expired.")
        }
        guard grant.guestPath.hasPrefix("/cozea/grants/"),
              grant.guestPath.split(separator: "/").count == 4 else {
            throw RuntimeError.invalid("A folder grant has an invalid guest path.")
        }
        let source = URL(fileURLWithPath: grant.canonicalHostPath).standardizedFileURL
        let resolved = source.resolvingSymlinksInPath()
        guard source.path == resolved.path,
              FileManager.default.fileExists(atPath: resolved.path) else {
            throw RuntimeError.invalid("A folder grant is missing or no longer canonical.")
        }
        guard grant.access == "read" || grant.access == "readWrite" else {
            throw RuntimeError.invalid("A folder grant has an invalid access mode.")
        }
        return .share(
            source: resolved.path,
            destination: grant.guestPath,
            options: grant.access == "read" ? ["ro"] : []
        )
    }

    private func validate(_ spec: StartSpec) throws {
        guard spec.location == "device" else {
            throw RuntimeError.invalid("The macOS helper accepts only device runtimes.")
        }
        guard spec.state == "none" || spec.state == "device" else {
            throw RuntimeError.invalid("A device runtime cannot own organization state.")
        }
        guard matches(spec.runtimeId, "^[a-z0-9][a-z0-9_-]{0,63}$") else {
            throw RuntimeError.invalid("The runtime ID is invalid.")
        }
        guard matches(spec.identity.publicationId, "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"),
              matches(spec.identity.releaseId, "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$") else {
            throw RuntimeError.invalid("The immutable release identity is invalid.")
        }
        guard matches(spec.image.reference, "^.+@sha256:[a-f0-9]{64}$"),
              matches(spec.image.manifestDigest, "^sha256:[a-f0-9]{64}$"),
              matches(spec.image.platformDigest, "^sha256:[a-f0-9]{64}$"),
              spec.image.platform == "linux/arm64" else {
            throw RuntimeError.invalid("The device image is not an exact Linux ARM64 image.")
        }
        guard !spec.image.signature.isEmpty, !spec.image.attestationDigest.isEmpty else {
            throw RuntimeError.invalid("The image has no verified signature or attestation.")
        }
        guard !spec.command.isEmpty, spec.command.count <= 64,
              spec.command.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 4096 }) else {
            throw RuntimeError.invalid("The container command is invalid.")
        }
        guard spec.workingDirectory.hasPrefix("/"),
              !spec.workingDirectory.contains("..") else {
            throw RuntimeError.invalid("The container working directory is invalid.")
        }
        guard spec.environment.count <= maximumEnvironment,
              spec.environment.allSatisfy({ key, value in
                  matches(key, "^[A-Z_][A-Z0-9_]{0,127}$") && value.utf8.count <= 16 * 1024
              }) else {
            throw RuntimeError.invalid("The container environment is invalid.")
        }
        guard spec.folderGrants.count <= maximumMounts else {
            throw RuntimeError.invalid("The container has too many folder grants.")
        }
        guard (1...4).contains(spec.resources.cpus),
              (minimumMemoryBytes...maximumMemoryBytes).contains(spec.resources.memoryBytes),
              (minimumMemoryBytes...maximumRootfsBytes).contains(spec.resources.rootfsBytes),
              (minimumMemoryBytes...maximumWritableBytes).contains(spec.resources.writableLayerBytes) else {
            throw RuntimeError.invalid("The container resource limits are invalid.")
        }
        if let port = spec.servicePort, !(1...65535).contains(port) {
            throw RuntimeError.invalid("The service port is invalid.")
        }
    }
}

private enum RuntimeError: Error, LocalizedError {
    case invalid(String)

    var errorDescription: String? {
        switch self {
        case .invalid(let message): message
        }
    }
}

private func option(_ name: String, arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
        return nil
    }
    return arguments[index + 1]
}

@main
private struct CozeaDevAppContainerRuntime {
    static func main() async {
        let arguments = CommandLine.arguments
        guard let rootPath = option("--root", arguments: arguments),
              let kernelPath = option("--kernel", arguments: arguments),
              let initfsReference = option("--initfs", arguments: arguments) else {
            FileHandle.standardError.write(
                Data("Missing --root, --kernel, or --initfs.\n".utf8)
            )
            exit(64)
        }

        let emitter = LineEmitter()
        let coordinator = RuntimeCoordinator(
            root: URL(fileURLWithPath: rootPath, isDirectory: true),
            kernelPath: URL(fileURLWithPath: kernelPath),
            initfsReference: initfsReference,
            emitter: emitter
        )

        while let line = readLine(strippingNewline: true) {
            guard line.utf8.count <= 2 * 1024 * 1024,
                  let data = line.data(using: .utf8) else {
                emitter.emit(HelperResponse(
                    protocolVersion: protocolVersion,
                    requestId: "unknown",
                    success: false,
                    availability: nil,
                    state: nil,
                    error: "The helper request is too large."
                ))
                continue
            }

            let request: HelperRequest
            do {
                request = try JSONDecoder().decode(HelperRequest.self, from: data)
            } catch {
                emitter.emit(HelperResponse(
                    protocolVersion: protocolVersion,
                    requestId: "unknown",
                    success: false,
                    availability: nil,
                    state: nil,
                    error: "The helper request is invalid."
                ))
                continue
            }

            guard request.protocolVersion == protocolVersion else {
                emitter.emit(HelperResponse(
                    protocolVersion: protocolVersion,
                    requestId: request.requestId,
                    success: false,
                    availability: nil,
                    state: nil,
                    error: "The helper protocol version is unsupported."
                ))
                continue
            }

            do {
                let response: HelperResponse
                switch request.task {
                case "status":
                    response = HelperResponse(
                        protocolVersion: protocolVersion,
                        requestId: request.requestId,
                        success: true,
                        availability: await coordinator.availability(),
                        state: nil,
                        error: nil
                    )
                case "start":
                    guard let start = request.start else {
                        throw RuntimeError.invalid("A start request has no runtime specification.")
                    }
                    response = HelperResponse(
                        protocolVersion: protocolVersion,
                        requestId: request.requestId,
                        success: true,
                        availability: nil,
                        state: try await coordinator.start(start),
                        error: nil
                    )
                case "inspect":
                    guard let runtimeId = request.runtimeId,
                          let state = await coordinator.inspect(runtimeId) else {
                        throw RuntimeError.invalid("The contained runtime does not exist.")
                    }
                    response = HelperResponse(
                        protocolVersion: protocolVersion,
                        requestId: request.requestId,
                        success: true,
                        availability: nil,
                        state: state,
                        error: nil
                    )
                case "stop":
                    guard let runtimeId = request.runtimeId else {
                        throw RuntimeError.invalid("A stop request has no runtime ID.")
                    }
                    response = HelperResponse(
                        protocolVersion: protocolVersion,
                        requestId: request.requestId,
                        success: true,
                        availability: nil,
                        state: try await coordinator.stop(runtimeId),
                        error: nil
                    )
                case "delete":
                    guard let runtimeId = request.runtimeId else {
                        throw RuntimeError.invalid("A delete request has no runtime ID.")
                    }
                    response = HelperResponse(
                        protocolVersion: protocolVersion,
                        requestId: request.requestId,
                        success: true,
                        availability: nil,
                        state: try await coordinator.delete(runtimeId),
                        error: nil
                    )
                default:
                    throw RuntimeError.invalid("The helper task is unsupported.")
                }
                emitter.emit(response)
            } catch {
                emitter.emit(HelperResponse(
                    protocolVersion: protocolVersion,
                    requestId: request.requestId,
                    success: false,
                    availability: nil,
                    state: nil,
                    error: error.localizedDescription
                ))
            }
        }
    }
}
