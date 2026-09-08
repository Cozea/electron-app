import Foundation
#if os(macOS)
import Darwin
#endif

/// Shared with the managed T3 adapter; schemas and descriptions have one source.
public enum ToolCatalogue {
    public static func jsonText() throws -> String {
        #if os(macOS)
        // Locate the resource beside the loaded dylib, or alongside an XCTest
        // bundle. Never depend on SwiftPM's absolute build-machine fallback.
        var info = Dl_info()
        if dladdr(#dsohandle, &info) != 0, let image = info.dli_fname {
            var directory = URL(fileURLWithPath: String(cString: image)).deletingLastPathComponent()
            for _ in 0..<4 {
                let bundleURL = directory.appendingPathComponent("CozeaComputerUseRuntime_CozeaComputerUseCore.bundle")
                if let url = Bundle(url: bundleURL)?.url(forResource: "tools", withExtension: "json") {
                    return try String(contentsOf: url, encoding: .utf8)
                }
                directory.deleteLastPathComponent()
            }
        }
        throw RuntimeFailure(.internalError, "Computer Use tool catalogue resource is missing.")
        #else
        guard let url = Bundle.module.url(forResource: "tools", withExtension: "json") else {
            throw RuntimeFailure(.internalError, "Computer Use tool catalogue resource is missing.")
        }
        return try String(contentsOf: url, encoding: .utf8)
        #endif
    }
}
