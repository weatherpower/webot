@echo off
setlocal
cd /d "%~dp0"
echo WeBot - safe local update
echo Stop the local WeBot server with Ctrl+C before continuing.
choice /C YN /M "Is the server stopped"
if errorlevel 2 exit /b 0
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it before updating.
  pause
  exit /b 1
)
node "%~dp0scripts\update-local.cjs"
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
