# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules


a = Analysis(
    ['backend\\main.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=[
        'uvicorn.logging', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan.on',
        # borax is imported statically (tt_calendar/utils/lunar_utils.py) but force-bundle it
        # so a rebuild can never silently omit it again.
        'borax', 'borax.calendars', 'borax.calendars.lunardate',
        # curl_cffi is imported under try/except in plugins/investing.py
        # (CF bypass via chrome impersonation). Force-bundle so a rebuild never drops it.
        # 注：插件（plugins/*.py）不打包进 exe —— 由用户从插件仓库放入 exe 旁 plugins/ 目录
        'curl_cffi', 'curl_cffi.requests', 'curl_cffi.requests.session',
        # 版本号由 scripts/sync_version.py 在构建前生成
        'tt_calendar._build_version',
        # 插件（plugins/*.py）在**运行时**才 import tt_calendar.* 的辅助模块，
        # 静态分析看不到它们 → 打包版里会缺模块。踩过的坑：jisilu 用
        # `tt_calendar.utils.text_utils`，只被插件引用，于是 2.5.x 的 sidecar
        # 里没有它，插件加载失败 → 订阅刷新只报一个看不懂的 pending_adaptation。
        # 整包收集（纯 Python，体积可忽略），今后任何插件 import 核心模块都不会再缺。
        *collect_submodules('tt_calendar'),
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 开发机 site-packages 里被 PyInstaller modulegraph 误判拉进来的大模块，
        # backend 完全不用（grep 全代码 0 引用）。打进去会让 onefile exe 多 50+ MB，
        # 每次启动解压到 %TEMP% 多花 5-7 秒。
        'numpy', 'numpy.libs', 'scipy', 'scipy.libs',
        'pandas', 'matplotlib', 'PIL', 'Pillow',
        'lxml', 'tkinter', 'tcl', 'tk',
        'cryptography', 'bcrypt',
        'jedi', 'parso', 'ipython', 'jupyter', 'notebook', 'ipykernel',
        'jupyter_client', 'jupyter_core', 'nbformat', 'nbconvert',
        'qtconsole', 'qt', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6',
        'pytest', '_pytest', 'py', 'coverage',
        'tensorflow', 'keras', 'torch', 'sklearn', 'scikit-learn',
        'gevent', 'greenlet', 'Cython', 'pythonnet',
        'sphinx', 'docutils',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='tt-calendar-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='tt-calendar-backend',
)
