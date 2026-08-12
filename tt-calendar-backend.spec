# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['backend\\main.py'],
    pathex=['.'],
    binaries=[],
    datas=[('frontend/dist', 'frontend/dist')],
    hiddenimports=['uvicorn.logging', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto', 'uvicorn.lifespan.on'],
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
    a.binaries,
    a.datas,
    [],
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
