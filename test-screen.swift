import Foundation

let libCS = dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_LAZY)
let libSK = dlopen("/Library/Developer/PrivateFrameworks/SimulatorKit.framework/SimulatorKit", RTLD_LAZY)

guard let clsDeviceSet = NSClassFromString("SimDeviceSet") as? NSObject.Type else { exit(1) }
let defaultSet = clsDeviceSet.perform(NSSelectorFromString("defaultSet"))!.takeUnretainedValue()
let devices = defaultSet.perform(NSSelectorFromString("availableDevicesByUDID"))!.takeUnretainedValue() as! [String: AnyObject]
let udid = "571DBC5E-01D2-4C67-939C-C620DAC7D085"
guard let device = devices[udid] else {
    print("Device not found")
    exit(1)
}
print("Device:", device)

let mainDisplay = device.perform(NSSelectorFromString("mainDisplay"))?.takeUnretainedValue()
print("Main Display:", mainDisplay)
