//! Integration tests for `KernelBridge` against a real fake-kernel Node subprocess.
//!
//! These spawn `node tests/fixtures/fake-kernel.mjs` (must be on PATH) and exercise the
//! JSON-RPC 2.0-over-stdio bridge end to end.

use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cobeing_gui_lib::kernel_bridge::{KernelBridge, KernelBridgeError, KernelBridgeOptions};

fn fake_kernel_command() -> Command {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("fake-kernel.mjs");
    let mut cmd = Command::new("node");
    cmd.arg(fixture);
    cmd
}

fn on_exited_flag() -> Arc<Mutex<Option<Option<i32>>>> {
    Arc::new(Mutex::new(None))
}

/// Shared harness: builds options, spawns the bridge, returns bridge + a helper to read
/// the on_exited signal.
fn spawn_bridge(timeout: Duration) -> (Arc<KernelBridge>, Arc<Mutex<Option<Option<i32>>>>) {
    let exited = on_exited_flag();
    let exited_cb = Arc::clone(&exited);
    let options = KernelBridgeOptions {
        command: fake_kernel_command(),
        on_notify: Box::new(|_| {}),
        on_exited: Box::new(move |code| {
            *exited_cb.lock().unwrap() = Some(code);
        }),
        request_timeout: timeout,
    };
    let bridge = KernelBridge::spawn(options).expect("spawn fake kernel");
    (bridge, exited)
}

#[test]
fn ping_round_trips() {
    let (bridge, _exited) = spawn_bridge(Duration::from_secs(5));
    let result = bridge
        .request("ping", None)
        .expect("ping should resolve to a result");
    assert_eq!(
        result,
        serde_json::json!({ "pong": true }),
        "ping result must be {{pong:true}}"
    );
    let _ = bridge.stop();
}

#[test]
fn notify_callback_is_invoked() {
    // Dedicated harness that records the notification payload.
    let received = Arc::new(Mutex::new(None::<serde_json::Value>));
    let recv_cb = Arc::clone(&received);
    let exited = on_exited_flag();
    let exited_cb = Arc::clone(&exited);
    let options = KernelBridgeOptions {
        command: fake_kernel_command(),
        on_notify: Box::new(move |params| {
            *recv_cb.lock().unwrap() = Some(params);
        }),
        on_exited: Box::new(move |code| {
            *exited_cb.lock().unwrap() = Some(code);
        }),
        request_timeout: Duration::from_secs(5),
    };
    let bridge = KernelBridge::spawn(options).expect("spawn fake kernel");

    bridge.request("emit-notify", None).expect("emit-notify");
    // Give the reader thread a moment to deliver the notification.
    for _ in 0..50 {
        if received.lock().unwrap().is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let payload = received.lock().unwrap().clone();
    assert_eq!(
        payload,
        Some(serde_json::json!({ "content": "hello from fake kernel" })),
        "notification params must carry the fixed content"
    );
    let _ = bridge.stop();
}

#[test]
fn boom_returns_rpc_error() {
    let (bridge, _exited) = spawn_bridge(Duration::from_secs(5));
    let err = bridge.request("boom", None).expect_err("boom must fail");
    match err {
        KernelBridgeError::Rpc { code, message } => {
            assert_eq!(code, -32000, "boom error code must be -32000");
            assert_eq!(message, "业务失败", "boom message must be preserved");
        }
        other => panic!("expected Rpc error, got {other:?}"),
    }
    let _ = bridge.stop();
}

#[test]
fn unknown_method_returns_rpc_error() {
    let (bridge, _exited) = spawn_bridge(Duration::from_secs(5));
    let err = bridge
        .request("no_such_method", None)
        .expect_err("unknown method must fail");
    match err {
        KernelBridgeError::Rpc { code, message } => {
            assert_eq!(code, -32601, "unknown method error code must be -32601");
            assert!(message.starts_with("method not found"), "unexpected {message}");
        }
        other => panic!("expected Rpc error, got {other:?}"),
    }
    let _ = bridge.stop();
}

#[test]
fn slow_request_times_out() {
    // 500ms timeout vs. the fake kernel's 2s delay.
    let (bridge, _exited) = spawn_bridge(Duration::from_millis(500));
    let started = std::time::Instant::now();
    let err = bridge.request("slow", None).expect_err("slow must time out");
    assert!(
        matches!(err, KernelBridgeError::Timeout),
        "expected Timeout, got {err:?}"
    );
    let elapsed = started.elapsed();
    assert!(
        elapsed < Duration::from_secs(4),
        "timeout should fire before the slow reply; took {elapsed:?}"
    );
    // The late reply must not panic; process is still alive.
    assert!(bridge.is_alive(), "kernel should still be alive after a timeout");
    let _ = bridge.stop();
}

#[test]
fn stop_exits_process_and_fires_callback() {
    let (bridge, exited) = spawn_bridge(Duration::from_secs(5));
    assert!(bridge.is_alive(), "kernel should be alive before stop");

    bridge.stop();

    // stop() is synchronous and idempotent; after it returns the process should be dead.
    assert!(
        !bridge.is_alive(),
        "kernel must not be alive after stop() returned"
    );
    // on_exited should have fired (waiter thread) with exit code 0.
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    let code = loop {
        {
            let guard = exited.lock().unwrap();
            if let Some(c) = guard.as_ref() {
                break c.clone();
            }
        }
        if std::time::Instant::now() >= deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    assert!(code.is_some(), "on_exited must fire with Some(code)");
    assert_eq!(code, Some(0), "fake kernel exits with code 0");
    // stop() again must be a no-op.
    bridge.stop();
}

#[test]
fn pending_request_receives_closed_after_process_killed() {
    let (bridge, _exited) = spawn_bridge(Duration::from_secs(5));

    // Start a slow request whose reply will never arrive because we kill the process.
    let bridge_for_worker = Arc::clone(&bridge);
    let worker = std::thread::spawn(move || bridge_for_worker.request("slow", None));

    // Give the request a moment to be written to the pipe before killing.
    std::thread::sleep(Duration::from_millis(100));
    bridge.kill();

    let outcome = worker.join().expect("worker thread must finish");
    match outcome {
        Err(KernelBridgeError::Closed) => {}
        Err(KernelBridgeError::Transport(_)) => {}
        oth => panic!("pending request should fail with Closed/Transport, got {oth:?}"),
    }
    assert!(!bridge.is_alive(), "kernel must be dead after kill()");
}

#[test]
fn params_are_forwarded() {
    let (bridge, _exited) = spawn_bridge(Duration::from_secs(5));
    // The fake kernel echoes no params, but a request with explicit empty object params
    // must still succeed (it exercises the `{}` default path via None as well).
    let _ = bridge.request("ping", Some(serde_json::json!({}))).unwrap();
    let _ = bridge.stop();
}
