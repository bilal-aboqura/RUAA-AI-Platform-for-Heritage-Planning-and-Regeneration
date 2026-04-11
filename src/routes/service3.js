'use strict';

const express        = require('express');
const multer         = require('multer');
const path           = require('path');
const fs             = require('fs');
const sharp          = require('sharp');
const { v4: uuidv4 } = require('uuid');
const Replicate      = require('replicate');
const https          = require('https');
const http           = require('http');

const router    = express.Router();
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Graceful Job model import — works even if Mongo isn't connected
const Job = (() => {
  try { return require('../models/Job'); }
  catch { return null; }
})();

// ─── Constants ────────────────────────────────────────────────────────────────
const SERVICE_NAME        = '2.5D District Map Generator';
const BLEND_MODEL         = 'google/nano-banana-pro';
const MAX_SPOTS           = 15;
const MIN_SPOT_DIMENSION  = 50;
const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;  // 5 min download timeout

const BLEND_PROMPT = [
  'A photorealistic, seamless isometric integration of traditional Najdi mud-brick',
  'buildings into the surrounding terrain. Realistic soft architectural shadows cast',
  'on the ground, matching the exact environmental lighting. High-end 2.5D',
  'architectural render, preserving the exact geometric shape and spatial layout of',
  'the input map. Calm, professional architectural visualization.',
].join(' ');

