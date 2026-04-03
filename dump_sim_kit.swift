import Foundation
import ObjectiveC

let devPath = "/Applications/Xcode.app/Contents/Developer"
let coreSimPath = "\(devPath)/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
let simKitPath = "\(devPath)/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"

dlopen(coreSimPath, RTLD_NOW)
dlopen(simKitPath, RTLD_NOW)

func dumpClass(_ className: String) {
    print("\n=== \(className) ===")
    guard let cls = NSClassFromString(className) else {
        print("Class not found")
        return
    }
    
    var propCount: UInt32 = 0
    if let props = class_copyPropertyList(cls, &propCount) {
        for i in 0..<Int(propCount) {
            let prop = props[i]
            let name = property_getName(prop)
            print("@property \(String(cString: name))")
        }
        free(props)
    }

    var methodCount: UInt32 = 0
    if let methods = class_copyMethodList(cls, &methodCount) {
        for i in 0..<Int(methodCount) {
            let sel = method_getName(methods[i])
            print("- [\(NSStringFromSelector(sel))]")
        }
        free(methods)
    }
}

let classesToDump = [
    "SimDeviceIO",
    "SimDeviceIOClient",
    "SimDisplay",
    "SimDeviceFramebufferService",
    "_TtC12SimulatorKit14SimDisplayView",
    "_TtC12SimulatorKit15SimDeviceScreen",
    "_TtC12SimulatorKit24SimDeviceLegacyHIDClient",
    "_TtC12SimulatorKit24SimDisplayRenderableView",
    "SimulatorKit.SimDeviceLegacyHIDClient",
    "SimulatorKit.SimDisplayView",
    "CoreSimulator.SimDeviceIO"
]

for cls in classesToDump {
    dumpClass(cls)
}
