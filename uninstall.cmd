@echo off
rem Takes AI Head Office Overview off this PC's menus: stops it, removes the desktop shortcut, Start with Windows and the
rem Start office link (this Windows user only). Your files are not deleted: it says which folder to delete yourself.
rem About > Uninstall in the office does the same.
setlocal
cd /d "%~dp0"
title AI Head Office Overview uninstall
echo.
echo  AI Head Office Overview uninstall
echo  =====================
echo.
where node >nul 2>&1 || goto :no_node
node tools\setup.js uninstall
goto :done

:no_node
rem Without Node.js the office cannot be running: take the link and both shortcuts away directly.
set "LINK_KEY=HKCU\Software\Classes\ai-head-office"
if defined AHO_LINK_KEY set "LINK_KEY=%AHO_LINK_KEY%"
reg delete "%LINK_KEY%" /f >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\platform\windows\shortcut.ps1" -Where desktop -Action remove >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\platform\windows\shortcut.ps1" -Where startup -Action remove >nul
echo  The Start office link, the desktop shortcut and Start with Windows are removed.
echo  AI Head Office Overview's files are still in %~dp0
echo  Delete that folder to remove it completely.

:done
echo.
if /i not "%AHO_INSTALL_NO_START%"=="1" pause
exit /b 0
