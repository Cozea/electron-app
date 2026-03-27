const fs = require('fs');

let lib = fs.readFileSync('packages/pty/src/lib.rs', 'utf8');

// The issue: ctx.value is being returned directly inside `create_threadsafe_function`, 
// but `ctx.value` in N-API context is just the Rust value, not a JS value. 
// We must convert it to a N-API string!
//
// In napi-rs, if you use `create_threadsafe_function`, the closure gives you a `ThreadSafeCallContext<T>` where `ctx.value` is the type `T`.
// The closure must return `Result<Vec<napi::JsUnknown>>` or `napi::JsUnknown` etc, or nothing if you let napi-rs automatically marshal it.
// Napi-rs 2.10+ can automatically convert strings and numbers if we define the function signatures correctly via `#[napi]` but for ThreadsafeFunction we need:
//
// `|ctx| ctx.env.create_string(&ctx.value).map(|v| vec![v.into_unknown()])`
//

lib = lib.replace(/\|ctx\| Ok\(vec\!\[ctx\.value\]\)/g, 
`|ctx| {
            let env = ctx.env;
            if let Ok(js_str) = env.create_string(&ctx.value) {
                Ok(vec![js_str.into_unknown()])
            } else {
                Ok(vec![])
            }
        }`);
// Wait, the exit code is an i32, so it needs `create_int32`
// Let's replace them carefully.

let repl_data = `|ctx| {
            let env = ctx.env;
            let js_str = env.create_string(&ctx.value)?;
            Ok(vec![js_str.into_unknown()])
        }`;

let repl_exit = `|ctx| {
            let env = ctx.env;
            let js_num = env.create_int32(ctx.value)?;
            Ok(vec![js_num.into_unknown()])
        }`;

let idx_data = lib.indexOf('.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?');
lib = lib.substring(0, idx_data) + '.create_threadsafe_function(0, ' + repl_data + ')?' + lib.substring(idx_data + 58);

let idx_exit = lib.indexOf('.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?');
lib = lib.substring(0, idx_exit) + '.create_threadsafe_function(0, ' + repl_exit + ')?' + lib.substring(idx_exit + 58);

fs.writeFileSync('packages/pty/src/lib.rs', lib);

