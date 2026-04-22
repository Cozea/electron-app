import Foundation
import ObjectiveC

func getXcodePath() -> String {
    let task = Process()
    task.launchPath = "/usr/bin/xcode-select"
    task.arguments = ["-p"]
    let pipe = Pipe()
    task.standardOutput = pipe
    task.launch()
    task.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "/Applications/Xcode.app/Contents/Developer"
}

let devPath = getXcodePath()
let coreSimPath = "\(devPath)/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
let simKitPath = "\(devPath)/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
let coreSimPathAlt = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
let simKitPathAlt = "/Library/Developer/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"

var csHandle = dlopen(coreSimPath, RTLD_NOW)
if csHandle == nil { csHandle = dlopen(coreSimPathAlt, RTLD_NOW) }

var skHandle = dlopen(simKitPath, RTLD_NOW)
if skHandle == nil { skHandle = dlopen(simKitPathAlt, RTLD_NOW) }

if csHandle == nil { 
    print("Failed to load CoreSimulator") 
} else {
    print("Loaded CoreSimulator")
}

if skHandle == nil { 
    print("Failed to load SimulatorKit") 
} else {
    print("Loaded SimulatorKit")
}

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
    "SimDevice",
    "SimDisplay",
    "SimDeviceLegacyHIDClient",
    "SimDeviceHIDClient",
    "SimDisplayRenderable",
    "SimDisplayIOSurfaceRenderable"
]

for cls in classesToDump {
    dumpClass(cls)
}
