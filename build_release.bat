@echo off
setlocal EnableDelayedExpansion
rem ============================================================
rem  TT Calendar - release build
rem
rem  Usage:
rem    build_release.bat            installer + portable zip
rem    build_release.bat preview    quick no-bundle build (target\release\app.exe)
rem
rem  Requirements: Node.js, Rust, Python + PyInstaller
rem  Output: .\release\
rem ============================================================

set "ROOT=%~dp0"
set "OUT=%ROOT%release"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=all"
if not exist "%OUT%" mkdir "%OUT%"

rem 优先 py -3.10：后端 exe 是 cp310 构建，而很多机器 PATH 上的 python
rem 已经是 3.13/3.14，那里通常没装 PyInstaller，直接 python -m PyInstaller 会失败。
set "PY="
py -3.10 -c "import PyInstaller" >nul 2>&1 && set "PY=py -3.10"
if not defined PY (
    python -c "import PyInstaller" >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo === PYTHON WITH PYINSTALLER NOT FOUND ===
    echo install: py -3.10 -m pip install pyinstaller
    goto :fail
)
echo Using Python: %PY%

echo === [0/7] Killing related processes ===
taskkill /F /IM "TT Calendar.exe" >nul 2>&1
taskkill /F /IM app.exe >nul 2>&1
taskkill /F /IM "TT-Calendar-Launcher.exe" >nul 2>&1
taskkill /F /IM tt-calendar-backend.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo.
echo === [1/7] Syncing version ===
pushd "%ROOT%"
%PY% scripts\sync_version.py
if errorlevel 1 goto :fail
for /f "usebackq delims=" %%v in (`%PY% -c "import json;print(json.load(open('version.json',encoding='utf-8'))['version'])"`) do set "VER=%%v"
if "%VER%"=="" (
    echo === VERSION READ FAILED ===
    goto :fail
)
echo Version: %VER%

echo.
echo === [2/7] Building backend (PyInstaller onedir) ===
%PY% -m PyInstaller --noconfirm --clean tt-calendar-backend.spec
if errorlevel 1 goto :fail
if not exist "%ROOT%dist\tt-calendar-backend\tt-calendar-backend.exe" (
    echo === BACKEND EXE MISSING ===
    goto :fail
)
popd

if /I "%MODE%"=="preview" (
    echo.
    echo === [3/7] Tauri build ^(preview, no bundle^) ===
    pushd "%ROOT%frontend"
    call npx tauri build --no-bundle --features custom-protocol
    if errorlevel 1 (
        popd
        goto :fail
    )
    popd
    echo.
    echo === DONE: %ROOT%frontend\src-tauri\target\release\app.exe ===
    exit /b 0
)

echo.
echo === [3/7] Building installer (Tauri bundle) ===
pushd "%ROOT%frontend"
call npx tauri build --features custom-protocol
if errorlevel 1 (
    popd
    goto :fail
)
popd

echo.
echo === [4/7] Collecting installer ===
set "SETUP=%ROOT%frontend\src-tauri\target\release\bundle\nsis\TT Calendar_%VER%_x64-setup.exe"
set "MSI=%ROOT%frontend\src-tauri\target\release\bundle\msi\TT Calendar_%VER%_x64_en-US.msi"
if exist "%SETUP%" (
    copy /Y "%SETUP%" "%OUT%\TT-Calendar-Setup-%VER%.exe" >nul
) else (
    echo === NSIS SETUP NOT FOUND: %SETUP% ===
    goto :fail
)
if exist "%MSI%" copy /Y "%MSI%" "%OUT%\TT-Calendar-%VER%.msi" >nul

echo.
echo === [5/7] Building portable zip ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\make_portable_zip.ps1" -Version "%VER%" -Root "%ROOT:~0,-1%"
if errorlevel 1 goto :fail

echo.
echo === [6/7] Checksums ===
certutil -hashfile "%OUT%\TT-Calendar-Setup-%VER%.exe" SHA256 | findstr /v ":"
certutil -hashfile "%OUT%\TT-Calendar-Portable-%VER%.zip" SHA256 | findstr /v ":"

echo.
echo === [7/7] Done ===
for %%A in ("%OUT%\TT-Calendar-Setup-%VER%.exe" "%OUT%\TT-Calendar-Portable-%VER%.zip") do (
    if exist "%%~A" (echo OK  %%~nxA  %%~zA bytes) else (echo MISSING  %%~A)
)
echo.
echo Release files are in: %OUT%
exit /b 0

:fail
echo.
echo === BUILD FAILED ===
popd 2>nul
exit /b 1
