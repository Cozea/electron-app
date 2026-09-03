import ContainerizationOCI
import CryptoKit
import Foundation

/// Fetches an exact image into an OCI layout directory, without a token exchange.
///
/// `ImageStore.pull` only accepts an `Authentication`, and spends it at the registry's
/// token endpoint rather than on the `/v2/` request itself. The gateway has already
/// completed that exchange and hands the device the resulting registry token, which
/// GHCR refuses to accept a second time as a credential -- it answers the replay with
/// its own challenge, and Containerization reports that as a refusal to exchange
/// credentials insecurely. Fetching here lets the token be used the only way it is
/// valid: as a bearer on the resource requests. The layout this writes is then handed
/// to `ImageStore.load`, so unpacking, verification and storage stay with the library.
///
/// Only the platform manifest named by the release is fetched. Nothing selects a
/// manifest from the registry's own index, so a registry cannot substitute a different
/// platform, and every blob is checked against the digest that referenced it.
enum RegistryPull {
    static func fetchOCILayout(
        reference: String,
        platformDigest: String,
        platform: String,
        token: String,
        into directory: URL
    ) async throws {
        let target = try RegistryTarget(reference: reference)
        let session = URLSession(
            configuration: .ephemeral,
            delegate: CredentialScopedRedirects(registryHost: target.host),
            delegateQueue: nil
        )
        defer { session.finishTasksAndInvalidate() }

        let blobs = directory.appendingPathComponent("blobs/sha256", isDirectory: true)
        try FileManager.default.createDirectory(at: blobs, withIntermediateDirectories: true)

        var imageDigest = platformDigest
        var imageBody = try await get(
            session: session,
            url: target.manifestURL(platformDigest),
            token: token,
            accept: manifestAcceptTypes
        )
        try verify(imageBody, matches: platformDigest, what: "image manifest")
        try write(imageBody, to: blobs, digest: platformDigest)

        // A release names the digest the builder reported for its platform, and with
        // provenance enabled that is an index holding the image alongside its
        // attestations rather than the image manifest itself. Resolve through it when
        // so. Choosing from this index is not the registry choosing for us: its digest
        // came from the signed release and was checked above, so only its own contents
        // are on offer here.
        if isIndex(imageBody) {
            let index = try JSONDecoder().decode(Index.self, from: imageBody)
            guard let entry = index.manifests.first(where: { matchesPlatform($0, platform) }) else {
                throw RegistryPullError.transport(
                    "The DevApp image index has no \(platform) manifest."
                )
            }
            imageDigest = entry.digest
            imageBody = try await get(
                session: session,
                url: target.manifestURL(entry.digest),
                token: token,
                accept: manifestAcceptTypes
            )
            try verify(imageBody, matches: entry.digest, what: "platform image manifest")
            try write(imageBody, to: blobs, digest: entry.digest)
        }

        let manifest = try JSONDecoder().decode(Manifest.self, from: imageBody)
        // The config and every layer, each verified against the digest that named it.
        for descriptor in [manifest.config] + manifest.layers {
            let body = try await get(
                session: session,
                url: target.blobURL(descriptor.digest),
                token: token,
                accept: [descriptor.mediaType]
            )
            try verify(body, matches: descriptor.digest, what: "blob \(descriptor.digest)")
            try write(body, to: blobs, digest: descriptor.digest)
        }

        try writeLayout(directory: directory, reference: reference, manifest: imageBody, digest: imageDigest)
    }

    // MARK: - Layout

    private static func writeLayout(
        directory: URL,
        reference: String,
        manifest: Data,
        digest: String
    ) throws {
        let layout = ["imageLayoutVersion": "1.0.0"]
        try JSONSerialization
            .data(withJSONObject: layout, options: [.sortedKeys])
            .write(to: directory.appendingPathComponent("oci-layout"), options: .atomic)

        // `load` resolves the image name from these annotations; without one it would
        // fall back to a digest-derived reference and the release would be stored under
        // a name nothing else refers to.
        let index: [String: Any] = [
            "schemaVersion": 2,
            "mediaType": MediaTypes.index,
            "manifests": [
                [
                    "mediaType": MediaTypes.imageManifest,
                    "digest": digest,
                    "size": manifest.count,
                    "annotations": [
                        AnnotationKeys.openContainersImageName: reference,
                        AnnotationKeys.containerizationImageName: reference,
                    ],
                ]
            ],
        ]
        try JSONSerialization
            .data(withJSONObject: index, options: [.sortedKeys])
            .write(to: directory.appendingPathComponent("index.json"), options: .atomic)
    }

