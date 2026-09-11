import Foundation

public struct VolumeCapabilitiesResult: Codable {
    public let path: String
    public let isCaseSensitive: Bool
    public let supportsCloning: Bool
    public let fileSystemType: String
}

public final class VolumeCapabilities: @unchecked Sendable {
    public static func probe(path: String) -> VolumeCapabilitiesResult {
        let url = URL(fileURLWithPath: path)
        var isCaseSensitive = false
        var supportsCloning = false
        var fileSystemType = "unknown"

        do {
            let values = try url.resourceValues(forKeys: [
                .volumeSupportsCaseSensitiveNamesKey,
                .volumeSupportsFileCloningKey,
                .volumeLocalizedFormatDescriptionKey
            ])

            isCaseSensitive = values.volumeSupportsCaseSensitiveNames ?? false
            supportsCloning = values.volumeSupportsFileCloning ?? false
            fileSystemType = values.volumeLocalizedFormatDescription ?? "unknown"
        } catch {
            // Fallback heuristics
        }

        return VolumeCapabilitiesResult(
            path: path,
            isCaseSensitive: isCaseSensitive,
            supportsCloning: supportsCloning,
            fileSystemType: fileSystemType
        )
    }
}
