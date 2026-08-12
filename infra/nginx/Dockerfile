FROM nginx:1.27-alpine

# nginx:alpine ships nginx linked against libssl but does NOT include the
# openssl CLI binary. init-certs.sh needs it to generate the 1-day self-signed
# bootstrap cert that lets nginx start before certbot has obtained the real
# Let's Encrypt cert.
RUN apk add --no-cache openssl