    private static func write(_ body: Data, to blobs: URL, digest: String) throws {
        let name = String(digest.dropFirst("sha256:".count))
        try body.write(to: blobs.appendingPathComponent(name), options: .atomic)
    }

    /// An index carries `manifests`; an image manifest carries `config`.
    private static func isIndex(_ body: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            return false
        }
        return object["manifests"] != nil && object["config"] == nil
    }

    /// Attestation entries sit in the same index under an "unknown" platform, so match
    /// the os and architecture the release asked for rather than taking the first entry.
    private static func matchesPlatform(_ descriptor: Descriptor, _ platform: String) -> Bool {
        let parts = platform.split(separator: "/").map(String.init)
        guard parts.count >= 2, let entry = descriptor.platform else { return false }
        return entry.os == parts[0] && entry.architecture == parts[1]
    }

    // MARK: - Transport

    /// GHCR answers with 404, not 406, when the stored manifest's media type is absent
    /// from Accept, so an incomplete list looks exactly like a missing image. Buildx
    /// writes Docker types by default and OCI types when asked, and a release may name
    /// either a single manifest or an index, so offer all four.
    private static let manifestAcceptTypes = [
        MediaTypes.imageManifest,
        MediaTypes.dockerManifest,
        MediaTypes.index,
        MediaTypes.dockerManifestList,
    ]

    private static func get(
        session: URLSession,
        url: URL,
        token: String,
        accept: [String]
    ) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(accept.joined(separator: ", "), forHTTPHeaderField: "Accept")
        request.setValue("Cozea-DevApp-Runtime/1", forHTTPHeaderField: "User-Agent")

        let (body, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RegistryPullError.transport("The registry returned a malformed response for \(url.path).")
        }
        guard http.statusCode == 200 else {
            throw RegistryPullError.transport(
                "The registry returned HTTP \(http.statusCode) for \(url.path)."
            )
        }
        return body
    }

    private static func verify(_ body: Data, matches digest: String, what: String) throws {
        let actual = "sha256:" + SHA256.hash(data: body).map { String(format: "%02x", $0) }.joined()
        guard actual == digest else {
            throw RegistryPullError.digestMismatch(
                "The \(what) did not match its digest: expected \(digest), got \(actual)."
            )
        }
    }
}

enum RegistryPullError: Error, CustomStringConvertible {
    case invalidReference(String)
    case transport(String)
    case digestMismatch(String)

    var description: String {
        switch self {
        case .invalidReference(let message), .transport(let message), .digestMismatch(let message):
            return message
        }
    }
}

/// Splits a digest-pinned reference into the registry host and repository path.
private struct RegistryTarget {
    let host: String
    let repository: String

    init(reference: String) throws {
        let withoutDigest = reference.split(separator: "@", maxSplits: 1).first.map(String.init) ?? reference
        guard let slash = withoutDigest.firstIndex(of: "/") else {
            throw RegistryPullError.invalidReference("The image reference names no repository: \(reference).")
        }
        host = String(withoutDigest[withoutDigest.startIndex..<slash])
        repository = String(withoutDigest[withoutDigest.index(after: slash)...])
        guard !host.isEmpty, !repository.isEmpty, !host.contains(".."), !repository.contains("..") else {
            throw RegistryPullError.invalidReference("The image reference is not a valid registry path: \(reference).")
        }
    }

    func manifestURL(_ digest: String) throws -> URL { try url("manifests", digest) }
    func blobURL(_ digest: String) throws -> URL { try url("blobs", digest) }

    private func url(_ kind: String, _ digest: String) throws -> URL {
        guard digest.hasPrefix("sha256:"), digest.count == 71,
              digest.dropFirst(7).allSatisfy({ $0.isHexDigit && !$0.isUppercase }),
              let url = URL(string: "https://\(host)/v2/\(repository)/\(kind)/\(digest)")
        else {
            throw RegistryPullError.invalidReference("The image digest is not a valid sha256: \(digest).")
        }
        return url
    }
}

/// Registries redirect blob reads to storage on another host. Following that redirect
/// with the Authorization header still attached would hand the registry token to a
/// third party, so it is dropped whenever the destination host changes.
private final class CredentialScopedRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let registryHost: String

    init(registryHost: String) {
        self.registryHost = registryHost
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard request.url?.host != registryHost else {
            completionHandler(request)
            return
        }
        var stripped = request
        stripped.setValue(nil, forHTTPHeaderField: "Authorization")
        completionHandler(stripped)
    }
}
