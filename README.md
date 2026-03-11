# ControlTime

Plataforma de monitoreo basado en GPS para control de ubicación en tiempo real.  
Permite ubicar personas en mapas interactivos actualizados en tiempo real.

## Características

- 🗺️ **Mapa interactivo** con OpenStreetMap (compatible con Google Maps)
- 📍 **Rastreo GPS en tiempo real** usando la API de Geolocalización del navegador
- 👥 **Multi-usuario** — varios dispositivos visibles simultáneamente en el mapa
- ⚡ **Actualizaciones en vivo** vía WebSockets (Socket.io)
- 📋 **Panel lateral** con lista de usuarios activos y sus últimas coordenadas
- 🔒 **Validación de coordenadas** en servidor para entradas seguras

## Tecnologías

| Capa      | Tecnología                        |
|-----------|-----------------------------------|
| Backend   | Node.js · Express · Socket.io     |
| Frontend  | HTML5 · CSS3 · Leaflet.js         |
| Mapa      | OpenStreetMap (tiles libres)      |
| Tiempo real | WebSockets (Socket.io)          |

## Instalación y uso

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar el servidor
npm start
# Servidor disponible en http://localhost:3000

# 3. Para desarrollo con recarga automática
npm run dev
```

## Pruebas

```bash
npm test
```

## Uso de la plataforma

1. Abre `http://localhost:3000` en tu navegador.
2. Escribe tu nombre en el panel izquierdo y haz clic en **Iniciar Seguimiento**.
3. El navegador pedirá permiso para acceder a tu ubicación GPS — acéptalo.
4. Tu posición aparecerá en el mapa y se actualizará automáticamente.
5. Puedes abrir la misma URL desde otros dispositivos para ver a múltiples personas rastreadas.
6. Haz clic sobre un usuario en la lista lateral o sobre su marcador en el mapa para ver sus coordenadas.

## Estructura del proyecto

```
ControlTime/
├── server.js          # Backend Express + Socket.io
├── package.json
├── public/
│   ├── index.html     # Interfaz principal del mapa
│   ├── css/
│   │   └── style.css  # Estilos
│   └── js/
│       └── app.js     # Lógica cliente (Leaflet + Socket.io)
└── tests/
    └── server.test.js # Pruebas del servidor
```
