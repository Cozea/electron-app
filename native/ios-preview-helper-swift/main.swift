import Foundation
import Darwin
import IOSurface
import CoreImage
import ImageIO
import UniformTypeIdentifiers

private let simulatorKitPath = "/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
private let radonTargetScreenID = 1

struct Config {
  let deviceId: String
  let deviceSetPath: String?
}

final class ProtocolIO {
  private let queue = DispatchQueue(label: "cozea.ios-preview-helper.protocol")

  func emit(_ line: String) {
    queue.sync {
      FileHandle.standardOutput.write(Data((line + "\n").utf8))
      fflush(stdout)
    }
  }
}

final class MjpegServer {
  private let listener: FileHandle
  private let acceptSource: DispatchSourceRead
  private let queue = DispatchQueue(label: "cozea.ios-preview-helper.mjpeg")
  private var clients: [FileHandle] = []
  private var headerSent = Set<ObjectIdentifier>()

  let url: URL

  init() throws {
    let socketFd = socket(AF_INET, SOCK_STREAM, 0)
    guard socketFd >= 0 else {
      throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }

    var value: Int32 = 1
    setsockopt(socketFd, SOL_SOCKET, SO_REUSEADDR, &value, socklen_t(MemoryLayout<Int32>.size))

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(0).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

    let bindResult = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { pointer in
        bind(socketFd, pointer, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bindResult == 0, listen(socketFd, SOMAXCONN) == 0 else {
      close(socketFd)
      throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }

    var actualAddress = sockaddr_in()
    var actualLength = socklen_t(MemoryLayout<sockaddr_in>.size)
    getsockname(socketFd, withUnsafeMutablePointer(to: &actualAddress) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { $0 }
    }, &actualLength)
    let port = Int(UInt16(bigEndian: actualAddress.sin_port))

    self.url = URL(string: "http://127.0.0.1:\(port)/stream.mjpeg")!
    self.listener = FileHandle(fileDescriptor: socketFd, closeOnDealloc: true)
    self.acceptSource = DispatchSource.makeReadSource(fileDescriptor: socketFd, queue: queue)

    acceptSource.setEventHandler { [weak self] in
      self?.acceptClient()
    }
    acceptSource.resume()
  }

  deinit {
    acceptSource.cancel()
    clients.forEach { try? $0.close() }
    try? listener.close()
  }

  func broadcast(jpeg data: Data) {
    queue.async {
      self.clients.removeAll { client in
        let identifier = ObjectIdentifier(client)
        do {
          if !self.headerSent.contains(identifier) {
            self.headerSent.insert(identifier)
            try client.write(contentsOf: Data("""
HTTP/1.1 200 OK\r
Connection: close\r
Cache-Control: no-cache, no-store, must-revalidate\r
Pragma: no-cache\r
Content-Type: multipart/x-mixed-replace; boundary=frame\r
\r
""".utf8))
          }

          var chunk = Data()
          chunk.append(Data("--frame\r\n".utf8))
          chunk.append(Data("Content-Type: image/jpeg\r\n".utf8))
          chunk.append(Data("Content-Length: \(data.count)\r\n\r\n".utf8))
          chunk.append(data)
          chunk.append(Data("\r\n".utf8))
          try client.write(contentsOf: chunk)
          return false
        } catch {
          self.headerSent.remove(identifier)
          try? client.close()
          return true
        }
      }
    }
  }

  private func acceptClient() {
    var address = sockaddr()
    var addressLength = socklen_t(MemoryLayout<sockaddr>.size)
    let fd = accept(listener.fileDescriptor, &address, &addressLength)
    guard fd >= 0 else {
      return
    }

    let client = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    clients.append(client)
  }
}

final class SimulatorBridge {
  private let config: Config
  private let io: ProtocolIO
  private let mjpegServer: MjpegServer

  private let context: AnyObject
  private let device: AnyObject
  private let descriptor: AnyObject
  private let screen: AnyObject
  private let screenUUID: String
  private let screenID: Int
  private let ciContext = CIContext()

  private var lastJpegFrame: Data?
  private var streamReadyEmitted = false
  private var unsupportedPayloadTypes = Set<String>()
  private var informationalEvents = Set<String>()
  private var surfacePollTimer: DispatchSourceTimer?
  private let stateQueue = DispatchQueue(label: "cozea.ios-preview-helper.state")

