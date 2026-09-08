import Foundation

public struct Rectangle: Codable, Sendable, Equatable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
    public var isValid: Bool { [x, y, width, height].allSatisfy(\.isFinite) && width > 0 && height > 0 }
    public func contains(_ point: Point) -> Bool {
        point.isFinite && point.x >= x && point.y >= y && point.x < x + width && point.y < y + height
    }
    public func approximatelyEquals(_ other: Self, tolerance: Double = 0.5) -> Bool {
        abs(x - other.x) <= tolerance && abs(y - other.y) <= tolerance &&
        abs(width - other.width) <= tolerance && abs(height - other.height) <= tolerance
    }
}

public struct ScreenshotGeometry: Codable, Sendable, Equatable {
    public let window: Rectangle
    public let pixelWidth: Int
    public let pixelHeight: Int
    public init(window: Rectangle, pixelWidth: Int, pixelHeight: Int) {
        self.window = window; self.pixelWidth = pixelWidth; self.pixelHeight = pixelHeight
    }
    public func windowPoint(from pixel: Point) throws -> Point {
        guard window.isValid, pixelWidth > 0, pixelHeight > 0,
              Rectangle(x: 0, y: 0, width: Double(pixelWidth), height: Double(pixelHeight)).contains(pixel) else {
            throw RuntimeFailure(.invalidArguments, "Coordinates are outside the observed screenshot.")
        }
        return Point(x: pixel.x * window.width / Double(pixelWidth), y: pixel.y * window.height / Double(pixelHeight))
    }
    public func globalPoint(from pixel: Point) throws -> Point {
        let local = try windowPoint(from: pixel)
        return Point(x: window.x + local.x, y: window.y + local.y)
    }
}

public struct DisplayGeometry: Sendable, Equatable {
    public let quartz: Rectangle
    public let appKit: Rectangle
    public init(quartz: Rectangle, appKit: Rectangle) { self.quartz = quartz; self.appKit = appKit }
    public func appKitPoint(fromQuartz point: Point) throws -> Point {
        guard quartz.isValid, appKit.isValid, quartz.contains(point) else {
            throw RuntimeFailure(.staleWindow, "The target is outside the active displays.")
        }
        return Point(
            x: appKit.x + (point.x - quartz.x) * appKit.width / quartz.width,
            y: appKit.y + appKit.height - (point.y - quartz.y) * appKit.height / quartz.height
        )
    }
}
