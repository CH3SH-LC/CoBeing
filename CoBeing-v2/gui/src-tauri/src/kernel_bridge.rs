//! KernelBridge — pure Rust bridge to the `cobeing-kernel` subprocess.
//!
//! This module is deliberately free of any Tauri dependency so it can be unit /
//! integration tested with a fake kernel subprocess (`node fake-kernel.mjs`).
//!
//! Protocol: JSON-RPC 2.0 over stdio, one JSON object per line.
//!   request  : {"jsonrpc":"2.0","id":<u64>,"method":"<m>","params":<obj>}
//!   response : {"jsonrpc":"2.0","id":N,"result":<v>} | {"jsonrpc":"2.0","id":N,"error":{..}}
//!   notify   : {"jsonrpc":"2.0","method":"notify","params":{..}}   (no id)
//!
//! Thread model:
//!   - one reader thread parses stdout lines and routes responses / notifications;
//!   - one stderr thread accumulates stderr into a small ring buffer for diagnostics;
//!   - one waiter thread blocks on `child.wait()`, fires on_exited, and clears pending.
//! Calls to `request` may originate from many threads concurrently (Tauri commands);
//! id allocation and the pending map are guarded by a Mutex, and the shared child
//! stdin is serialized through another Mutex.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// Errors surfaced by a kernel round-trip.
#[derive(Debug, Clone)]
pub enum KernelBridgeError {
    /// Transport failure (writing failed, malformed line, process gone, ...).
    Transport(String),
    /// The request exceeded `request_timeout`.
    Timeout,
    /// The kernel replied with a JSON-RPC error object.
    Rpc { code: i64, message: String },
    /// The subprocess exited before the response arrived.
    Closed,
}

impl std::fmt::Display for KernelBridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KernelBridgeError::Transport(msg) => write!(f, "transport error: {msg}"),
            KernelBridgeError::Timeout => write!(f, "request timed out"),
            KernelBridgeError::Rpc { code, message } => write!(f, "[{code}] {message}"),
            KernelBridgeError::Closed => write!(f, "kernel process is closed"),
        }
    }
}

impl std::error::Error for KernelBridgeError {}

/// Constructor options for a [`KernelBridge`].
pub struct KernelBridgeOptions {
    /// Command used to spawn the kernel. Tests inject a fake kernel here.
    pub command: Command,
    /// Invoked on the reader thread for each `notify` notification (params object).
    pub on_notify: Box<dyn Fn(serde_json::Value) + Send + 'static>,
    /// Invoked once when the subprocess exits (with its exit code if available).
    pub on_exited: Box<dyn Fn(Option<i32>) + Send + 'static>,
    /// Per-request timeout. Defaults to 60s when not set.
    pub request_timeout: Duration,
}

impl Default for KernelBridgeOptions {
    fn default() -> Self {
        KernelBridgeOptions {
            command: Command::new("node"),
            on_notify: Box::new(|_| {}),
            on_exited: Box::new(|_| {}),
            request_timeout: Duration::from_secs(60),
        }
    }
}

/// The bridge. Shared as `Arc<KernelBridge>`; the interior threads hold clones.
pub struct KernelBridge {
    /// `None` once the waiter thread has reaped the process.
    child: Mutex<Option<Child>>,
    stdin: Mutex<ChildStdin>,
    /// id -> single-value channel that receives the matched response line.
    pending: Mutex<HashMap<u64, mpsc::Sender<serde_json::Value>>>,
    next_id: AtomicU64,
    request_timeout: Duration,
    /// No more responses will ever arrive; all current waiters may be failed.
    exited: AtomicBool,
    /// Set by `stop()` when a grace period has elapsed and the process must be killed.
    kill_requested: AtomicBool,
    on_exited: Mutex<Option<Box<dyn Fn(Option<i32>) + Send + 'static>>>,
    /// Rolling buffer of the last N stderr lines (diagnostics).
    stderr_ring: Mutex<Vec<String>>,
    stderr_cap: usize,
}

const STDERR_RING_CAP: usize = 200;

impl KernelBridge {
    /// Spawn the subprocess for `options` and start the reader / stderr / waiter threads.
    /// Returns an `Arc` that all threads and callers share. Consumes `options`.
    pub fn spawn(mut options: KernelBridgeOptions) -> Result<Arc<KernelBridge>, KernelBridgeError> {
        let request_timeout = if options.request_timeout.is_zero() {
            Duration::from_secs(60)
        } else {
            options.request_timeout
        };

        let mut child = options.command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| KernelBridgeError::Transport(format!("failed to spawn: {e}")))?;

