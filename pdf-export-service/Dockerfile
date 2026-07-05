# Imagen oficial de Puppeteer: incluye Chromium + todas las dependencias del
# sistema (fuentes, libs gráficas) ya resueltas — evita la lista larga y
# frágil de paquetes apt que requeriría instalar Chromium a mano sobre node:20.
FROM ghcr.io/puppeteer/puppeteer:22.15.0

WORKDIR /app
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 4000
CMD ["node", "server.js"]
