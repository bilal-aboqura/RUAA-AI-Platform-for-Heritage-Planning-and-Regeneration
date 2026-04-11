# Tasks: 2.5D District Map Generator

**Input**: Design documents from `/specs/001-2-5d-district-map/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted. Verification via manual API testing and browser UI.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the new service3.js and create the frontend HTML shell

- [X] T001 Strip existing GIS/KML logic from `src/routes/service3.js` and replace with a clean Express Router skeleton preserving the existing module pattern (imports, multer config, UPLOADS_DIR, OUTPUTS_DIR, Job model loading, Replicate client init, `downloadFile()` helper, and `module.exports = router`)
- [X] T002 [P] Create `public/service3.html` with the base HTML structure following the existing page pattern (Tailwind CSS, Cairo font, RTL layout, dark theme, glassmorphism cards) — include empty sections for: map upload area, canvas editor area, building catalog panel, spot assignment list, progress display, and results viewer
- [X] T003 [P] Define service-level constants in `src/routes/service3.js`: `SERVICE_03_NAME`, `SERVICE_03_DEFINITION`, allowed image extensions set, Replicate model identifiers (`RMBG_MODEL = 'briaai/rmbg-1.4'`, `BLEND_MODEL = 'google/nano-banana-2'`, `EDGE_MODEL = 'black-forest-labs/flux-canny-pro'`), and `MAX_SPOTS = 15`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core utility functions and validation logic that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Implement `validateSpots(spots, mapWidth, mapHeight)` function in `src/routes/service3.js` — validates the spots JSON array: each spot must have `spotNumber` (unique, 1–15), `boundingBox` (`{x, y, width, height}` — non-negative integers, within map dimensions), `sourceJobId` (string), `sourceService` (1 or 2), `selectedView` (string). Returns `{ valid: boolean, errors: string[] }`
- [X] T005 [P] Implement `downloadFile(url, destPath)` utility function in `src/routes/service3.js` — download a file from a URL (http/https) and save to `destPath`. Follow the existing pattern from service1.js/service2.js using `https.get`/`http.get` with stream piping. Handle redirects and errors gracefully
- [X] T006 [P] Implement `resolveAssetImagePath(sourceJobId, sourceService, selectedView)` function in `src/routes/service3.js` — given a job ID, service number, and view key, resolve the absolute filesystem path to the actual image file in `/public/outputs/{sourceJobId}/`. Validate the file exists. Return `{ imagePath, error }`. For Service 2 jobs, map view keys (`aerial`, `street`, `facade`, etc.) to actual filenames. For Service 1, map `restored`/`upscaled` to actual filenames
- [X] T007 [P] Implement `generateEdgeMap(inputImagePath, outputEdgePath)` function in `src/routes/service3.js` — use Sharp to extract Canny-style edges from an image: load image → convert to greyscale → apply Sobel convolution kernel via `sharp.convolve()` → normalize → apply threshold → save as PNG. This produces the structural edge map used by the edge-control model

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 5 — Automatic Building Discovery (Priority: P2, but prerequisite for US1 UI) 🎯 MVP Foundation

**Goal**: Scan `/public/outputs/` for completed Service 1/2 jobs and return a structured catalog of available building assets with views and thumbnails

**Independent Test**: Complete 2 jobs in Service 1 or 2, hit `POST /api/service3/discover-assets`, verify both appear in the response with correct metadata, views, and thumbnails

> **Note**: Moved before US1 because the building catalog is required for the US1 frontend to display assignable assets

### Implementation for User Story 5

- [X] T008 [US5] Implement `scanBuildingAssets()` function in `src/routes/service3.js` — read all subdirectories in OUTPUTS_DIR, load `metadata.json` from each, filter for `service === 1` or `service === 2`, extract `buildingName`, `architecturalStyle`, list available image files with view key labels (for Service 2: map filenames to `aerial`/`street`/`facade`/`night`/etc.; for Service 1: `restored`/`upscaled`), mark the default view (`aerial` for S2, `upscaled` for S1), validate that image files exist on disk, return structured catalog array per the contracts/api.md schema
- [X] T009 [US5] Implement `POST /discover-assets` endpoint in `src/routes/service3.js` — call `scanBuildingAssets()`, return `{ assets, totalAssets }` if found, or 404 with descriptive message if no assets exist. No file upload needed for this endpoint

**Checkpoint**: Asset discovery works — UI can now fetch and display the building catalog

---

## Phase 4: User Story 1 — Upload Base Map and Assign Building Assets (Priority: P1) 🎯 MVP

**Goal**: User uploads a base map image, draws numbered bounding rectangles on a canvas, assigns building assets from the catalog to each spot, and previews the assignments

**Independent Test**: Upload a sample base map, draw 3 bounding rectangles, assign 3 buildings from the catalog, confirm the preview shows buildings positioned at the correct spots with correct labels

### Implementation for User Story 1

- [X] T010 [US1] Implement the map upload section in `public/service3.html` — file input accepting JPEG/PNG/TIFF/WebP (max 100MB), district name text input (RTL), upload button. On upload, display the image in a `<canvas>` element scaled to fit the editor area while tracking the scale factor for coordinate mapping
- [X] T011 [US1] Implement the canvas drawing interaction in `public/service3.html` — mousedown/mousemove/mouseup event handlers on the canvas. User clicks and drags to draw a rectangle (shown with a dashed border and auto-numbered label). Store each spot as `{ spotNumber, boundingBox: {x, y, width, height} }` in a JavaScript array. Support deleting a spot by clicking its number label. Render all spots with semi-transparent fill and white numbered labels
- [X] T012 [US1] Implement the building catalog panel in `public/service3.html` — on page load, fetch `POST /api/service3/discover-assets`. Display each asset as a card showing: thumbnail, building name, style, source service badge. When user clicks a catalog card and then clicks a spot on the canvas, assign that building to that spot. Show view selector dropdown (defaulting to aerial) when multiple views are available
- [X] T013 [US1] Implement the spot assignment list panel in `public/service3.html` — display a table/list showing all spots: spot number, bounding box dimensions, assigned building name (or "unassigned"), thumbnail preview, selected view, and a change/remove button. Clicking "change" re-opens the catalog selection for that spot. Ensure the canvas preview updates immediately when assignments change
- [X] T014 [US1] Implement the assignment preview overlay on the canvas in `public/service3.html` — when a building is assigned to a spot, load the building's thumbnail image and render it inside the bounding rectangle on the canvas at reduced opacity (0.6) with the building name label below. This gives the user a visual confirmation of what the final composition will look like before submitting
- [X] T015 [US1] Implement the `POST /api/service3/compose` endpoint scaffolding in `src/routes/service3.js` — multer single file upload for `baseMap` field, parse `districtName` and `spots` (JSON string) from the request body, call `validateSpots()`, get base map dimensions via `sharp(baseMapPath).metadata()`, check resolution warning (< 1500×1500), create a Job record with status `pending` and metadata containing `baseMap`, `spots`, and `districtName`. Return the `jobId` immediately (processing continues in background via `setImmediate` or similar)
- [X] T016 [US1] Wire the "Submit for Processing" button in `public/service3.html` — collect all spot assignments, serialize as JSON, create FormData with `baseMap` file + `districtName` + `spots`, POST to `/api/service3/compose`, display the returned `jobId` and switch UI to the progress/results view

**Checkpoint**: User can upload a map, draw spots, assign buildings, preview, and submit — the compose endpoint accepts the request and creates a Job

---

## Phase 5: User Story 2 — Automated Composition and AI Blending (Priority: P1)

**Goal**: The compose pipeline receives the validated input, removes building backgrounds, composites them onto the base map using Sharp, and sends the composite through AI blending to unify lighting and style

**Independent Test**: Submit a base map with 2 assigned buildings, verify the pipeline produces `composite_raw.png` and `composite_blended.png` in the outputs directory with visually integrated buildings

### Implementation for User Story 2

- [X] T017 [US2] Implement `removeBackground(imagePath, outputPath)` function in `src/routes/service3.js` — convert the building image to a base64 data URI, call `replicate.run('briaai/rmbg-1.4', { input: { image } })`, download the result (transparent PNG), save to `outputPath`. Handle errors gracefully (if removal fails, copy the original image as fallback)
- [X] T018 [US2] Implement the composition stage in `src/routes/service3.js` — within the compose pipeline (triggered after T015 creates the job): update job status to `compositing`. For each spot: call `resolveAssetImagePath()` to get the building image → call `removeBackground()` to get a transparent cutout → use `sharp(cutoutPath).resize(spot.boundingBox.width, spot.boundingBox.height, { fit: 'contain', background: { r:0, g:0, b:0, alpha:0 } })` to scale the cutout → build a `composite` array with `{ input: resizedBuffer, left: spot.boundingBox.x, top: spot.boundingBox.y }`. Finally, call `sharp(baseMapPath).composite(compositeArray).png().toFile(rawCompositePath)`. Save as `composite_raw.png` in the job output directory
- [X] T019 [US2] Implement the AI blending stage in `src/routes/service3.js` — update job status to `blending`. Convert `composite_raw.png` to a base64 data URI. Call `replicate.run(BLEND_MODEL, { input: { image, prompt: '<2.5D architectural blending prompt>', prompt_strength: 0.35, ... } })`. The prompt should instruct: "Unify the lighting, shadow direction, color temperature, and perspective of all buildings with the base map to create a seamless professional 2.5D heritage district visualization. Preserve building positions exactly." Download the result and save as `composite_blended.png`
- [X] T020 [US2] Implement the progress display in `public/service3.html` — after submitting the compose request, poll `GET /api/service3/job/:jobId` every 3 seconds. Display a multi-step progress indicator showing the current pipeline stage: compositing → blending → edge-control → complete. Show stage-specific status text and a spinner/animation for the active stage. Stop polling when status is `done` or `failed`

**Checkpoint**: Full pipeline produces a blended composite — buildings are visually integrated into the base map

---

## Phase 6: User Story 3 — Edge-Control Refinement and Final Output (Priority: P1)

**Goal**: Apply Canny edge-control model to preserve geometric boundaries, save the final 2.5D output with metadata, and make it discoverable by Service 5

**Independent Test**: Run the full pipeline, compare building outlines in the final output vs. source assets — edges should be sharp and geometrically consistent. Verify the output appears in downstream service discovery

### Implementation for User Story 3

- [X] T021 [US3] Implement the edge-control stage in `src/routes/service3.js` — update job status to `edge-control`. Call `generateEdgeMap(rawCompositePath, edgesPath)` to extract edges. Convert `composite_blended.png` and `edges.png` to base64 data URIs. Call `replicate.run(EDGE_MODEL, { input: { control_image: edgesDataUri, image: blendedDataUri, prompt: 'Preserve architectural edges, building outlines, rooflines, and geometric boundaries exactly. Maintain the unified lighting and seamless 2.5D district style.', ... } })`. Download result and save as `district_2.5d_final.png`. Wrap the entire edge-control call in a try-catch: on failure, copy `composite_blended.png` as the final output and add a warning to the job
- [X] T022 [US3] Implement `writeMetadataJson(jobId, jobData)` function in `src/routes/service3.js` — writes `metadata.json` to the job output directory with fields: `service: 3`, `serviceName`, `districtName`, `spotsCount`, `buildings` array, `processedAt`, `pipelineStages` object, `outputFiles` array (with label, URL, extension, stage for each intermediate and final file), and `version` number. This makes the output discoverable by Service 5 and Service 6
- [X] T023 [US3] Implement the final Job update and response in `src/routes/service3.js` — after all pipeline stages complete: update the Job status to `done`, set `outputFile` to the final image path, save metadata via `writeMetadataJson()`. Ensure the final response (or polled status) includes all output URLs (`rawComposite`, `blended`, `final`), `pipelineStages`, and any `warnings`
- [X] T024 [US3] Implement `GET /job/:jobId` endpoint in `src/routes/service3.js` — load the Job from MongoDB by ID, return status, pipeline stages, output URLs, warnings, version, and timestamps per the contracts/api.md schema. Return 404 if job not found
- [X] T025 [US3] Implement the results viewer in `public/service3.html` — when the pipeline completes (status = `done`), display: the final 2.5D output image (large, zoomable), download button, side-by-side comparison toggle (raw composite vs. blended vs. final), pipeline stage badges showing which stages completed or were skipped, and any warning messages

**Checkpoint**: Full pipeline produces a polished 2.5D output with edge-controlled geometry, metadata for downstream discovery, and a complete results viewer

---

## Phase 7: User Story 4 — Review and Re-process (Priority: P2)

**Goal**: Allow users to modify building assignments and re-run the pipeline without re-uploading the base map, preserving previous versions

**Independent Test**: Complete a full pipeline run, change one building assignment, re-run, verify the new output reflects the change and the previous version is preserved

### Implementation for User Story 4

- [X] T026 [US4] Implement `POST /recompose/:jobId` endpoint in `src/routes/service3.js` — load the existing Job, validate the new `spots` array against the stored base map dimensions, increment the `version` number, create a new output subdirectory or version-suffixed filenames, re-run the full pipeline (background removal → composite → blend → edge control) with the original base map and new spot assignments. Update the Job record with new outputs while preserving previous version outputs. Return the same response schema as `/compose`
- [X] T027 [US4] Implement the re-process UI flow in `public/service3.html` — after viewing results, add a "Modify & Re-process" button that returns the user to the canvas editor with the existing base map and current spot assignments pre-loaded. The user can modify, add, or remove spots, change building assignments, then re-submit. The UI sends to `/recompose/:jobId` instead of `/compose`. Show version history with links to previous outputs

**Checkpoint**: Users can iterate on their compositions without starting from scratch

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, UX refinement, and performance improvements across all stories

- [X] T028 [P] Add comprehensive error handling to all Replicate API calls in `src/routes/service3.js` — wrap each `replicate.run()` call with try-catch, implement timeout handling (5 min per AI call), log errors with stage context, update Job status to `failed` with error details on unrecoverable failures
- [X] T029 [P] Add base map resolution validation and warning UI in `public/service3.html` — after upload, check dimensions via canvas. If below 1500×1500, show a prominent warning banner in Arabic recommending a higher-resolution map but allow the user to proceed
- [X] T030 [P] Add canvas interaction polish in `public/service3.html` — implement rectangle resize handles (drag corners to resize), snap-to-grid (optional), minimum rectangle size enforcement (50×50px), keyboard shortcuts (Delete to remove selected spot, Escape to cancel drawing), and touch event support for tablet use
- [X] T031 Update the services navigation in `public/services.html` and `public/index.html` to reflect the new Service 3 name and description: "2.5D District Map Generator" replacing "Geospatial Analysis & Urban Fabric Restoration"
- [X] T032 [P] Add input sanitization for `districtName` field in `src/routes/service3.js` — trim whitespace, limit to 200 characters, strip any HTML/script tags. Add the same sanitization in the frontend before submission
- [ ] T033 Run the full pipeline end-to-end per `specs/001-2-5d-district-map/quickstart.md` — verify all 4 endpoints work, all 3 pipeline stages execute, metadata.json is written correctly, and the final output is viewable

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on T001 (service skeleton) — BLOCKS all user stories
- **US5 (Phase 3)**: Depends on Phase 2 completion — must complete before US1 (provides building catalog)
- **US1 (Phase 4)**: Depends on Phase 3 (needs catalog) — BLOCKS US2 (provides compose endpoint + frontend)
- **US2 (Phase 5)**: Depends on US1 (needs compose endpoint scaffolding from T015)
- **US3 (Phase 6)**: Depends on US2 (needs blended composite as input)
- **US4 (Phase 7)**: Depends on US3 (needs full pipeline to iterate on)
- **Polish (Phase 8)**: Can start after Phase 6 (core pipeline complete)

### User Story Dependencies

```
Phase 1 (Setup) → Phase 2 (Foundation) → Phase 3 (US5: Discovery)
                                              ↓
                                         Phase 4 (US1: Upload & Assign)
                                              ↓
                                         Phase 5 (US2: Compose & Blend)
                                              ↓
                                         Phase 6 (US3: Edge Control & Output)
                                              ↓
                                    ┌─────────┴─────────┐
                              Phase 7 (US4)        Phase 8 (Polish)
                              (Re-process)         (can start here)
