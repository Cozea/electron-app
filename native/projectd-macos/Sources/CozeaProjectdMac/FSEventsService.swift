import Foundation
import CoreServices

public struct FSEventItem: Codable {
    public let id: UInt64
    public let path: String
    public let flags: UInt32
    public let isCreated: Bool
    public let isRemoved: Bool
    public let isRenamed: Bool
    public let isModified: Bool
    public let isDir: Bool
    public let isSymlink: Bool
    public let dropped: Bool
}

public final class FSEventsService: @unchecked Sendable {
    public static let shared = FSEventsService()

    private var activeStreams: [UInt64: FSEventStreamRef] = [:]
    private var nextStreamId: UInt64 = 1
    private let lock = NSLock()

    private init() {}

    public func startStream(
        path: String,
        latency: Double = 0.05,
        onEvents: @escaping ([FSEventItem]) -> Void
    ) -> UInt64 {
        lock.lock()
        defer { lock.unlock() }

        let streamId = nextStreamId
        nextStreamId += 1

        let pathsToWatch = [path] as CFArray
        var context = FSEventStreamContext(
            version: 0,
            info: UnsafeMutableRawPointer(Unmanaged.passRetained(StreamCallbackWrapper(callback: onEvents)).toOpaque()),
            retain: nil,
            release: { info in
                guard let info = info else { return }
                Unmanaged<StreamCallbackWrapper>.fromOpaque(info).release()
            },
            copyDescription: nil
        )

        let flags: FSEventStreamCreateFlags = UInt32(
            kFSEventStreamCreateFlagFileEvents |
            kFSEventStreamCreateFlagNoDefer |
            kFSEventStreamCreateFlagUseCFTypes |
            kFSEventStreamCreateFlagWatchRoot
        )

        let stream = FSEventStreamCreate(
            kCFAllocatorDefault,
            { (streamRef, clientCallBackInfo, numEvents, eventPaths, eventFlags, eventIds) in
                guard let info = clientCallBackInfo else { return }
                let wrapper = Unmanaged<StreamCallbackWrapper>.fromOpaque(info).takeUnretainedValue()

                guard let paths = unsafeBitCast(eventPaths, to: NSArray.self) as? [String] else { return }
                var items: [FSEventItem] = []

                for i in 0..<numEvents {
                    let flag = eventFlags[i]
                    let eventId = eventIds[i]
                    let eventPath = paths[i]

                    let isCreated = (flag & UInt32(kFSEventStreamEventFlagItemCreated)) != 0
                    let isRemoved = (flag & UInt32(kFSEventStreamEventFlagItemRemoved)) != 0
                    let isRenamed = (flag & UInt32(kFSEventStreamEventFlagItemRenamed)) != 0
                    let isModified = (flag & UInt32(kFSEventStreamEventFlagItemModified)) != 0
                    let isDir = (flag & UInt32(kFSEventStreamEventFlagItemIsDir)) != 0
                    let isSymlink = (flag & UInt32(kFSEventStreamEventFlagItemIsSymlink)) != 0
                    let dropped = (flag & UInt32(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped)) != 0

                    items.append(FSEventItem(
                        id: eventId,
                        path: eventPath,
                        flags: flag,
                        isCreated: isCreated,
                        isRemoved: isRemoved,
                        isRenamed: isRenamed,
                        isModified: isModified,
                        isDir: isDir,
                        isSymlink: isSymlink,
                        dropped: dropped
                    ))
                }

                wrapper.callback(items)
            },
            &context,
            pathsToWatch,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            latency,
            flags
        )

        guard let streamRef = stream else {
            return 0
        }

        FSEventStreamSetDispatchQueue(streamRef, DispatchQueue.global(qos: .userInitiated))
        FSEventStreamStart(streamRef)

        activeStreams[streamId] = streamRef
        return streamId
    }

    public func stopStream(streamId: UInt64) {
        lock.lock()
        defer { lock.unlock() }

        guard let stream = activeStreams.removeValue(forKey: streamId) else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
    }

    public func stopAll() {
        lock.lock()
        let ids = Array(activeStreams.keys)
        lock.unlock()

        for id in ids {
            stopStream(streamId: id)
        }
    }
}

private class StreamCallbackWrapper: @unchecked Sendable {
    let callback: ([FSEventItem]) -> Void
    init(callback: @escaping ([FSEventItem]) -> Void) {
        self.callback = callback
    }
}
