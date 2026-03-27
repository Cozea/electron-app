use std::env;
use std::io::{self, BufRead, Write};
use std::process;

#[derive(Debug, Clone)]
struct Config {
    device_id: String,
    device_set_path: Option<String>,
}

fn main() {
    if let Err(message) = run() {
        let clean = sanitize(&message);
        let _ = writeln!(io::stderr(), "{clean}");
        let _ = println!("fatal {clean}");
        let _ = io::stdout().flush();
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let config = parse_args(env::args().skip(1).collect())?;

    println!("ready {}", sanitize(&config.device_id));
    if let Some(device_set_path) = &config.device_set_path {
        println!("info device_set_path {}", sanitize(device_set_path));
    }
    io::stdout()
        .flush()
        .map_err(|error| format!("failed to flush startup event: {error}"))?;

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();

    while let Some(line_result) = lines.next() {
        let line = line_result.map_err(|error| format!("failed to read stdin: {error}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match parse_command(trimmed) {
            Command::Ping { request_id } => {
                println!("ack {}", sanitize(&request_id));
            }
            Command::Shutdown { request_id } => {
                println!("ack {}", sanitize(&request_id));
                println!("stopped");
                io::stdout()
                    .flush()
                    .map_err(|error| format!("failed to flush shutdown event: {error}"))?;
                return Ok(());
            }
            Command::Screenshot { job_id } => {
                println!(
                    "error {} not_implemented:{}",
                    sanitize(&job_id),
                    sanitize(trimmed)
                );
            }
            Command::Runtime { line } => {
                println!("error runtime not_implemented:{}", sanitize(line));
            }
            Command::ProtocolError { message } => {
                println!("error protocol {}", sanitize(&message));
            }
        }

        io::stdout()
            .flush()
            .map_err(|error| format!("failed to flush response: {error}"))?;
    }

    println!("stopped");
    io::stdout()
        .flush()
        .map_err(|error| format!("failed to flush stop event: {error}"))?;

    Ok(())
}

fn parse_args(arguments: Vec<String>) -> Result<Config, String> {
    let mut args = arguments.into_iter();
    let mode = args.next().ok_or_else(|| usage("missing mode"))?;
    if mode != "ios" {
        return Err(usage(&format!("unsupported mode: {mode}")));
    }

    let mut device_id: Option<String> = None;
    let mut device_set_path: Option<String> = None;

    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--udid" => {
                let value = args
                    .next()
                    .ok_or_else(|| usage("missing value for --udid"))?;
                if value.trim().is_empty() {
                    return Err(usage("empty value for --udid"));
                }
                device_id = Some(value);
            }
            "--device-set-path" => {
                let value = args
                    .next()
                    .ok_or_else(|| usage("missing value for --device-set-path"))?;
                if value.trim().is_empty() {
                    return Err(usage("empty value for --device-set-path"));
                }
                device_set_path = Some(value);
            }
            "--help" | "-h" => {
                return Err(usage("help requested"));
            }
            other => {
                return Err(usage(&format!("unexpected argument: {other}")));
            }
        }
    }

    Ok(Config {
        device_id: device_id.ok_or_else(|| usage("missing required --udid"))?,
        device_set_path,
    })
}

fn usage(reason: &str) -> String {
    format!(
        "{reason}. Usage: cozea-ios-preview-helper ios --udid <device-id> [--device-set-path <path>]"
    )
}

enum Command<'a> {
    Ping { request_id: String },
    Shutdown { request_id: String },
    Screenshot { job_id: String },
    Runtime { line: &'a str },
    ProtocolError { message: String },
}

fn parse_command(line: &str) -> Command<'_> {
    let mut parts = line.split_whitespace();
    let command = parts.next().unwrap_or_default();

    match command {
        "ping" | "shutdown" => {
            let request_id = parts.next().unwrap_or_default().trim().to_string();
            if request_id.is_empty() {
                return Command::ProtocolError {
                    message: format!("missing_request_id:{command}"),
                };
            }

            if command == "ping" {
                Command::Ping { request_id }
            } else {
                Command::Shutdown { request_id }
            }
        }
        "screenshot" => {
            let job_id = parts.next().unwrap_or_default().trim().to_string();
            if job_id.is_empty() {
                return Command::ProtocolError {
                    message: "missing_screenshot_id".to_string(),
                };
            }

            Command::Screenshot { job_id }
        }
        "touch"
        | "wheel"
        | "key"
        | "button"
        | "rotate"
        | "copy_screenshot"
        | "fps"
        | "pointer"
        | "video"
        | "paste"
        | "token"
        | "setUpKeyboard" => Command::Runtime { line },
        other => Command::ProtocolError {
            message: format!("unknown_command:{other}"),
        },
    }
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|character| if character.is_control() && character != '\t' { ' ' } else { character })
        .collect::<String>()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{parse_args, parse_command, Command};

    #[test]
    fn parse_args_accepts_udid_and_device_set_path() {
        let config = parse_args(vec![
            "ios".to_string(),
            "--udid".to_string(),
            "SIM-123".to_string(),
            "--device-set-path".to_string(),
            "/tmp/device-set".to_string(),
        ])
        .expect("args should parse");

        assert_eq!(config.device_id, "SIM-123");
        assert_eq!(config.device_set_path.as_deref(), Some("/tmp/device-set"));
    }

    #[test]
    fn parse_args_requires_udid() {
        let error = parse_args(vec!["ios".to_string()]).expect_err("missing udid should fail");
        assert!(error.contains("missing required --udid"));
    }

    #[test]
    fn parse_command_recognizes_runtime_and_protocol_commands() {
        match parse_command("ping 12") {
            Command::Ping { request_id } => assert_eq!(request_id, "12"),
            _ => panic!("expected ping command"),
        }

        match parse_command("screenshot shot-1 -r Portrait") {
            Command::Screenshot { job_id } => assert_eq!(job_id, "shot-1"),
            _ => panic!("expected screenshot command"),
        }

        match parse_command("rotate LandscapeLeft") {
            Command::Runtime { line } => assert_eq!(line, "rotate LandscapeLeft"),
            _ => panic!("expected runtime command"),
        }
    }

    #[test]
    fn parse_command_rejects_unknown_lines() {
        match parse_command("mystery") {
            Command::ProtocolError { message } => assert_eq!(message, "unknown_command:mystery"),
            _ => panic!("expected protocol error"),
        }
    }
}
