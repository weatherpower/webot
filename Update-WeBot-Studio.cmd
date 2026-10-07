@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   WeBot Studio Updater
echo ========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or is not on PATH.
  echo.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo ERROR: Run this file from the WeatherPower webot repository folder.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if /I not "%BRANCH%"=="master" (
  echo ERROR: Studio updater only runs from the master branch.
  echo Current branch: %BRANCH%
  echo.
  pause
  exit /b 1
)

git diff --quiet
if errorlevel 1 goto dirty
git diff --cached --quiet
if errorlevel 1 goto dirty

echo Checking GitHub for updates...
git fetch origin master
if errorlevel 1 (
  echo.
  echo ERROR: Could not fetch origin/master.
  pause
  exit /b 1
)

git merge-base --is-ancestor HEAD origin/master
if errorlevel 1 (
  echo.
  echo ERROR: Local master and origin/master have diverged.
  echo Nothing was changed.
  pause
  exit /b 1
)

git merge --ff-only origin/master
if errorlevel 1 (
  echo.
  echo ERROR: Update failed. Nothing was force-overwritten.
  pause
  exit /b 1
)

echo.
echo WeBot Studio files are up to date.
echo Close and reopen WeBot Studio so server-side changes load.
echo.
pause
exit /b 0

:dirty
echo ERROR: You have local tracked code changes.
echo Save a version or undo those changes in Studio first.
echo Nothing was overwritten.
echo.
pause
exit /b 1