```

### Within Each User Story

- Backend logic before frontend integration
- Core functions before endpoint handlers
- Endpoint handlers before UI wiring
- Each story adds an independently verifiable increment

### Parallel Opportunities

- T002 and T003 can run in parallel with each other (different files)
- T004, T005, T006, T007 can all run in parallel (independent functions)
- T028, T029, T030, T032 can all run in parallel (independent polish tasks)
- T010, T011, T012, T013, T014 can be parallelized in pairs across frontend sections

---

## Parallel Example: Phase 2 (Foundation)

```text
# All foundation tasks can run in parallel (independent functions, same file but no conflicts):
T004: validateSpots() function
T005: downloadFile() function
T006: resolveAssetImagePath() function
T007: generateEdgeMap() function
```

## Parallel Example: Phase 4 (US1)

```text
# Frontend canvas + catalog can be built in parallel:
Group A (Canvas): T010 (upload) → T011 (drawing)
Group B (Catalog): T012 (catalog panel) → T013 (assignment list)
Then: T014 (preview overlay combines both), T015 (backend), T016 (wire submit)
```

---

## Implementation Strategy

### MVP First (Phase 1 → 2 → 3 → 4 → 5 → 6)

1. Complete Phase 1: Setup (skeleton + HTML shell)
2. Complete Phase 2: Foundation (utility functions)
3. Complete Phase 3: US5 — Asset Discovery (catalog endpoint)
4. Complete Phase 4: US1 — Upload & Assign (canvas editor + compose endpoint)
5. Complete Phase 5: US2 — Compose & Blend (background removal + composition + blending)
6. Complete Phase 6: US3 — Edge Control & Final Output (edge preservation + metadata)
7. **STOP and VALIDATE**: Test full pipeline end-to-end
8. Deploy/demo if ready

### Incremental Delivery

1. After Phase 3: Discovery endpoint works → verify catalog loads
2. After Phase 4: Upload + assign works → verify spots and preview render
3. After Phase 5: Composition pipeline works → verify blended output quality
4. After Phase 6: Full pipeline works → verify final 2.5D output + metadata
5. After Phase 7: Re-processing works → verify iteration flow
6. After Phase 8: Polish complete → production-ready

---

## Notes

- [P] tasks = different files or independent functions, no dependencies
- [Story] label maps task to specific user story for traceability
- US5 is moved before US1 because the discovery catalog is a prerequisite for the assignment UI
- All AI model calls go through the existing Replicate npm package — no new dependencies
- The pipeline within `/compose` runs in background after returning the jobId (async processing)
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