        // ChildStdin must be taken out before we move `child` into the waiter thread.
        let stdin = child.stdin.take().ok_or_else(|| {
            KernelBridgeError::Transport("child stdin was not piped".into())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            KernelBridgeError::Transport("child stdout was not piped".into())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            KernelBridgeError::Transport("child stderr was not piped".into())
        })?;

        let bridge = Arc::new(KernelBridge {
            child: Mutex::new(Some(child)),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            request_timeout,
            exited: AtomicBool::new(false),
            kill_requested: AtomicBool::new(false),
            on_exited: Mutex::new(Some(options.on_exited)),
            stderr_ring: Mutex::new(Vec::new()),
            stderr_cap: STDERR_RING_CAP,
        });

        // Reader thread (stdout).
        {
            let bridge = Arc::clone(&bridge);
            let on_notify = options.on_notify;
            thread::Builder::new()
                .name("kernel-reader".into())
                .spawn(move || bridge.reader_loop(BufReader::new(stdout), on_notify))
                .map_err(|e| KernelBridgeError::Transport(format!("reader thread: {e}")))?;
        }

        // Stderr ring thread.
        {
            let bridge = Arc::clone(&bridge);
            thread::Builder::new()
                .name("kernel-stderr".into())
                .spawn(move || bridge.stderr_loop(BufReader::new(stderr)))
                .map_err(|e| KernelBridgeError::Transport(format!("stderr thread: {e}")))?;
        }

        // Waiter thread (process exit detection).
        {
            let bridge = Arc::clone(&bridge);
            thread::Builder::new()
                .name("kernel-waiter".into())
                .spawn(move || bridge.waiter_loop())
                .map_err(|e| KernelBridgeError::Transport(format!("waiter thread: {e}")))?;
        }

