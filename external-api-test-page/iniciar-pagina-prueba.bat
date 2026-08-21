@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo No se encontro "python" en el PATH. Instale Python 3 o use otro servidor estatico.
    pause
    exit /b 1
)

echo Sirviendo esta carpeta por HTTP en http://localhost:5190 ...
echo (proxea /api/* al backend -- ver _proxy_common.py / ADR-107; para HTTPS
echo  use iniciar-pagina-prueba-https.bat en otra ventana, puerto 5443)
echo Deje esta ventana abierta. Cierre con Ctrl+C cuando termine.
echo.
python "%~dp0serve_http.py" 5190
pause
