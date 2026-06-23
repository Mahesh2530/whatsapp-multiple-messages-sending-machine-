@echo off
echo ============================================================
echo   WhatsApp Web Automation - Starting All Services
echo ============================================================

echo.
echo [1/3] Starting Flask Backend (port 5000)...
start "Flask Backend" cmd /k "cd /d C:\Users\Lenovo\Desktop\whatsapp\backend && python run.py"
timeout /t 2 /nobreak >nul

echo [2/3] Starting WhatsApp Service (port 3001)...
start "WhatsApp Service" cmd /k "cd /d C:\Users\Lenovo\Desktop\whatsapp\whatsapp-service && node server.js"

timeout /t 2 /nobreak >nul

echo [3/3] Starting Frontend (port 5173)...
start "Frontend" cmd /k "cd /d C:\Users\Lenovo\Desktop\whatsapp\frontend && npm run dev"

echo.
echo ============================================================
echo   All services starting! Open http://localhost:5173
echo ============================================================
echo.
echo Services:
echo   Frontend      http://localhost:5173
echo   Flask API     http://localhost:5000
echo   WA Service    http://localhost:3001
echo ============================================================
pause
