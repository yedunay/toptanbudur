# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
RUN npm install -g pnpm@9.15.0
WORKDIR /app
COPY package.json ./
RUN pnpm install --no-frozen-lockfile

FROM node:20-alpine AS dev
RUN npm install -g pnpm@9.15.0
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3002
CMD ["sh", "-c", "pnpm install --no-frozen-lockfile && pnpm dev --host 0.0.0.0 --port 3002"]

FROM node:20-alpine AS builder
RUN npm install -g pnpm@9.15.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_API_BASE=http://localhost:4000/api
ARG VITE_LANDING_URL=http://localhost:3001
ARG VITE_STOREFRONT_URL=http://localhost:3001
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_LANDING_URL=$VITE_LANDING_URL
ENV VITE_STOREFRONT_URL=$VITE_STOREFRONT_URL
RUN pnpm build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html/admin
# NOT: index.html (SPA kabuğu) ASLA cache'lenmez → her deploy anında görünür.
# Eski hali Cache-Control header'ı vermediği için tarayıcı eski bundle'ı tutuyor
# ve "build aldım ama hiçbir şey değişmedi" oluyordu. Hash'li asset'ler immutable.
RUN echo 'server { listen 3002; server_name _; root /usr/share/nginx/html; index index.html; location = / { return 301 /admin/; } location /admin/assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; } location = /admin/sw.js { add_header Cache-Control "no-store"; try_files /admin/sw.js =404; } location /admin/ { add_header Cache-Control "no-store, must-revalidate"; try_files $uri $uri/ /admin/index.html; } location = /admin { return 301 /admin/; } location = /favicon.ico { try_files /admin/favicon.ico =404; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 3002
CMD ["nginx", "-g", "daemon off;"]
