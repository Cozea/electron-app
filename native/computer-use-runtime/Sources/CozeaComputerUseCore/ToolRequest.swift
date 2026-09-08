import Foundation

public enum ComputerTool: String, Codable, CaseIterable, Sendable {
    case listApps = "list_apps"
    case getAppState = "get_app_state"
    case click
    case secondaryAction = "perform_secondary_action"
    case scroll
    case drag
    case typeText = "type_text"
    case pressKey = "press_key"
    case setValue = "set_value"
    public var mutatesDesktop: Bool { self != .listApps && self != .getAppState }
}

public enum MouseButton: String, Sendable { case left, right, middle }
public enum ClickStrategy: String, Sendable { case auto, accessibility, appPost = "app_post", sky = "sky_click", global }
public enum ScrollDirection: String, Sendable { case up, down, left, right }

public struct Point: Sendable, Codable, Equatable {
    public let x: Double
    public let y: Double
    public init(x: Double, y: Double) { self.x = x; self.y = y }
    public var isFinite: Bool { x.isFinite && y.isFinite }
}

public enum ActionTarget: Sendable, Equatable {
    case element(Int)
    case screenshot(Point)
}

public struct ObservationOptions: Sendable, Equatable {
    public let includeText: Bool
    public let includeScreenshot: Bool
    public let maxNodes: Int
    public let maxDepth: Int
    public let textLimit: Int?
}

public enum ToolOperation: Sendable, Equatable {
    case listApps
    case observe(app: String, options: ObservationOptions)
    case click(app: String, target: ActionTarget, button: MouseButton, count: Int, strategy: ClickStrategy)
    case secondary(app: String, index: Int, action: String)
    case scroll(app: String, index: Int, direction: ScrollDirection, pages: Double)
    case drag(app: String, from: Point, to: Point)
    case typeText(app: String, text: String)
    case pressKey(app: String, key: String)
    case setValue(app: String, index: Int, value: String)

    public var app: String? {
        switch self {
        case .listApps: nil
        case .observe(let a, _), .click(let a, _, _, _, _), .secondary(let a, _, _),
             .scroll(let a, _, _, _), .drag(let a, _, _), .typeText(let a, _),
             .pressKey(let a, _), .setValue(let a, _, _): a
        }
    }
}

public struct ToolRequest: Sendable, Equatable {
    public let tool: ComputerTool
    public let operation: ToolOperation
    public let observationID: String?

