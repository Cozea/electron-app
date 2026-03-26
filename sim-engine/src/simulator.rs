use libloading::Library;
use objc2::rc::Id;
use objc2::{msg_send, ClassType};
use objc2_foundation::{NSObject, NSString};
use std::ffi::c_void;
use std::sync::Arc;

pub type IOSurfaceRef = *mut c_void;

#[link(name = "IOSurface", kind = "framework")]
extern "C" {
    pub fn IOSurfaceLock(buffer: IOSurfaceRef, options: u32, seed: *mut u32) -> i32;
    pub fn IOSurfaceUnlock(buffer: IOSurfaceRef, options: u32, seed: *mut u32) -> i32;
    pub fn IOSurfaceGetBaseAddress(buffer: IOSurfaceRef) -> *mut c_void;
    pub fn IOSurfaceGetWidth(buffer: IOSurfaceRef) -> usize;
    pub fn IOSurfaceGetHeight(buffer: IOSurfaceRef) -> usize;
    pub fn IOSurfaceGetBytesPerRow(buffer: IOSurfaceRef) -> usize;
    pub fn IOSurfaceGetPixelFormat(buffer: IOSurfaceRef) -> u32;
}

pub struct SimulatorKit {
    lib: Library,
}

impl SimulatorKit {
    pub fn load() -> Result<Self, libloading::Error> {
        unsafe {
            // First load CoreSimulator since SimulatorKit depends on it
            let _ = Library::new("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator");
            let lib = Library::new("/Library/Developer/PrivateFrameworks/SimulatorKit.framework/SimulatorKit")?;
            Ok(Self { lib })
        }
    }
}
