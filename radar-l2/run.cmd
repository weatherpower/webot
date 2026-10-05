@echo off
rem WeatherPower Level 2 radar: keeps NEXRAD-resolution radar images flowing to the website. Leave this window open.
cd /d "%~dp0"
:again
python radar_l2.py --loop --sites KSRX,KSHV,KTLX,KFWS,KLZK --every 45
echo radar_l2 stopped, restarting in 15 s...
timeout /t 15 >nul
goto again
