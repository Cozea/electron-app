// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "CozeaLocalAutomation",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "LocalAutomationCore", targets: ["LocalAutomationCore"]),
        .executable(
            name: "cozea-local-automation-helper",
            targets: ["CozeaLocalAutomationHelper"]
        ),
        .executable(
            name: "generate-dev-command-ranker",
            targets: ["GenerateDevCommandRanker"]
        ),
        .executable(
            name: "validate-local-automation-core",
            targets: ["ValidateLocalAutomationCore"]
        ),
    ],
    targets: [
        .target(name: "LocalAutomationCore"),
        .executableTarget(
            name: "CozeaLocalAutomationHelper",
            dependencies: ["LocalAutomationCore"]
        ),
        .executableTarget(
            name: "GenerateDevCommandRanker",
            dependencies: ["LocalAutomationCore"]
        ),
        .executableTarget(
            name: "ValidateLocalAutomationCore",
            dependencies: ["LocalAutomationCore"]
        ),
    ]
)