    public init(tool name: String, arguments: [String: JSONValue]) throws {
        guard let tool = ComputerTool(rawValue: name) else {
            throw RuntimeFailure(.invalidArguments, "Unknown Computer Use tool.")
        }
        let a = Arguments(arguments)
        self.tool = tool
        self.observationID = try a.optionalString("snapshot_id", max: 128)
        if tool == .listApps { self.operation = .listApps; return }
        let app = try a.string("app", max: 512)
        switch tool {
        case .listApps: self.operation = .listApps
        case .getAppState:
            let text = try a.bool("include_text", default: true)
            let image = try a.bool("include_screenshot", default: true)
            guard text || image else { throw RuntimeFailure(.invalidArguments, "Request text, screenshot, or both.") }
            let textLimit: Int?
            if arguments["text_limit"]?.string?.lowercased() == "max" { textLimit = nil }
            else { textLimit = try a.integer("text_limit", default: 500, range: 1...100_000) }
            self.operation = .observe(app: app, options: ObservationOptions(
                includeText: text, includeScreenshot: image,
                maxNodes: try a.integer("max_tree_nodes", default: 1200, range: 1...5000),
                maxDepth: try a.integer("max_tree_depth", default: 64, range: 1...128),
                textLimit: textLimit
            ))
        case .click:
            let hasIndex = arguments["element_index"] != nil
            let hasPoint = arguments["x"] != nil || arguments["y"] != nil
            guard hasIndex != hasPoint else { throw RuntimeFailure(.invalidArguments, "Use either element_index or x/y, not both.") }
            let target: ActionTarget = hasIndex ? .element(try a.index()) : .screenshot(try a.point(x: "x", y: "y"))
            guard let button = MouseButton(rawValue: try a.optionalString("mouse_button", max: 16) ?? "left"),
                  let strategy = ClickStrategy(rawValue: try a.optionalString("click_method", max: 32) ?? "auto") else {
                throw RuntimeFailure(.invalidArguments, "Unknown mouse button or click method.")
            }
            let count = try a.integer("click_count", default: 1, range: 1...3)
            if strategy == .accessibility && !hasIndex { throw RuntimeFailure(.invalidArguments, "accessibility requires element_index.") }
            if strategy == .sky && (button != .left || count > 2) { throw RuntimeFailure(.invalidArguments, "sky_click supports one or two left clicks.") }
            self.operation = .click(app: app, target: target, button: button, count: count, strategy: strategy)
        case .secondaryAction:
            self.operation = .secondary(app: app, index: try a.index(), action: try a.string("action", max: 256))
        case .scroll:
            guard let direction = ScrollDirection(rawValue: try a.string("direction", max: 16).lowercased()) else {
                throw RuntimeFailure(.invalidArguments, "Unknown scroll direction.")
            }
            let pages = try a.number("pages", default: 1)
            guard pages > 0 && pages <= 20 else { throw RuntimeFailure(.invalidArguments, "pages must be greater than zero and at most 20.") }
            self.operation = .scroll(app: app, index: try a.index(), direction: direction, pages: pages)
        case .drag:
            self.operation = .drag(app: app, from: try a.point(x: "from_x", y: "from_y"), to: try a.point(x: "to_x", y: "to_y"))
        case .typeText:
            self.operation = .typeText(app: app, text: try a.string("text", max: 65_536, allowEmpty: true))
        case .pressKey:
            self.operation = .pressKey(app: app, key: try a.string("key", max: 256))
        case .setValue:
            self.operation = .setValue(app: app, index: try a.index(), value: try a.string("value", max: 65_536, allowEmpty: true))
        }
    }
}

private struct Arguments {
    let values: [String: JSONValue]
    init(_ values: [String: JSONValue]) { self.values = values }
    func optionalString(_ key: String, max: Int) throws -> String? {
        guard values[key] != nil else { return nil }
        return try string(key, max: max)
    }
    func string(_ key: String, max: Int, allowEmpty: Bool = false) throws -> String {
        guard let value = values[key]?.string, value.utf8.count <= max,
              !value.contains("\0"), allowEmpty || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw RuntimeFailure(.invalidArguments, "\(key) must be a valid bounded string.")
        }
        return value
    }
    func bool(_ key: String, default fallback: Bool) throws -> Bool {
        guard let raw = values[key] else { return fallback }
        guard let value = raw.bool else { throw RuntimeFailure(.invalidArguments, "\(key) must be boolean.") }
        return value
    }
    func number(_ key: String, default fallback: Double? = nil) throws -> Double {
        guard let raw = values[key] else {
            if let fallback { return fallback }
            throw RuntimeFailure(.invalidArguments, "\(key) is required.")
        }
        guard let value = raw.number, value.isFinite else { throw RuntimeFailure(.invalidArguments, "\(key) must be a finite number.") }
        return value
    }
    func integer(_ key: String, default fallback: Int? = nil, range: ClosedRange<Int>) throws -> Int {
        let value = try number(key, default: fallback.map(Double.init))
        guard value.rounded(.towardZero) == value, value >= Double(range.lowerBound), value <= Double(range.upperBound) else {
            throw RuntimeFailure(.invalidArguments, "\(key) must be an integer in \(range.lowerBound)...\(range.upperBound).")
        }
        return Int(value)
    }
    func index() throws -> Int {
        if let string = values["element_index"]?.string,
           let value = Int(string), value >= 0, value <= 1_000_000 { return value }
        return try integer("element_index", range: 0...1_000_000)
    }
    func point(x: String, y: String) throws -> Point { Point(x: try number(x), y: try number(y)) }
}
