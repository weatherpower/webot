@echo off
setlocal
title WeatherPower - WeBot Studio Updater
echo.
echo ========================================
echo   WeBot Studio Updater
echo ========================================
echo.
echo This window will stay open so you can see any error.
echo.

set "PS1=%~dp0Update-WeBot-Studio.ps1"
if not exist "%PS1%" (
  set "PS1=%TEMP%\Update-WeBot-Studio.ps1"
  echo Downloading the latest updater from GitHub...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/weatherpower/webot/master/Update-WeBot-Studio.ps1' -OutFile '%PS1%'; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
  if errorlevel 1 (
    echo.
    echo ERROR: Could not download the updater.
    echo.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "CODE=%ERRORLEVEL%"

echo.
echo ----------------------------------------
if "%CODE%"=="0" (
  echo Updater finished successfully.
) else (
  echo Updater stopped with code %CODE%.
  echo Check your Desktop for WeBot-Studio-Update.log.
)
echo ----------------------------------------
echo.
pause
exit /b %CODE%
