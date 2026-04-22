import Foundation
import ObjectiveC

let coreSimPath = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
let simKitPath = "/Library/Developer/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"

dlopen(coreSimPath, RTLD_NOW)
dlopen(simKitPath, RTLD_NOW)

var classCount: UInt32 = 0
let classList = objc_copyClassList(&classCount)
if let classList = classList {
    for i in 0..<Int(classCount) {
        let cls: AnyClass = classList[i]
        let name = String(cString: class_getName(cls))
        if name.lowercased().contains("display") || name.lowercased().contains("surface") || name.lowercased().contains("framebuffer") {
            print(name)
        }
    }
}
