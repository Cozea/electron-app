mod simulator;
mod device;
mod input;
mod server;

use clap::Parser;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(default_value = "ios")]
    cmd: String,

    #[arg(long)]
    id: String,

    #[arg(short, long)]
    license_token: Option<String>,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    
    let _sim_kit = simulator::SimulatorKit::load().expect("Failed to load SimulatorKit");
    
    let device = device::get_device_by_udid(&args.id).expect("Device not found");
    
    let stream_state = Arc::new(Mutex::new(server::StreamState::new()));
    let port = server::start_mjpeg_server(stream_state.clone()).await.unwrap();
    println!("stream_ready http://127.0.0.1:{}/stream.mjpeg", port);
    
    device::start_video_capture(device, stream_state).unwrap();
    
    input::start_stdin_loop(device).await;
}
