@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   HVAC/R Cycle Lab - Auto-Build ^& GitHub Publisher
echo ===================================================

echo [1/5] Running physics ^& diagnostic verification...
node tests/verify_physics.js
if errorlevel 1 (
  echo [ERROR] Physics verification failed! Aborting publish.
  pause
  exit /b 1
)

echo [2/5] Rebuilding single-file bundle (HVAC_Refrigerant_Cycle_Lab.html)...
set "SKIP_HUB_SYNC=1"
node build_classroom_bundle.js
if errorlevel 1 (
  echo [ERROR] Bundle build failed! Aborting publish.
  pause
  exit /b 1
)

echo [3/5] Staging and committing changes...
git add -A
git diff --cached --quiet
if errorlevel 1 (
  set "MSG=%*"
  if "%MSG%"=="" set "MSG=Update HVAC/R Cycle Lab (%DATE% %TIME%)"
  git commit -m "%MSG%"
) else (
  echo No new file changes to commit.
)

echo [4/5] Pushing to GitHub Pages (origin main)...
git push -u origin main
if errorlevel 1 (
  echo.
  echo [NOTE] Push did not complete. Make sure the repository exists on GitHub:
  echo        https://github.com/new  ^(Repository name: hvac-cycle-lab^)
  pause
  exit /b 1
)

echo [5/5] Syncing ^& publishing to Integrated Study Helper...
set "HUB_SYNC=..\Integrated Study Helper\sync_and_publish.py"
set "PY_EXE=python"
if exist "..\cte-program-tracker-standalone\.venv\Scripts\python.exe" (
  set "PY_EXE=..\cte-program-tracker-standalone\.venv\Scripts\python.exe"
)
if exist "%HUB_SYNC%" (
  "%PY_EXE%" "%HUB_SYNC%" --push --source refrigerant-cycle
  if errorlevel 1 (
    echo [WARN] Integrated Study Helper sync/publish returned an error.
  )
) else (
  echo [NOTE] Integrated Study Helper sync script not found; skipping hub sync.
)

echo.
echo [SUCCESS] Live site update pushed! GitHub Pages will refresh in ~15-30 seconds:
echo           https://lenir67.github.io/hvac-cycle-lab/
echo           https://lenir67.github.io/integrated-study-helper/#refrigerant-cycle
pause
