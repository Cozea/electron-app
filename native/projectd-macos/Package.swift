// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CozeaProjectdMac",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "cozea-projectd-mac-helper", targets: ["CozeaProjectdMac"])
    ],
    targets: [
        .executableTarget(
            name: "CozeaProjectdMac",
            path: "Sources/CozeaProjectdMac"
        )
    ]
)
