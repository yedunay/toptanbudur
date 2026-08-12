#!/bin/sh
# Backgrounded reload loop — runs as part of nginx:alpine's entrypoint chain.
# Sends SIGHUP to nginx every 6h so renewed Let's Encrypt certs are picked up
# without an external signal. We MUST background and return immediately,
# otherwise the entrypoint never reaches `exec nginx -g 'daemon off;'`.

set -e

(
    # First reload happens after 6h — by then certbot has had multiple chances
    # to refresh certs.
    while :; do
        sleep 21600
        if [ -f /var/run/nginx.pid ]; then
            nginx -s reload 2>&1 || true
        fi
    done
) &