  init(config: Config, io: ProtocolIO) throws {
    self.config = config
    self.io = io
    self.mjpegServer = try MjpegServer()

    guard dlopen(simulatorKitPath, RTLD_NOW) != nil else {
      throw HelperError("failed to load SimulatorKit at \(simulatorKitPath)")
    }

    let context = try SimulatorBridge.makeServiceContext()
    let deviceSet = try SimulatorBridge.defaultDeviceSet(context: context)
    let device = try SimulatorBridge.findDevice(deviceSet: deviceSet, udid: config.deviceId)
    try SimulatorBridge.waitUntilBooted(device: device, deviceId: config.deviceId)

    let descriptor = try SimulatorBridge.findFramebufferServerDescriptor(device: device)
    let screen = try SimulatorBridge.enumerateScreen(descriptor: descriptor, targetScreenID: radonTargetScreenID)
    let screenUUID = try SimulatorBridge.extractUUID(from: screen)
    let screenID = try SimulatorBridge.readScreenID(from: screen)

    self.context = context
    self.device = device
    self.descriptor = descriptor
    self.screen = screen
    self.screenUUID = screenUUID
    self.screenID = screenID

    io.emit("ready \(sanitize(config.deviceId))")
    io.emit("info stream_url \(sanitize(mjpegServer.url.absoluteString))")
    io.emit("info selected_screen_id \(screenID)")
    emitDisplayMetadata()

    registerSurfaceCallbacks()
    registerDisplayCallbacks()
    startSurfacePolling()
  }

  func streamURL() -> String {
    mjpegServer.url.absoluteString
  }

  func screenshot(jobId: String) {
    stateQueue.sync {
      guard let frame = lastJpegFrame else {
        io.emit("error \(sanitize(jobId)) no_frame_available")
        return
      }

      let filename = "cozea-native-preview-\(UUID().uuidString).jpg"
      let path = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(filename)
      do {
        try frame.write(to: path)
        io.emit("screenshot_ready \(sanitize(jobId)) \(sanitize(path.path))")
      } catch {
        io.emit("error \(sanitize(jobId)) failed_to_write_screenshot")
      }
    }
  }

  func respondNotImplemented(_ line: String) {
    io.emit("error runtime not_implemented:\(sanitize(line))")
  }

  private func registerSurfaceCallbacks() {
    let selector = NSSelectorFromString("registerCallbackWithUUID:ioSurfacesChangeCallback:")
    typealias RegisterFn = @convention(c) (AnyObject, Selector, NSString, @convention(block) (AnyObject?) -> Void) -> Void
    let register = unsafeBitCast(screen.method(for: selector), to: RegisterFn.self)

    let block: @convention(block) (AnyObject?) -> Void = { [weak self] payload in
      self?.handleSurfacePayload(payload)
    }

    register(screen, selector, screenUUID as NSString, block)
    emitInfoOnce("surface_callback_registered")

    if let surface = screen.perform(NSSelectorFromString("framebufferSurface"))?.takeUnretainedValue() {
      handleSurfacePayload(surface)
    } else if let surface = screen.perform(NSSelectorFromString("maskedFramebufferSurface"))?.takeUnretainedValue() {
      handleSurfacePayload(surface)
    } else {
      emitInfoOnce("initial_framebuffer_surface_nil")
    }
  }

  private func registerDisplayCallbacks() {
    let selector = NSSelectorFromString("registerCallbackWithUUID:displayPropertiesChanged:")
    guard screen.responds(to: selector) else {
      return
    }

    typealias RegisterFn = @convention(c) (AnyObject, Selector, NSString, @convention(block) (AnyObject?) -> Void) -> Void
    let register = unsafeBitCast(screen.method(for: selector), to: RegisterFn.self)
    let block: @convention(block) (AnyObject?) -> Void = { [weak self] _ in
      self?.emitInfoOnce("display_properties_changed")
      self?.captureCurrentSurface()
    }
    register(screen, selector, "\(screenUUID)-display" as NSString, block)
    emitInfoOnce("display_callback_registered")
  }

  private func startSurfacePolling() {
    let timer = DispatchSource.makeTimerSource(queue: stateQueue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(250))
    timer.setEventHandler { [weak self] in
      self?.captureCurrentSurface()
    }
    timer.resume()
    surfacePollTimer = timer
    emitInfoOnce("surface_polling_started")
  }

