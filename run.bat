@echo off
title Indian Stock Watchlist App
echo ========================================================
echo         Indian Stock Watchlist App Setup and Launch
echo ========================================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed on this system!
    echo.
    echo Please download and install Python from: https://www.python.org/downloads/
    echo IMPORTANT: Make sure to check the box "Add Python to PATH" during setup.
    echo.
    pause
    exit /b
)

:: Automatically install/verify dependencies quietly
echo [1/2] Checking required Python packages...
python -m pip install -r requirements.txt >nul 2>&1

echo [2/2] Starting server...
echo.
echo ========================================================
echo App is ready! Open your browser and go to:
echo http://127.0.0.1:5000
echo ========================================================
echo (Keep this window open while using the app)
echo.

python app.py
pause
