# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — builder
#   Installs ALL dependencies (including devDeps) and compiles Tailwind CSS.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /build

# Copy manifests first for better layer caching
COPY package.json package-lock.json ./

# Install everything (dev deps needed for Tailwind CLI)
RUN npm ci

# Copy source so Tailwind can scan class names
COPY . .

# Compile Tailwind → public/css/style.css
RUN npm run build:css

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — runner (production)
#   Lean image: only production deps, pre-built CSS, no devDeps.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

# Install OS-level libs required by sharp (libvips) and canvas processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    libglib2.0-0 \
    libexpat1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./

# Install production dependencies only, then rebuild sharp for Linux/amd64
RUN npm ci --omit=dev && \
    npm rebuild sharp

# Copy application source
COPY src/ ./src/
COPY server.js ./

# Copy public assets (HTML, images, vendor, CSS) from builder stage
# This includes the compiled public/css/style.css from the Tailwind build step
COPY --from=builder /build/public ./public

# Ensure upload / output directories exist inside the image.
# These will be OVERRIDDEN by named volumes at runtime, so their contents
# here act only as a safe default for the first start.
RUN mkdir -p public/uploads public/outputs

# Drop root privileges — run as the built-in non-root node user
USER node

# Expose the application port (configurable via PORT env var)
EXPOSE 3000

# Health check — verifies the server is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
