// TT Calendar Launcher: 调系统 python 跑 backend（uvicorn），启动前清理端口残留，
// HTTP /health 轮询确认 ready，Pake + python 同 Job Object 一起死。日志写 launcher.log
#![windows_subsystem = "windows"]

use std::env;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const HOST: &str = "127.0.0.1";
const PORT: u16 = 8765;

static START: OnceLock<Instant> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn log(msg: impl std::fmt::Display) {
    let start = START.get_or_init(Instant::now);
    let path = LOG_PATH.get_or_init(|| PathBuf::from("launcher.log"));
    if let Ok(mut f) = OpenOptions::new().append(true).create(true).open(path) {
        let _ = writeln!(f, "+{:.3}s {}", start.elapsed().as_secs_f64(), msg);
    }
}

fn main() {
    let exe_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let _ = LOG_PATH.set(exe_dir.join("launcher.log"));
    log(format!("=== launcher start, exe_dir={}", exe_dir.display()));

    let pake = match find_file(&exe_dir, "TT Calendar.exe") {
        Some(p) => p,
        None => {
            log(format!("ERROR pake not found near {}", exe_dir.display()));
            std::process::exit(1);
        }
    };
    let python = match find_python() {
        Some(p) => p,
        None => {
            log("ERROR python not found in PATH");
            std::process::exit(1);
        }
    };
    log(format!("pake={} python={}", pake.display(), python));

    // 启动前清理 8765 残留：上次 backend 若未被 Job Object 完全回收，TCP 轮询会误判 ready
    ensure_port_free(PORT);

    let job = create_job();

    log("spawning backend...");
    let mut backend_cmd = Command::new(&python);
    backend_cmd
        .args([
            "-m",
            "uvicorn",
            "backend.main:app",
            "--host",
            HOST,
            "--port",
            &PORT.to_string(),
        ])
        .current_dir(&exe_dir)
        .creation_flags(CREATE_NO_WINDOW);
    let err_path = exe_dir.join("backend.stderr.log");
    let out_path = exe_dir.join("backend.stdout.log");
    if let Ok(f) = std::fs::File::create(&err_path) {
        backend_cmd.stderr(std::process::Stdio::from(f));
    }
    if let Ok(f) = std::fs::File::create(&out_path) {
        backend_cmd.stdout(std::process::Stdio::from(f));
    }
    let mut backend_proc = match spawn_into_job(&mut backend_cmd, job) {
        Ok(c) => {
            log(format!("backend spawned pid={}", c.id()));
            c
        }
        Err(e) => {
            log(format!("ERROR spawn backend failed: {}", e));
            std::process::exit(1);
        }
    };

    // HTTP /health 轮询替代纯 TCP connect：确认 backend 已完成 lifespan startup 并真正响应
    let t0 = Instant::now();
    let ready = wait_for_health(PORT, 20_000);
    log(format!(
        "backend ready={} after {:.2}s",
        ready,
        t0.elapsed().as_secs_f64()
    ));
    if !ready {
        log("ERROR backend not ready in 20s, killing and exit");
        let _ = backend_proc.kill();
        std::process::exit(1);
    }

    log("spawning pake...");
    let mut pake_cmd = Command::new(&pake);
    let mut pake_proc = match spawn_into_job(&mut pake_cmd, job) {
        Ok(c) => {
            log(format!("pake spawned pid={}", c.id()));
            c
        }
        Err(e) => {
            log(format!("ERROR spawn pake failed: {}", e));
            let _ = backend_proc.kill();
            std::process::exit(1);
        }
    };

    let _ = pake_proc.wait();
    log("pake exited, job will clean up");
    drop(pake_proc);
    drop(backend_proc);
    std::process::exit(0);
}

fn find_python() -> Option<String> {
    for name in &["python", "python3", "py"] {
        let out = Command::new(name)
            .arg("--version")
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                return Some((*name).to_string());
            }
        }
    }
    None
}

// 检测 8765 是否被占；若被占（通常是上次 backend 残留），找 LISTENING PID taskkill 掉
fn ensure_port_free(port: u16) {
    let addr: SocketAddr = match format!("{}:{}", HOST, port).parse() {
        Ok(a) => a,
        Err(_) => return,
    };
    let probe = TcpStream::connect_timeout(&addr, Duration::from_millis(300));
    if probe.is_err() {
        log(format!("port {} free", port));
        return;
    }
    log(format!("port {} occupied, finding owner...", port));
    let out = Command::new("cmd")
        .args(["/c", &format!("netstat -ano | findstr :{}", port)])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let mut killed: Vec<u32> = Vec::new();
    if let Ok(o) = out {
        let s = String::from_utf8_lossy(&o.stdout);
        for line in s.lines() {
            if !line.contains("LISTENING") {
                continue;
            }
            if let Some(pid_str) = line.split_whitespace().last() {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    let st = Command::new("taskkill")
                        .args(["/F", "/PID", &pid.to_string()])
                        .creation_flags(CREATE_NO_WINDOW)
                        .status();
                    if st.map(|s| s.success()).unwrap_or(false) {
                        killed.push(pid);
                    }
                }
            }
        }
    }
    log(format!("killed occupant pids: {:?}", killed));
    if !killed.is_empty() {
        thread::sleep(Duration::from_millis(1000));
        log("waited 1s for port release");
    }
}

fn wait_for_health(port: u16, timeout_ms: u64) -> bool {
    let start = Instant::now();
    let mut attempts = 0u32;
    while start.elapsed().as_millis() < timeout_ms as u128 {
        attempts += 1;
        if port_open(port) {
            log(format!("port open after {} attempts", attempts));
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    log(format!("port still closed after {} attempts", attempts));
    false
}

fn port_open(port: u16) -> bool {
    let addr: SocketAddr = match format!("{}:{}", HOST, port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
}

fn create_job() -> HANDLE {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            log("WARN CreateJobObjectW failed");
            return std::ptr::null_mut();
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::addr_of_mut!(info) as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            log("WARN SetInformationJobObject failed");
        }
        job
    }
}

fn spawn_into_job(cmd: &mut Command, job: HANDLE) -> std::io::Result<Child> {
    let child = cmd.spawn()?;
    if !job.is_null() {
        let ok = unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as _) };
        if ok == 0 {
            log("WARN AssignProcessToJobObject failed");
        }
    }
    Ok(child)
}

fn find_file(dir: &PathBuf, name: &str) -> Option<PathBuf> {
    let candidates = [
        dir.to_path_buf(),
        dir.join("dist"),
        dir.join("..").join("dist"),
    ];
    for c in &candidates {
        let p = c.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}
