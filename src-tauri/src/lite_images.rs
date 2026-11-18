//! Lite's image checker, talking to the Python worker.
//!
//! ## What this does
//!
//! Starts `tools/lite_image_check.py` once, keeps it alive while Lite is in charge,
//! and asks it about one image at a time. The worker holds the NudeNet model on this
//! Mac's CoreML provider; this side holds the decision about what to do with the
//! answer.
//!
//! ## Why the decision is here and not in the worker
//!
//! A detector that convicts is a detector that gets someone banned for a photo of a
//! statue. The worker reports a score; this module applies the same two gates the
//! Windows bot applies before anything is removed:
//!
//! 1. the channel's `nsfw_images` switch must not be `off`, and
//! 2. `nsfw_image` is on `AUTO_DELETE_VIOLATION_TYPES` — which it is — so a hit at
//!    or above the threshold is a removal, exactly as on Windows.
//!
//! Below the threshold, and in the helpline, nothing happens but a flag.
//!
//! ## Cost
//!
//! The model is 12 MB and the worker is idle between images, so it costs nothing
//! while nobody posts a picture. It is stopped when Lite stops, so the model is not
//! held in memory by an app that is not using it.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

use serde_json::{json, Value};

/// Where the worker and its interpreter live.
///
/// The venv is outside the app bundle on purpose: it is 200 MB of onnxruntime and
/// rebuilding it inside the bundle on every release would make updates enormous.
/// If it is missing, image checking is simply unavailable and says so.
const VENV_PYTHON: &str = "/Users/andrehoey/lite-ml/bin/python";
const WORKER_SCRIPT: &str = "/Users/andrehoey/sahara-dashboard/tools/lite_image_check.py";

/// The Windows bot's "normal" sensitivity. High enough that a swimsuit is not a
/// breach, low enough that a clear exposure is caught.
const DEFAULT_THRESHOLD: f64 = 0.6;

struct Worker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

static WORKER: Mutex<Option<Worker>> = Mutex::new(None);

/// Is the checker usable on this machine at all?
pub fn available() -> bool {
    std::path::Path::new(VENV_PYTHON).exists() && std::path::Path::new(WORKER_SCRIPT).exists()
}

/// Start the worker if it is not already running.
///
/// Returns the reason on failure so the screen can say "image checking is off and
/// here is why" rather than quietly not checking anything.
pub fn start() -> Result<(), String> {
    if !available() {
        return Err(format!(
            "the image checker is not installed at {VENV_PYTHON}"
        ));
    }
    let mut guard = match WORKER.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    if guard.is_some() {
        return Ok(());
    }

    let mut child = Command::new(VENV_PYTHON)
        .arg(WORKER_SCRIPT)
        .arg(DEFAULT_THRESHOLD.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start the image checker: {e}"))?;

    let stdin = child.stdin.take().ok_or("no stdin on the worker")?;
    let stdout = child.stdout.take().ok_or("no stdout on the worker")?;
    let mut worker = Worker {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    };

    // The first line says whether the model loaded. Waiting for it here means
    // "started" never means "probably started".
    let mut line = String::new();
    worker
        .stdout
        .read_line(&mut line)
        .map_err(|e| format!("the image checker did not answer: {e}"))?;
    let v: Value = serde_json::from_str(line.trim()).unwrap_or(json!({}));
    if let Some(fatal) = v.get("fatal").and_then(|f| f.as_str()) {
        let _ = worker.child.kill();
        return Err(fatal.to_string());
    }
    if v.get("ready").and_then(|r| r.as_bool()) != Some(true) {
        let _ = worker.child.kill();
        return Err("the image checker did not report ready".into());
    }

    *guard = Some(worker);
    Ok(())
}

/// Stop the worker and let go of the model.
pub fn stop() {
    let mut guard = match WORKER.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    if let Some(mut w) = guard.take() {
        let _ = w.stdin.flush();
        let _ = w.child.kill();
        let _ = w.child.wait();
    }
}

/// Ask about one image. `Ok(None)` means "no opinion", never "clean".
///
/// An error is not evidence, so a failed check returns a flag-worthy error and
/// nothing is deleted.
pub fn check(path: &str) -> Result<(bool, f64, Vec<String>), String> {
    let mut guard = match WORKER.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    let worker = guard.as_mut().ok_or("the image checker is not running")?;

    writeln!(worker.stdin, "{path}").map_err(|e| format!("could not ask the checker: {e}"))?;
    worker
        .stdin
        .flush()
        .map_err(|e| format!("could not ask the checker: {e}"))?;

    let mut line = String::new();
    worker
        .stdout
        .read_line(&mut line)
        .map_err(|e| format!("the checker did not answer: {e}"))?;
    let v: Value =
        serde_json::from_str(line.trim()).map_err(|e| format!("the checker said something odd: {e}"))?;

    if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
        if !err.is_empty() {
            return Err(err.to_string());
        }
    }

    let nsfw = v.get("nsfw").and_then(|n| n.as_bool()).unwrap_or(false);
    let score = v.get("score").and_then(|s| s.as_f64()).unwrap_or(0.0);
    let labels: Vec<String> = v
        .get("labels")
        .and_then(|l| l.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    Ok((nsfw, score, labels))
}
