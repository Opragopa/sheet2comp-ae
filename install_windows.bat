@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "JSX=Sheets-to-AE-Comp-Generator.jsx"
set "PERSON_JSX=person_plates_from_sheet.jsx"
set "TOPICS_JSX=session_topics_from_sheet.jsx"
set "SHORTEN_JSX=shorten_render_queue_names.jsx"
set "TOPICS_EXAMPLE=session_topics_example.tsv"
set "PY=download_data.py"
set "PERSON_PY=download_person_plate_data.py"
set "PREPARE_PERSON_PY=prepare_person_plate_photos.py"
set "EXTRACT_PY=extract_session_topics.py"

if not exist "%SCRIPT_DIR%%JSX%" (
  echo Missing %JSX%
  exit /b 1
)

if not exist "%SCRIPT_DIR%%PY%" (
  echo Missing %PY%
  exit /b 1
)

if not exist "%SCRIPT_DIR%%PERSON_PY%" (
  echo Missing %PERSON_PY%
  exit /b 1
)

if not exist "%SCRIPT_DIR%%PREPARE_PERSON_PY%" (
  echo Missing %PREPARE_PERSON_PY%
  exit /b 1
)

if not exist "%SCRIPT_DIR%%EXTRACT_PY%" (
  echo Missing %EXTRACT_PY%
  exit /b 1
)

if not exist "%SCRIPT_DIR%%PERSON_JSX%" (
  echo Missing %PERSON_JSX%
  exit /b 1
)

if not exist "%SCRIPT_DIR%%TOPICS_JSX%" (
  echo Missing %TOPICS_JSX%
  exit /b 1
)

if not exist "%SCRIPT_DIR%%SHORTEN_JSX%" (
  echo Missing %SHORTEN_JSX%
  exit /b 1
)

if not exist "%SCRIPT_DIR%%TOPICS_EXAMPLE%" (
  echo Missing %TOPICS_EXAMPLE%
  exit /b 1
)

if not "%~1"=="" (
  set "AE_SCRIPTS=%~1"
) else (
  for %%V in (2026 2025 2024) do (
    if not defined AE_SCRIPTS if exist "C:\Program Files\Adobe\Adobe After Effects %%V\Support Files\Scripts" set "AE_SCRIPTS=C:\Program Files\Adobe\Adobe After Effects %%V\Support Files\Scripts"
  )
)

if not defined AE_SCRIPTS (
  echo After Effects Scripts folder not found.
  echo Usage: install_windows.bat "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts"
  exit /b 1
)

set "PYTHON_CMD="
for /f "delims=" %%P in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_CMD=%%P"
if not defined PYTHON_CMD (
  for /f "delims=" %%P in ('python -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_CMD=%%P"
)

if not defined PYTHON_CMD (
  echo Python 3 not found. Install Python 3 and rerun.
  exit /b 1
)

if not exist "%AE_SCRIPTS%" mkdir "%AE_SCRIPTS%"
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%JSX%" "%AE_SCRIPTS%\%JSX%" >nul
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%PERSON_JSX%" "%AE_SCRIPTS%\%PERSON_JSX%" >nul
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%TOPICS_JSX%" "%AE_SCRIPTS%\%TOPICS_JSX%" >nul
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%SHORTEN_JSX%" "%AE_SCRIPTS%\%SHORTEN_JSX%" >nul
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%TOPICS_EXAMPLE%" "%AE_SCRIPTS%\%TOPICS_EXAMPLE%" >nul
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%PY%" "%AE_SCRIPTS%\%PY%" >nul
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%PERSON_PY%" "%AE_SCRIPTS%\%PERSON_PY%" >nul
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%PREPARE_PERSON_PY%" "%AE_SCRIPTS%\%PREPARE_PERSON_PY%" >nul
if errorlevel 1 exit /b 1

copy /Y "%SCRIPT_DIR%%EXTRACT_PY%" "%AE_SCRIPTS%\%EXTRACT_PY%" >nul
if errorlevel 1 exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -Command "$cfg=@{pythonCmd=$env:PYTHON_CMD}|ConvertTo-Json; Set-Content -LiteralPath (Join-Path $env:AE_SCRIPTS 'ae_parser_config.json') -Value $cfg -Encoding UTF8"
if errorlevel 1 exit /b 1

echo Installed to:
echo %AE_SCRIPTS%
echo Python:
echo %PYTHON_CMD%
endlocal
