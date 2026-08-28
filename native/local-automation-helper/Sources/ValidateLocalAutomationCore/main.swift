import Foundation
import LocalAutomationCore

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("Validation failed: \(message)\n".utf8))
        exit(1)
    }
}

let staticScore = DevCommandScoring.score(features: [
    DevCommandFeature.manifestMatch.rawValue: 1,
    DevCommandFeature.serverSignal.rawValue: 1,
    DevCommandFeature.staticSiteMatch.rawValue: 1,
    DevCommandFeature.runtimeAvailable.rawValue: 1,
    DevCommandFeature.verifiedCommand.rawValue: 1,
])
let guessScore = DevCommandScoring.score(features: [
    DevCommandFeature.manifestMatch.rawValue: 1,
    DevCommandFeature.runtimeAvailable.rawValue: 1,
])
require(staticScore > guessScore, "a verified static site must outrank an unverified guess")
require(staticScore >= 0.54, "a verified static site must clear the selection threshold")
require(guessScore < 0.54, "an unverified guess must remain below the selection threshold")

let baseFeatures = [
    DevCommandFeature.manifestMatch.rawValue: 1.0,
    DevCommandFeature.scriptNameScore.rawValue: 0.8,
    DevCommandFeature.runtimeAvailable.rawValue: 1.0,
    DevCommandFeature.verifiedCommand.rawValue: 1.0,
]
var previewFeatures = baseFeatures
previewFeatures[DevCommandFeature.productionPenalty.rawValue] = 1
require(
    DevCommandScoring.score(features: baseFeatures) >
        DevCommandScoring.score(features: previewFeatures),
    "a production preview candidate must receive a penalty"
)

print("Local automation core validation passed")
