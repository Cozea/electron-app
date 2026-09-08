// swift-tools-version: 6.2
import PackageDescription

var products: [Product] = [.library(name: "CozeaComputerUseCore", targets: ["CozeaComputerUseCore"])]
var targets: [Target] = [
    .target(name: "CozeaComputerUseCore", resources: [.process("Resources")]),
    .testTarget(name: "CozeaComputerUseCoreTests", dependencies: ["CozeaComputerUseCore"]),
]
#if os(macOS)
products.append(.library(name: "CozeaComputerUseRuntime", targets: ["CozeaComputerUseRuntime"]))
targets.append(.target(name: "CozeaComputerUseRuntime", dependencies: ["CozeaComputerUseCore"]))
targets.append(.testTarget(name: "CozeaComputerUseRuntimeTests", dependencies: ["CozeaComputerUseRuntime"]))
products.append(.executable(name: "computer-use-fixture", targets: ["ComputerUseFixture"]))
targets.append(.executableTarget(name: "ComputerUseFixture"))
#endif

let package = Package(
    name: "CozeaComputerUseRuntime",
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)
