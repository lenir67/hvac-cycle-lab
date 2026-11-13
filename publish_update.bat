@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   HVAC/R Cycle Lab - Auto-Build ^& GitHub Publisher
echo ===================================================

echo [1/4] Running physics ^& diagnostic verification...
node tests/verify_physics.js
if errorlevel 1 (
  echo [ERROR] Physics verification failed! Aborting publish.
  pause
  exit /b 1
)

echo [2/4] Rebuilding single-file bundle (HVAC_Refrigerant_Cycle_Lab.html)...
node build_classroom_bundle.js
if errorlevel 1 (
  echo [ERROR] Bundle build failed! Aborting publish.
  pause
  exit /b 1
)

echo [3/4] Staging and committing changes...
git add -A
git diff --cached --quiet
if errorlevel 1 (
  set "MSG=%*"
  if "%MSG%"=="" set "MSG=Update HVAC/R Cycle Lab (%DATE% %TIME%)"
  git commit -m "%MSG%"
) else (
  echo No new file changes to commit.
)

echo [4/4] Pushing to GitHub Pages (origin main)...
git push -u origin main
if errorlevel 1 (
  echo.
  echo [NOTE] Push did not complete. Make sure the repository exists on GitHub:
  echo        https://github.com/new  ^(Repository name: hvac-cycle-lab^)
  pause
  exit /b 1
)

echo.
echo [SUCCESS] Live site update pushed! GitHub Pages will refresh in ~15-30 seconds:
echo           https://lenir67.github.io/hvac-cycle-lab/
pause
