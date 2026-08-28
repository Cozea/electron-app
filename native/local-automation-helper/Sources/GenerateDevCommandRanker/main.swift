import CreateML
import Foundation
import LocalAutomationCore
import TabularData

private struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state
    }

    mutating func unitValue() -> Double {
        Double(next() >> 11) / Double(1 << 53)
    }
}

private func outputPath(arguments: [String]) -> String {
    if let index = arguments.firstIndex(of: "--output"), arguments.indices.contains(index + 1) {
        return arguments[index + 1]
    }
    return FileManager.default.currentDirectoryPath + "/Models/DevCommandRanker.mlmodel"
}

private var generator = SeededGenerator(state: 0xC02EA)
private var featureColumns: [String: [Double]] = [:]
for feature in DevCommandFeature.allCases {
    featureColumns[feature.rawValue] = []
}
private var scores: [Double] = []

for _ in 0..<2_048 {
    var features: [String: Double] = [:]
    for feature in DevCommandFeature.allCases {
        let value: Double
        if feature == .scriptNameScore {
            value = generator.unitValue()
        } else {
            value = generator.unitValue() > 0.5 ? 1 : 0
        }
        features[feature.rawValue] = value
        featureColumns[feature.rawValue, default: []].append(value)
    }
    scores.append(DevCommandScoring.rawScore(features: features))
}

var table = DataFrame()
for name in DevCommandFeature.allCases.map(\.rawValue) {
    table.append(column: Column(name: name, contents: featureColumns[name] ?? []))
}
table.append(column: Column(name: "score", contents: scores))
let parameters = MLBoostedTreeRegressor.ModelParameters(
    validation: .none,
    maxDepth: 4,
    maxIterations: 120,
    minLossReduction: 0,
    minChildWeight: 0.1,
    randomSeed: 0xC02EA,
    stepSize: 0.1,
    earlyStoppingRounds: nil,
    rowSubsample: 1,
    columnSubsample: 1
)
let regressor = try MLBoostedTreeRegressor(
    trainingData: table,
    targetColumn: "score",
    featureColumns: DevCommandFeature.allCases.map(\.rawValue),
    parameters: parameters
)

let destination = URL(fileURLWithPath: outputPath(arguments: CommandLine.arguments))
try FileManager.default.createDirectory(
    at: destination.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try? FileManager.default.removeItem(at: destination)
try regressor.write(to: destination, metadata: nil)
print(destination.path)
