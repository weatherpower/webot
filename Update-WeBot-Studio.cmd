@echo off
setlocal EnableExtensions EnableDelayedExpansion
title WeatherPower - WeBot Studio Updater

echo.
echo ========================================
echo   WeBot Studio Updater
echo ========================================
echo.
echo This updater can be run from anywhere.
echo It will try to find the WeBot Studio project automatically.
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: Git is not installed or is not on PATH.
  echo Install Git for Windows, then run this updater again.
  echo.
  pause
  exit /b 1
)

set "ROOT="
set "FOUND_BY="

rem 1) If the updater itself is already in the repo, use that.
call :TRYROOT "%~dp0" "updater folder"
if defined ROOT goto FOUND

rem 2) Ask the running WeBot Studio where its project files live.
echo Looking for a running WeBot Studio...
set "STUDIO_ROOT="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $c=Invoke-RestMethod -Uri 'http://127.0.0.1:7777/api/config' -TimeoutSec 2; if($c.projectRoot){[Console]::Out.WriteLine($c.projectRoot)} } catch {}"`) do set "STUDIO_ROOT=%%P"
if defined STUDIO_ROOT (
  call :TRYROOT "!STUDIO_ROOT!" "running WeBot Studio"
  if defined ROOT goto FOUND
)

rem 3) Search the normal places projects are usually kept.
echo Searching common folders...
set "FOUND_PATH="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$roots=@($env:USERPROFILE+'\Desktop',$env:USERPROFILE+'\Documents',$env:USERPROFILE+'\Downloads',$env:USERPROFILE+'\source\repos',$env:USERPROFILE+'\Documents\GitHub','C:\WeatherPower','D:\WeatherPower'); $found=$null; foreach($r in $roots){ if($found){break}; if(!(Test-Path -LiteralPath $r)){continue}; if((Test-Path -LiteralPath (Join-Path $r 'studio\server.js')) -and (Test-Path -LiteralPath (Join-Path $r '.git'))){$found=$r;break}; try{$g=Get-ChildItem -LiteralPath $r -Directory -Filter .git -Recurse -Depth 5 -Force -ErrorAction SilentlyContinue; foreach($x in $g){$p=$x.Parent.FullName; if(Test-Path -LiteralPath (Join-Path $p 'studio\server.js')){$found=$p;break}}}catch{} }; if($found){[Console]::Out.WriteLine($found)}"`) do set "FOUND_PATH=%%P"
if defined FOUND_PATH (
  call :TRYROOT "!FOUND_PATH!" "folder search"
  if defined ROOT goto FOUND
)

rem 4) Last resort: let the user point to the folder once.
echo.
echo I could not find it automatically.
echo A folder picker will open. Choose the folder that contains "studio" and ".git".
set "PICKED="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -STA -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Select the WeatherPower webot folder'; $d.ShowNewFolderButton=$false; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.WriteLine($d.SelectedPath)}"`) do set "PICKED=%%P"
if defined PICKED call :TRYROOT "!PICKED!" "folder picker"
if not defined ROOT (
  echo.
  echo ERROR: That folder is not the WeatherPower webot project.
  echo It must contain:
  echo   .git
  echo   studio\server.js
  echo.
  pause
  exit /b 1
)

:FOUND
echo.
echo Found WeBot Studio:
echo   !ROOT!
echo Found by: !FOUND_BY!
echo.

pushd "!ROOT!" >nul
if errorlevel 1 (
  echo ERROR: Could not open the Studio project folder.
  pause
  exit /b 1
)

for /f "delims=" %%U in ('git remote get-url origin 2^>nul') do set "ORIGIN=%%U"
echo !ORIGIN! | findstr /I /C:"weatherpower/webot" >nul
if errorlevel 1 (
  echo ERROR: This folder does not point to the weatherpower/webot GitHub repository.
  echo Origin: !ORIGIN!
  popd
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if /I not "!BRANCH!"=="master" (
  echo ERROR: The project is currently on branch "!BRANCH!".
  echo Switch it to master before updating so nothing gets overwritten.
  popd
  pause
  exit /b 1
)

git diff --quiet
if errorlevel 1 goto DIRTY
git diff --cached --quiet
if errorlevel 1 goto DIRTY

for /f "delims=" %%H in ('git rev-parse --short HEAD') do set "BEFORE=%%H"

echo Checking GitHub for updates...
git fetch origin master
if errorlevel 1 (
  echo.
  echo ERROR: Could not fetch origin/master.
  popd
  pause
  exit /b 1
)

set "AHEAD=0"
set "BEHIND=0"
for /f "tokens=1,2" %%A in ('git rev-list --left-right --count HEAD...origin/master') do (
  set "AHEAD=%%A"
  set "BEHIND=%%B"
)

if "!AHEAD!"=="0" (
  git merge --ff-only origin/master
  if errorlevel 1 (
    echo.
    echo ERROR: Update failed. Nothing was force-overwritten.
    popd
    pause
    exit /b 1
  )
) else (
  echo.
  echo Your local Studio has !AHEAD! local commit(s) that are not on GitHub.
  echo GitHub also has !BEHIND! newer commit(s).
  echo.
  echo I will preserve your local commits on a backup branch,
  echo then make local master match origin/master so Studio can update.
  echo Nothing committed will be deleted.
  echo.
  set "STAMP="
  for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%T"
  set "BACKUP=studio-local-backup-!STAMP!"
  git branch "!BACKUP!" HEAD
  if errorlevel 1 (
    echo ERROR: Could not create the safety backup branch.
    popd
    pause
    exit /b 1
  )
  echo Safety backup created: !BACKUP!
  git reset --hard origin/master
  if errorlevel 1 (
    echo.
    echo ERROR: Could not reset master to the latest GitHub version.
    echo Your backup branch still exists: !BACKUP!
    popd
    pause
    exit /b 1
  )
)

for /f "delims=" %%H in ('git rev-parse --short HEAD') do set "AFTER=%%H"
popd

echo.
if /I "!BEFORE!"=="!AFTER!" (
  echo WeBot Studio is already up to date at !AFTER!.
) else (
  echo UPDATED: !BEFORE!  --^>  !AFTER!
)

rem Keep a copy on the Desktop so the updater is easy to find next time.
if exist "%USERPROFILE%\Desktop" (
  if /I not "%~f0"=="%USERPROFILE%\Desktop\Update WeBot Studio.cmd" (
    copy /Y "%~f0" "%USERPROFILE%\Desktop\Update WeBot Studio.cmd" >nul 2>nul
    if not errorlevel 1 echo A copy of this updater is now on your Desktop.
  )
)

echo.
echo IMPORTANT:
echo Close WeBot Studio completely and reopen it once.
echo Then refresh its page. New Studio buttons and server code will load.
echo.
pause
exit /b 0

:DIRTY
echo.
echo ERROR: The Studio project has local tracked changes.
echo I will NOT overwrite them.
echo Use Studio's "Save version" or undo those edits first, then rerun this updater.
echo.
popd
pause
exit /b 1

:TRYROOT
set "CAND=%~1"
if not defined CAND exit /b 0
if exist "!CAND!\studio\server.js" if exist "!CAND!\.git" (
  set "ROOT=!CAND!"
  if "!ROOT:~-1!"=="\" set "ROOT=!ROOT:~0,-1!"
  set "FOUND_BY=%~2"
)
exit /b 0
