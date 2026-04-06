use sysinfo::{System, Pid};
fn main() {
    let mut sys = System::new_all();
    sys.refresh_all();
}
