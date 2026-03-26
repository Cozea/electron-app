use libloading::Library;
use std::ffi::c_void;

pub type IOSurfaceRef = *mut c_void;

#[link(name = "IOSurface", kind = "framework")]
unsafe extern "C" {
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
