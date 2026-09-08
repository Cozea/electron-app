import Foundation

/// Coordinate input has no semantic AX handle to revalidate. Reject known UI
/// changes and expired observations instead of reusing stale screenshot pixels.
public enum CoordinateLeaseGuard {
    public static func validate(observedVersion: UInt64, currentObservedVersion: UInt64,
                                inputVersion: UInt64, currentInputVersion: UInt64,
                                age: Duration) throws {
        guard observedVersion == currentObservedVersion, inputVersion == currentInputVersion,
              age >= .zero, age <= .seconds(30) else {
            throw RuntimeFailure(.staleObservation, "The screenshot is stale. Call get_app_state before a coordinate action.")
        }
    }
}
