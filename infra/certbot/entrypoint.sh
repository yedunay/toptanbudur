#!/bin/sh
# Certbot entrypoint:
#   1. Wait for nginx HTTP :80 to be reachable (so the ACME HTTP-01 webroot works).
#   2. If a real Let's Encrypt cert for ${DOMAIN} doesn't exist yet, request one.
#   3. Loop: every 12h run `certbot renew`. Certbot itself only renews when the cert
#      is within 30 days of expiry, so this is a safe fixed cadence (well under the
#      85-day target the user wants — Let's Encrypt issues for 90 days).
#
# Notes:
#   - Renewal does NOT need to signal nginx: the nginx container reloads itself
#     every 6h (see compose CMD), so it picks up the new fullchain.pem on its own.
#   - Set LETSENCRYPT_STAGING=1 to use Let's Encrypt's staging endpoint while testing
#     (avoids burning the 5/week prod rate-limit during DNS/firewall debugging).

set -eu

: "${DOMAIN:?DOMAIN env var is required}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL env var is required}"

STAGING_FLAG=""
if [ "${LETSENCRYPT_STAGING:-0}" = "1" ]; then
    echo "[certbot] LETSENCRYPT_STAGING=1 — using staging endpoint (cert will NOT be browser-trusted)"
    STAGING_FLAG="--staging"
fi

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

wait_for_nginx() {
    # Nginx is on the same docker network and starts in ~1s. We just need to give it
    # a small head-start before the ACME HTTP-01 challenge. busybox wget is available
    # in certbot/certbot (Alpine) but its flags vary; portable check is `wget -q -O-`.
    i=0
    while [ $i -lt 30 ]; do
        if wget -q -O- --tries=1 --timeout=2 "http://nginx/" >/dev/null 2>&1; then
            return 0
        fi
        i=$((i + 1))
        sleep 2
    done
    # Even if the GET errored (e.g. on 404), nginx is almost certainly up by 60s.
    echo "[certbot] WARN: nginx GET probe never succeeded in 60s — continuing anyway"
    return 0
}

have_real_cert() {
    # Certbot writes /etc/letsencrypt/renewal/<name>.conf only after a successful
    # issuance. The self-signed bootstrap cert doesn't create one, so this is the
    # most reliable "is this a real LE cert?" signal — no openssl parsing needed.
    [ -f "/etc/letsencrypt/renewal/${DOMAIN}.conf" ]
}

obtain_cert() {
    echo "[certbot] requesting cert for ${DOMAIN} and www.${DOMAIN}"

    # Remove the self-signed bootstrap dir so certbot doesn't refuse to overwrite.
    # Only safe to delete because we've already confirmed via have_real_cert() that
    # no real LE cert lives here.
    rm -rf "/etc/letsencrypt/live/${DOMAIN}" \
           "/etc/letsencrypt/archive/${DOMAIN}" \
           "/etc/letsencrypt/renewal/${DOMAIN}.conf" 2>/dev/null || true

    # Domains to include — start with apex, optionally add www if INCLUDE_WWW=1.
    # Default off because many registrars CNAME `www` to a redirect/CDN service
    # by default (e.g. NatroCDN), which makes ACME HTTP-01 fail for www.
    DOMAIN_ARGS="-d ${DOMAIN}"
    if [ "${INCLUDE_WWW:-0}" = "1" ]; then
        DOMAIN_ARGS="${DOMAIN_ARGS} -d www.${DOMAIN}"
    fi

    # shellcheck disable=SC2086
    certbot certonly \
        --webroot -w /var/www/certbot \
        ${DOMAIN_ARGS} \
        --email "${LETSENCRYPT_EMAIL}" \
        --agree-tos --no-eff-email --non-interactive \
        --keep-until-expiring \
        --rsa-key-size 4096 \
        ${STAGING_FLAG}
}

trap 'echo "[certbot] caught TERM — exiting"; exit 0' TERM INT

wait_for_nginx

if have_real_cert; then
    echo "[certbot] real cert already present for ${DOMAIN} — skipping issuance"
else
    if ! obtain_cert; then
        echo "[certbot] initial issuance failed — will retry on next renewal cycle"
    fi
fi

# Renewal loop — every 12h. Certbot internally only renews when within 30 days of expiry.
echo "[certbot] entering renewal loop (every 12h)"
while :; do
    sleep 12h &
    wait $!
    echo "[certbot] $(date -u +%FT%TZ) — running certbot renew"
    certbot renew --webroot -w /var/www/certbot --quiet ${STAGING_FLAG} || \
        echo "[certbot] renew attempt failed — will retry next cycle"
done
