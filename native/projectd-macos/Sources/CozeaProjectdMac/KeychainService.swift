import Foundation
import Security
import CryptoKit

public enum KeychainServiceError: Error, LocalizedError {
    case itemNotFound
    case duplicateItem
    case unexpectedStatus(OSStatus)
    case invalidData
    case invalidKeyFormat
    case signingFailed(String)

    public var errorDescription: String? {
        switch self {
        case .itemNotFound:
            return "Item not found in macOS Keychain"
        case .duplicateItem:
            return "Item already exists in macOS Keychain"
        case .unexpectedStatus(let status):
            return "Keychain operation failed with OSStatus \(status)"
        case .invalidData:
            return "Invalid data retrieved from Keychain"
        case .invalidKeyFormat:
            return "Invalid P-256 key format in JWK"
        case .signingFailed(let msg):
            return "Signing failed: \(msg)"
        }
    }
}

public final class KeychainService: @unchecked Sendable {
    public static let shared = KeychainService()

    private let serviceName = "app.cozea.projectd.identity"
    private let accountName = "device_identity"

    private init() {}

    public func saveIdentity(jsonString: String, account: String? = nil) throws {
        let targetAccount = account ?? accountName
        try? deleteIdentity(account: targetAccount)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        process.arguments = [
            "add-generic-password",
            "-a", targetAccount,
            "-s", serviceName,
            "-w", jsonString,
            "-U",
            "-A"
        ]
        let errPipe = Pipe()
        process.standardError = errPipe
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus != 0 {
            let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
            let errMsg = String(data: errData, encoding: .utf8) ?? "Unknown security error"
            throw KeychainServiceError.signingFailed("Failed to save identity via security: \(errMsg)")
        }
    }

    public func loadIdentity(account: String? = nil) throws -> String? {
        let targetAccount = account ?? accountName
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        process.arguments = [
            "find-generic-password",
            "-a", targetAccount,
            "-s", serviceName,
            "-w"
        ]
        let outPipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus != 0 {
            return nil
        }
        let data = outPipe.fileHandleForReading.readDataToEndOfFile()
        guard let str = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !str.isEmpty else {
            return nil
        }
        return str
    }

    public func deleteIdentity(account: String? = nil) throws {
        let targetAccount = account ?? accountName
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        process.arguments = [
            "delete-generic-password",
            "-a", targetAccount,
            "-s", serviceName
        ]
        let errPipe = Pipe()
        process.standardError = errPipe
        try process.run()
        process.waitUntilExit()
    }

    /**
     * Signs a challenge using a raw P-256 private key scalar (derived from JWK 'd' parameter)
     * producing an ECDSA P-256 SHA-256 signature in IEEE P1363 (r || s, 64-byte) format,
     * base64url-encoded.
     */
    public func signChallenge(challenge: String, privateKeyBase64UrlD: String) throws -> String {
        guard let challengeData = challenge.data(using: .utf8) else {
            throw KeychainServiceError.invalidData
        }

        // Decode base64url 'd'
        var base64 = privateKeyBase64UrlD
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 {
            base64.append("=")
        }

        guard let dData = Data(base64Encoded: base64) else {
            throw KeychainServiceError.invalidKeyFormat
        }

        guard let privateKey = try? P256.Signing.PrivateKey(rawRepresentation: dData) else {
            throw KeychainServiceError.invalidKeyFormat
        }

        guard let signature = try? privateKey.signature(for: challengeData) else {
            throw KeychainServiceError.signingFailed("CryptoKit failed to generate ECDSA signature")
        }

        // P-256 raw representation is 64 bytes (r || s, 32 bytes each) matching WebCrypto / IEEE P1363
        let rawSignature = signature.rawRepresentation
        let signatureBase64Url = rawSignature.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        return signatureBase64Url
    }
}
