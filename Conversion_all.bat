@echo off
REM Convert all Hero Lab .por files in To_Convert to Chummer JSON.
REM One .por = one character. If the character has vehicles (or spirits/sprites), separate JSON files are created for each (do not combine).
setlocal
cd /d "%~dp0"

if not exist "To_Convert" (
    echo Creating To_Convert folder. Place your .por files there.
    mkdir "To_Convert"
)

if not exist "To_Convert\Converted" mkdir "To_Convert\Converted"

echo Converting all .por files in To_Convert...
for %%f in (To_Convert\*.por) do (
    if exist "%%f" (
        echo.
        echo --- %%f ---
        npx tsx scripts/convert-herolabs-to-chummer.ts "%%f" --out-dir "To_Convert\Converted"
    )
)

echo.
echo Done. Check To_Convert\Converted for JSON files.
endlocal
