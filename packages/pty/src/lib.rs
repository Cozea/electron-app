#![deny(clippy::all)]

use napi_derive::napi;
use portable_pty::{native_pty_system, CommandBuilder, PtySize, Child, MasterPty};
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};
use std::thread;
use std::collections::HashMap;
use napi::{JsFunction, Result, threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy}};

#[napi(object)]
pub struct PtyOptions {
    pub executable: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub env: Option<HashMap<String, String>>,
}

#[napi]
pub struct NativePty {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

#[napi]
impl NativePty {
    #[napi]
    pub fn write(&self, data: String) -> Result<()> {
        let mut w = self.writer.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
        w.write_all(data.as_bytes()).map_err(|e| napi::Error::from_reason(e.to_string()))?;
        w.flush().map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(())
    }

    #[napi]
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let master = self.master.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| napi::Error::from_reason(e.to_string()))?;
        Ok(())
    }

    #[napi]
    pub fn kill(&self) -> Result<()> {
        let mut child = self.child.lock().map_err(|e| napi::Error::from_reason(e.to_string()))?;
        let _ = child.kill();
        Ok(())
    }
}

#[napi(ts_args_type = "options: PtyOptions, onData: (data: string) => void, onExit: (exitCode: number) => void")]
pub fn spawn(
    options: PtyOptions,
    on_data: JsFunction,
    on_exit: JsFunction,
) -> Result<NativePty> {
    let pty_system = native_pty_system();

    let pair = pty_system.openpty(PtySize {
        rows: options.rows,
        cols: options.cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let mut cmd = CommandBuilder::new(&options.executable);
    cmd.args(&options.args);
    cmd.cwd(&options.cwd);

    if let Some(env) = options.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    
    // We don't need the slave handle in this process anymore
    drop(pair.slave);

    let writer = pair.master.take_writer().map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| napi::Error::from_reason(e.to_string()))?;

    let tsfn_on_data: ThreadsafeFunction<String, ErrorStrategy::CalleeHandled> = on_data
        .create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
        
    let tsfn_on_exit: ThreadsafeFunction<i32, ErrorStrategy::CalleeHandled> = on_exit
        .create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;

    let child_arc = Arc::new(Mutex::new(child));
    let child_clone = child_arc.clone();

    // Data reading thread
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[0..n]).into_owned();
                    tsfn_on_data.call(Ok(text), ThreadsafeFunctionCallMode::Blocking);
                }
                Err(_) => break, // Disconnected or error
            }
        }
        
        // Wait for the child to exit
        if let Ok(mut c) = child_clone.lock() {
            let exit_status = c.wait().unwrap_or_else(|_| portable_pty::ExitStatus::with_exit_code(1));
            let code = if exit_status.success() { 0 } else { 1 };
            tsfn_on_exit.call(Ok(code), ThreadsafeFunctionCallMode::Blocking);
        }
    });

    Ok(NativePty {
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(pair.master)),
        child: child_arc,
    })
}
