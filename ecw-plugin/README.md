Coloca aquí los binarios del plugin ECW para GDAL compatibles con Linux (licenciados por tu proveedor).

Ruta montada en contenedor backend: /opt/ecw
Variable utilizada: GDAL_DRIVER_PATH=/opt/ecw

Verificación dentro del contenedor:
- docker exec mapas-backend gdalinfo --formats | grep ECW

Si no aparece ECW, la conversión de input.ecw no será posible y debes:
1) revisar compatibilidad versión GDAL/plugin,
2) revisar dependencias compartidas (*.so),
3) validar licencia runtime del SDK ECW.
