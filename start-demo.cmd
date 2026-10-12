@echo off
rem AI Head Office Overview demo: made-up projects with real little websites, for screenshots and trying it out.
rem Runs on 127.0.0.1:8882 with its own data (data-demo), so the real office and its settings are not touched.
rem About > Quit in the demo window stops the demo and its sites.
cd /d "%~dp0"
where node >nul 2>&1 || goto :no_node
node demo\demo.js
if errorlevel 1 pause
exit /b

:no_node
echo.
echo  The demo needs Node.js, and it is not installed on this PC (or not on the PATH).
echo  Install the LTS version from https://nodejs.org, then double-click start-demo.cmd again.
echo.
pause
exit /b 1
