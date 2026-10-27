@echo off
rem AI Head Office Overview. Starts the office with its console window minimised, then opens the office in its own window
rem (Microsoft Edge app mode). Closing the console window stops the office and every local copy it started;
rem Settings > About > Quit does the same. Starting it again while it runs just opens the window.
rem "start.cmd quiet" (Start with Windows, and the Start office link) starts it without opening the window.
rem First time on this PC? Double-click install.cmd instead: it checks Node.js and sets up the shortcuts.
rem
rem Every start also (re)registers the ai-head-office://start link for this Windows user, so index.html's Start office
rem button works after the first start with no setup step, and keeps working if this folder is moved. The link runs
rem node.exe with lib\platform\windows\link-start.js, which ignores the link's address and runs this file with the
rem fixed word "quiet". uninstall.cmd removes the link.
rem AHO_LINK_KEY: tests register the link under a throwaway key instead of the real one.
if not "%~1"=="run" (
  where node >nul 2>&1 || goto :no_node
  node -e "process.exit(+process.versions.node.split('.')[0]>=22?0:1)" || goto :old_node
  start "AI Head Office Overview" /min "%~f0" run %1
  exit /b
)
title AI Head Office Overview
cd /d "%~dp0"
rem The link is registered by the office's own code (lib/platform), which hands the folder to reg.exe as one argument:
rem a folder name with & or ^ in it can never break out into a command here.
node -e "require('./lib/platform').link('create', process.cwd())" >nul 2>&1
set AHO_OPEN=1
if /i "%~2"=="quiet" set AHO_OPEN=0
node server.js
if errorlevel 1 if /i not "%~2"=="quiet" pause
rem This window was opened by "start" above, which keeps it open after the script ends: closed here, so Quit and
rem Uninstall leave no empty console window behind.
exit

:no_node
echo.
echo  AI Head Office Overview needs Node.js, and it is not installed on this PC (or not on the PATH).
echo  Double-click install.cmd: it can install Node.js for you. Or install the LTS version from
echo  https://nodejs.org (the default options are fine), then double-click start.cmd again.
echo.
pause
exit /b 1

:old_node
echo.
for /f "delims=" %%v in ('node -v') do echo  AI Head Office Overview needs Node.js 22 or newer; this PC has %%v.
echo  Double-click install.cmd: it can update Node.js for you.
echo.
pause
exit /b 1
