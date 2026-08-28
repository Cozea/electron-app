import CoreML
import Foundation
import LocalAutomationCore

private final class CoreMLRanker {
    private let model: MLModel
    private let outputName: String

    init(modelURL: URL) throws {
        let compiledURL: URL
        if modelURL.pathExtension == "mlmodelc" {
            compiledURL = modelURL
        } else {
            compiledURL = try MLModel.compileModel(at: modelURL)
        }

        let configuration = MLModelConfiguration()
        configuration.computeUnits = .all
        model = try MLModel(contentsOf: compiledURL, configuration: configuration)
        outputName = model.modelDescription.outputDescriptionsByName["score"] != nil
            ? "score"
            : model.modelDescription.outputDescriptionsByName.keys.sorted().first ?? "score"
    }

    func score(features: [String: Double]) throws -> Double {
        var values: [String: Any] = [:]
        for feature in DevCommandFeature.allCases {
            values[feature.rawValue] = features[feature.rawValue] ?? 0
        }
        let provider = try MLDictionaryFeatureProvider(dictionary: values)
        let prediction = try model.prediction(from: provider)
        guard let value = prediction.featureValue(for: outputName) else {
            throw NSError(
                domain: "CozeaLocalAutomation",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Core ML ranker returned no score output."]
            )
        }
        return min(1, max(0, value.doubleValue))
    }
}

private func modelPath(arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: "--model"), arguments.indices.contains(index + 1) else {
        return nil
    }
    return arguments[index + 1]
}

private let encoder = JSONEncoder()
private let decoder = JSONDecoder()
private let ranker: CoreMLRanker? = {
    guard let path = modelPath(arguments: CommandLine.arguments) else { return nil }
    do {
        return try CoreMLRanker(modelURL: URL(fileURLWithPath: path))
    } catch {
        FileHandle.standardError.write(Data("Core ML model unavailable: \(error.localizedDescription)\n".utf8))
        return nil
    }
}()

private func respond(_ response: RankResponse) {
    guard let data = try? encoder.encode(response) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

while let line = readLine() {
    guard let data = line.data(using: .utf8) else { continue }
    let request: RankRequest
    do {
        request = try decoder.decode(RankRequest.self, from: data)
    } catch {
        respond(RankResponse(requestId: "unknown", success: false, error: "Invalid request."))
        continue
    }

    guard request.task == "rank_dev_commands" else {
        respond(RankResponse(requestId: request.requestId, success: false, error: "Unsupported task."))
        continue
    }

    if let ranker {
        do {
            let scores = try request.candidates.map { candidate in
                CandidateScore(candidateId: candidate.candidateId, score: try ranker.score(features: candidate.features))
            }
            respond(RankResponse(requestId: request.requestId, success: true, engine: "coreml", scores: scores))
            continue
        } catch {
            FileHandle.standardError.write(Data("Core ML prediction failed: \(error.localizedDescription)\n".utf8))
        }
    }

    let fallbackScores = request.candidates.map { candidate in
        CandidateScore(candidateId: candidate.candidateId, score: DevCommandScoring.score(features: candidate.features))
    }
    respond(
        RankResponse(
            requestId: request.requestId,
            success: true,
            engine: "deterministic_fallback",
            scores: fallbackScores
        )
    )
}
