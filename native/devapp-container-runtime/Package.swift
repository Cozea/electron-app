// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "CozeaDevAppContainerRuntime",
    platforms: [.macOS(.v26)],
    products: [
        .executable(
            name: "cozea-devapp-container-runtime",
            targets: ["CozeaDevAppContainerRuntime"]
        ),
    ],
    dependencies: [
        .package(
            url: "https://github.com/apple/containerization.git",
            exact: "0.43.0"
        ),
    ],
    targets: [
        .executableTarget(
            name: "CozeaDevAppContainerRuntime",
            dependencies: [
                .product(name: "Containerization", package: "containerization"),
                .product(name: "ContainerizationEXT4", package: "containerization"),
                .product(name: "ContainerizationOCI", package: "containerization"),
                .product(name: "ContainerizationOS", package: "containerization"),
            ]
        ),
    ]
)
