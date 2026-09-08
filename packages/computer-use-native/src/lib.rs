use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[link(name = "CozeaComputerUseBridge")]
extern "C" {
    fn cozea_computer_use_abi_version() -> u32;
    fn cozea_computer_use_configure(session: *const c_char, policy: *const c_char) -> bool;
    fn cozea_computer_use_revoke_session(session: *const c_char);
    fn cozea_computer_use_revoke_all();
    fn cozea_computer_use_cancel_request(session: *const c_char, request: *const c_char);
    fn cozea_computer_use_call(session: *const c_char, tool: *const c_char, arguments: *const c_char, context: *const c_char) -> *mut c_char;
    fn cozea_computer_use_list_tools() -> *mut c_char;
    fn cozea_computer_use_turn_ended(session: *const c_char);
    fn cozea_computer_use_reset_session(session: *const c_char);
    fn cozea_computer_use_reset_all();
    fn cozea_computer_use_diagnostics() -> *mut c_char;
    fn cozea_computer_use_request_permission(target: *const c_char) -> bool;
    fn cozea_computer_use_free(pointer: *mut c_char);
}
fn c_string(value: &str) -> Result<CString> {
    CString::new(value).map_err(|_| Error::from_reason("Native argument contains an embedded NUL"))
}
unsafe fn take_string(pointer: *mut c_char) -> Result<String> {
    if pointer.is_null() { return Err(Error::from_reason("Native bridge returned null")); }
    let result = CStr::from_ptr(pointer).to_str().map(str::to_owned)
        .map_err(|_| Error::from_reason("Native result is not UTF-8"));
    cozea_computer_use_free(pointer);
    result
}
fn join_error(error: tokio::task::JoinError) -> Error {
    Error::from_reason(format!("Native Computer Use worker failed: {error}"))
}
#[napi]
pub fn abi_version() -> u32 { unsafe { cozea_computer_use_abi_version() } }

// These functions are synchronous and nonblocking. Revocation must not queue
// behind the worker that is currently awaiting visible cursor arrival.
#[napi]
pub fn configure_session(session: String, policy_json: String) -> Result<bool> {
    let session = c_string(&session)?; let policy = c_string(&policy_json)?;
    Ok(unsafe { cozea_computer_use_configure(session.as_ptr(), policy.as_ptr()) })
}
#[napi]
pub fn revoke_session(session: String) -> Result<()> {
    let session = c_string(&session)?;
    unsafe { cozea_computer_use_revoke_session(session.as_ptr()) }; Ok(())
}
#[napi]
pub fn revoke_all() { unsafe { cozea_computer_use_revoke_all() } }
#[napi]
pub fn cancel_request(session: String, request: String) -> Result<()> {
    let session = c_string(&session)?; let request = c_string(&request)?;
    unsafe { cozea_computer_use_cancel_request(session.as_ptr(), request.as_ptr()) }; Ok(())
}
#[napi]
pub async fn call_tool(session: String, tool: String, arguments_json: String, context_json: String) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        let session = c_string(&session)?; let tool = c_string(&tool)?;
        let arguments = c_string(&arguments_json)?; let context = c_string(&context_json)?;
        unsafe { take_string(cozea_computer_use_call(session.as_ptr(), tool.as_ptr(), arguments.as_ptr(), context.as_ptr())) }
    }).await.map_err(join_error)?
}
#[napi]
pub fn list_tools() -> Result<String> { unsafe { take_string(cozea_computer_use_list_tools()) } }
#[napi]
pub async fn diagnostics() -> Result<String> {
    tokio::task::spawn_blocking(|| unsafe { take_string(cozea_computer_use_diagnostics()) }).await.map_err(join_error)?
}
#[napi]
pub fn request_permission(target: String) -> Result<bool> {
    let target = c_string(&target)?;
    Ok(unsafe { cozea_computer_use_request_permission(target.as_ptr()) })
}
#[napi]
pub async fn turn_ended(session: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let session = c_string(&session)?;
        unsafe { cozea_computer_use_turn_ended(session.as_ptr()) }; Ok(())
    }).await.map_err(join_error)?
}
#[napi]
pub async fn reset_session(session: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let session = c_string(&session)?;
        unsafe { cozea_computer_use_reset_session(session.as_ptr()) }; Ok(())
    }).await.map_err(join_error)?
}
#[napi]
pub async fn reset_all() -> Result<()> {
    tokio::task::spawn_blocking(|| { unsafe { cozea_computer_use_reset_all() }; Ok(()) }).await.map_err(join_error)?
}
