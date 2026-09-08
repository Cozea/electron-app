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
        .package(path: "../computer-use-runtime"),
    ],
    targets: [
        .target(
            name: "CozeaComputerUseBridge",
            dependencies: [
                .product(name: "CozeaComputerUseRuntime", package: "computer-use-runtime"),
                .product(name: "CozeaComputerUseCore", package: "computer-use-runtime"),
            ],
            path: "Sources/CozeaComputerUseBridge"
        ),
    ]
)
