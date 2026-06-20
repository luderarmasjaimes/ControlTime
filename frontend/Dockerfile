# Build stage — pin amd64 for Docker Desktop/WSL consistency on Windows hosts
FROM --platform=linux/amd64 node:20-alpine AS build-stage
WORKDIR /app
ARG BUILD_STAMP=dev
ENV VITE_BUILD_STAMP=$BUILD_STAMP
COPY package*.json ./
# use npm ci for reproducible, faster installs
RUN npm ci --legacy-peer-deps --prefer-offline --no-audit
COPY . .
RUN npm run build

# Production stage — nginx 1.27-alpine (stable-alpine had corrupt 0-byte entrypoint on some pulls)
FROM --platform=linux/amd64 nginx:1.27-alpine AS production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -q --spider http://localhost/ || exit 1
# Bypass broken empty /docker-entrypoint.sh on some Docker Desktop pulls
ENTRYPOINT []
CMD ["/usr/sbin/nginx", "-g", "daemon off;"]