  private func captureCurrentSurface() {
    if let surface = screen.perform(NSSelectorFromString("framebufferSurface"))?.takeUnretainedValue() {
      handleSurfacePayload(surface)
      return
    }
    if let surface = screen.perform(NSSelectorFromString("maskedFramebufferSurface"))?.takeUnretainedValue() {
      handleSurfacePayload(surface)
      return
    }
    emitInfoOnce("surface_poll_returned_nil")
  }

  private func handleSurfacePayload(_ payload: AnyObject?) {
    guard let payload else {
      return
    }

    if let data = dataForPayload(payload) {
      stateQueue.sync {
        lastJpegFrame = data
        mjpegServer.broadcast(jpeg: data)
        if !streamReadyEmitted {
          streamReadyEmitted = true
          io.emit("stream_ready \(sanitize(mjpegServer.url.absoluteString))")
        }
      }
      return
    }

    let typeName = String(describing: type(of: payload))
    stateQueue.sync {
      guard !unsupportedPayloadTypes.contains(typeName) else {
        return
      }
      unsupportedPayloadTypes.insert(typeName)
      io.emit("info unsupported_surface_payload \(sanitize(typeName))")
      io.emit("info payload_description \(sanitize(describePayload(payload)))")
    }
  }

  private func dataForPayload(_ payload: AnyObject) -> Data? {
    if let surface = iosSurface(from: payload) {
      return jpegData(from: surface)
    }
    if let data = payload as? Data {
      return data
    }
    if let nsData = payload as? NSData {
      return nsData as Data
    }
    if let array = payload as? NSArray {
      for item in array {
        if let object = item as AnyObject?, let data = dataForPayload(object) {
          return data
        }
      }
    }
    if let dictionary = payload as? NSDictionary {
      for value in dictionary.allValues {
        if let object = value as AnyObject?, let data = dataForPayload(object) {
          return data
        }
      }
    }
    return nil
  }

  private func emitDisplayMetadata() {
    emitInfoOnce("screen_id_\(screenID)")
    if let displaySize = screen.perform(NSSelectorFromString("displaySize"))?.takeUnretainedValue() {
      emitInfoOnce("display_size_\(sanitize(String(describing: displaySize)))")
    }
  }

  private func emitInfoOnce(_ key: String) {
    stateQueue.sync {
      guard !informationalEvents.contains(key) else {
        return
      }
      informationalEvents.insert(key)
      io.emit("info \(sanitize(key))")
    }
  }

  private func describePayload(_ payload: AnyObject) -> String {
    if let dictionary = payload as? NSDictionary {
      let keys = dictionary.allKeys.map { String(describing: $0) }.joined(separator: ",")
      return "NSDictionary(keys=[\(keys)])"
    }
    if let array = payload as? NSArray {
      let itemTypes = array.compactMap { item -> String? in
        guard let object = item as AnyObject? else {
          return nil
        }
        return String(describing: type(of: object))
      }
      return "NSArray(count=\(array.count),types=[\(itemTypes.joined(separator: ","))])"
    }
    if let data = payload as? NSData {
      return "NSData(length=\(data.length))"
    }
    return String(describing: payload)
  }

  private func iosSurface(from payload: AnyObject) -> IOSurfaceRef? {
    let value = payload
    let opaque = Unmanaged.passUnretained(value).toOpaque()
    let candidate = unsafeBitCast(opaque, to: IOSurfaceRef.self)
    if CFGetTypeID(candidate) == IOSurfaceGetTypeID() {
      return candidate
    }
    return nil
  }

  private func jpegData(from surface: IOSurfaceRef) -> Data? {
    let ciImage = CIImage(ioSurface: surface)
    let extent = ciImage.extent.integral
    guard !extent.isEmpty,
          let cgImage = ciContext.createCGImage(ciImage, from: extent) else {
      return nil
    }

    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
      return nil
    }
    CGImageDestinationAddImage(destination, cgImage, [
      kCGImageDestinationLossyCompressionQuality: 0.75,
    ] as CFDictionary)

    guard CGImageDestinationFinalize(destination) else {
      return nil
    }
    return data as Data
  }