// ─── Directories ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../../public/uploads');
const OUTPUTS_DIR = path.join(__dirname, '../../public/outputs');
[UPLOADS_DIR, OUTPUTS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_, file, cb) =>
    cb(null, `s3_${Date.now()}_${uuidv4().slice(0, 8)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });


// ═══════════════════════════════════════════════════════════════════════════════
// Helper: download URL → local file (follows redirects)
// ═══════════════════════════════════════════════════════════════════════════════
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(dest);
    const req   = proto.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => fs.unlink(dest, () => {}));
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) {
        file.close(() => fs.unlink(dest, () => {}));
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    req.setTimeout(PIPELINE_TIMEOUT_MS, () => req.destroy(new Error('Download timeout')));
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Validate the incoming spots array
//   Expected shape per spot: { x, y, width, height, jobId, viewType }
// ═══════════════════════════════════════════════════════════════════════════════
function validateSpots(spots, mapWidth, mapHeight) {
  const errors = [];

  if (!Array.isArray(spots) || spots.length === 0) {
    return { valid: false, errors: ['Spots must be a non-empty array'] };
  }
  if (spots.length > MAX_SPOTS) {
    errors.push(`Maximum ${MAX_SPOTS} spots allowed, received ${spots.length}`);
  }

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const p = `spots[${i}]`;

    if (typeof s.x !== 'number' || typeof s.y !== 'number') {
      errors.push(`${p}.x and ${p}.y must be numbers`);
    } else if (s.x < 0 || s.y < 0) {
      errors.push(`${p}.x and ${p}.y must be >= 0`);
    }

    if (typeof s.width !== 'number' || typeof s.height !== 'number') {
      errors.push(`${p}.width and ${p}.height must be numbers`);
    } else {
      if (s.width < MIN_SPOT_DIMENSION || s.height < MIN_SPOT_DIMENSION) {
        errors.push(`${p}.width and ${p}.height must be >= ${MIN_SPOT_DIMENSION}px`);
      }
      if (s.x + s.width > mapWidth) {
        errors.push(`${p} extends beyond map width (${s.x + s.width} > ${mapWidth})`);
      }
      if (s.y + s.height > mapHeight) {
        errors.push(`${p} extends beyond map height (${s.y + s.height} > ${mapHeight})`);
      }
    }

    if (!s.jobId || typeof s.jobId !== 'string') {
      errors.push(`${p}.jobId is required (string)`);
    }

    if (s.viewType !== undefined && typeof s.viewType !== 'string') {
      errors.push(`${p}.viewType must be a string when provided`);
    }
  }

  return { valid: errors.length === 0, errors };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Resolve a building asset image from disk
//   Looks for /public/outputs/{jobId}/{viewType}.png (then .jpg, .jpeg, .webp)
//   Falls back to any image in the directory if viewType match fails.
// ═══════════════════════════════════════════════════════════════════════════════
function resolveAssetImage(jobId, viewType) {
  const jobDir = path.join(OUTPUTS_DIR, jobId);
  if (!fs.existsSync(jobDir)) {
    return { imagePath: null, error: `Job directory not found: ${jobId}` };
  }

  const extPriority = ['.png', '.jpg', '.jpeg', '.webp', '.tiff'];
  const view = (viewType || 'aerial').toLowerCase();

  // Direct match: {viewType}.{ext}
  for (const ext of extPriority) {
    const direct = path.join(jobDir, view + ext);
    if (fs.existsSync(direct)) return { imagePath: direct, error: null };
  }

  // Fuzzy match: filename ends with _{viewType}
  const files = fs.readdirSync(jobDir).filter(f =>
    /\.(png|jpg|jpeg|tiff|webp)$/i.test(f),
  );

  for (const ext of extPriority) {
    const match = files.find(f => {
      const base = path.basename(f, path.extname(f)).toLowerCase();
      return base === view || base.endsWith('_' + view);
    });
    if (match) return { imagePath: path.join(jobDir, match), error: null };
  }

  // Last resort: grab any image (prefer PNG)
  if (files.length > 0) {
    const fallback = files.find(f => path.extname(f).toLowerCase() === '.png') || files[0];
    return { imagePath: path.join(jobDir, fallback), error: null };
  }

  return { imagePath: null, error: `No image found for view "${view}" in job ${jobId}` };
}


// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 1 — compositeImages()
// Loads each building asset, resizes it to its bounding box, and composites
// all buildings onto the uploaded base map using sharp.
// Returns: { compositePath, compositeBuffer }
// ═══════════════════════════════════════════════════════════════════════════════
async function compositeImages(jobDir, baseMapPath, spots) {
  const overlays = [];

  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    const view = spot.viewType || 'aerial';
    console.log(`  [Composite] Spot ${i + 1}/${spots.length} — job ${spot.jobId}, view ${view}`);

    // Resolve the pre-cut building image from disk
    const { imagePath, error } = resolveAssetImage(spot.jobId, view);
    if (error) throw new Error(`Spot ${i + 1}: ${error}`);

    // Resize to exactly match the bounding box; contain keeps aspect + pads transparent
    const resized = await sharp(imagePath)
      .resize(Math.round(spot.width), Math.round(spot.height), {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    overlays.push({
      input: resized,
      left:  Math.round(spot.x),
      top:   Math.round(spot.y),
    });
  }

  // Composite all overlays onto the base map
  const compositePath = path.join(jobDir, 'composite_raw.png');
  await sharp(baseMapPath)
    .composite(overlays)
    .png()
    .toFile(compositePath);

  // Also produce a buffer for the AI call
  const compositeBuffer = fs.readFileSync(compositePath);
  console.log(`  [Composite] ✓ Raw composite saved (${(compositeBuffer.length / 1024).toFixed(0)} KB)`);

  return { compositePath, compositeBuffer };
}


// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 2 — blendWithNanoBanana()
// Sends the composite to google/nano-banana-pro via Replicate so the
// model blends lighting, shadows, and textures into a seamless 2.5D Najdi
// architectural visualisation.
//
// The image_input parameter pins the model to the composite layout.
// We match the aspect ratio to prevent hallucinating new structures.
//
// Fallback: If the AI call fails, we return the raw composite so the user
// at least receives a usable result.
// ═══════════════════════════════════════════════════════════════════════════════
async function blendWithNanoBanana(jobDir, compositeBuffer, mapWidth, mapHeight) {
  const blendedPath = path.join(jobDir, 'district_2.5d_final.webp');

  try {
    // Save the composite to disk so Replicate can fetch it via public URL
    // (avoids huge base64 payloads that the model can't preview/process reliably)
    const compositePng = path.join(jobDir, 'composite_for_blend.png');
    fs.writeFileSync(compositePng, compositeBuffer);
    const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const publicRoot = path.join(__dirname, '../../public');
    const relativePath = path.relative(publicRoot, compositePng).replace(/\\/g, '/');
    const compositeUrl = `${APP_BASE_URL}/${relativePath}`;

    // Determine a reasonable aspect ratio from the map dimensions
    const aspectRatio = computeAspectRatioLabel(mapWidth, mapHeight);

    console.log(`  [Blend] Calling ${BLEND_MODEL} (aspect=${aspectRatio})...`);

    const output = await replicate.run(BLEND_MODEL, {
      input: {
        prompt:          BLEND_PROMPT,
        image_input:     [compositeUrl],
        aspect_ratio:    aspectRatio,
        resolution:      '1K',
        output_format:   'png',
      },
    });

    // Replicate may return a string URL or an array
    const resultUrl = String(Array.isArray(output) ? output[0] : output);
    if (!resultUrl.startsWith('http')) {
      throw new Error(`Unexpected nano-banana-pro output: ${resultUrl.substring(0, 80)}`);
    }

    await downloadFile(resultUrl, blendedPath);
    console.log(`  [Blend] ✓ AI-blended image saved`);
    return { path: blendedPath, usedFallback: false };

  } catch (err) {
    // ── FALLBACK: save raw composite as the final output ──────────────────
    console.warn(`  [Blend] ✗ AI blending failed (${err.message}). Falling back to raw composite.`);
    await sharp(compositeBuffer).webp({ quality: 95 }).toFile(blendedPath);
    return { path: blendedPath, usedFallback: true };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Helper: pick the closest standard aspect_ratio label for nano-banana-pro
// ═══════════════════════════════════════════════════════════════════════════════
function computeAspectRatioLabel(w, h) {
  // Prefer match_input_image so the model preserves layout exactly
  // The API schema lists it as a valid option
  if (w && h) return 'match_input_image';

  // Fallback table (shouldn't normally be reached)
  const ratios = [
    { label: '1:1',  r: 1 },
    { label: '4:5',  r: 4 / 5 },
    { label: '5:4',  r: 5 / 4 },
    { label: '3:2',  r: 3 / 2 },
    { label: '2:3',  r: 2 / 3 },
    { label: '16:9', r: 16 / 9 },
    { label: '9:16', r: 9 / 16 },
    { label: '21:9', r: 21 / 9 },
    { label: '9:21', r: 9 / 21 },
  ];
  const target = w / h;
  let best = ratios[0];
  for (const r of ratios) {
    if (Math.abs(r.r - target) < Math.abs(best.r - target)) best = r;
  }
  return best.label;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Orchestrator: Run the full 2-stage pipeline
//   Stage 1 → Asset retrieval + sharp compositing
//   Stage 2 → AI visual blending (nano-banana-pro) with fallback
// ═══════════════════════════════════════════════════════════════════════════════
async function runPipeline(jobId, baseMapPath, spots, districtName) {
  const jobDir = path.join(OUTPUTS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const stages   = { compositing: 'pending', blending: 'pending' };
  const warnings = [];
  const outputs  = {};

  // Convenience DB updater — silent on failure
  const updateJob = async (status) => {
    if (!Job) return;
    try {
      await Job.updateOne({ jobId }, {
        $set: {
          status,
          metadata: { baseMap: { filePath: baseMapPath }, spots, districtName, stages },
        },
      });
    } catch {}
  };

  try {
    // Read base map dimensions for validation context
    const mapMeta = await sharp(baseMapPath).metadata();
    const mapWidth  = mapMeta.width;
    const mapHeight = mapMeta.height;

    // ── Stage 1: Sharp Compositing ──────────────────────────────────────────
    stages.compositing = 'processing';
    await updateJob('processing');
    console.log(`[Pipeline/${jobId}] Stage 1/2: Compositing (${spots.length} spots)...`);

    const { compositePath, compositeBuffer } = await compositeImages(jobDir, baseMapPath, spots);
    outputs.rawComposite = `/outputs/${jobId}/composite_raw.png`;
    stages.compositing   = 'done';

    // ── Stage 2: AI Blending (nano-banana-pro) ──────────────────────────────
    stages.blending = 'processing';
    await updateJob('processing');
    console.log(`[Pipeline/${jobId}] Stage 2/2: AI Blending (${BLEND_MODEL})...`);

    const blendResult = await blendWithNanoBanana(jobDir, compositeBuffer, mapWidth, mapHeight);
    outputs.final     = `/outputs/${jobId}/district_2.5d_final.webp`;
    stages.blending   = blendResult.usedFallback ? 'fallback' : 'done';
    if (blendResult.usedFallback) {
      warnings.push('AI blending failed — raw composite saved as final output (fallback).');
    }

    // ── Finalize: metadata.json + DB update ─────────────────────────────────
    const outputFiles = [
      { label: 'Raw Composite',  url: outputs.rawComposite,  ext: 'png',  stage: 'compositing' },
      { label: 'Final 2.5D Map', url: outputs.final,         ext: 'webp', stage: 'blending' },
    ];

    const metaPath = path.join(jobDir, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      service: 3,
      serviceName: SERVICE_NAME,
      districtName: districtName || '',
      spotsCount: spots.length,
      buildings: spots.map(s => ({ jobId: s.jobId, viewType: s.viewType || 'aerial' })),
      processedAt: new Date().toISOString(),
      blendModel: BLEND_MODEL,
      prompt: BLEND_PROMPT,
      mapDimensions: { width: mapWidth, height: mapHeight },
      stages,
      outputFiles,
      warnings,
    }, null, 2));

    if (Job) {
      try {
        await Job.updateOne({ jobId }, {
          $set: {
            status: 'done',
            outputFiles,
            metadata: {
              baseMap: { filePath: baseMapPath, width: mapWidth, height: mapHeight },
              spots, districtName, stages, warnings,
            },
            completedAt: new Date(),
          },
        });
      } catch {}
    }

    console.log(`[Pipeline/${jobId}] ✓ Complete — final: ${path.basename(blendResult.path)}`);

    return {
      jobId,
      status: 'done',
      districtName,
      stages,
      outputs,
      warnings,
    };

  } catch (err) {
    console.error(`[Pipeline/${jobId}] ✗ FAILED: ${err.message}`);

    // If compositing succeeded but something else broke, save the raw composite as fallback
    const rawPath = path.join(jobDir, 'composite_raw.png');
    if (fs.existsSync(rawPath) && !fs.existsSync(path.join(jobDir, 'district_2.5d_final.webp'))) {
      try {
        await sharp(rawPath).webp({ quality: 95 }).toFile(path.join(jobDir, 'district_2.5d_final.webp'));
        console.log(`[Pipeline/${jobId}] ⚠ Saved raw composite as fallback final output`);
      } catch {}
    }

    if (Job) {
      try {
        await Job.updateOne({ jobId }, {
          $set: { status: 'failed', error: `Pipeline failed: ${err.message}` },
        });
      } catch {}
    }
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Scan /public/outputs for S1/S2 building assets (for catalog UI)
// ═══════════════════════════════════════════════════════════════════════════════
function scanBuildingAssets() {
  const assets = [];
  const jobDirs = fs.readdirSync(OUTPUTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const jobId of jobDirs) {
    const metaPath = path.join(OUTPUTS_DIR, jobId, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.service !== 1 && meta.service !== 2) continue;

      const jobDir = path.join(OUTPUTS_DIR, jobId);
      const files  = fs.readdirSync(jobDir).filter(f =>
        /\.(png|jpg|jpeg|tiff|webp)$/i.test(f),
      );
      if (files.length === 0) continue;

      const buildingName        = meta.buildingName || meta.districtName || 'مبنى غير مسمى';
      const architecturalStyle  = meta.archStyle || meta.architecturalStyle || meta.style || '';
      const views               = [];

      const viewMap = meta.service === 2
        ? {
            aerial: 'Aerial View', street: 'Street View',
            comparison: 'Historical Comparison', vision: 'Restoration Vision',
            corner: 'Corner Perspective', plaza: 'Pedestrian Plaza',
            night: 'Night Atmosphere', facade: 'Facade Detail',
          }
        : { restored: 'Restored Image', upscaled: 'Upscaled Image' };

      for (const [key, label] of Object.entries(viewMap)) {
        const match = files.find(f => {
          const base = path.basename(f, path.extname(f)).toLowerCase();
          return base === key || base.endsWith('_' + key);
        });
        if (match) {
          views.push({
            key, label,
            imagePath: `/outputs/${jobId}/${match}`,
            isDefault: key === 'aerial' || (meta.service === 1 && key === 'upscaled'),
          });
        }
      }

      // If no named views matched, add all images generically
      if (views.length === 0) {
        for (const file of files) {
          const base = path.basename(file, path.extname(file));
          views.push({
            key: base.replace(/[^a-zA-Z0-9]/g, '_'),
            label: base,
            imagePath: `/outputs/${jobId}/${file}`,
            isDefault: views.length === 0,
          });
        }
      }

      const validViews   = views.filter(v => fs.existsSync(path.join(__dirname, '../../public', v.imagePath)));
      if (validViews.length === 0) continue;
      const defaultView  = validViews.find(v => v.isDefault) || validViews[0];

      assets.push({
        sourceService: meta.service,
        sourceJobId: jobId,
        buildingName,
        architecturalStyle,
        views: validViews,
        thumbnail: defaultView.imagePath,
      });
    } catch { /* skip malformed metadata */ }
  }
  return assets;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  R O U T E S
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /discover-assets ────────────────────────────────────────────────────
// Returns all S1/S2 building assets available for placement.
router.post('/discover-assets', (req, res) => {
  try {
    const assets = scanBuildingAssets();
    if (assets.length === 0) {
      return res.status(404).json({
        error: 'No building assets found. Complete at least one Service 1 or 2 job first.',
      });
    }
    return res.json({ assets, totalAssets: assets.length });
  } catch (err) {
    console.error('[S3/discover-assets]', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// ─── POST /compose ────────────────────────────────────────────────────────────
// Accepts: baseMap (file), districtName (string), spots (JSON string)
// Spots shape: [{ x, y, width, height, jobId, viewType }]
// Returns immediately with jobId; pipeline runs in background.
router.post('/compose', upload.single('baseMap'), async (req, res) => {
  try {
    // ── Validate baseMap upload ──────────────────────────────────────────────
    if (!req.file) return res.status(400).json({ error: 'baseMap file is required' });

    const districtName = (req.body.districtName || '').trim().replace(/<[^>]*>/g, '').slice(0, 200);
    if (!districtName) return res.status(400).json({ error: 'districtName is required' });

    // ── Parse spots JSON ────────────────────────────────────────────────────
    let spots;
    try { spots = JSON.parse(req.body.spots); }
    catch { return res.status(400).json({ error: 'spots must be valid JSON' }); }

    // ── Read map dimensions for bounds-checking ─────────────────────────────
    const baseMapPath = req.file.path;
    const mapMeta     = await sharp(baseMapPath).metadata();
    const mapWidth    = mapMeta.width;
    const mapHeight   = mapMeta.height;

    const validation = validateSpots(spots, mapWidth, mapHeight);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    // ── Prepare job directory ───────────────────────────────────────────────
    const jobId  = uuidv4();
    const jobDir = path.join(OUTPUTS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Copy base map into job dir for persistence / recompose
    const jobBaseMapPath = path.join(jobDir, `basemap${path.extname(req.file.originalname)}`);
    fs.copyFileSync(baseMapPath, jobBaseMapPath);

    // ── Create Job document ─────────────────────────────────────────────────
    if (Job) {
      try {
        await Job.create({
          jobId,
          service: 3,
          status: 'pending',
          inputFiles: [{
            originalName: req.file.originalname,
            storedPath: baseMapPath,
            sizeBytes: req.file.size,
          }],
          metadata: {
            baseMap: { originalName: req.file.originalname, filePath: jobBaseMapPath, width: mapWidth, height: mapHeight },
            spots,
            districtName,
          },
        });
      } catch {}
    }

    console.log(`\n[S3/compose] ${jobId} | "${districtName}" | ${spots.length} spots | ${mapWidth}x${mapHeight}`);

    // Respond immediately — pipeline runs in background
    res.json({ jobId, status: 'pending', districtName });

    // ── Kick off pipeline asynchronously ────────────────────────────────────
    setImmediate(async () => {
      try {
        await runPipeline(jobId, jobBaseMapPath, spots, districtName);
      } catch (err) {
        console.error(`[S3/compose] ${jobId} failed: ${err.message}`);
      }
    });
  } catch (err) {
    console.error('[S3/compose]', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// ─── GET /job/:jobId ──────────────────────────────────────────────────────────
// Returns current job status, pipeline stage progress, and output URLs.
router.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    let job = null;
    if (Job) { try { job = await Job.findOne({ jobId }); } catch {} }

    const buildResponse = (status, meta, createdAt) => {
      const jobDir = path.join(OUTPUTS_DIR, jobId);
      const files  = fs.existsSync(jobDir) ? fs.readdirSync(jobDir) : [];
      return {
        jobId,
        status,
        districtName: meta.districtName || '',
        spotsCount:   (meta.spots || []).length,
        stages:       meta.stages || meta.pipelineStages || {},
        outputs: {
          rawComposite: files.includes('composite_raw.png')
            ? `/outputs/${jobId}/composite_raw.png` : null,
          final: files.includes('district_2.5d_final.webp')
            ? `/outputs/${jobId}/district_2.5d_final.webp`
            : files.includes('composite_raw.png')
              ? `/outputs/${jobId}/composite_raw.png`
              : null,
        },
        warnings: meta.warnings || [],
        createdAt: createdAt || '',
      };
    };

    if (job) {
      return res.json(buildResponse(job.status, job.metadata || {}, job.createdAt?.toISOString()));
    }

    // Fallback: read from disk metadata
    const metaPath = path.join(OUTPUTS_DIR, jobId, 'metadata.json');
    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return res.json(buildResponse('done', meta, meta.processedAt || ''));
  } catch (err) {
    console.error('[S3/job]', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// ─── POST /recompose/:jobId ──────────────────────────────────────────────────
// Re-runs the pipeline on an existing job with modified spots.
router.post('/recompose/:jobId', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { jobId } = req.params;
    const spots     = req.body.spots;

    if (!Array.isArray(spots) || spots.length === 0) {
      return res.status(400).json({ error: 'spots array is required' });
    }

    // ── Retrieve existing job data ──────────────────────────────────────────
    let existingMeta = null;
    let job = null;
    if (Job) { try { job = await Job.findOne({ jobId }); } catch {} }

    if (job) {
      existingMeta = job.metadata || {};
    } else {
      const metaPath = path.join(OUTPUTS_DIR, jobId, 'metadata.json');
      if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ error: 'Job not found' });
      }
      existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }

    const baseMapPath = existingMeta.baseMap?.filePath;
    if (!baseMapPath || !fs.existsSync(baseMapPath)) {
      return res.status(400).json({ error: 'Original base map not found. Cannot re-compose.' });
    }

    const mapMeta   = await sharp(baseMapPath).metadata();
    const validation = validateSpots(spots, mapMeta.width, mapMeta.height);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    const districtName = existingMeta.districtName || '';

    if (Job && job) {
      try {
        await Job.updateOne({ jobId }, {
          $set: { status: 'pending', error: null, metadata: { ...existingMeta, spots } },
        });
      } catch {}
    }

    console.log(`\n[S3/recompose] ${jobId} | ${spots.length} spots`);
    res.json({ jobId, status: 'pending', districtName });

    setImmediate(async () => {
      try {
        await runPipeline(jobId, baseMapPath, spots, districtName);
      } catch (err) {
        console.error(`[S3/recompose] ${jobId} failed: ${err.message}`);
      }
    });
  } catch (err) {
    console.error('[S3/recompose]', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// ─── GET /previous-outputs ────────────────────────────────────────────────────
// Browse completed S1 & S2 job results (backward compat for catalog UI).
router.get('/previous-outputs', (req, res) => {
  try {
    const serviceFilter = parseInt(req.query.service) || null;
    const jobs = [];
    const jobDirs = fs.readdirSync(OUTPUTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const jobId of jobDirs) {
      const metaFile = path.join(OUTPUTS_DIR, jobId, 'metadata.json');
      if (!fs.existsSync(metaFile)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        if (!meta.service) continue;
        if (serviceFilter && meta.service !== serviceFilter) continue;
        if (meta.service !== 1 && meta.service !== 2) continue;

        const jobDir = path.join(OUTPUTS_DIR, jobId);
        const files  = fs.readdirSync(jobDir).filter(f =>
          /\.(png|jpg|tiff|glb|obj|fbx|stl|pdf)$/i.test(f),
        );

        jobs.push({
          jobId,
          service: meta.service,
          model: meta.model || '',
          processedAt: meta.processedAt || '',
          originalNames: (meta.images || []).map(i => i.originalName || i.name || '').filter(Boolean),
          images: files.filter(f => /\.(png|jpg|tiff)$/i.test(f)).map(f => ({
            name: f,
            url: `/outputs/${jobId}/${f}`,
            sizeKB: Math.round(fs.statSync(path.join(jobDir, f)).size / 1024),
          })),
          models: files.filter(f => /\.(glb|obj|fbx|stl)$/i.test(f)).map(f => ({
            name: f,
            url: `/outputs/${jobId}/${f}`,
            sizeKB: Math.round(fs.statSync(path.join(jobDir, f)).size / 1024),
          })),
          totalFiles: files.length,
        });
      } catch { /* skip malformed */ }
    }

    jobs.sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));
    return res.json({ success: true, jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


module.exports = router;
