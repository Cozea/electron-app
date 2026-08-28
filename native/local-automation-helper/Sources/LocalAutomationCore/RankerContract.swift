import Foundation

public enum DevCommandFeature: String, CaseIterable, Codable, Sendable {
    case manifestMatch
    case scriptNameScore
    case serverSignal
    case packageManagerMatch
    case frameworkMatch
    case readmeMatch
    case staticSiteMatch
    case runtimeAvailable
    case verifiedCommand
    case productionPenalty
}

public struct RankCandidate: Codable, Sendable, Equatable {
    public let candidateId: String
    public let features: [String: Double]

    public init(candidateId: String, features: [String: Double]) {
        self.candidateId = candidateId
        self.features = features
    }
}

public struct RankRequest: Codable, Sendable, Equatable {
    public let requestId: String
    public let task: String
    public let candidates: [RankCandidate]

    public init(requestId: String, task: String, candidates: [RankCandidate]) {
        self.requestId = requestId
        self.task = task
        self.candidates = candidates
    }
}

public struct CandidateScore: Codable, Sendable, Equatable {
    public let candidateId: String
    public let score: Double

    public init(candidateId: String, score: Double) {
        self.candidateId = candidateId
        self.score = score
    }
}

public struct RankResponse: Codable, Sendable, Equatable {
    public let requestId: String
    public let success: Bool
    public let engine: String?
    public let scores: [CandidateScore]?
    public let error: String?

    public init(
        requestId: String,
        success: Bool,
        engine: String? = nil,
        scores: [CandidateScore]? = nil,
        error: String? = nil
    ) {
        self.requestId = requestId
        self.success = success
        self.engine = engine
        self.scores = scores
        self.error = error
    }
}

public enum DevCommandScoring {
    public static let bias = 0.08

    public static let weights: [DevCommandFeature: Double] = [
        .manifestMatch: 0.12,
        .scriptNameScore: 0.22,
        .serverSignal: 0.16,
        .packageManagerMatch: 0.08,
        .frameworkMatch: 0.08,
        .readmeMatch: 0.08,
        .staticSiteMatch: 0.24,
        .runtimeAvailable: 0.08,
        .verifiedCommand: 0.18,
        .productionPenalty: -0.16,
    ]

    public static func rawScore(features: [String: Double]) -> Double {
        DevCommandFeature.allCases.reduce(bias) { partial, feature in
            partial + (features[feature.rawValue] ?? 0) * (weights[feature] ?? 0)
        }
    }

    public static func score(features: [String: Double]) -> Double {
        min(1, max(0, rawScore(features: features)))
    }
}
