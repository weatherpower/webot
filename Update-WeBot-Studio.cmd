@echo off
setlocal EnableExtensions EnableDelayedExpansion
title WeatherPower - WeBot Studio Updater

set "LOG=%USERPROFILE%\Desktop\WeBot-Studio-Update.log"
> "%LOG%" echo WeBot Studio updater started %DATE% %TIME%

echo.
echo ========================================
echo   WeBot Studio Updater
echo ========================================
echo.
echo This version uses Git directly from CMD.
echo The window will stay open when it finishes.
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or is not on PATH.
  >> "%LOG%" echo ERROR: Git is not installed or is not on PATH.
  goto FAIL
)

set "ROOT="
echo Looking for a running WeBot Studio...
for /f "usebackq delims=" %%P in (\`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $c=Invoke-RestMethod -Uri 'http://127.0.0.1:7777/api/config' -TimeoutSec 3; if($c.projectRoot){[Console]::Out.WriteLine($c.projectRoot)} } catch {}"\`) do set "ROOT=%%P"

if not defined ROOT (
  echo Running Studio did not provide its folder. Opening a folder picker...
  for /f "usebackq delims=" %%P in (\`powershell -NoProfile -STA -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Select the WeatherPower webot folder'; $d.ShowNewFolderButton=$false; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.WriteLine($d.SelectedPath)}"\`) do set "ROOT=%%P"
)

if not defined ROOT (
  echo ERROR: Could not find WeBot Studio.
  >> "%LOG%" echo ERROR: Could not find WeBot Studio.
  goto FAIL
)

if not exist "!ROOT!\studio\server.js" (
  echo ERROR: The selected folder does not contain studio\server.js
  >> "%LOG%" echo ERROR: Missing studio\server.js in !ROOT!
  goto FAIL
)
if not exist "!ROOT!\.git" (
  echo ERROR: The selected folder is not a Git repository.
  >> "%LOG%" echo ERROR: Missing .git in !ROOT!
  goto FAIL
)

echo Found WeBot Studio:
echo   !ROOT!
>> "%LOG%" echo Studio project: !ROOT!

pushd "!ROOT!" >nul
if errorlevel 1 (
  echo ERROR: Could not open the Studio folder.
  >> "%LOG%" echo ERROR: Could not open Studio folder.
  goto FAIL
)

set "ORIGIN="
for /f "delims=" %%U in ('git remote get-url origin 2^>nul') do set "ORIGIN=%%U"
echo !ORIGIN! | findstr /I /C:"weatherpower/webot" >nul
if errorlevel 1 (
  echo ERROR: This folder is not connected to weatherpower/webot.
  echo Origin: !ORIGIN!
  >> "%LOG%" echo ERROR: Unexpected origin !ORIGIN!
  popd
  goto FAIL
)

set "BEFORE="
for /f "delims=" %%H in ('git rev-parse --short HEAD 2^>nul') do set "BEFORE=%%H"
set "BRANCH="
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "BRANCH=%%B"

echo Current branch: !BRANCH!
echo Current commit: !BEFORE!
>> "%LOG%" echo Current branch: !BRANCH!
>> "%LOG%" echo Current commit: !BEFORE!

rem Preserve tracked uncommitted changes. Untracked files are left alone.
set "DIRTYFILE=%TEMP%\webot-studio-dirty-%RANDOM%%RANDOM%.txt"
git status --porcelain --untracked-files=no > "!DIRTYFILE!" 2>nul
for %%Z in ("!DIRTYFILE!") do set "DIRTYSIZE=%%~zZ"
if not "!DIRTYSIZE!"=="0" (
  echo.
  echo Saving tracked local edits in Git stash...
  >> "%LOG%" echo Saving tracked local edits in Git stash...
  git stash push -m "WeBot Studio updater backup" >> "%LOG%" 2>&1
  if errorlevel 1 (
    del /q "!DIRTYFILE!" >nul 2>nul
    echo ERROR: Could not stash local edits. Nothing else was changed.
    popd
    goto FAIL
  )
)
del /q "!DIRTYFILE!" >nul 2>nul

echo.
echo Fetching latest origin/master...
>> "%LOG%" echo Fetching latest origin/master...
git fetch origin master --prune
if errorlevel 1 (
  echo ERROR: Git fetch failed.
  >> "%LOG%" echo ERROR: Git fetch failed with code !ERRORLEVEL!
  popd
  goto FAIL
)

set "HEADFULL="
set "REMOTEFULL="
for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "HEADFULL=%%H"
for /f "delims=" %%H in ('git rev-parse origin/master 2^>nul') do set "REMOTEFULL=%%H"

if /I not "!HEADFULL!"=="!REMOTEFULL!" (
  set "BACKUP=studio-local-backup-%RANDOM%-%RANDOM%"
  echo Creating safety branch: !BACKUP!
  >> "%LOG%" echo Creating safety branch: !BACKUP!
  git branch "!BACKUP!" HEAD >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo ERROR: Could not create safety branch.
    popd
    goto FAIL
  )
)

if /I not "!BRANCH!"=="master" (
  git show-ref --verify --quiet refs/heads/master
  if errorlevel 1 (
    git checkout -b master origin/master >> "%LOG%" 2>&1
  ) else (
    git checkout master >> "%LOG%" 2>&1
  )
  if errorlevel 1 (
    echo ERROR: Could not switch to master.
    popd
    goto FAIL
  )
)

echo Updating local master to the GitHub version...
>> "%LOG%" echo Updating local master to origin/master...
git reset --hard origin/master
if errorlevel 1 (
  echo ERROR: Could not update local master.
  popd
  goto FAIL
)

set "AFTER="
for /f "delims=" %%H in ('git rev-parse --short HEAD 2^>nul') do set "AFTER=%%H"

popd

echo.
echo ========================================
echo   UPDATE COMPLETE
echo ========================================
echo.
echo !BEFORE!  --^>  !AFTER!
echo.
echo Close WeBot Studio COMPLETELY and reopen it.
echo Then refresh the Studio page.
echo.
echo You should now see:
echo   - Emergency now
echo   - Update Studio
echo.
echo Log: %LOG%
>> "%LOG%" echo UPDATED: !BEFORE! -^> !AFTER!
>> "%LOG%" echo Update complete.
echo.
pause
exit /b 0

:FAIL
echo.
echo ========================================
echo   UPDATE FAILED
echo ========================================
echo.
echo Nothing else will be changed.
echo Log: %LOG%
echo.
pause
exit /b 1
