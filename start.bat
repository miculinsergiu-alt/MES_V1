@echo off
echo Starting SmartFactory MES...
start "SmartFactory Backend" cmd /k "cd /d %~dp0backend && node server.js"
timeout /t 3 /nobreak > nul
start "SmartFactory Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
echo.
echo ✅ SmartFactory MES started!
echo    Backend:  http://localhost:3001
echo    Frontend: http://localhost:5173
echo.
timeout /t 3 /nobreak > nul
start http://localhost:5173
