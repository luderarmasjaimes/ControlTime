# Imagen oficial de Puppeteer: incluye Chromium + todas las dependencias del
# sistema (fuentes, libs gráficas) ya resueltas — evita la lista larga y
# frágil de paquetes apt que requeriría instalar Chromium a mano sobre node:20.
FROM ghcr.io/puppeteer/puppeteer:22.15.0

WORKDIR /app
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

# qpdf aplica el cifrado PDF estándar (ISO 32000, AES-256) sobre el PDF ya
# generado — pdf-lib puede dibujar contenido (watermark) pero no cifrar.
# ffmpeg compone el MP4 narrado a partir de las imágenes de diapositiva ya
# generadas para el PPTX (/render-video) — no necesita Chromium, comparte
# este mismo contenedor por simplicidad (ver comentario de trade-off en
# server.js junto al endpoint).
USER root
# La imagen base trae DOS archivos apt preconfigurados para el repo de Google
# Chrome (google-chrome.list y google.list — mirrors/mecanismos de firma
# distintos) que no usamos: el Chromium real lo instala el propio Puppeteer,
# no apt. Su clave GPG rota periódicamente y cuando queda desactualizada
# `apt-get update` falla entero ("NO_PUBKEY ...") aunque qpdf/ffmpeg no
# dependan de ese repo en absoluto. Se quitan ambos antes de actualizar en vez
# de perseguir la clave nueva cada vez que Google la rota.
RUN rm -f /etc/apt/sources.list.d/google-chrome.list \
          /etc/apt/sources.list.d/google.list \
    && apt-get update && apt-get install -y --no-install-recommends qpdf ffmpeg \
    && rm -rf /var/lib/apt/lists/*
USER pptruser

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 4000
CMD ["node", "server.js"]
