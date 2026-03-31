# Build stage
FROM node:20-alpine as build-stage
WORKDIR /app
COPY package*.json ./
# use npm ci for reproducible, faster installs
RUN npm ci --legacy-peer-deps --prefer-offline --no-audit
COPY . .
RUN npm run build

# Production stage
FROM nginx:stable-alpine as production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -q --spider http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
