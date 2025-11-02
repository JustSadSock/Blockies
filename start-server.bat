@echo off
echo Starting Blockies Multiplayer Server...
echo.

REM Check if node_modules exists, if not install dependencies
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Start the Node.js server in the background
echo Starting Node.js server on port 3000...
start /B node server.js
timeout /t 3 /nobreak >nul

REM Start Cloudflared tunnel
echo Starting Cloudflared tunnel (irgri-tunnel)...
echo Server will be accessible at: https://irgri.uk
echo.
echo Press Ctrl+C to stop the server
echo.

cloudflared tunnel run irgri-tunnel
