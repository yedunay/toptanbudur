#!/bin/sh
# Bootstraps a 1-day self-signed cert for ${DOMAIN} so nginx can start before
# certbot has obtained the real Let's Encrypt cert. Once certbot succeeds,
# the file is replaced and the next `nginx -s reload` (every 6h) picks it up.
#
# Runs as part of nginx:alpine's /docker-entrypoint.d/ chain, before nginx starts.
# Errors are intentionally NOT silenced — if openssl fails, the message must be
# visible in `docker compose logs nginx` so the cause is diagnosable.

set -eu

: "${DOMAIN:?DOMAIN env var is required (set it in the project root .env)}"

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
    echo "[init-certs] cert for ${DOMAIN} already present — skipping bootstrap"
    exit 0
fi

echo "[init-certs] no cert for ${DOMAIN} — generating self-signed bootstrap (1 day)"
mkdir -p "${CERT_DIR}"

# Minimal openssl req: just CN, no SAN, no -addext (Alpine's openssl.cnf may
# lack the [req_ext] section that -addext requires). 1-day placeholder.
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "${CERT_DIR}/privkey.pem" \
    -out "${CERT_DIR}/fullchain.pem" \
    -subj "/CN=${DOMAIN}"

cp "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/chain.pem"
chmod 644 "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/chain.pem"
chmod 600 "${CERT_DIR}/privkey.pem"

echo "[init-certs] bootstrap cert ready — certbot will replace it shortly"
