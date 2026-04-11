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

const Job = (() => {
  try { return require('../models/Job'); }
  catch { return null; }
})();

// ─── Constants ────────────────────────────────────────────────────────────────
const SERVICE_NAME        = '2.5D District Map Generator';
const RMBG_MODEL          = 'cjwbw/rembg';
const BLEND_MODEL         = 'google/nano-banana-2';
const EDGE_MODEL          = 'black-forest-labs/flux-canny-pro';
const MAX_SPOTS           = 15;
const MIN_SPOT_DIMENSION  = 50;
const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;

const BLEND_PROMPT = [
  'True isometric 45-degree angle projection of a Najdi architectural heritage district.',
  'Buildings only. Traditional mud-brick structures with flat roofs, wooden doors,',
  'and highly detailed entrances perfectly matching the exact spatial layout of the',
  'underlying reference map. Isolated on a solid dark gray background (RGB 50, 50, 50).',
  'High resolution, seamless realistic lighting, soft architectural shadows,',
  'professional 2.5D rendering.',
].join(' ');

const BLEND_NEGATIVE_PROMPT = [
  'european, medieval, modern, futuristic, low poly, untextured, plastic, generic 3d,',
  'ground, streets, sky, terrain, white background, out of frame, perspective distortion,',
  'non-isometric, different architecture.',
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

  for (const ext of extPriority) {
    const direct = path.join(jobDir, view + ext);
    if (fs.existsSync(direct)) return { imagePath: direct, error: null };
  }

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

  if (files.length > 0) {
    const fallback = files.find(f => path.extname(f).toLowerCase() === '.png') || files[0];
    return { imagePath: path.join(jobDir, fallback), error: null };
  }

  return { imagePath: null, error: `No image found for view "${view}" in job ${jobId}` };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Async Helper: Remove background via Replicate (briaai/rmbg-1.4)
//   Falls back to original image on failure.
// ═══════════════════════════════════════════════════════════════════════════════
async function removeBackground(imagePath, outputPath) {
  try {
    const buffer = fs.readFileSync(imagePath);
    const ext    = path.extname(imagePath).slice(1).toLowerCase();
    const mime   = ext === 'png' ? 'image/png' : 'image/jpeg';
    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;

    console.log(`  [RMBG] Removing background: ${path.basename(imagePath)}`);
    const output    = await replicate.run(RMBG_MODEL, { input: { image: dataUri } });
    const resultUrl = String(Array.isArray(output) ? output[0] : output);
    if (!resultUrl.startsWith('http')) throw new Error('Invalid RMBG output URL');

    await downloadFile(resultUrl, outputPath);
    console.log(`  [RMBG] ✓ Saved: ${path.basename(outputPath)}`);
    return { success: true };
  } catch (err) {
    console.warn(`  [RMBG] ✗ Failed (${err.message}). Using original image.`);
    try {
      fs.copyFileSync(imagePath, outputPath);
    } catch {
      await sharp(imagePath).png().toFile(outputPath);
    }
    return { success: false, fallback: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Async Helper: Composite all building cutouts onto the base map via sharp
//   Returns the path to the raw composite PNG.
// ═══════════════════════════════════════════════════════════════════════════════
async function compositeBuildings(jobDir, baseMapPath, spots) {
  const composites = [];

  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    console.log(`  [Composite] Spot ${i + 1}/${spots.length} — job ${spot.jobId}, view ${spot.viewType || 'aerial'}`);

    const { imagePath, error } = resolveAssetImage(spot.jobId, spot.viewType || 'aerial');
    if (error) throw new Error(`Spot ${i + 1}: ${error}`);

    const cutoutPath = path.join(jobDir, `spot_${i + 1}_cutout.png`);
    const rmbg = await removeBackground(imagePath, cutoutPath);

    const resized = await sharp(cutoutPath)
      .resize(Math.round(spot.width), Math.round(spot.height), {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    composites.push({
      input: resized,
      left:  Math.round(spot.x),
      top:   Math.round(spot.y),
    });
  }

  const rawPath = path.join(jobDir, 'composite_raw.png');
  await sharp(baseMapPath)
    .composite(composites)
    .png()
    .toFile(rawPath);

  console.log(`  [Composite] ✓ Raw composite saved`);
  return rawPath;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Async Helper: AI Blending via google/nano-banana-2
//   Nano Banana 2 API schema: prompt (required), image_input (array of URIs),
//   aspect_ratio, resolution, output_format. No prompt_strength or negative_prompt.
//   The prompt instructs the model to render a Najdi heritage 2.5D district while
//   using the composite as the primary visual reference via image_input.
// ═══════════════════════════════════════════════════════════════════════════════
async function blendWithAI(jobDir, rawCompositePath) {
  const blendedPath = path.join(jobDir, 'composite_blended.png');

  try {
    const buffer   = fs.readFileSync(rawCompositePath);
    const dataUri  = `data:image/png;base64,${buffer.toString('base64')}`;

    console.log(`  [Blend] Calling ${BLEND_MODEL}...`);
    const output    = await replicate.run(BLEND_MODEL, {
      input: {
        prompt:       BLEND_PROMPT,
        image_input:  [dataUri],
        aspect_ratio: 'match_input_image',
        resolution:   '2K',
        output_format: 'png',
      },
    });

    const resultUrl = String(Array.isArray(output) ? output[0] : output);
    if (!resultUrl.startsWith('http')) throw new Error('Invalid blend output URL');

    await downloadFile(resultUrl, blendedPath);
    console.log(`  [Blend] ✓ Blended image saved`);
    return { path: blendedPath, usedFallback: false };
  } catch (err) {
    console.warn(`  [Blend] ✗ Failed (${err.message}). Using raw composite.`);
    fs.copyFileSync(rawCompositePath, blendedPath);
    return { path: blendedPath, usedFallback: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Async Helper: Edge Control via black-forest-labs/flux-canny-pro
//   Generates an edge map from the raw composite, then passes the blended
//   image through canny-controlled generation to enforce geometric structure.
//   Gracefully falls back to the blended image on any error.
// ═══════════════════════════════════════════════════════════════════════════════
async function enforceEdges(jobDir, rawCompositePath, blendedImagePath) {
  const finalPath = path.join(jobDir, 'district_2.5d.png');

  try {
    const edgesPath = path.join(jobDir, 'edges.png');
    await sharp(rawCompositePath)
      .grayscale()
      .convolve({
        width:  3, height: 3,
        kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1],
      })
      .convolve({
        width:  3, height: 3,
        kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1],
      })
      .normalize()
      .threshold(128)
      .png()
      .toFile(edgesPath);

    const edgesDataUri   = `data:image/png;base64,${fs.readFileSync(edgesPath).toString('base64')}`;
    const blendedDataUri = `data:image/png;base64,${fs.readFileSync(blendedImagePath).toString('base64')}`;

    console.log(`  [Edge] Calling ${EDGE_MODEL}...`);
    const output    = await replicate.run(EDGE_MODEL, {
      input: {
        control_image:       edgesDataUri,
        image:               blendedDataUri,
        prompt:              'Preserve architectural edges, building outlines, rooflines, and geometric boundaries exactly. Maintain the unified lighting and seamless 2.5D district style.',
        num_inference_steps: 50,
        guidance_scale:      7.5,
      },
    });

    const resultUrl = String(Array.isArray(output) ? output[0] : output);
    if (!resultUrl.startsWith('http')) throw new Error('Invalid edge control output URL');

    await downloadFile(resultUrl, finalPath);
    console.log(`  [Edge] ✓ Final edge-controlled output saved`);
    return { path: finalPath, usedFallback: false };
  } catch (err) {
    console.warn(`  [Edge] ✗ Failed (${err.message}). Using blended image as final.`);
    fs.copyFileSync(blendedImagePath, finalPath);
    return { path: finalPath, usedFallback: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Orchestrator: Run the full 3-stage pipeline
//   Stage 1 → Asset retrieval + background removal + sharp compositing
//   Stage 2 → AI visual blending (Nano Banana 2)
//   Stage 3 → Edge control (Flux Canny Pro) — graceful fallback
// ═══════════════════════════════════════════════════════════════════════════════
async function runPipeline(jobId, baseMapPath, spots, districtName) {
  const jobDir = path.join(OUTPUTS_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const stages   = { compositing: 'pending', blending: 'pending', edgeControl: 'pending' };
  const warnings = [];
  const outputs  = {};

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
    // ── Stage 1: Compositing ────────────────────────────────────────────────
    stages.compositing = 'processing';
    await updateJob('processing');
    console.log(`[Pipeline/${jobId}] Stage 1/3: Compositing (${spots.length} spots)...`);

    const rawCompositePath = await compositeBuildings(jobDir, baseMapPath, spots);
    outputs.rawComposite = `/outputs/${jobId}/composite_raw.png`;
    stages.compositing   = 'done';

    // ── Stage 2: AI Blending ────────────────────────────────────────────────
    stages.blending = 'processing';
    await updateJob('processing');
    console.log(`[Pipeline/${jobId}] Stage 2/3: AI Blending (${BLEND_MODEL})...`);

    const blendResult = await blendWithAI(jobDir, rawCompositePath);
    outputs.blended   = `/outputs/${jobId}/composite_blended.png`;
    stages.blending   = blendResult.usedFallback ? 'skipped' : 'done';
    if (blendResult.usedFallback) {
      warnings.push('AI blending failed — raw composite used as fallback.');
    }

    // ── Stage 3: Edge Control ───────────────────────────────────────────────
    stages.edgeControl = 'processing';
    await updateJob('processing');
    console.log(`[Pipeline/${jobId}] Stage 3/3: Edge Control (${EDGE_MODEL})...`);

    const edgeResult = await enforceEdges(jobDir, rawCompositePath, blendResult.path);
    outputs.final    = `/outputs/${jobId}/district_2.5d.png`;
    stages.edgeControl = edgeResult.usedFallback ? 'skipped' : 'done';
    if (edgeResult.usedFallback) {
      warnings.push('Edge control failed — blended image used as final output.');
    }

    // ── Finalize ────────────────────────────────────────────────────────────
    const outputFiles = [
      { label: 'Raw Composite',  url: outputs.rawComposite, ext: 'png', stage: 'compositing' },
      { label: 'Blended Image',  url: outputs.blended,      ext: 'png', stage: 'blending' },
      { label: 'Final 2.5D Map', url: outputs.final,        ext: 'png', stage: 'edge-control' },
    ];

    const metaPath = path.join(jobDir, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      service: 3,
      serviceName: SERVICE_NAME,
      districtName: districtName || '',
      spotsCount: spots.length,
      buildings: spots.map(s => ({ jobId: s.jobId, viewType: s.viewType || 'aerial' })),
      processedAt: new Date().toISOString(),
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
              baseMap: { filePath: baseMapPath },
              spots, districtName, stages, warnings,
            },
            completedAt: new Date(),
          },
        });
      } catch {}
    }

    console.log(`[Pipeline/${jobId}] ✓ Complete — final: ${path.basename(edgeResult.path)}`);

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
    if (!req.file) return res.status(400).json({ error: 'baseMap file is required' });

    const districtName = (req.body.districtName || '').trim().replace(/<[^>]*>/g, '').slice(0, 200);
    if (!districtName) return res.status(400).json({ error: 'districtName is required' });

    let spots;
    try { spots = JSON.parse(req.body.spots); }
    catch { return res.status(400).json({ error: 'spots must be valid JSON' }); }

    const baseMapPath = req.file.path;
    const mapMeta     = await sharp(baseMapPath).metadata();
    const mapWidth    = mapMeta.width;
    const mapHeight   = mapMeta.height;

    const validation = validateSpots(spots, mapWidth, mapHeight);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    const jobId  = uuidv4();
    const jobDir = path.join(OUTPUTS_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const jobBaseMapPath = path.join(jobDir, `basemap${path.extname(req.file.originalname)}`);
    fs.copyFileSync(baseMapPath, jobBaseMapPath);

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
    res.json({ jobId, status: 'pending', districtName });

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
          rawComposite: files.includes('composite_raw.png') ? `/outputs/${jobId}/composite_raw.png` : null,
          blended:      files.includes('composite_blended.png') ? `/outputs/${jobId}/composite_blended.png` : null,
          final:        files.includes('district_2.5d.png') ? `/outputs/${jobId}/district_2.5d.png`
                       : files.includes('composite_blended.png') ? `/outputs/${jobId}/composite_blended.png`
                       : null,
        },
        warnings: meta.warnings || [],
        createdAt: createdAt || '',
      };
    };

    if (job) {
      return res.json(buildResponse(job.status, job.metadata || {}, job.createdAt?.toISOString()));
    }

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
// Browse completed S1 & S2 job results (backward compat).
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
