// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "CozeaComputerUseBridge",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "CozeaComputerUseBridge",
            type: .dynamic,
            targets: ["CozeaComputerUseBridge"]
        ),
    ],
    dependencies: [
        .package(
            url: "https://github.com/iFurySt/open-codex-computer-use.git",
            revision: "41c5294cfe4735baca03f9c82b4de99d191a0b49"
        ),
    ],
    targets: [
        .target(
            name: "CozeaComputerUseBridge",
            dependencies: [
                .product(name: "OpenComputerUseKit", package: "open-codex-computer-use"),
            ],
            path: "Sources/CozeaComputerUseBridge"
        ),
    ]
)
