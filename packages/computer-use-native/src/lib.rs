use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[link(name = "CozeaComputerUseBridge")]
extern "C" {
    fn cozea_computer_use_call(
        session_id: *const c_char,
        tool: *const c_char,
        arguments_json: *const c_char,
    ) -> *mut c_char;
    fn cozea_computer_use_list_tools() -> *mut c_char;
    fn cozea_computer_use_turn_ended(session_id: *const c_char);
    fn cozea_computer_use_reset_session(session_id: *const c_char);
    fn cozea_computer_use_reset_all();
    fn cozea_computer_use_diagnostics() -> *mut c_char;
    fn cozea_computer_use_request_permission(target: *const c_char) -> bool;
    fn cozea_computer_use_free(pointer: *mut c_char);
}

fn operation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn lock_operations() -> Result<std::sync::MutexGuard<'static, ()>> {
    operation_lock()
        .lock()
        .map_err(|_| Error::from_reason("Computer Use operation lock was poisoned"))
}

fn to_c_string(value: &str, label: &str) -> Result<CString> {
    CString::new(value).map_err(|_| Error::from_reason(format!("{label} contains an embedded NUL byte")))
}

unsafe fn take_owned_string(pointer: *mut c_char) -> Result<String> {
    if pointer.is_null() {
        return Err(Error::from_reason("Computer Use native bridge returned a null response"));
    }
    let value = CStr::from_ptr(pointer).to_string_lossy().into_owned();
    cozea_computer_use_free(pointer);
    Ok(value)
}

#[napi]
pub async fn call_tool(session_id: String, tool: String, arguments_json: String) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        let _guard = lock_operations()?;
        let session_id = to_c_string(&session_id, "sessionId")?;
        let tool = to_c_string(&tool, "tool")?;
        let arguments_json = to_c_string(&arguments_json, "argumentsJson")?;
        unsafe {
            take_owned_string(cozea_computer_use_call(
                session_id.as_ptr(),
                tool.as_ptr(),
                arguments_json.as_ptr(),
            ))
        }
    })
    .await
    .map_err(|error| Error::from_reason(format!("Computer Use worker join failed: {error}")))?
}

#[napi]
pub fn list_tools() -> Result<String> {
    let _guard = lock_operations()?;
    unsafe { take_owned_string(cozea_computer_use_list_tools()) }
}

#[napi]
pub fn diagnostics() -> Result<String> {
    unsafe { take_owned_string(cozea_computer_use_diagnostics()) }
}

#[napi]
pub fn request_permission(target: String) -> Result<bool> {
    let target = to_c_string(&target, "permission target")?;
    Ok(unsafe { cozea_computer_use_request_permission(target.as_ptr()) })
}

#[napi]
pub async fn turn_ended(session_id: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let _guard = lock_operations()?;
        let session_id = to_c_string(&session_id, "sessionId")?;
        unsafe { cozea_computer_use_turn_ended(session_id.as_ptr()) };
        Ok(())
    })
    .await
    .map_err(|error| Error::from_reason(format!("Computer Use worker join failed: {error}")))?
}

#[napi]
pub async fn reset_session(session_id: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let _guard = lock_operations()?;
        let session_id = to_c_string(&session_id, "sessionId")?;
        unsafe { cozea_computer_use_reset_session(session_id.as_ptr()) };
        Ok(())
    })
    .await
    .map_err(|error| Error::from_reason(format!("Computer Use worker join failed: {error}")))?
}

#[napi]
pub async fn reset_all() -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let _guard = lock_operations()?;
        unsafe { cozea_computer_use_reset_all() };
        Ok(())
    })
    .await
    .map_err(|error| Error::from_reason(format!("Computer Use worker join failed: {error}")))?
}