  private static func makeServiceContext() throws -> AnyObject {
    guard let cls = NSClassFromString("SimServiceContext") as? NSObject.Type else {
      throw HelperError("missing_SimServiceContext")
    }
    let raw = cls.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
    let initSelector = NSSelectorFromString("initWithDeveloperDir:connectionType:error:")
    typealias InitFn = @convention(c) (AnyObject, Selector, NSString, Int, UnsafeMutablePointer<AnyObject?>?) -> Unmanaged<AnyObject>?
    var initError: AnyObject?
    let initFn = unsafeBitCast(raw.method(for: initSelector), to: InitFn.self)
    guard let context = initFn(raw, initSelector, "/Applications/Xcode.app/Contents/Developer" as NSString, 0, &initError)?.takeRetainedValue() else {
      throw HelperError("failed_to_initialize_sim_service_context")
    }

    let connectSelector = NSSelectorFromString("connectWithError:")
    typealias ConnectFn = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<AnyObject?>?) -> Bool
    var connectError: AnyObject?
    let connectFn = unsafeBitCast(context.method(for: connectSelector), to: ConnectFn.self)
    guard connectFn(context, connectSelector, &connectError) else {
      throw HelperError("failed_to_connect_sim_service_context")
    }
    return context
  }

  private static func defaultDeviceSet(context: AnyObject) throws -> AnyObject {
    let selector = NSSelectorFromString("defaultDeviceSetWithError:")
    typealias Fn = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<AnyObject?>?) -> Unmanaged<AnyObject>?
    var error: AnyObject?
    let function = unsafeBitCast(context.method(for: selector), to: Fn.self)
    guard let result = function(context, selector, &error)?.takeRetainedValue() else {
      throw HelperError("failed_to_load_default_device_set")
    }
    return result
  }

  private static func findDevice(deviceSet: AnyObject, udid: String) throws -> AnyObject {
    guard let devices = deviceSet.perform(NSSelectorFromString("devices"))?.takeUnretainedValue() as? NSArray else {
      throw HelperError("failed_to_read_simulator_devices")
    }

    for item in devices {
      guard let device = item as AnyObject?,
            let value = device.perform(NSSelectorFromString("UDID"))?.takeUnretainedValue() else {
        continue
      }
      if String(describing: value as AnyObject) == udid {
        return device
      }
    }

    throw HelperError("simulator_not_found:\(udid)")
  }

  private static func waitUntilBooted(device: AnyObject, deviceId: String) throws {
    let stateSelector = NSSelectorFromString("state")
    typealias StateFn = @convention(c) (AnyObject, Selector) -> Int
    let stateFn = unsafeBitCast(device.method(for: stateSelector), to: StateFn.self)

    let deadline = Date().addingTimeInterval(30)
    while Date() < deadline {
      if stateFn(device, stateSelector) == 3 {
        return
      }

      let stateString = device.perform(NSSelectorFromString("stateString"))?.takeUnretainedValue()
      if String(describing: stateString as Any) == "Booted" {
        return
      }
      Thread.sleep(forTimeInterval: 0.5)
    }

    throw HelperError("simulator_not_booted:\(deviceId)")
  }

  private static func findFramebufferServerDescriptor(device: AnyObject) throws -> AnyObject {
    guard let ioObject = device.perform(NSSelectorFromString("io"))?.takeUnretainedValue() as AnyObject?,
          let ports = ioObject.perform(NSSelectorFromString("ioPorts"))?.takeUnretainedValue() as? NSArray else {
      throw HelperError("missing_simulator_io_ports")
    }

    for item in ports {
      guard let port = item as AnyObject?,
            let identifier = port.perform(NSSelectorFromString("portIdentifier"))?.takeUnretainedValue() else {
        continue
      }

      if String(describing: identifier as AnyObject) == "com.apple.framebuffer.server",
         let descriptor = port.perform(NSSelectorFromString("descriptor"))?.takeUnretainedValue() as AnyObject? {
        return descriptor
      }
    }

    throw HelperError("missing_framebuffer_server_descriptor")
  }

  private static func enumerateScreen(descriptor: AnyObject, targetScreenID: Int) throws -> AnyObject {
    let selector = NSSelectorFromString("enumerateScreensWithCompletionQueue:completionHandler:")
    typealias Fn = @convention(c) (AnyObject, Selector, DispatchQueue, @convention(block) (AnyObject?, AnyObject?) -> Void) -> Void
    let function = unsafeBitCast(descriptor.method(for: selector), to: Fn.self)

    let semaphore = DispatchSemaphore(value: 0)
    var result: AnyObject?
    var discoveredScreenIDs: [Int] = []

    let block: @convention(block) (AnyObject?, AnyObject?) -> Void = { screens, _ in
      if let array = screens as? NSArray {
        for item in array {
          guard let screen = item as AnyObject? else {
            continue
          }
          guard let screenID = try? readScreenID(from: screen) else {
            continue
          }
          discoveredScreenIDs.append(screenID)
          if screenID == targetScreenID {
            result = screen
            break
          }
        }
      }
      semaphore.signal()
    }

    function(descriptor, selector, DispatchQueue.global(), block)
    _ = semaphore.wait(timeout: .now() + 5)

    guard let screen = result else {
      let discovered = discoveredScreenIDs.map(String.init).joined(separator: ",")
      throw HelperError("failed_to_find_target_screen_id:\(targetScreenID):[\(discovered)]")
    }
    return screen
  }

  private static func readScreenID(from screen: AnyObject) throws -> Int {
    guard let properties = screen.perform(NSSelectorFromString("screenProperties"))?.takeUnretainedValue() as AnyObject?,
          let value = properties.perform(NSSelectorFromString("screenID"))?.takeUnretainedValue() else {
      throw HelperError("failed_to_read_screen_id")
    }

    if let number = value as? NSNumber {
      return number.intValue
    }

    let description = String(describing: value as AnyObject)
    if let intValue = Int(description) {
      return intValue
    }

    throw HelperError("invalid_screen_id:\(description)")
  }

  private static func extractUUID(from object: AnyObject) throws -> String {
    let text = String(describing: object)
    let pattern = #"UUID = \"([A-F0-9-]+)\";"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else {
      throw HelperError("failed_to_compile_uuid_pattern")
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, options: [], range: range),
          let swiftRange = Range(match.range(at: 1), in: text) else {
      throw HelperError("failed_to_extract_screen_uuid")
    }
    return String(text[swiftRange])
  }
}

