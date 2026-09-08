// swift-tools-version: 6.2
import PackageDescription

var products: [Product] = [.library(name: "CozeaComputerUseCore", targets: ["CozeaComputerUseCore"])]
var targets: [Target] = [
    .target(name: "CozeaComputerUseCore"),
    .testTarget(name: "CozeaComputerUseCoreTests", dependencies: ["CozeaComputerUseCore"]),
]
#if os(macOS)
products.append(.library(name: "CozeaComputerUseRuntime", targets: ["CozeaComputerUseRuntime"]))
targets.append(.target(name: "CozeaComputerUseRuntime", dependencies: ["CozeaComputerUseCore"]))
targets.append(.testTarget(name: "CozeaComputerUseRuntimeTests", dependencies: ["CozeaComputerUseRuntime"]))
#endif

let package = Package(
    name: "CozeaComputerUseRuntime",
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)
