import Foundation
import ObjectiveC

let simKitPath = "/Library/Developer/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
dlopen(simKitPath, RTLD_NOW)

var out = ""
var protoCount: UInt32 = 0
if let protocols = objc_copyProtocolList(&protoCount) {
    for i in 0..<Int(protoCount) {
        let proto = protocols[i]
        let name = String(cString: protocol_getName(proto))
        out += "\n=== Protocol \(name) ===\n"
        
        var propCount: UInt32 = 0
        if let props = protocol_copyPropertyList(proto, &propCount) {
            for j in 0..<Int(propCount) {
                let propName = String(cString: property_getName(props[j]))
                out += "@property \(propName)\n"
            }
            free(props)
        }
        
        var methCount: UInt32 = 0
        if let methods = protocol_copyMethodDescriptionList(proto, true, true, &methCount) {
            for j in 0..<Int(methCount) {
                if let sel = methods[j].name {
                    out += "- [\(NSStringFromSelector(sel))]\n"
                }
            }
            free(methods)
        }
    }
}
print(out)
