import Foundation

/// Leases never remap an index to a different element. A read can publish a new
/// lease while an action retains its old immutable lease and revalidates it.
public actor ObservationStore<Value: Sendable> {
    private struct Entry: Sendable {
        let id: String
        let aliases: Set<String>
        let value: Value
    }
    private var sessions: [String: [Entry]] = [:]
    private let perSessionLimit: Int
    private let sessionLimit: Int

    public init(perSessionLimit: Int = 4, sessionLimit: Int = 64) {
        self.perSessionLimit = max(1, perSessionLimit)
        self.sessionLimit = max(1, sessionLimit)
    }

    public func publish(session: String, id: String, aliases: [String], value: Value) throws {
        guard sessions[session] != nil || sessions.count < sessionLimit else {
            throw RuntimeFailure(.busy, "Too many Computer Use sessions.")
        }
        var entries = sessions[session] ?? []
        entries.removeAll { $0.id == id }
        entries.append(Entry(id: id, aliases: Set(aliases.map(Self.normalize)), value: value))
        if entries.count > perSessionLimit { entries.removeFirst(entries.count - perSessionLimit) }
        sessions[session] = entries
    }

    public func lease(session: String, app: String, id: String? = nil) throws -> Value {
        let alias = Self.normalize(app)
        let entries = sessions[session] ?? []
        if let id {
            guard let entry = entries.first(where: { $0.id == id && $0.aliases.contains(alias) }) else {
                throw RuntimeFailure(.staleObservation, "This snapshot is unavailable for this session/app. Call get_app_state.")
            }
            return entry.value
        }
        guard let entry = entries.last(where: { $0.aliases.contains(alias) }) else {
            throw RuntimeFailure(.stateRequired, "Call get_app_state for the target app before an action.")
        }
        return entry.value
    }

    public func remove(session: String) { sessions.removeValue(forKey: session) }
    public func reset() { sessions.removeAll() }
    private static func normalize(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
}
