#!/bin/bash
set -e

echo "=============================================="
echo "  RUAA – AI Platform — Production Deployment"
echo "=============================================="

PROJECT_DIR="/root/RUAA-AI-Platform-for-Heritage-Planning-and-Regeneration"
DOMAIN="ruaa-ai.cloud"

# ── Step 1: Check Docker container is running ──
echo ""
echo "▶ Step 1: Checking Docker container..."
cd "$PROJECT_DIR"
if docker compose ps | grep -q "running"; then
    echo "  ✅ Container is running"
else
    echo "  ⚠️  Container not running, starting..."
    docker compose up -d --build
fi
echo ""

# ── Step 2: Install Nginx ──
echo "▶ Step 2: Installing Nginx..."
apt-get update -qq
apt-get install -y nginx > /dev/null 2>&1
echo "  ✅ Nginx installed"
echo ""

# ── Step 3: Create TEMPORARY HTTP-only Nginx config ──
# Certbot needs HTTP working first to do the ACME challenge
echo "▶ Step 3: Creating HTTP-only Nginx config for Certbot..."

cat > /etc/nginx/sites-available/re22 << 'NGINX_HTTP'
# Temporary HTTP-only config — Certbot will add SSL automatically
server {
    listen 80;
    server_name ruaa-ai.cloud www.ruaa-ai.cloud;

    client_max_body_size 110m;

    proxy_set_header  Host              $host;
    proxy_set_header  X-Real-IP         $remote_addr;
    proxy_set_header  X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header  X-Forwarded-Proto $scheme;

    proxy_read_timeout    300s;
    proxy_connect_timeout  30s;
    proxy_send_timeout    300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|otf)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    gzip            on;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_types      text/plain text/css application/json application/javascript
                    text/xml application/xml image/svg+xml;
}
NGINX_HTTP

echo "  ✅ HTTP-only config created"
echo ""

# ── Step 4: Enable the site ──
echo "▶ Step 4: Enabling Nginx site..."
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/re22 /etc/nginx/sites-enabled/re22
nginx -t && systemctl reload nginx
echo "  ✅ Nginx enabled and running (HTTP)"
echo ""

# ── Step 5: Test HTTP access ──
echo "▶ Step 5: Testing HTTP access to app..."
sleep 2
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ || echo "000")
echo "  App direct:  HTTP $HTTP_STATUS"
HTTP_STATUS2=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/ || echo "000")
echo "  Via Nginx:   HTTP $HTTP_STATUS2"
echo ""

# ── Step 6: Install Certbot and get SSL ──
echo "▶ Step 6: Installing Certbot and obtaining SSL certificate..."
apt-get install -y certbot python3-certbot-nginx > /dev/null 2>&1
echo "  ✅ Certbot installed"
echo ""
echo "  Running Certbot for $DOMAIN ..."
certbot --nginx \
    -d "$DOMAIN" \
    -d "www.$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email admin@ruaa-ai.cloud \
    --redirect
echo "  ✅ SSL certificate obtained and Nginx configured!"
echo ""

# ── Step 7: Now replace with full production Nginx config ──
echo "▶ Step 7: Writing final production Nginx config..."

# Get the certbot-generated cert paths (they should be standard)
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/$DOMAIN/privkey.pem"

cat > /etc/nginx/sites-available/re22 << NGINX_PROD
##############################################################################
# RUAA – AI Platform — Nginx production configuration
##############################################################################

# Redirect HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    # ── SSL ──────────────────────────────────────────────────────────────
    ssl_certificate     $CERT_PATH;
    ssl_certificate_key $KEY_PATH;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # ── Upload size (>= multer limit: 100 MB) ────────────────────────────
    client_max_body_size 110m;

    # ── Real-IP passthrough ──────────────────────────────────────────────
    proxy_set_header  Host              \$host;
    proxy_set_header  X-Real-IP         \$remote_addr;
    proxy_set_header  X-Forwarded-For   \$proxy_add_x_forwarded_for;
    proxy_set_header  X-Forwarded-Proto \$scheme;

    # ── Timeouts (generous for long-running AI jobs) ─────────────────────
    proxy_read_timeout    300s;
    proxy_connect_timeout  30s;
    proxy_send_timeout    300s;

    # ── Proxy to Docker container ────────────────────────────────────────
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # ── Static file caching ──────────────────────────────────────────────
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|otf)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # ── Gzip ─────────────────────────────────────────────────────────────
    gzip            on;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_types      text/plain text/css application/json application/javascript
                    text/xml application/xml image/svg+xml;

    # ── Security headers ─────────────────────────────────────────────────
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
NGINX_PROD

nginx -t && systemctl reload nginx
echo "  ✅ Production Nginx config active with SSL"
echo ""

# ── Step 8: Firewall ──
echo "▶ Step 8: Configuring firewall (UFW)..."
ufw allow OpenSSH > /dev/null 2>&1
ufw allow 'Nginx Full' > /dev/null 2>&1
echo "y" | ufw enable > /dev/null 2>&1
echo "  ✅ Firewall enabled (SSH + Nginx)"
echo ""

# ── Step 9: Verify SSL auto-renew ──
echo "▶ Step 9: Verifying SSL auto-renewal..."
certbot renew --dry-run
echo "  ✅ Auto-renewal is working"
echo ""

# ── Step 10: Final checks ──
echo "▶ Step 10: Final verification..."
echo ""
echo "  Docker container:"
docker compose ps
echo ""
echo "  HTTPS test:"
HTTPS_STATUS=$(curl -sk -o /dev/null -w "%{http_code}" https://$DOMAIN/ || echo "000")
echo "  https://$DOMAIN → HTTP $HTTPS_STATUS"
echo ""

echo "=============================================="
echo "  ✅ DEPLOYMENT COMPLETE!"
echo "=============================================="
echo ""
echo "  🌐 Site: https://$DOMAIN"
echo "  🔒 SSL:  Let's Encrypt (auto-renewing)"
echo "  🐳 App:  Docker container 're22_app'"
echo ""
echo "  Useful commands:"
echo "    docker compose -f $PROJECT_DIR/docker-compose.yml logs -f app"
echo "    docker compose -f $PROJECT_DIR/docker-compose.yml ps"
echo "    certbot certificates"
echo "=============================================="
