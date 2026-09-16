@echo off
REM Starts the Origin Pixel office and keeps it up.
REM
REM Registered as a Scheduled Task ("OriginPixelOffice") so the office survives a reboot - the
REM routine scheduler only runs while this process does, and a missed run is only caught up when
REM the server comes back. Remove with:  schtasks /delete /tn OriginPixelOffice /f
REM
REM Runs from this file's own folder so the relative brain path in office.config.json resolves.
cd /d "%~dp0"

REM Already listening on 4520? Then an office is running - do not start a second one.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":4520 " >nul 2>&1
if %errorlevel%==0 (
  echo Office already running on port 4520 - nothing to do.
  exit /b 0
)

if not exist "logs" mkdir "logs"
echo [%date% %time%] starting office >> "logs\office.log"
node serve.mjs >> "logs\office.log" 2>&1
echo [%date% %time%] office exited with %errorlevel% >> "logs\office.log"
