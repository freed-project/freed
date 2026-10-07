//! Explicit Linux custody acceptance. Run `isolated_linux_vault` with --ignored.
//! Every child receives a private bus and XDG roots; no login vault is opened.
#![cfg(target_os = "linux")]
#[path = "../src/library_core_platform_key.rs"]
mod platform;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// This requires dbus-daemon, dbus-send, and gnome-keyring-daemon on PATH.
/// It belongs to the explicit native acceptance tier, not an owner's login bus.
#[test]
#[ignore = "requires Linux Secret Service acceptance dependencies"]
fn isolated_linux_vault() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("bus.conf");
    std::fs::write(&config, format!(r#"<busconfig><type>session</type><listen>unix:path={}/bus</listen><auth>EXTERNAL</auth><policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>"#, root.path().display())).unwrap();
    let mut bus = Process(
        Command::new("dbus-daemon")
            .arg("--nofork")
            .arg("--print-address=1")
            .arg(format!("--config-file={}", config.display()))
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let mut address = String::new();
    BufReader::new(bus.0.stdout.take().unwrap())
        .read_line(&mut address)
        .unwrap();
    let address = address.trim();
    assert!(address.starts_with(&format!("unix:path={}/bus,", root.path().display())));
    let mut env = vec![
        ("DBUS_SESSION_BUS_ADDRESS", address.to_owned()),
        (
            "FREED_VAULT_ACCEPTANCE_ROOT",
            root.path().display().to_string(),
        ),
    ];
    for (name, part) in [
        ("XDG_DATA_HOME", "data"),
        ("XDG_CONFIG_HOME", "config"),
        ("XDG_CACHE_HOME", "cache"),
        ("XDG_RUNTIME_DIR", "runtime"),
    ] {
        let path = root.path().join(part);
        std::fs::create_dir(&path).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        env.push((name, path.display().to_string()));
    }
    let run = |mode: &str| {
        let started = Instant::now();
        let mut child = Process(
            Command::new(std::env::current_exe().unwrap())
                .args(["linux_vault_child", "--ignored", "--exact", "--nocapture"])
                .envs(env.iter().cloned())
                .env("FREED_VAULT_ACCEPTANCE_MODE", mode)
                .spawn()
                .unwrap(),
        );
        loop {
            if let Some(status) = child.0.try_wait().unwrap() {
                assert!(status.success(), "vault phase {mode}");
                break;
            }
            assert!(
                started.elapsed() < Duration::from_secs(15),
                "vault phase timed out: {mode}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    let start = || {
        let mut daemon = Process(
            Command::new("gnome-keyring-daemon")
                .args([
                    "--foreground",
                    "--unlock",
                    "--components=secrets",
                    "--control-directory",
                ])
                .arg(root.path().join("runtime"))
                .envs(env.iter().cloned())
                .stdin(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        daemon
            .0
            .stdin
            .take()
            .unwrap()
            .write_all(b"freed-synthetic-vault-fixture")
            .unwrap();
        let started = Instant::now();
        loop {
            let status = Command::new("dbus-send")
                .args([
                    "--session",
                    "--print-reply",
                    "--dest=org.freedesktop.DBus",
                    "/org/freedesktop/DBus",
                    "org.freedesktop.DBus.GetNameOwner",
                    "string:org.freedesktop.secrets",
                ])
                .envs(env.iter().cloned())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .unwrap();
            if status.success() {
                break;
            }
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "private vault did not start"
            );
            assert!(daemon.0.try_wait().unwrap().is_none());
            std::thread::sleep(Duration::from_millis(20));
        }
        daemon
    };
    run("refuse");
    let daemon = start();
    run("write");
    run("read");
    run("lock");
    run("refuse");
    drop(daemon);
    run("refuse");
    let _daemon = start();
    run("read");
    run("corrupt");
    run("duplicate");
}

#[test]
#[ignore = "child of isolated_linux_vault; never run against a login session"]
fn linux_vault_child() {
    use platform::{load_platform_key, store_platform_key, PlatformKeyVault};
    // The parent supplies a fresh private data root and bus to every child.
    let root = std::env::var("FREED_VAULT_ACCEPTANCE_ROOT").expect("run isolated_linux_vault");
    assert_eq!(
        std::env::var("XDG_DATA_HOME").unwrap(),
        format!("{root}/data")
    );
    assert!(std::env::var("DBUS_SESSION_BUS_ADDRESS")
        .unwrap()
        .starts_with(&format!("unix:path={root}/bus,")));
    let mode = std::env::var("FREED_VAULT_ACCEPTANCE_MODE").unwrap();
    const ACTOR: PlatformKeyVault = PlatformKeyVault {
        account: "actor-current",
        envelope_format: "freed_library_core_actor_key_v1",
        description: "actor",
    };
    const AUTHORITY: PlatformKeyVault = PlatformKeyVault {
        account: "authority-current",
        envelope_format: "freed_library_core_authority_key_v1",
        description: "authority",
    };
    match mode.as_str() {
        "write" => {
            assert_eq!(load_platform_key(&ACTOR, "synthetic-a").unwrap(), None);
            store_platform_key(&ACTOR, "synthetic-a", b"synthetic-actor-a").unwrap();
            store_platform_key(&ACTOR, "synthetic-b", b"synthetic-actor-b").unwrap();
            store_platform_key(&AUTHORITY, "synthetic-a", b"synthetic-authority-a").unwrap();
        }
        "read" => {
            for (vault, subject, bytes) in [
                (&ACTOR, "synthetic-a", b"synthetic-actor-a".as_slice()),
                (&ACTOR, "synthetic-b", b"synthetic-actor-b".as_slice()),
                (
                    &AUTHORITY,
                    "synthetic-a",
                    b"synthetic-authority-a".as_slice(),
                ),
            ] {
                assert_eq!(
                    load_platform_key(vault, subject).unwrap().as_deref(),
                    Some(bytes)
                );
            }
            assert_eq!(load_platform_key(&ACTOR, "absent").unwrap(), None);
        }
        "refuse" => {
            assert!(load_platform_key(&ACTOR, "synthetic-a").is_err());
            assert!(load_platform_key(&ACTOR, "absent").is_err());
            assert!(store_platform_key(&ACTOR, "synthetic-a", b"replacement").is_err());
        }
        "lock" | "corrupt" | "duplicate" => {
            use dbus_secret_service::{EncryptionType, SecretService};
            let service =
                SecretService::connect_with_max_prompt_timeout(EncryptionType::Dh, 0).unwrap();
            let collection = service.get_default_collection().unwrap();
            if mode == "lock" {
                collection.lock().unwrap();
                return;
            }
            let attributes = std::collections::HashMap::from([
                ("service", platform::KEYRING_SERVICE),
                ("username", "subject-v1:13:actor-current:synthetic-a"),
                ("target", "default"),
            ]);
            if mode == "corrupt" {
                let items = collection.search_items(attributes).unwrap();
                assert_eq!(items.len(), 1);
                items[0]
                    .set_secret(b"corrupt", "application/octet-stream")
                    .unwrap();
                assert!(load_platform_key(&ACTOR, "synthetic-a").is_err());
                store_platform_key(&ACTOR, "synthetic-a", b"synthetic-actor-a").unwrap();
            } else {
                collection
                    .create_item(
                        "duplicate synthetic fixture",
                        attributes,
                        b"duplicate",
                        false,
                        "application/octet-stream",
                    )
                    .unwrap();
                assert!(load_platform_key(&ACTOR, "synthetic-a").is_err());
                assert!(store_platform_key(&ACTOR, "synthetic-a", b"replacement").is_err());
            }
        }
        _ => panic!("unknown acceptance phase"),
    }
}
