<div align="center">

# 🗓️ TT Calendar

**Your schedule. Your rules.** A local-first desktop calendar + todo + countdown — no accounts, no cloud, no subscription fees.

**English · [简体中文](README.zh-CN.md)**

[![Release](https://img.shields.io/badge/Release-v2.3.0-3D6BFB)](https://github.com/TTDiang2/TT_Calendar/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2B-blue)]()
[![License](https://img.shields.io/badge/License-MIT-green)]()

> Download, unzip, double-click. It just works — **no Python required**, no registration, no configuration.

</div>

---

## Why TT Calendar?

Every calendar/todo app has a hundred little places that don't fit how *you* work.
Can't record a schedule your own way? Need a special day to count itself down?
Want to see a week's workload density before planning it? Data trapped in someone else's cloud?

TT Calendar is built the other way around — **your rules first, and it's 100 % modifiable.**
Every line of source lives in this repo. Tell any AI coding assistant what you want, and it just grows.

---

## ✨ Highlights

- 🗓️ **Four calendar views** — month / week / day / year, with drag-and-drop rescheduling
- 🧩 **Modular subscription plugins** *(new in v2.3)* — subscribe to *any* economic calendar or market data source; plugins are shared across the community. More below.
- 📝 **Three-slot day scheduling** — a day is just *morning / afternoon / evening*. No bloated forms.
- 🎨 **Busyness tinting** — every day is shaded by how full it is, at a glance
- ✅ **A todo board with 5 views** — list, matrix, kanban, gantt and stickies, sorted by due date × importance
- ⏳ **Anniversary countdown** — mark a date once; it counts down 99 / 100 / 365 / 520 / 1000 days by itself
- 🌔 **Lunar calendar support** — built-in Chinese lunar dates & solar terms
- 🔍 **Global search** — jump anywhere with one keystroke
- 📥 **Data layers** — Chinese holidays, investment calendars, custom events — toggle them on the sidebar
- 🔐 **100 % local data** — SQLite on your machine. Your data belongs to you.

---

## 🧩 Plugin System: subscribe to whatever calendar you want

*(introduced in v2.3 — our take on an "open subscription" ecosystem)*

A subscription source is a **plugin**: a single Python file describing *what to fetch*
and *how to display it*. Plugins are not bundled into TT Calendar itself — they live in a
dedicated community repository and are installed locally in one step.

### 📦 Plugin repository: [TTDiang2/TT_Calendar_Plugins](https://github.com/TTDiang2/TT_Calendar_Plugins)

Browse the repository for the calendar source you need — **investing.com economic calendar,
Jisilu investment calendar**, and more to come from the community.

### Install a plugin (3 steps)

1. Download the plugin `.py` file (e.g. `investing.py`) from the plugin repository
2. Put it into the app's `plugins/` folder:

   ```
   TT_Calendar/
   └── plugins/
       └── investing.py     # ← downloaded from the plugin repo
   ```

   (For the packaged exe build: create a `plugins/` folder next to the exe and put it there.)

3. Restart the app — the new layers appear in the sidebar, and you can add the source in the subscription panel.

### Write & share your own

- **Plug in what you care about** — economic calendars, market events, holidays… whatever your workflow needs.
- **Write your own in ~100 lines** — fetch events → declare layers → declare how fields display.
  No core-code changes, no frontend code required.
- **Share it** — open a PR against the plugin repository, so others can use it without rebuilding the wheel.

Read the **[Plugin Development Guide](docs/SUBSCRIPTION_PLUGIN_GUIDE.md)** for the full protocol.

---

## 📸 Screenshots

### Calendar views

| Month view · busyness tinting | Month view · today's todos in the side panel |
|---|---|
| ![Month view with busyness tinting](docs/images/月视图展示-充实度染色.png) | ![Month view showing todos](docs/images/月视图展示-当天待办自动展示在右侧边栏.png) |

| Month view · todo deadline tinting | Day view |
|---|---|
| ![Month view with todo tinting](docs/images/月视图展示-待办染色.png) | ![Day view](docs/images/日视图展示.png) |

| Week view | Year view · busyness tinting |
|---|---|
| ![Week view](docs/images/周视图展示.png) | ![Year view with busyness](docs/images/年视图展示-充实度染色.png) |

### Create & color your day

| New entry dialog | Coloring dialog |
|---|---|
| ![New entry dialog](docs/images/点点创建页面.png) | ![Coloring dialog](docs/images/涂色创建页面.png) |

### Todos — five ways to see them

| List | Matrix |
|---|---|
| ![Todo list view](docs/images/待办视图-列表.png) | ![Todo matrix view](docs/images/待办视图-矩阵.png) |

| Kanban | Gantt |
|---|---|
| ![Todo kanban view](docs/images/待办视图-看板.png) | ![Todo gantt view](docs/images/待办视图-甘特.png) |

| Stickies |
|---|
| ![Todo stickies view](docs/images/待办视图-便签.png) |

### Countdown & search

| Countdown cards | Event search |
|---|---|
| ![Countdown view](docs/images/倒数日视图.png) | ![Event search page](docs/images/事件搜索页面.png) |

### Subscriptions (plugins) & sync

| Create a subscription | Settings · GitHub sync |
|---|---|
| ![Subscription creation dialog](docs/images/订阅创建页面.png) | ![Sync settings page](docs/images/设置页面-数据同步功能展示.png) |

---

## ⚡ Installation

### Download (recommended)

Grab the latest **3 files** from [GitHub Releases](https://github.com/TTDiang2/TT_Calendar/releases):

| File | Role |
|---|---|
| `TT-Calendar-Launcher-x64.exe` | Launcher — double-click this one |
| `TT-Calendar-x64.exe` | Calendar UI (Tauri desktop) |
| `tt-calendar-backend-x64.exe` | Backend service (embeds a Python runtime) |

Put all three in **one folder**, double-click `TT-Calendar-Launcher-x64.exe`, and the window opens in 5–10 s.

> ✅ No Python needed — the backend exe bundles a full Python runtime.
> ✅ No registration, no mandatory internet, no configuration.

### Run from source (development)

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in a browser, or run `npm run tauri:dev` for the desktop window.

---

## 🖱️ First steps

| Action | Result |
|---|---|
| **Double-click** a date | Create an event |
| **Right-click** a date | Quick menu: event / schedule / coloring |
| **Drag** a day cell | Move the whole day's plan to another day |
| **← / →** | Previous / next month (or week in week/day view) |
| **T** | Jump back to today |
| **N** | Quickly create an event on the selected date |
| **/** | Global search — Enter jumps to the result |
| **Sidebar layer switches** | Toggle data layers: holidays, investment calendars, etc. |

### Data layers (sidebar)

Don't want something? Turn it off. Want more? Turn it on:

- **Chinese public holidays** — legal holidays & make-up workdays, auto-marked
- **Investment calendars** — stock / convertible-bond / dividend / REIT / index-option events, pulled on demand
- **Busyness tinting** — five shades of green showing how full each day is
- **Important dates layer** — manually flagged days with countdown

---

## 🏗️ Architecture

```
TT-Calendar-Launcher.exe (Rust)
        │ spawns backend + health check + lifecycle
        ▼
tt-calendar-backend.exe (FastAPI · embedded Python · 127.0.0.1:8765)
        │ REST API
        ▼
TT Calendar.exe (Tauri + React · UI)
```

| Layer | Tech |
|---|---|
| UI | React · TypeScript · Tailwind CSS · Tauri 2 |
| Backend | FastAPI · SQLite |
| Launcher | Rust (process orchestration) |
| Plugins | Python `Source` protocol, `plugins/` folder discovery |

Deep dives: [Architecture](docs/ARCHITECTURE.md) · [Design philosophy](docs/PHILOSOPHY.md) ·
[Plugin guide](docs/SUBSCRIPTION_PLUGIN_GUIDE.md) · [Sync protocol](docs/SYNC_PROTOCOL.md)

---

## 🔒 Data & Privacy

- All data (schedules, todos, configs) lives in `data/calendar.db` (SQLite) next to the app.
- No account system, no telemetry, no network reporting.
- External data layers are fetched on demand only when you enable them.
- The data directory is gitignored — your personal data never enters the repo.

---

## 🛠️ Made to be modified

The whole point: **if you don't like something, change the source.**
Module boundaries are clean on purpose — most features touch only one or two files.

```
├── frontend/            # UI (React + Tauri)
├── backend/             # REST API (FastAPI)
├── tt_calendar/         # core logic (Python)
├── plugins/             # your locally installed subscription plugins (see TT_Calendar_Plugins)
├── launcher/            # Rust launcher
├── scripts/             # helpers
└── tests/               # automated tests
```

**Add a feature?** Just tell your AI assistant, e.g.:

> "Add lunar solar terms to the month view sidebar."
> "Make todos repeat weekly."
> "Support a new calendar source as a plugin."

**Ship it?** Run the one-click build:

```bat
build_release.bat
```

It builds the frontend, desktop app, backend and launcher into 3 exes under `release/` —
ready to distribute to any Windows machine, no environment needed.

---

## 🤝 Contributing

- Found a bug or want a feature? Open an [issue](../../issues).
- Wrote a useful subscription plugin? **Share it** — a plugin is a single file.
  See the [Plugin Development Guide](docs/SUBSCRIPTION_PLUGIN_GUIDE.md).
- Documentation lives alongside code under `docs/`.

---

## 📄 License

MIT License — do whatever you want, keep the attribution.
