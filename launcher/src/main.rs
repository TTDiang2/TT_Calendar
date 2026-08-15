// TT Calendar Launcher: 拉起 backend（优先系统 Python，回退 PyInstaller exe），
// 启动前清理端口残留，HTTP /health 轮询确认 ready（不是只 TCP connect），
// backend + 界面同 Job Object 一起死。日志写 launcher.log
#![windows_subsystem = "windows"]

use std::env;
use std::fs::OpenOptions;
use std::io::{Read, Write};
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

    let pake = match find_file(&exe_dir, &["TT Calendar.exe", "TT-Calendar-x64.exe"]) {
        Some(p) => p,
        None => {
            log(format!("ERROR pake not found near {}", exe_dir.display()));
            std::process::exit(1);
        }
    };

    // 启动前清理 8765 残留：上次 backend 若未被 Job Object 完全回收，TCP 轮询会误判 ready
    ensure_port_free(PORT);

    let job = create_job();

    // 后端启动策略：优先用系统 Python（启动快，~1.5s），找不到或依赖不全则回退 PyInstaller exe
    let mut backend_proc = match spawn_backend(&exe_dir, job) {
        Ok((c, mode)) => {
            log(format!("backend spawned pid={} via {}", c.id(), mode));
            c
        }
        Err(e) => {
            log(format!("ERROR spawn backend failed: {}", e));
            std::process::exit(1);
        }
    };

    // HTTP /health 轮询：必须收到真 200，确认 lifespan startup 已完成、首个前端请求不会被卡
    let t0 = Instant::now();
    let ready = wait_for_health(PORT, 30_000);
    log(format!(
        "backend ready={} after {:.2}s",
        ready,
        t0.elapsed().as_secs_f64()
    ));
    if !ready {
        log("ERROR backend not ready in 30s, killing and exit");
        let _ = backend_proc.kill();
        std::process::exit(1);
    }

    log(format!("spawning pake at {}...", pake.display()));
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

// 尝试用系统 Python 启动 backend；失败（找不到 python 或依赖不全）则回退 PyInstaller exe
fn spawn_backend(exe_dir: &PathBuf, job: HANDLE) -> std::io::Result<(Child, &'static str)> {
    let err_path = exe_dir.join("backend.stderr.log");
    let out_path = exe_dir.join("backend.stdout.log");

    if let Some(python) = find_system_python() {
        log(format!("found system python: {}", python));
        // 二次校验：项目依赖是否齐全（避免启动到一半才崩）
        if check_python_deps(&python, exe_dir) {
            let mut cmd = Command::new(&python);
            cmd.args([
                "-m", "uvicorn", "backend.main:app",
                "--host", HOST, "--port", &PORT.to_string(),
            ])
            .current_dir(exe_dir)
            .creation_flags(CREATE_NO_WINDOW);
            redirect_logs(&mut cmd, &err_path, &out_path);
            let child = spawn_into_job(&mut cmd, job)?;
            return Ok((child, "system-python"));
        }
        log("system python deps incomplete, falling back to bundled exe");
    } else {
        log("no system python in PATH, using bundled exe");
    }

    let backend_exe = match find_file(exe_dir, &["tt-calendar-backend.exe", "tt-calendar-backend-x64.exe"]) {
        Some(p) => p,
        None => return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "tt-calendar-backend.exe not found near launcher exe",
        )),
    };
    let mut cmd = Command::new(&backend_exe);
    cmd.current_dir(exe_dir).creation_flags(CREATE_NO_WINDOW);
    redirect_logs(&mut cmd, &err_path, &out_path);
    let child = spawn_into_job(&mut cmd, job)?;
    Ok((child, "pyinstaller-exe"))
}

fn redirect_logs(cmd: &mut Command, err_path: &PathBuf, out_path: &PathBuf) {
    if let Ok(f) = std::fs::File::create(err_path) {
        cmd.stderr(std::process::Stdio::from(f));
    }
    if let Ok(f) = std::fs::File::create(out_path) {
        cmd.stdout(std::process::Stdio::from(f));
    }
}

fn find_system_python() -> Option<String> {
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

// 用 `python -c "import ..."` 验证依赖齐全。失败原因常见：装了 Python 但没 pip install
// 或目录里没有 backend/tt_calendar 源码（纯 exe 部署场景，必须回退 PyInstaller exe）
fn check_python_deps(python: &str, exe_dir: &PathBuf) -> bool {
    // 必须同时验证第三方依赖 AND 项目源码包：仅 exe 的干净目录里 import backend 会失败，
    // 此时若仍选 system-python，uvicorn 会因 No module named 'backend' 崩溃、界面永远不启动
    let deps = "import fastapi, uvicorn, pydantic, chinese_calendar, bs4, dateutil, httpx, backend, tt_calendar";
    let out = Command::new(python)
        .args(["-c", deps])
        .current_dir(exe_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match out {
        Ok(o) => {
            if !o.status.success() {
                let err = String::from_utf8_lossy(&o.stderr);
                let first_line = err.lines().next().unwrap_or("(no stderr)");
                log(format!("deps check failed: {}", first_line));
                false
            } else {
                true
            }
        }
        Err(e) => {
            log(format!("deps check error: {}", e));
            false
        }
    }
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

// HTTP /health 轮询：发真 GET，检查状态码 200 + 响应体含 ok
// 比 TCP connect 严：uvicorn 一绑 socket 就能 TCP connect，但 lifespan 钩子（sync_countdown_events
// 等）还没跑完时 HTTP /health 会失败或超时
fn wait_for_health(port: u16, timeout_ms: u64) -> bool {
    let start = Instant::now();
    let mut attempts = 0u32;
    while start.elapsed().as_millis() < timeout_ms as u128 {
        attempts += 1;
        if health_ok(port) {
            log(format!("/health 200 OK after {} attempts", attempts));
            return true;
        }
        thread::sleep(Duration::from_millis(150));
    }
    log(format!("/health still failing after {} attempts", attempts));
    false
}

fn health_ok(port: u16) -> bool {
    let addr: SocketAddr = match format!("{}:{}", HOST, port).parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let req = b"GET /health HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    if stream.write_all(req).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return false,
    };
    let resp = String::from_utf8_lossy(&buf[..n]);
    resp.lines().next().map(|l| l.contains(" 200 ")).unwrap_or(false)
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

fn find_file(dir: &PathBuf, names: &[&str]) -> Option<PathBuf> {
    let candidates = [
        dir.to_path_buf(),
        dir.join("dist"),
        dir.join("..").join("dist"),
    ];
    for c in &candidates {
        for name in names {
            let p = c.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}
