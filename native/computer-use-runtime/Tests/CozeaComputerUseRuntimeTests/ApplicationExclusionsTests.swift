import XCTest
import CozeaComputerUseCore
@testable import CozeaComputerUseRuntime

final class ApplicationExclusionsTests: XCTestCase {
    func testExcludedAppsCannotBeListedOrResolvedByAnyAlias() {
        let identifiers = [
            "com.1password.1password", "com.1password.safari", "com.bitwarden.desktop",
            "com.dashlane.DashlanePhoneFinal", "com.dashlane.Dashlane", "com.dashlane.mac.Dashlane",
            "com.lastpass.LastPass", "com.lastpass.lastpassmacdesktop",
            "com.nordsec.nordpass", "me.proton.pass.electron", "me.proton.pass.catalyst", "com.apple.Passwords",
        ]
        for identifier in identifiers {
            let app = AppDescriptor(pid: 123, name: "Vault", bundleID: identifier, launchIdentity: "fixture")
            XCTAssertTrue(ApplicationExclusions.visible([app]).isEmpty, identifier)
            for alias in ["Vault", "123", identifier, "  \(identifier.uppercased())  "] {
                XCTAssertThrowsError(try ApplicationExclusions.resolve(alias, candidates: [app]), alias) { error in
                    XCTAssertEqual((error as? RuntimeFailure)?.code, .permissionDenied)
                }
            }
            XCTAssertThrowsError(try ApplicationExclusions.resolve(identifier, candidates: [])) { error in
                XCTAssertEqual((error as? RuntimeFailure)?.code, .permissionDenied)
            }
        }
    }

    func testExactMatchingDoesNotExcludePrefixesOrSimilarNames() throws {
        for identifier in ["com.dashlane.dashlane.example", "org.example.com.lastpass.lastpassmacdesktop", "org.example.editor"] {
            let app = AppDescriptor(pid: 456, name: "Dashlane Notes", bundleID: identifier, launchIdentity: "fixture")
            XCTAssertFalse(ApplicationExclusions.contains(identifier))
            XCTAssertEqual(ApplicationExclusions.visible([app]), [app])
            XCTAssertEqual(try ApplicationExclusions.resolve("456", candidates: [app]), app)
        }
        XCTAssertFalse(ApplicationExclusions.contains(nil))
        XCTAssertFalse(ApplicationExclusions.contains(""))
    }
}
