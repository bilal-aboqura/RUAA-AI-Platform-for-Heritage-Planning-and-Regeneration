# Implementation Plan: 2.5D District Map Generator

**Branch**: `001-2-5d-district-map` | **Date**: 2026-04-08 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/001-2-5d-district-map/spec.md`

## Summary

Replace the existing Service 03 (Geospatial Analysis & Urban Fabric Restoration) with a new **2.5D District Map Generator** that allows users to upload a base map, manually place numbered bounding rectangles to mark building positions, assign building assets from Service 1/2 outputs, and run a three-stage AI pipeline (composition → blending → edge control) to produce a polished 2.5D district visualization. The implementation fits entirely within the existing Express.js monolith using existing dependencies (Sharp, Replicate, Multer, Mongoose).

## Technical Context

**Language/Version**: Node.js v18+ (CommonJS modules)  
**Primary Dependencies**: Express.js 5.1, Sharp 0.33, Replicate 1.0, Multer 1.4, Mongoose 8.14 (all existing)  
**Storage**: MongoDB via Mongoose (`Job` model) + filesystem (`/public/outputs/{jobId}/`)  
**Testing**: Manual API testing via curl + browser UI verification  
**Target Platform**: Windows (development), Linux server (production)  
**Project Type**: Web service (Express.js monolith)  
**Performance Goals**: Full pipeline completes in under 5 minutes for 6 buildings  
**Constraints**: No new heavy dependencies; must follow existing service architecture patterns  
**Scale/Scope**: Up to 15 buildings per composition; single concurrent user

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution is an unfilled template — no project-specific gates are defined. Proceeding without constitutional constraints. The implementation adheres to the existing codebase patterns (service-per-file, multer uploads, replicate API calls, Job model, filesystem outputs).

## Project Structure

### Documentation (this feature)

```text
specs/001-2-5d-district-map/
├── plan.md              # This file
├── spec.md              # Feature specification (complete)
├── research.md          # Phase 0 output (complete)
├── data-model.md        # Phase 1 output (complete)
├── quickstart.md        # Phase 1 output (complete)
├── contracts/
│   └── api.md           # API endpoint contracts (complete)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── routes/
│   └── service3.js          # [MODIFY] Replace core logic with 2.5D pipeline
├── models/
│   └── Job.js               # [UNCHANGED] Existing Job schema (service=3)
└── utils/
    ├── aiModels.js           # [UNCHANGED]
    ├── aiTextProviders.js    # [UNCHANGED]
    └── structuredJson.js     # [UNCHANGED]

public/
├── service3.html            # [NEW] Frontend UI with canvas-based map editor
├── uploads/                 # [UNCHANGED] Multer upload destination
└── outputs/                 # [UNCHANGED] Pipeline output storage
    └── {jobId}/
        ├── metadata.json        # Job metadata for downstream discovery
        ├── composite_raw.png    # Stage 1 output
        ├── composite_blended.png # Stage 2 output
        ├── district_2.5d_final.png # Stage 3 output (or blended fallback)
        └── edges.png            # Canny edge map (intermediate)
```

**Structure Decision**: Single-file service replacement following the existing monolithic pattern. All logic remains in `service3.js` consistent with services 1–6. One new HTML file for the frontend UI.

## Implementation Components

### Component 1: Backend Service Router (`service3.js`)

**What changes**: Complete replacement of the service3.js file's core logic — removing GIS/KML/SHP parsing and replacing with the 2.5D composition pipeline.

**Preserved patterns**:
- Express Router with multer upload middleware
- Replicate API integration via `new Replicate({ auth: ... })`
- Job model creation and status updates (`pending → processing → done/failed`)
- Output storage in `/public/outputs/{jobId}/`
- `metadata.json` generation for cross-service discovery
- `downloadFile()` helper for fetching Replicate outputs
- Error handling with try-catch around AI calls

**New endpoints**:
1. `POST /discover-assets` — Scan `/public/outputs/` for Service 1/2 jobs, return catalog
2. `POST /compose` — Full pipeline: upload base map → background removal → composite → blend → edge control
3. `GET /job/:jobId` — Job status and output URLs
4. `POST /recompose/:jobId` — Re-run with modified spots

**Pipeline stages** (all within `/compose`):
1. **Input validation**: Parse `spots` JSON, validate bounding boxes against map dimensions
2. **Background removal**: For each assigned building asset → call `briaai/rmbg-1.4` via Replicate → download transparent PNG
3. **Composition**: Use `sharp.composite()` to overlay each transparent building onto the base map at its bounding box coordinates
4. **AI Blending**: Send composite to `google/nano-banana-2` (image-to-image, prompt_strength ~0.35) with architectural blending prompt
5. **Edge extraction**: Generate Canny edges from the raw composite using Sharp convolution
6. **Edge control**: Send blended image + Canny edges to `black-forest-labs/flux-canny-pro` → final output
7. **Fallback**: If step 6 fails → use blended image from step 4 as final, set warning flag

### Component 2: Frontend UI (`service3.html`)

**What it does**: Canvas-based map editor where users:
1. Upload a base map image
2. Click-and-drag to draw numbered bounding rectangles
3. Assign building assets from a catalog (fetched via `/discover-assets`)
4. Select which view to use per building (defaults to aerial)
5. Preview assignments overlaid on the map
6. Submit for processing and view progress/results

**Design approach**: Static HTML + vanilla JS + Canvas API, consistent with existing `index.html`, `services.html`, `login.html` pages. Uses the existing Tailwind CSS design system (Cairo font, gold/dark palette, glassmorphism).

### Component 3: Asset Discovery Logic

**What it does**: Reads all subdirectories in `/public/outputs/`, loads `metadata.json` from each, filters for Service 1 (`service: 1`) and Service 2 (`service: 2`) entries, extracts building name, style, and available image files, and returns a structured catalog.

**Key logic**:
- For Service 2 jobs: list all 8 view images with view key labels, default to `aerial`
- For Service 1 jobs: list restored and upscaled images, default to upscaled
- Validate that referenced image files actually exist on disk

## AI Model Integration

| Stage | Model | Mode | Key Parameters |
|-------|-------|------|----------------|
| Background removal | `briaai/rmbg-1.4` | Image → Image (mask) | `input: { image }` |
| Visual blending | `google/nano-banana-2` | Image-to-image | `prompt_strength: 0.35`, architectural unity prompt |
| Edge control | `black-forest-labs/flux-canny-pro` | ControlNet (Canny) | `control_image: edges.png`, `prompt: preserve` |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AI blending alters building placement | Medium | High | Use low `prompt_strength` (0.3–0.4) to preserve composition structure |
| Edge-control step fails/times out | Medium | Medium | Graceful fallback to blended image with warning flag |
| Background removal fails for complex scenes | Low | Medium | Save raw composite as fallback; user can re-run with different view |
| Large maps (>10000px) cause memory issues | Low | Medium | Resize to max 4096px before processing; document resolution limits |
| Replicate API rate limits | Low | High | Sequential processing with delay between calls; existing retry patterns |
