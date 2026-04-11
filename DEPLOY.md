# re22 — VPS Deployment Guide

A step-by-step guide for deploying the **re22** Express.js monolith to a fresh Ubuntu/Debian VPS using Docker + Nginx.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Ubuntu / Debian VPS | 22.04 LTS recommended |
| Docker Engine | 24+ |
| Docker Compose plugin | v2 (`docker compose`) |
| Nginx | any recent stable |
| Certbot | for Let's Encrypt SSL |
| Domain | DNS A record → VPS IP |

---

## Step 1 — Install Docker on the VPS

```bash
# Install via the official convenience script
curl -fsSL https://get.docker.com | sudo sh

# Add your user to the docker group (no sudo needed after re-login)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

---

## Step 2 — Clone the Repository

```bash
cd /opt
sudo git clone https://github.com/YOUR_USERNAME/re22.git
sudo chown -R $USER:$USER /opt/re22
cd /opt/re22
```

> **VPS:** `76.13.139.206` — SSH in with `ssh root@76.13.139.206` before running these commands.

---

## Step 3 — Create the `.env` File

```bash
cp .env.example .env
nano .env
```

Fill in every variable (see `.env.example` for the full list):

| Variable | Required | Description |
|---|---|---|
| `PORT` | ✅ | Keep `3000` |
| `APP_BASE_URL` | ✅ | `https://ruaa-ai.cloud` |
| `MONGO_URI` | ✅ | MongoDB Atlas connection string |
| `REPLICATE_API_TOKEN` | ✅ | Replicate API key |
| `REPLICATE_GEMINI_MODEL` | ✅ | e.g. `google/gemini-2.5-flash` |
| `BLENDER_PATH` | ❌ | Leave empty on Linux VPS |

```bash
# Secure the file — only root / your user should read it
chmod 600 .env
```

---

## Step 4 — Build and Start the Container

```bash
# Build the image and start in detached mode
docker compose up -d --build

# Verify the container is running and healthy
docker compose ps

# Tail the logs
docker compose logs -f app
```

The app is now running on `http://127.0.0.1:3000` (only accessible locally — Nginx will expose it).

---

## Step 5 — Install and Configure Nginx

```bash
sudo apt install -y nginx

# Copy the site config
sudo cp nginx/re22.conf /etc/nginx/sites-available/re22

# Edit the server_name directive (already set to ruaa-ai.cloud)

# Enable the site
sudo ln -s /etc/nginx/sites-available/re22 /etc/nginx/sites-enabled/re22

# Remove the default site if present
sudo rm -f /etc/nginx/sites-enabled/default

# Test and reload
sudo nginx -t && sudo systemctl reload nginx
```

---

## Step 6 — Enable SSL with Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d ruaa-ai.cloud -d www.ruaa-ai.cloud

# Certbot will:
#  1. Obtain the certificate
#  2. Automatically edit your nginx config to add SSL
#  3. Set up auto-renewal (a systemd timer)

# Verify auto-renewal
sudo certbot renew --dry-run
```

After Certbot runs, uncomment the HTTP→HTTPS redirect block in `nginx/re22.conf` and reload Nginx.

---

## Step 7 — Open the Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # ports 80 + 443
sudo ufw enable
sudo ufw status
```

---

## Updating / Re-deploying

```bash
cd /opt/re22

# Pull latest code
git pull origin main

# Rebuild and restart (volumes are preserved automatically)
docker compose up -d --build

# Clean up old images to free disk space
docker image prune -f
```

> **Tip:** Uploaded files in `public/uploads` and job outputs in `public/outputs` are stored in named Docker volumes (`uploads_data`, `outputs_data`). They survive container rebuilds and `docker compose down`. To explicitly preserve them before a dangerous operation, back up with `docker run --rm -v re22_uploads_data:/data -v $(pwd):/backup alpine tar czf /backup/uploads_backup.tar.gz -C /data .`

---

## Useful Commands

```bash
# View running containers
docker compose ps

# Stream logs
docker compose logs -f app

# Open a shell inside the container
docker compose exec app sh

# Stop the app
docker compose down

# Stop and wipe volumes (DESTRUCTIVE — deletes all uploads/outputs)
docker compose down -v

# Inspect named volumes
docker volume ls
docker volume inspect re22_uploads_data
```

---

## Folder Structure on the VPS

```
/opt/re22/
├── .env                  ← secrets (chmod 600, never committed)
├── .env.example          ← committed template
├── Dockerfile
├── docker-compose.yml
├── nginx/
│   └── re22.conf
├── server.js
├── src/
├── public/               ← static HTML/CSS (baked into image)
│   ├── uploads/          ← ⚠ mounted from Docker volume
│   └── outputs/          ← ⚠ mounted from Docker volume
└── ...
```
