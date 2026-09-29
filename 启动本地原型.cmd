@echo off
cd /d "%~dp0"
set "RACE_NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined RACE_NODE set "RACE_NODE=%%N"
if not defined RACE_NODE set "RACE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%RACE_NODE%" (
  echo ERROR: Node.js was not found.
  echo Install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
echo Local prototype URL: http://127.0.0.1:3100
echo Keep this window open while playing. Press Ctrl+C to stop.
echo.
"%RACE_NODE%" server.mjs
echo.
echo The server stopped. Read the error above if it did not start.
pause
