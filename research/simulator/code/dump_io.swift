import Foundation

let csHandle = dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW)
let skHandle = dlopen("/Library/Developer/PrivateFrameworks/SimulatorKit.framework/SimulatorKit", RTLD_NOW)

func dumpClass(_ className: String) {
    print("\n=== \(className) ===")
    guard let cls = NSClassFromString(className) else {
        print("Class not found")
        return
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

dumpClass("SimDeviceIO")
dumpClass("_TtC12SimulatorKit15SimDeviceScreen")
dumpClass("_TtC12SimulatorKit24SimDeviceLegacyHIDClient")