        Ok(bridge)
    }

    /// Is the subprocess still believed to be running?
    pub fn is_alive(&self) -> bool {
        if self.exited.load(Ordering::SeqCst) {
            return false;
        }
        let mut child = self.child.lock().unwrap();
        match child.as_mut() {
            Some(proc) => proc.try_wait().map(|s| s.is_none()).unwrap_or(false),
            None => false,
        }
    }

    /// Send a JSON-RPC request and await the matching response, using the configured
    /// default timeout. Safe to call concurrently from many threads.
    pub fn request(
        self: &Arc<Self>,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, KernelBridgeError> {
        self.request_with_timeout(method, params, self.request_timeout)
    }

    /// `request` with an explicit timeout (used internally by `stop` with a short one).
    fn request_with_timeout(
        self: &Arc<Self>,
        method: &str,
        params: Option<serde_json::Value>,
        timeout: Duration,
    ) -> Result<serde_json::Value, KernelBridgeError> {
        if self.exited.load(Ordering::SeqCst) {
            return Err(KernelBridgeError::Closed);
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let params = params.unwrap_or_else(|| serde_json::json!({}));

        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);

        let line =
            serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let line_str = line.to_string();

        let write_result = {
            let mut stdin = self.stdin.lock().unwrap();
            stdin
                .write_all(line_str.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush())
                .map_err(|e| KernelBridgeError::Transport(format!("write failed: {e}")))
        };

        if let Err(e) = write_result {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }

        let response = match rx.recv_timeout(timeout) {
            Ok(line) => line,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending.lock().unwrap().remove(&id);
                // The process may have exited while we were waiting.
                if self.exited.load(Ordering::SeqCst) {
                    return Err(KernelBridgeError::Closed);
                }
                return Err(KernelBridgeError::Timeout);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.pending.lock().unwrap().remove(&id);
                if self.exited.load(Ordering::SeqCst) {
                    return Err(KernelBridgeError::Closed);
                }
                return Err(KernelBridgeError::Transport(
                    "response channel closed without leaving match".into(),
                ));
            }
        };

        self.pending.lock().unwrap().remove(&id);
        Self::decode_response(response)
    }

    /// Interpret a received response object: Ok(result) or Err(Rpc{..}).
    fn decode_response(
        value: serde_json::Value,
    ) -> Result<serde_json::Value, KernelBridgeError> {
        let Some(obj) = value.as_object() else {
            return Err(KernelBridgeError::Transport("malformed response".into()));
        };
        if let Some(result) = obj.get("result") {
            return Ok(result.clone());
        }
        if let Some(err) = obj.get("error") {
            let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
            let message = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            return Err(KernelBridgeError::Rpc { code, message });
        }
        Err(KernelBridgeError::Transport("malformed response".into()))
    }

    /// Gracefully stop: send the `stop` request (short ~3s timeout, best effort), then
    /// wait for the process to exit (up to 5s), then force-kill if still alive. Idempotent.
    pub fn stop(self: &Arc<Self>) {
        if self.exited.load(Ordering::SeqCst) {
            return;
        }
        let _ = self.request_with_timeout("stop", None, Duration::from_secs(3));
        self.wait_exit(Duration::from_secs(5));
        if self.exited.load(Ordering::SeqCst) {
            return;
        }
        // Not dead yet — request the waiter thread to force-kill it.
        self.kill_requested.store(true, Ordering::SeqCst);
        self.wait_exit(Duration::from_secs(2));
    }

    /// Actually signal the process to die (used by the waiter thread / force path).
    fn send_kill(&self) {
        let mut child = self.child.lock().unwrap();
        if let Some(proc) = child.as_mut() {
            let _ = proc.kill();
        }
    }

    /// Immediately terminate the subprocess (no graceful `stop` handshake) and wait for
    /// it to be reaped by the waiter thread. Outstanding requests fail as `Closed`.
    pub fn kill(self: &Arc<Self>) {
        if self.exited.load(Ordering::SeqCst) {
            return;
        }
        self.kill_requested.store(true, Ordering::SeqCst);
        self.send_kill();
        self.wait_exit(Duration::from_secs(5));
    }

    /// Wait up to `timeout` for the subprocess to exit.
    fn wait_exit(self: &Arc<Self>, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        while !self.exited.load(Ordering::SeqCst) {
            if Instant::now() >= deadline {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    /// Drain the last (up to `STDERR_RING_CAP`) stderr lines as diagnostics.
    pub fn stderr_lines(&self) -> Vec<String> {
        self.stderr_ring.lock().unwrap().clone()
    }

    // ---- reader / stderr / waiter loops ------------------------------------

    fn reader_loop(
        self: &Arc<Self>,
        mut stdout: BufReader<std::process::ChildStdout>,
        on_notify: Box<dyn Fn(serde_json::Value) + Send + 'static>,
    ) {
        let mut line = String::new();
        loop {
            line.clear();
            match stdout.read_line(&mut line) {
                Ok(0) => break, // EOF
                Ok(_) => {}
                Err(_) => break,
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let value: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue, // ignore malformed lines
            };
            let Some(obj) = value.as_object() else { continue };
            if let Some(id) = obj.get("id").and_then(|id| id.as_u64()) {
                // Response: deliver the whole object to the matching waiter.
                if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
                    let _ = tx.send(value);
                }
            } else if obj
                .get("method")
                .and_then(|m| m.as_str())
                .map(|m| m == "notify")
                .unwrap_or(false)
            {
                // Notification: forward params.
                let params = obj.get("params").cloned().unwrap_or(serde_json::Value::Null);
                on_notify(params);
            }
            // Anything else is ignored (kept out of the ring; it is not diagnostics).
        }
    }

    fn stderr_loop(self: &Arc<Self>, mut stderr: BufReader<std::process::ChildStderr>) {
        let mut line = String::new();
        loop {
            line.clear();
            match stderr.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let mut ring = self.stderr_ring.lock().unwrap();
                    if ring.len() >= self.stderr_cap {
                        ring.remove(0);
                    }
                    ring.push(line.trim_end().to_string());
                }
                Err(_) => break,
            }
        }
    }

    fn waiter_loop(self: &Arc<Self>) {
        // Poll the child so that `stop()` can force-kill a hung process without ever
        // needing to acquire a child lock that this thread is holding for a long time.
        let exit_code = loop {
            if self.kill_requested.load(Ordering::SeqCst) {
                self.send_kill();
            }
            let polled = {
                let mut child = self.child.lock().unwrap();
                match child.as_mut() {
                    Some(proc) => match proc.try_wait() {
                        Ok(Some(status)) => Some(status.code()),
                        Ok(None) => None,
                        Err(_) => Some(None), // reaped / error -> treat as exited
                    },
                    None => Some(None), // already reaped elsewhere
                }
            };
            match polled {
                Some(code) => break code,
                None => thread::sleep(Duration::from_millis(50)),
            }
        };

        self.exited.store(true, Ordering::SeqCst);
        // Fail every outstanding waiter: dropping all senders makes receivers observe
        // Disconnected, which combined with `exited` is surfaced as `Closed`.
        self.pending.lock().unwrap().clear();

        if let Some(cb) = self.on_exited.lock().unwrap().take() {
            cb(exit_code);
        }
    }
}
