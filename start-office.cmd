@echo off
REM Starts the Origin Pixel office and keeps it up.
REM
REM The routine scheduler only runs while this process does, and a missed run is only caught up when
REM the server comes back. To have it start at logon (checked 17 Sep 2026: NOT registered yet):
REM   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1              register it
REM   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Check       what is registered
REM   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Uninstall   remove it
REM Status, pause and the Stop button: http://localhost:4520/ops
REM
REM Runs from this file's own folder so the relative brain path in office.config.json resolves.
REM PORT (default 4520) and AO_LOG_DIR (default logs) can be set first; the tests use both.
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not defined PORT set PORT=4520
if not defined AO_LOG_DIR set AO_LOG_DIR=logs
set "LOG=%AO_LOG_DIR%\office.log"
if not exist "%AO_LOG_DIR%" mkdir "%AO_LOG_DIR%"

REM One office at a time. An office that ANSWERS on the port is left alone; anything else holding the
REM port is reported, not mistaken for the office.
curl -s -m 5 http://127.0.0.1:%PORT%/api/health 2>nul | findstr /c:"\"ok\":true" >nul 2>&1
if !errorlevel!==0 (
  echo Office already running on port %PORT% - nothing to do.
  exit /b 0
)
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>&1
if !errorlevel!==0 (
  echo [%date% %time%] port %PORT% is held by a program that is not the office - not starting >> "!LOG!"
  echo Port %PORT% is in use by something that is not the office. See !LOG!.
  exit /b 1
)

REM Keep it up: restart after a crash, waiting longer each time (15 s, 60 s, 135 s, 240 s), and give
REM up after 5 quick failures so a broken start does not spin forever. A run that lasted 10 minutes
REM or more resets the count.
set RESTARTS=0
:run
REM keep the log from growing without bound: one 5 MB generation is kept
for %%F in ("!LOG!") do if %%~zF GTR 5000000 move /y "!LOG!" "!LOG!.1" >nul
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set START=%%t
echo [%date% %time%] starting office >> "!LOG!"
node serve.mjs >> "!LOG!" 2>&1
set CODE=!errorlevel!
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set END=%%t
set /a RAN=END-START
echo [%date% %time%] office exited with !CODE! after !RAN! s >> "!LOG!"
REM Exit code 3 = stopped on purpose (the Stop button on /ops, or POST /api/office/stop): do not restart.
if !CODE!==3 (
  echo [%date% %time%] stopped on purpose - not restarting >> "!LOG!"
  exit /b 0
)
if !RAN! GEQ 600 set RESTARTS=0
set /a RESTARTS+=1
if !RESTARTS! GTR 5 (
  echo [%date% %time%] gave up after 5 quick restarts - fix the error above, then run this file again >> "!LOG!"
  exit /b !CODE!
)
set /a WAIT=RESTARTS*RESTARTS*15
echo [%date% %time%] restarting in !WAIT! s (restart !RESTARTS! of 5) >> "!LOG!"
REM Start-Sleep, not "timeout": timeout returns at once when there is no console to read (a scheduled
REM task, or input redirected), which turned the backoff into a tight restart loop.
powershell -NoProfile -Command "Start-Sleep -Seconds !WAIT!"
goto run
