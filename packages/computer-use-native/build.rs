use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Runs a command and returns its stdout output, panicking with a descriptive message on failure.
fn run(mut command: Command, label: &str) -> String {
    let output = command.output().unwrap_or_else(|error| panic!("{label} could not start: {error}"));
    if !output.status.success() {
        panic!(
            "{label} failed (status {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// Maps Rust target architecture to Swift target triple for macOS.
fn swift_triple(target_arch: &str) -> &'static str {
    match target_arch {
        "aarch64" => "arm64-apple-macosx14.0",
        "x86_64" => "x86_64-apple-macosx14.0",
        other => panic!("Unsupported macOS Computer Use architecture: {other}"),
    }
}

fn main() {
    napi_build::setup();

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let repository_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("packages/computer-use-native must live two levels below the repository root");
    let swift_package = repository_root.join("native/computer-use-bridge");
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH");
    let triple = swift_triple(&target_arch);

    println!("cargo:rerun-if-changed={}", swift_package.join("Package.swift").display());
    println!(
        "cargo:rerun-if-changed={}",
        swift_package.join("Sources/CozeaComputerUseBridge/Bridge.swift").display()
    );

    let mut build = Command::new("/usr/bin/xcrun");
    build.args([
        "swift",
        "build",
        "--package-path",
        swift_package.to_str().expect("swift package path"),
        "--configuration",
        "release",
        "--triple",
        triple,
        "--product",
        "CozeaComputerUseBridge",
    ]);
    run(build, "Swift OpenComputerUseKit bridge build");

    let mut bin_path = Command::new("/usr/bin/xcrun");
    bin_path.args([
        "swift",
        "build",
        "--package-path",
        swift_package.to_str().expect("swift package path"),
        "--configuration",
        "release",
        "--triple",
        triple,
        "--show-bin-path",
    ]);
    let swift_bin_path = run(bin_path, "Swift bridge bin-path query");

    println!("cargo:rustc-link-search=native={swift_bin_path}");
    println!("cargo:rustc-link-lib=dylib=CozeaComputerUseBridge");
    println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path");
    println!("cargo:rustc-env=COZEA_COMPUTER_USE_SWIFT_BIN_PATH={swift_bin_path}");
}
