# Quickstart: 2.5D District Map Generator

**Branch**: `001-2-5d-district-map` | **Date**: 2026-04-08

## Prerequisites

1. Node.js v18+ installed
2. `REPLICATE_API_TOKEN` set in `.env`
3. MongoDB running (optional — graceful degradation)
4. At least one completed Service 1 or Service 2 job with outputs in `/public/outputs/`

## Setup

```bash
# Install dependencies (no new packages needed — all existing)
npm install

# Build CSS
npm run build:css

# Start server
npm run dev
```

## Quick Test Flow

1. **Ensure building assets exist**: Complete a Service 1 or Service 2 job first.

2. **Discover assets**:
   ```bash
   curl http://localhost:3000/api/service3/discover-assets
   ```

3. **Compose a 2.5D map**:
   ```bash
   curl -X POST http://localhost:3000/api/service3/compose \
     -F "baseMap=@./test-map.png" \
     -F "districtName=حي سمحان" \
     -F 'spots=[{"spotNumber":1,"boundingBox":{"x":100,"y":200,"width":300,"height":250},"sourceJobId":"<JOB_ID>","sourceService":2,"selectedView":"aerial"}]'
   ```

4. **Check result**:
   ```bash
   curl http://localhost:3000/api/service3/job/<JOB_ID>
   ```

## Key Files

| File | Purpose |
|------|---------|
| `src/routes/service3.js` | Main service router (replaced) |
| `public/service3.html` | Frontend UI with canvas-based map editor |
| `src/models/Job.js` | Shared Job model (unchanged) |
| `src/utils/aiTextProviders.js` | AI text utilities (unchanged) |

## Pipeline Duration

- **Compositing**: ~2–5 seconds (local Sharp processing)
- **Background removal**: ~5–10 seconds per building (Replicate API)
- **AI Blending**: ~15–30 seconds (Replicate API)
- **Edge Control**: ~15–30 seconds (Replicate API)
- **Total for 6 buildings**: ~2–4 minutes
