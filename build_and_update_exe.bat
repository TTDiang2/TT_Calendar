@echo off
setlocal
echo === TT Calendar.exe update script (bulletproof) ===

set "SRC=E:\Automation Scripts and Temp Codes\TT_Calendar\frontend\src-tauri\target\release\app.exe"
set "DST=E:\Automation Scripts and Temp Codes\TT_Calendar\TT Calendar.exe"

echo.
echo [1/6] Killing ALL related processes (killer loop)...
taskkill /F /IM "TT Calendar.exe" 2>nul
taskkill /F /IM app.exe 2>nul
taskkill /F /IM "TT-Calendar-Launcher.exe" 2>nul
taskkill /F /IM tt-calendar-backend.exe 2>nul
timeout /t 4 /nobreak >nul
taskkill /F /IM "TT Calendar.exe" 2>nul
taskkill /F /IM app.exe 2>nul
timeout /t 2 /nobreak >nul
echo processes dead.

echo.
echo [2/6] Rebuilding Tauri exe (incremental ~1-2 min)...
cd /d "E:\Automation Scripts and Temp Codes\TT_Calendar\frontend"
call npx tauri build --no-bundle
if errorlevel 1 (
    echo.
    echo === BUILD FAILED === see errors above.
    pause
    exit /b 1
)
echo build done.

echo.
echo [3/6] Retry-copying new exe (waits for file lock)...
for /L %%i in (1,1,10) do (
    copy /Y "%SRC%" "%DST%" >nul 2>&1
    if not errorlevel 1 goto :copied
    echo lock still held, retry %%i/10...
    timeout /t 2 /nobreak >nul
)
echo === COPY FAILED after 10 retries ===
pause
exit /b 1
:copied

echo.
echo [4/6] Verifying copy (byte size match)...
for %%A in ("%SRC%") do set SZ_SRC=%%~zA
for %%A in ("%DST%") do set SZ_DST=%%~zA
if "%SZ_SRC%"=="%SZ_DST%" (
    echo OK: %SZ_DST% bytes copied correctly.
) else (
    echo === MISMATCH: src=%SZ_SRC% dst=%SZ_DST% ===
    pause
    exit /b 1
)

echo.
echo [5/6] Clearing WebView cache (exe now dead)...
if exist "%LOCALAPPDATA%\com.tt.calendar" (
    rd /s /q "%LOCALAPPDATA%\com.tt.calendar"
    echo cache cleared.
) else (
    echo no cache to clear.
)

echo.
echo [6/6] Starting launcher...
start "" "E:\Automation Scripts and Temp Codes\TT_Calendar\TT-Calendar-Launcher.exe"
echo.
echo === DONE! Launcher started. Wait ~10s for window to load. ===
pause
