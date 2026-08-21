@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo No se encontro "python" en el PATH. Instale Python 3 o use otro servidor estatico.
    pause
    exit /b 1
)

echo Sirviendo esta carpeta por HTTPS en https://localhost:5443 ...
echo Certificado AUTOFIRMADO: el navegador mostrara una advertencia la primera
echo vez -- es esperado, hay que aceptarla manualmente (no es un certificado
echo de una autoridad publica). Necesario para usar la camara real desde otra
echo PC de la red (getUserMedia exige HTTPS o localhost).
echo Deje esta ventana abierta. Cierre con Ctrl+C cuando termine.
echo.
python "%~dp0serve_https.py" 5443
pause