struct HelperError: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

func parseArgs() throws -> Config {
  var arguments = Array(CommandLine.arguments.dropFirst())
  guard arguments.first == "ios" else {
    throw HelperError("missing_or_invalid_mode")
  }
  arguments.removeFirst()

  var deviceId: String?
  var deviceSetPath: String?

  while !arguments.isEmpty {
    let argument = arguments.removeFirst()
    switch argument {
    case "--udid":
      guard let value = arguments.first, !value.isEmpty else {
        throw HelperError("missing_udid")
      }
      deviceId = arguments.removeFirst()
    case "--device-set-path":
      guard let value = arguments.first, !value.isEmpty else {
        throw HelperError("missing_device_set_path")
      }
      deviceSetPath = arguments.removeFirst()
    default:
      throw HelperError("unexpected_argument:\(argument)")
    }
  }

  guard let deviceId else {
    throw HelperError("missing_udid")
  }

  return Config(deviceId: deviceId, deviceSetPath: deviceSetPath)
}

func sanitize(_ value: String) -> String {
  value.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
}

do {
  let io = ProtocolIO()
  let config = try parseArgs()
  let bridge = try SimulatorBridge(config: config, io: io)

  if let deviceSetPath = config.deviceSetPath {
    io.emit("info device_set_path \(sanitize(deviceSetPath))")
  }

  let input = FileHandle.standardInput
  while let line = try input.read(upToCount: 4096), !line.isEmpty {
    guard let commandLine = String(data: line, encoding: .utf8) else {
      continue
    }

    for rawLine in commandLine.split(separator: "\n") {
      let trimmed = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty {
        continue
      }

      let parts = trimmed.split(separator: " ", omittingEmptySubsequences: true)
      guard let command = parts.first.map(String.init) else {
        continue
      }

      switch command {
      case "ping":
        if let requestId = parts.dropFirst().first {
          io.emit("ack \(sanitize(String(requestId)))")
        } else {
          io.emit("error protocol missing_request_id:ping")
        }
      case "shutdown":
        if let requestId = parts.dropFirst().first {
          io.emit("ack \(sanitize(String(requestId)))")
        } else {
          io.emit("error protocol missing_request_id:shutdown")
        }
        io.emit("stopped")
        exit(0)
      case "screenshot":
        if let requestId = parts.dropFirst().first {
          bridge.screenshot(jobId: String(requestId))
        } else {
          io.emit("error protocol missing_screenshot_id")
        }
      default:
        bridge.respondNotImplemented(trimmed)
      }
    }
  }

  io.emit("stopped")
} catch {
  let message = sanitize(String(describing: error))
  FileHandle.standardError.write(Data((message + "\n").utf8))
  FileHandle.standardOutput.write(Data(("fatal \(message)\n").utf8))
  fflush(stdout)
  exit(1)
}
