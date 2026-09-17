@echo off
REM Starts the Origin Pixel office and keeps it up.
REM
REM The routine scheduler only runs while this process does, and a missed run is only caught up when
REM the server comes back. To have it start at logon, register it once (checked 17 Sep 2026: NOT
REM registered on this machine yet):
REM   schtasks /create /tn OriginPixelOffice /sc onlogon /rl limited /tr "\"%~f0\""
REM Remove with:  schtasks /delete /tn OriginPixelOffice /f
REM
REM Runs from this file's own folder so the relative brain path in office.config.json resolves.
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not exist "logs" mkdir "logs"

REM One office at a time. An office that ANSWERS on 4520 is left alone; anything else holding the
REM port is reported, not mistaken for the office.
curl -s -m 5 http://127.0.0.1:4520/api/health 2>nul | findstr /c:"\"ok\":true" >nul 2>&1
if !errorlevel!==0 (
  echo Office already running on port 4520 - nothing to do.
  exit /b 0
)
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":4520 " >nul 2>&1
if !errorlevel!==0 (
  echo [%date% %time%] port 4520 is held by a program that is not the office - not starting >> "logs\office.log"
  echo Port 4520 is in use by something that is not the office. See logs\office.log.
  exit /b 1
)

REM Keep it up: restart after a crash, waiting longer each time (15 s, 60 s, 135 s, 240 s), and give
REM up after 5 quick failures so a broken start does not spin forever. A run that lasted 10 minutes
REM or more resets the count.
set RESTARTS=0
:run
REM keep the log from growing without bound: one 5 MB generation is kept
for %%F in ("logs\office.log") do if %%~zF GTR 5000000 move /y "logs\office.log" "logs\office.log.1" >nul
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set START=%%t
echo [%date% %time%] starting office >> "logs\office.log"
node serve.mjs >> "logs\office.log" 2>&1
set CODE=!errorlevel!
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set END=%%t
set /a RAN=END-START
echo [%date% %time%] office exited with !CODE! after !RAN! s >> "logs\office.log"
if !RAN! GEQ 600 set RESTARTS=0
set /a RESTARTS+=1
if !RESTARTS! GTR 5 (
  echo [%date% %time%] gave up after 5 quick restarts - fix the error above, then run this file again >> "logs\office.log"
  exit /b !CODE!
)
set /a WAIT=RESTARTS*RESTARTS*15
echo [%date% %time%] restarting in !WAIT! s (restart !RESTARTS! of 5) >> "logs\office.log"
timeout /t !WAIT! /nobreak >nul
goto run
