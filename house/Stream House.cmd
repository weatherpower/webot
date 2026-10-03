@echo off
title WeatherPower Stream House
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
rem Already running? Just open the control panel.
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', 7788); exit 0 } catch { exit 1 }" >nul 2>nul && (start "" http://localhost:7788 & exit /b 0)
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:7788"
echo Starting WeatherPower Stream House... keep this window open while you stream.
node server.js
echo.
echo Stream House stopped.
pause
