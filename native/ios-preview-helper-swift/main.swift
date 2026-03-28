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
  private let outputFd = FileHandle.standardOutput.fileDescriptor

  func emit(_ line: String) {
    queue.sync {
      let data = Data((line + "\n").utf8)
      data.withUnsafeBytes { bytes in
        guard var baseAddress = bytes.baseAddress else {
          return
        }
        var remaining = bytes.count
        while remaining > 0 {
          let written = Darwin.write(outputFd, baseAddress, remaining)
          if written <= 0 {
            break
          }
          remaining -= written
          baseAddress = baseAddress.advanced(by: written)
        }
      }
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

  var hasConnectedClients: Bool {
    queue.sync {
      !clients.isEmpty
    }
  }

  func broadcast(jpeg data: Data) {
    queue.async {
      var survivingClients: [FileHandle] = []
      for client in self.clients {
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
          survivingClients.append(client)
        } catch {
          self.headerSent.remove(identifier)
          try? client.close()
        }
      }
      self.clients = survivingClients
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
  private static let stateQueueKey = DispatchSpecificKey<Void>()
  private static let controlQueueKey = DispatchSpecificKey<Void>()

  private let config: Config
  private let io: ProtocolIO
  private let mjpegServer: MjpegServer

  private let context: AnyObject
  private let deviceSet: AnyObject
  private let device: AnyObject
  private let descriptor: AnyObject
  private let screen: AnyObject
  private let screenUUID: String
  private let screenID: Int
  private let ciContext = CIContext()
  private let simulatorDispatchQueue = DispatchQueue(label: "com.simulatorServer.dispatchQueue")
  private let simDeviceClient: AnyObject?
  private var startupPurpleWorkspacePort: mach_port_name_t?
  private var lastJpegFrame: Data?
  private var streamReadyEmitted = false
  private var unsupportedPayloadTypes = Set<String>()
  private var informationalEvents = Set<String>()
  private var frameCallbackCount = 0
  private var surfacesChangedCallbackCount = 0
  private var propertiesChangedCallbackCount = 0
  private let stateQueue = DispatchQueue(label: "cozea.ios-preview-helper.state")

  private struct BootstrapResult {
    let context: AnyObject
    let deviceSet: AnyObject
    let device: AnyObject
    let descriptor: AnyObject
    let screen: AnyObject
    let screenUUID: String
    let screenID: Int
  }

  init(config: Config, io: ProtocolIO) throws {
    self.config = config
    self.io = io
    self.stateQueue.setSpecific(key: Self.stateQueueKey, value: ())
    self.simulatorDispatchQueue.setSpecific(key: Self.controlQueueKey, value: ())
    io.emit("info stage init_start")
    self.mjpegServer = try MjpegServer()
    io.emit("info stage mjpeg_server_ready")

    guard dlopen(simulatorKitPath, RTLD_NOW) != nil else {
      throw HelperError("failed to load SimulatorKit at \(simulatorKitPath)")
    }
    io.emit("info stage simulatorkit_loaded")

    let bootstrap = try SimulatorBridge.bootstrap(config: config, io: io)

    self.context = bootstrap.context
    self.deviceSet = bootstrap.deviceSet
    self.device = bootstrap.device
    self.descriptor = bootstrap.descriptor
    self.screen = bootstrap.screen
    self.screenUUID = bootstrap.screenUUID
    self.screenID = bootstrap.screenID
    self.simDeviceClient = try? Self.makeLegacyHidClient(
      device: bootstrap.device,
      sessionResetQueue: simulatorDispatchQueue,
      io: io
    )
    performKeyboardBootstrap()
    self.startupPurpleWorkspacePort = try? Self.lookupPurpleWorkspacePort(on: bootstrap.device)
    io.emit("ready \(sanitize(config.deviceId))")
    if let startupPurpleWorkspacePort {
      emitMachPortInfo(startupPurpleWorkspacePort, label: "purple_port_startup")
    } else {
      io.emit("info purple_port_startup_unavailable")
    }
    emitDisplayMetadata()
    io.emit("info phase register_surface_callbacks_start")
    registerSurfaceCallbacks()
    io.emit("info phase register_surface_callbacks_done")
    io.emit("info phase register_display_callbacks_start")
    registerDisplayCallbacks()
    io.emit("info phase register_display_callbacks_done")
    io.emit("info phase start_surface_polling_start")
    startSurfacePolling()
    io.emit("info phase start_surface_polling_done")
  }

  func streamURL() -> String {
    mjpegServer.url.absoluteString
  }

  func screenshot(jobId: String) {
    syncOnStateQueue {
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

  func setUpKeyboard() {
    syncOnControlQueue {
      performKeyboardBootstrap()
    }
  }

  func rotate(rotation: String) {
    syncOnControlQueue {
      do {
        let direction = try Self.purpleRotationDirection(for: rotation)
        try sendPurpleRotate(direction: direction)
      } catch {
        io.emit("error runtime \(sanitize(String(describing: error)))")
      }
    }
  }

  private func registerSurfaceCallbacks() {
    let fullSelector = NSSelectorFromString(
      "registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:"
    )
    if screen.responds(to: fullSelector) {
      typealias RegisterScreenCallbacksFn = @convention(c) (
        AnyObject,
        Selector,
        NSUUID,
        DispatchQueue,
        @convention(block) (AnyObject?) -> Void,
        @convention(block) (AnyObject?) -> Void,
        @convention(block) (AnyObject?) -> Void
      ) -> Void

      let register = unsafeBitCast(screen.method(for: fullSelector), to: RegisterScreenCallbacksFn.self)
      let callbackUUID = NSUUID()
      let frameBlock: @convention(block) (AnyObject?) -> Void = { [weak self] payload in
        self?.emitFrameCallback(kind: "frame")
        self?.handleSurfacePayload(payload)
      }
      let surfacesChangedBlock: @convention(block) (AnyObject?) -> Void = { [weak self] payload in
        self?.emitFrameCallback(kind: "surfaces_changed")
        if let payload {
          self?.handleSurfacePayload(payload)
        }
      }
      let propertiesChangedBlock: @convention(block) (AnyObject?) -> Void = { [weak self] _ in
        self?.emitFrameCallback(kind: "properties_changed")
      }

      io.emit("info phase register_surface_full_selector_resolved")
      io.emit("info phase register_surface_full_call_start")
      register(
        screen,
        fullSelector,
        callbackUUID,
        simulatorDispatchQueue,
        frameBlock,
        surfacesChangedBlock,
        propertiesChangedBlock
      )
      io.emit("info phase register_surface_full_call_done")
    } else {
      io.emit("info phase register_surface_selector_start")
      let selector = NSSelectorFromString("registerCallbackWithUUID:ioSurfacesChangeCallback:")
      typealias RegisterFn = @convention(c) (AnyObject, Selector, NSString, @convention(block) (AnyObject?) -> Void) -> Void
      let register = unsafeBitCast(screen.method(for: selector), to: RegisterFn.self)
      io.emit("info phase register_surface_selector_resolved")

      let block: @convention(block) (AnyObject?) -> Void = { [weak self] payload in
        self?.handleSurfacePayload(payload)
      }

      io.emit("info phase register_surface_call_start")
      register(screen, selector, screenUUID as NSString, block)
      io.emit("info phase register_surface_call_done")
    }

    emitInfoOnce("surface_callback_registered")
  }

  private func registerDisplayCallbacks() {
    io.emit("info phase register_display_selector_start")
    let selector = NSSelectorFromString("registerCallbackWithUUID:displayPropertiesChanged:")
    guard screen.responds(to: selector) else {
      io.emit("info phase register_display_selector_missing")
      return
    }

    typealias RegisterFn = @convention(c) (AnyObject, Selector, NSString, @convention(block) (AnyObject?) -> Void) -> Void
    let register = unsafeBitCast(screen.method(for: selector), to: RegisterFn.self)
    let block: @convention(block) (AnyObject?) -> Void = { [weak self] _ in
      self?.emitInfoOnce("display_properties_changed")
    }
    io.emit("info phase register_display_call_start")
    register(screen, selector, "\(screenUUID)-display" as NSString, block)
    io.emit("info phase register_display_call_done")
    emitInfoOnce("display_callback_registered")
  }

  private func startSurfacePolling() {
    emitInfoOnce("surface_polling_disabled_pending_safe_probe")
  }

  private func handleSurfacePayload(_ payload: AnyObject?) {
    guard let payload else {
      return
    }

    if let data = dataForPayload(payload) {
      syncOnStateQueue {
        lastJpegFrame = data
        if mjpegServer.hasConnectedClients {
          mjpegServer.broadcast(jpeg: data)
        }
        if !streamReadyEmitted {
          streamReadyEmitted = true
          io.emit("stream_ready \(sanitize(mjpegServer.url.absoluteString))")
        }
      }
      return
    }

    let typeName = String(describing: type(of: payload))
    syncOnStateQueue {
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
    io.emit("info screen_id_\(screenID)")
  }

  private func emitInfoOnce(_ key: String) {
    syncOnStateQueue {
      guard !informationalEvents.contains(key) else {
        return
      }
      informationalEvents.insert(key)
      io.emit("info \(sanitize(key))")
    }
  }

  private func emitFrameCallback(kind: String) {
    syncOnStateQueue {
      switch kind {
      case "frame":
        frameCallbackCount += 1
        io.emit("info frame_callback_\(frameCallbackCount)")
      case "surfaces_changed":
        surfacesChangedCallbackCount += 1
        io.emit("info surfaces_changed_callback_\(surfacesChangedCallbackCount)")
      case "properties_changed":
        propertiesChangedCallbackCount += 1
        io.emit("info properties_changed_callback_\(propertiesChangedCallbackCount)")
      default:
        io.emit("info callback_\(sanitize(kind))")
      }
    }
  }

  private func syncOnStateQueue(_ block: () -> Void) {
    if DispatchQueue.getSpecific(key: Self.stateQueueKey) != nil {
      block()
      return
    }

    stateQueue.sync {
      block()
    }
  }

  private func syncOnControlQueue(_ block: () -> Void) {
    if DispatchQueue.getSpecific(key: Self.controlQueueKey) != nil {
      block()
      return
    }

    simulatorDispatchQueue.sync {
      block()
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
    let typeName = String(cString: object_getClassName(payload))
    guard typeName.contains("IOSurface") else {
      return nil
    }

    let opaque = Unmanaged.passUnretained(payload).toOpaque()
    let candidate = unsafeBitCast(opaque, to: IOSurfaceRef.self)
    guard CFGetTypeID(candidate) == IOSurfaceGetTypeID() else {
      return nil
    }
    return candidate
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

  private func sendPurpleRotate(direction: Int32) throws {
    var message = [UInt8](repeating: 0, count: 0x58)

    try writeUInt32(0x20032, at: 0x18, into: &message)
    try writeUInt32(0x4, at: 0x48, into: &message)
    try writeUInt32(UInt32(bitPattern: direction), at: 0x4c, into: &message)

    let remotePort = try lookupPurpleWorkspacePort()
    emitMachPortInfo(remotePort, label: "purple_port_before_send")

    try writeUInt32(0x13, at: 0x0, into: &message)
    try writeUInt32(0x6c, at: 0x4, into: &message)
    try writeUInt32(remotePort, at: 0x8, into: &message)
    try writeUInt32(0, at: 0xc, into: &message)
    try writeUInt32(0, at: 0x10, into: &message)
    try writeUInt32(0x7b, at: 0x14, into: &message)

    let result: kern_return_t = message.withUnsafeMutableBytes { buffer in
      guard let header = buffer.baseAddress?.assumingMemoryBound(to: mach_msg_header_t.self) else {
        return KERN_INVALID_ARGUMENT
      }
      return mach_msg_send(header)
    }

    guard result == KERN_SUCCESS else {
      throw HelperError("purple_rotate_send_failed:\(result)")
    }
  }

  private func lookupPurpleWorkspacePort() throws -> mach_port_name_t {
    if let remotePort = try Self.lookupPurpleWorkspacePort(on: device) {
      emitMachPortInfo(remotePort, label: "purple_port_lookup")
      return remotePort
    }

    if let startupPurpleWorkspacePort, isMachPortUsable(startupPurpleWorkspacePort) {
      emitMachPortInfo(startupPurpleWorkspacePort, label: "purple_port_startup_reused")
      return startupPurpleWorkspacePort
    }

    if let refreshedDevice = try findRefreshedDeviceForPurpleLookup(),
       let remotePort = try Self.lookupPurpleWorkspacePort(on: refreshedDevice) {
      emitMachPortInfo(remotePort, label: "purple_port_lookup_refreshed")
      return remotePort
    }

    throw HelperError("purple_lookup_failed:lookup_returned_zero")
  }

  private static func lookupPurpleWorkspacePort(on candidateDevice: AnyObject) throws -> mach_port_name_t? {
    let selector = NSSelectorFromString("lookup:error:")
    typealias LookupFn = @convention(c) (AnyObject, Selector, NSString, UnsafeMutablePointer<AnyObject?>?) -> mach_port_name_t
    var lookupError: AnyObject?
    let lookup = unsafeBitCast(candidateDevice.method(for: selector), to: LookupFn.self)
    let remotePort = lookup(candidateDevice, selector, "PurpleWorkspacePort" as NSString, &lookupError)
    if let lookupError {
      let errorDescription = sanitize(String(describing: lookupError))
      if errorDescription.contains("current state: Shutdown")
        || errorDescription.contains("current state: Shutting Down") {
        return nil
      }
      throw HelperError("purple_lookup_failed:\(errorDescription)")
    }
    if remotePort == 0 {
      return nil
    }
    return remotePort
  }

  private func findRefreshedDeviceForPurpleLookup() throws -> AnyObject? {
    do {
      let refreshedDevice = try Self.findDevice(deviceSet: deviceSet, udid: config.deviceId)
      let stateSelector = NSSelectorFromString("state")
      typealias StateFn = @convention(c) (AnyObject, Selector) -> Int
      let stateFn = unsafeBitCast(refreshedDevice.method(for: stateSelector), to: StateFn.self)
      let state = stateFn(refreshedDevice, stateSelector)
      io.emit("info purple_lookup_refreshed_device_state_\(state)")
      return refreshedDevice
    } catch {
      io.emit("info purple_lookup_refresh_failed_\(sanitize(String(describing: error)))")
      return nil
    }
  }

  private static func purpleRotationDirection(for rotation: String) throws -> Int32 {
    switch rotation {
    case "Portrait":
      return 1
    case "PortraitUpsideDown":
      return 2
    case "LandscapeLeft":
      return 3
    case "LandscapeRight":
      return 4
    default:
      throw HelperError("unsupported_rotation:\(rotation)")
    }
  }

  private func writeUInt32(_ value: UInt32, at offset: Int, into bytes: inout [UInt8]) throws {
    let end = offset + MemoryLayout<UInt32>.size
    guard offset >= 0, end <= bytes.count else {
      throw HelperError("out_of_bounds_write:\(offset)")
    }
    withUnsafeBytes(of: value) { rawBytes in
      for (index, byte) in rawBytes.enumerated() {
        bytes[offset + index] = byte
      }
    }
  }

  private func emitMachPortInfo(_ port: mach_port_name_t, label: String) {
    var portType: mach_port_type_t = 0
    let status = mach_port_type(mach_task_self_, port, &portType)
    if status == KERN_SUCCESS {
      io.emit("info \(label)_\(port)_type_\(portType)")
    } else {
      io.emit("info \(label)_\(port)_type_error_\(status)")
    }
  }

  private func isMachPortUsable(_ port: mach_port_name_t) -> Bool {
    let machPortTypeSend: mach_port_type_t = 1 << 16
    var portType: mach_port_type_t = 0
    let status = mach_port_type(mach_task_self_, port, &portType)
    guard status == KERN_SUCCESS else {
      return false
    }
    return (portType & machPortTypeSend) != 0
  }

  private func performKeyboardBootstrap() {
    io.emit("info keyboard_bootstrap_start")
    setUpKeyboardOnDeviceIfAvailable()

    guard let simDeviceClient else {
      io.emit("info keyboard_client_unavailable")
      return
    }

    io.emit("info keyboard_client_ready")
    do {
      try sendSyntheticWarmupKeyEvents(using: simDeviceClient)
      io.emit("info keyboard_warmup_sent")
    } catch {
      io.emit("info keyboard_warmup_failed_\(sanitize(String(describing: error)))")
    }
  }

  private func setUpKeyboardOnDeviceIfAvailable() {
    let hardwareSelector = NSSelectorFromString("setHardwareKeyboardEnabled:keyboardType:error:")
    let languageSelector = NSSelectorFromString("setKeyboardLanguage:error:")

    if device.responds(to: languageSelector) {
      typealias SetKeyboardLanguageFn = @convention(c) (
        AnyObject,
        Selector,
        NSString,
        UnsafeMutablePointer<AnyObject?>?
      ) -> Bool
      let setKeyboardLanguage = unsafeBitCast(device.method(for: languageSelector), to: SetKeyboardLanguageFn.self)
      var error: AnyObject?
      let language = (Locale.current.language.languageCode?.identifier ?? "en") as NSString
      let success = setKeyboardLanguage(device, languageSelector, language, &error)
      if let error {
        io.emit("info keyboard_language_error_\(sanitize(String(describing: error)))")
      } else {
        io.emit("info keyboard_language_result_\(success ? "true" : "false")_\(sanitize(language as String))")
      }
    } else {
      io.emit("info keyboard_language_selector_missing")
    }

    if device.responds(to: hardwareSelector) {
      typealias SetHardwareKeyboardFn = @convention(c) (
        AnyObject,
        Selector,
        Bool,
        Int,
        UnsafeMutablePointer<AnyObject?>?
      ) -> Bool
      let setHardwareKeyboard = unsafeBitCast(device.method(for: hardwareSelector), to: SetHardwareKeyboardFn.self)
      var error: AnyObject?
      let enabled = setHardwareKeyboard(device, hardwareSelector, true, 0, &error)
      if let error {
        io.emit("info keyboard_enable_error_\(sanitize(String(describing: error)))")
      } else {
        io.emit("info keyboard_enable_result_\(enabled ? "true" : "false")")
      }

      Thread.sleep(forTimeInterval: 0.05)
      error = nil
      let disabled = setHardwareKeyboard(device, hardwareSelector, false, 0, &error)
      if let error {
        io.emit("info keyboard_disable_error_\(sanitize(String(describing: error)))")
      } else {
        io.emit("info keyboard_disable_result_\(disabled ? "true" : "false")")
      }
    } else {
      io.emit("info keyboard_enable_selector_missing")
    }
  }

  private func sendSyntheticWarmupKeyEvents(using client: AnyObject) throws {
    let handle = dlopen(simulatorKitPath, RTLD_NOW)
    guard let keyboardBuilder = dlsym(handle, "IndigoHIDMessageForKeyboardArbitrary") else {
      throw HelperError("missing_IndigoHIDMessageForKeyboardArbitrary")
    }

    typealias KeyboardBuilderFn = @convention(c) (UInt32, UInt32) -> UnsafeMutableRawPointer?
    let buildKeyboardMessage = unsafeBitCast(keyboardBuilder, to: KeyboardBuilderFn.self)

    if let down = buildKeyboardMessage(0, 1) {
      try sendLegacyHidMessage(down, using: client)
    }
    if let up = buildKeyboardMessage(0, 2) {
      try sendLegacyHidMessage(up, using: client)
    }

    Thread.sleep(forTimeInterval: 0.05)
  }

  private func sendLegacyHidMessage(_ message: UnsafeMutableRawPointer, using client: AnyObject) throws {
    let selector = NSSelectorFromString("sendWithMessage:freeWhenDone:completionQueue:completion:")
    guard client.responds(to: selector) else {
      throw HelperError("missing_sendWithMessage")
    }

    typealias SendMessageFn = @convention(c) (
      AnyObject,
      Selector,
      UnsafeMutableRawPointer,
      Bool,
      DispatchQueue,
      AnyObject?
    ) -> Void

    let sendMessage = unsafeBitCast(client.method(for: selector), to: SendMessageFn.self)
    sendMessage(
      client,
      selector,
      message,
      true,
      simulatorDispatchQueue,
      nil
    )
  }

  private static func makeLegacyHidClient(
    device: AnyObject,
    sessionResetQueue: DispatchQueue,
    io: ProtocolIO
  ) throws -> AnyObject {
    guard let cls = NSClassFromString("SimulatorKit.SimDeviceLegacyHIDClient") as? NSObject.Type else {
      throw HelperError("missing_SimDeviceLegacyHIDClient")
    }

    guard let alloc = cls.perform(NSSelectorFromString("alloc"))?.takeUnretainedValue() else {
      throw HelperError("failed_to_alloc_legacy_hid_client")
    }

    let resetSelector = NSSelectorFromString("initWithDevice:sessionResetQueue:error:sessionResetHandler:")
    if alloc.responds(to: resetSelector) {
      typealias InitWithResetFn = @convention(c) (
        AnyObject,
        Selector,
        AnyObject,
        DispatchQueue,
        UnsafeMutablePointer<AnyObject?>?,
        @convention(block) () -> Void
      ) -> Unmanaged<AnyObject>?

      let resetBlock: @convention(block) () -> Void = {
        io.emit("info hid_client_session_reset")
      }
      let initialize = unsafeBitCast(alloc.method(for: resetSelector), to: InitWithResetFn.self)
      var error: AnyObject?
      if let client = initialize(
        alloc,
        resetSelector,
        device,
        sessionResetQueue,
        &error,
        resetBlock
      )?.takeRetainedValue() {
        io.emit("info hid_client_init_with_reset_queue")
        return client
      }
      if let error {
        io.emit("info hid_client_init_with_reset_queue_failed_\(sanitize(String(describing: error)))")
      }
    }

    let selector = NSSelectorFromString("initWithDevice:error:")
    guard alloc.responds(to: selector) else {
      throw HelperError("missing_initWithDevice:error:")
    }

    typealias InitFn = @convention(c) (
      AnyObject,
      Selector,
      AnyObject,
      UnsafeMutablePointer<AnyObject?>?
    ) -> Unmanaged<AnyObject>?

    var error: AnyObject?
    let initialize = unsafeBitCast(alloc.method(for: selector), to: InitFn.self)
    guard let client = initialize(alloc, selector, device, &error)?.takeRetainedValue() else {
      if let error {
        throw HelperError("legacy_hid_client_init_failed:\(sanitize(String(describing: error)))")
      }
      throw HelperError("legacy_hid_client_init_failed")
    }

    return client
  }

  private static func makeServiceContext() throws -> AnyObject {
    guard let cls = NSClassFromString("SimServiceContext") as? NSObject.Type else {
      throw HelperError("missing_SimServiceContext")
    }

    let developerDir = "/Applications/Xcode.app/Contents/Developer" as NSString
    let sharedSelector = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
    if cls.responds(to: sharedSelector) {
      typealias SharedFn = @convention(c) (AnyClass, Selector, NSString, UnsafeMutablePointer<AnyObject?>?) -> Unmanaged<AnyObject>?
      var sharedError: AnyObject?
      let sharedFn = unsafeBitCast(cls.method(for: sharedSelector), to: SharedFn.self)
      if let context = sharedFn(cls, sharedSelector, developerDir, &sharedError)?.takeRetainedValue() {
        return context
      }
      if let sharedError {
        throw HelperError("failed_to_load_shared_sim_service_context:\(sanitize(String(describing: sharedError)))")
      }
      throw HelperError("failed_to_load_shared_sim_service_context")
    }

    let raw = cls.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
    let initSelector = NSSelectorFromString("initWithDeveloperDir:connectionType:error:")
    typealias InitFn = @convention(c) (AnyObject, Selector, NSString, Int, UnsafeMutablePointer<AnyObject?>?) -> Unmanaged<AnyObject>?
    var initError: AnyObject?
    let initFn = unsafeBitCast(raw.method(for: initSelector), to: InitFn.self)
    guard let context = initFn(raw, initSelector, developerDir, 0, &initError)?.takeRetainedValue() else {
      if let initError {
        throw HelperError("failed_to_initialize_sim_service_context:\(sanitize(String(describing: initError)))")
      }
      throw HelperError("failed_to_initialize_sim_service_context")
    }

    let connectSelector = NSSelectorFromString("connectWithError:")
    typealias ConnectFn = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<AnyObject?>?) -> Bool
    var connectError: AnyObject?
    let connectFn = unsafeBitCast(context.method(for: connectSelector), to: ConnectFn.self)
    guard connectFn(context, connectSelector, &connectError) else {
      if let connectError {
        throw HelperError("failed_to_connect_sim_service_context:\(sanitize(String(describing: connectError)))")
      }
      throw HelperError("failed_to_connect_sim_service_context")
    }
    return context
  }

  private static func bootstrap(config: Config, io: ProtocolIO) throws -> BootstrapResult {
    let maxAttempts = 3
    var lastError: Error?

    for attempt in 1...maxAttempts {
      if attempt > 1 {
        io.emit("info bootstrap_retry_\(attempt)")
        Thread.sleep(forTimeInterval: 1.0)
      }

      do {
        io.emit("info stage make_service_context_start")
        let context = try makeServiceContext()
        io.emit("info stage make_service_context_done")
        io.emit("info stage default_device_set_start")
        let deviceSet = try defaultDeviceSet(context: context)
        io.emit("info stage default_device_set_done")
        io.emit("info stage find_device_start")
        let device = try findDevice(deviceSet: deviceSet, udid: config.deviceId)
        io.emit("info stage find_device_done")
        io.emit("info stage wait_until_booted_start")
        let bootedDevice = try waitUntilBooted(
          deviceSet: deviceSet,
          initialDevice: device,
          deviceId: config.deviceId,
          io: io
        )
        io.emit("info stage wait_until_booted_done")

        io.emit("info stage find_framebuffer_descriptor_start")
        let descriptor = try findFramebufferServerDescriptor(device: bootedDevice)
        io.emit("info stage find_framebuffer_descriptor_done")
        io.emit("info stage enumerate_screen_start")
        let screen = try enumerateScreen(descriptor: descriptor, targetScreenID: radonTargetScreenID)
        io.emit("info stage enumerate_screen_done")
        io.emit("info stage extract_screen_uuid_start")
        let screenUUID = try extractUUID(from: screen)
        io.emit("info stage extract_screen_uuid_done")
        io.emit("info stage read_screen_id_start")
        let screenID = try readScreenID(from: screen)
        io.emit("info stage read_screen_id_done")

        return BootstrapResult(
          context: context,
          deviceSet: deviceSet,
          device: bootedDevice,
          descriptor: descriptor,
          screen: screen,
          screenUUID: screenUUID,
          screenID: screenID
        )
      } catch {
        lastError = error
      }
    }

    throw lastError ?? HelperError("bootstrap_failed")
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
    guard let devices = deviceSet.perform(NSSelectorFromString("availableDevices"))?.takeUnretainedValue() as? NSArray else {
      throw HelperError("failed_to_read_available_simulator_devices")
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

  private static func waitUntilBooted(deviceSet: AnyObject, initialDevice: AnyObject, deviceId: String, io: ProtocolIO) throws -> AnyObject {
    let stateSelector = NSSelectorFromString("state")
    typealias StateFn = @convention(c) (AnyObject, Selector) -> Int
    let deadline = Date().addingTimeInterval(30)
    var emittedStates = Set<String>()
    var currentDevice = initialDevice
    while Date() < deadline {
      if let refreshedDevice = try? findDevice(deviceSet: deviceSet, udid: deviceId) {
        if refreshedDevice !== currentDevice {
          currentDevice = refreshedDevice
          io.emit("info boot_device_refreshed")
        }
      }

      let stateFn = unsafeBitCast(currentDevice.method(for: stateSelector), to: StateFn.self)
      let numericState = stateFn(currentDevice, stateSelector)
      let stateStringValue = currentDevice.perform(NSSelectorFromString("stateString"))?.takeUnretainedValue()
      let stateString = sanitize(String(describing: stateStringValue as Any))
      let stateKey = "boot_state_\(numericState)_\(stateString)"
      if !emittedStates.contains(stateKey) {
        emittedStates.insert(stateKey)
        io.emit("info \(stateKey)")
      }

      if numericState == 3 {
        return currentDevice
      }

      if stateString == "Booted" {
        return currentDevice
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
    guard let properties = screen.perform(NSSelectorFromString("screenProperties"))?.takeUnretainedValue() as AnyObject? else {
      throw HelperError("failed_to_read_screen_id")
    }

    let selector = NSSelectorFromString("screenID")
    typealias ScreenIDFn = @convention(c) (AnyObject, Selector) -> Int32
    let function = unsafeBitCast(properties.method(for: selector), to: ScreenIDFn.self)
    return Int(function(properties, selector))
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

func handleProtocolLine(_ trimmed: String, io: ProtocolIO, bridge: SimulatorBridge) {
  let parts = trimmed.split(separator: " ", omittingEmptySubsequences: true)
  guard let command = parts.first.map(String.init) else {
    return
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
      io.emit("info phase screenshot_command_received_\(sanitize(String(requestId)))")
      bridge.screenshot(jobId: String(requestId))
    } else {
      io.emit("error protocol missing_screenshot_id")
    }
  case "setUpKeyboard":
    bridge.setUpKeyboard()
  case "rotate":
    let rotation = parts.dropFirst().joined(separator: " ")
    if rotation.isEmpty {
      io.emit("error protocol missing_rotation")
    } else {
      bridge.rotate(rotation: rotation)
    }
  default:
    bridge.respondNotImplemented(trimmed)
  }
}

do {
  let io = ProtocolIO()
  let config = try parseArgs()
  let bridge = try SimulatorBridge(config: config, io: io)

  if let deviceSetPath = config.deviceSetPath {
    io.emit("info device_set_path \(sanitize(deviceSetPath))")
  }

  let inputFd = FileHandle.standardInput.fileDescriptor
  let source = DispatchSource.makeReadSource(fileDescriptor: inputFd, queue: DispatchQueue.global())
  var bufferedInput = Data()
  source.setEventHandler {
    var localBuffer = [UInt8](repeating: 0, count: 4096)
    let readCount = Darwin.read(inputFd, &localBuffer, localBuffer.count)
    if readCount <= 0 {
      io.emit("stopped")
      exit(0)
    }

    bufferedInput.append(contentsOf: localBuffer.prefix(readCount))

    while let newlineIndex = bufferedInput.firstIndex(of: 0x0a) {
      let lineData = bufferedInput.prefix(upTo: newlineIndex)
      bufferedInput.removeSubrange(...newlineIndex)
      guard let commandLine = String(data: lineData, encoding: .utf8) else {
        continue
      }
      let trimmed = commandLine.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty {
        continue
      }
      handleProtocolLine(trimmed, io: io, bridge: bridge)
    }
  }
  source.resume()
  dispatchMain()
} catch {
  let message = sanitize(String(describing: error))
  FileHandle.standardError.write(Data((message + "\n").utf8))
  FileHandle.standardOutput.write(Data(("fatal \(message)\n").utf8))
  fflush(stdout)
  exit(1)
}
