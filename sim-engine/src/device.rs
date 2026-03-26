use std::ffi::{c_void, CStr, CString};
use std::os::raw::c_char;
use objc2::rc::Id;
use objc2::runtime::{Class, Object, Sel};
use objc2::{msg_send, sel};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::server::StreamState;
use crate::simulator::IOSurfaceRef;

pub fn get_device_by_udid(udid: &str) -> Option<*mut Object> {
    unsafe {
        let cls_nsstring = Class::get("NSString")?;
        let udid_nsstr: *mut Object = msg_send![cls_nsstring, stringWithUTF8String: CString::new(udid).unwrap().as_ptr()];
        
        let cls_context = Class::get("SimServiceContext")?;
        let ctx: *mut Object = msg_send![cls_context, sharedServiceContextForDeveloperDir: std::ptr::null_mut::<c_void>() error: std::ptr::null_mut::<c_void>()];
        
        let default_set: *mut Object = msg_send![ctx, defaultDeviceSetWithError: std::ptr::null_mut::<c_void>()];
        if default_set.is_null() { return None; }
        
        let devices_dict: *mut Object = msg_send![default_set, availableDevicesByUDID];
        if devices_dict.is_null() { return None; }
        
        let device: *mut Object = msg_send![devices_dict, objectForKey: udid_nsstr];
        if device.is_null() { return None; }
        
        Some(device)
    }
}

pub fn start_video_capture(device: *mut Object, stream_state: Arc<Mutex<StreamState>>) -> Result<(), String> {
    unsafe {
        let screen: *mut Object = msg_send![device, mainScreen];
        if screen.is_null() { return Err("No mainScreen on device".into()); }
        
        // Register callbacks or polling.
        // For MVP, let's just start a tokio interval to poll unmaskedSurface.
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(16));
            loop {
                interval.tick().await;
                let surface: IOSurfaceRef = msg_send![screen, unmaskedSurface];
                if !surface.is_null() {
                    if let Ok(jpeg) = encode_iosurface_to_jpeg(surface) {
                        let state = stream_state.lock().await;
                        let _ = state.tx.send(jpeg);
                    }
                }
            }
        });
    }
    Ok(())
}

fn encode_iosurface_to_jpeg(surface: IOSurfaceRef) -> Result<Vec<u8>, String> {
    unsafe {
        crate::simulator::IOSurfaceLock(surface, 1, std::ptr::null_mut());
        let width = crate::simulator::IOSurfaceGetWidth(surface);
        let height = crate::simulator::IOSurfaceGetHeight(surface);
        let bytes_per_row = crate::simulator::IOSurfaceGetBytesPerRow(surface);
        let ptr = crate::simulator::IOSurfaceGetBaseAddress(surface) as *const u8;
        
        let len = bytes_per_row * height;
        let data = std::slice::from_raw_parts(ptr, len);
        
        // Use image crate to encode to jpeg. The format is typically BGRA or RGBA.
        // Assuming BGRA8
        let mut img = image::RgbaImage::new(width as u32, height as u32);
        for y in 0..height {
            for x in 0..width {
                let offset = y * bytes_per_row + x * 4;
                let b = data[offset];
                let g = data[offset + 1];
                let r = data[offset + 2];
                let a = data[offset + 3];
                img.put_pixel(x as u32, y as u32, image::Rgba([r, g, b, a]));
            }
        }
        crate::simulator::IOSurfaceUnlock(surface, 1, std::ptr::null_mut());
        
        let mut buf = std::io::Cursor::new(Vec::new());
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 80);
        encoder.encode_image(&img).map_err(|e| e.to_string())?;
        
        Ok(buf.into_inner())
    }
}
