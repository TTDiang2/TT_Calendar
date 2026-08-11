@echo off
setlocal
rem ============================================================
rem  TT Calendar - one-click release build
rem  Builds all 3 exes into .\release\ (no system Python needed
rem  to RUN the app; this script only needs build toolchain:
rem  Node.js + Rust + Python/PyInstaller to BUILD).
rem ============================================================

set "ROOT=%~dp0"
set "OUT=%ROOT%release"
if not exist "%OUT%" mkdir "%OUT%"

echo === [0/6] Killing related processes ===
taskkill /F /IM "TT Calendar.exe" 2>nul
taskkill /F /IM app.exe 2>nul
taskkill /F /IM "TT-Calendar-Launcher.exe" 2>nul
taskkill /F /IM tt-calendar-backend.exe 2>nul
timeout /t 3 /nobreak >nul

echo.
echo === [1/6] Building frontend (npm) ===
pushd "%ROOT%frontend"
call npm run build
if errorlevel 1 (
    echo === FRONTEND BUILD FAILED ===
    popd & exit /b 1
)
popd

echo.
echo === [2/6] Building Tauri app (no bundle) ===
pushd "%ROOT%frontend"
call npx tauri build --no-bundle
if errorlevel 1 (
    echo === TAURI BUILD FAILED ===
    popd & exit /b 1
)
popd

echo.
echo === [3/6] Building backend exe (PyInstaller) ===
pushd "%ROOT%"
python -m PyInstaller --noconfirm --clean tt-calendar-backend.spec
if errorlevel 1 (
    echo === PYINSTALLER FAILED ===
    popd & exit /b 1
)
popd

echo.
echo === [4/6] Building launcher (cargo) ===
pushd "%ROOT%launcher"
call cargo build --release
if errorlevel 1 (
    echo === CARGO BUILD FAILED ===
    popd & exit /b 1
)
popd

echo.
echo === [5/6] Collecting artifacts ===
copy /Y "%ROOT%frontend\src-tauri\target\release\app.exe" "%OUT%\TT-Calendar-x64.exe" >nul
copy /Y "%ROOT%dist\tt-calendar-backend.exe" "%OUT%\tt-calendar-backend-x64.exe" >nul
copy /Y "%ROOT%launcher\target\release\tt-calendar-launcher.exe" "%OUT%\TT-Calendar-Launcher-x64.exe" >nul

echo.
echo === [6/6] Verifying sizes ===
for %%A in ("%OUT%\TT-Calendar-x64.exe" "%OUT%\tt-calendar-backend-x64.exe" "%OUT%\TT-Calendar-Launcher-x64.exe") do (
    if exist "%%~A" (
        echo OK  %%~nxA  %%~zA bytes
    ) else (
        echo MISSING  %%~A
    )
)

echo.
echo === DONE! Release files in: %OUT% ===
echo Copy all 3 exes into ONE folder and run TT-Calendar-Launcher.exe
pause
