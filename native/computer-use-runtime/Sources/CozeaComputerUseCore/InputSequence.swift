import Foundation

/// Shared by the native action router and fault-injection tests. The action cannot
/// be admitted before successful visible arrival AND a second target validation.
public enum CausalPointerSequence {
    public static func perform<Target: Sendable>(
        control: ActionControl,
        resolve: @Sendable () async throws -> Target,
        arrive: @Sendable (Target) async throws -> Void,
        revalidate: @Sendable (Target) async throws -> Void,
        dispatch: @Sendable (Target) async throws -> String
    ) async throws -> String {
        try control.check()
        let target = try await resolve()
        try control.check()
        try await arrive(target)
        try control.check()
        try await revalidate(target)
        try control.check()
        return try await dispatch(target)
    }
}

public enum UnicodeInput {
    /// Split only at Unicode scalar boundaries; a combining grapheme may be
    /// longer than one event but a UTF-16 surrogate pair must never be split.
    public static func chunks(_ text: String, maxUnits: Int = 64) -> [[UInt16]] {
        precondition(maxUnits >= 2)
        var result: [[UInt16]] = []; var current: [UInt16] = []
        for scalar in text.unicodeScalars {
            let units = Array(String(scalar).utf16)
            if current.count + units.count > maxUnits { result.append(current); current.removeAll(keepingCapacity: true) }
            current.append(contentsOf: units)
        }
        if !current.isEmpty { result.append(current) }
        return result
    }
}
