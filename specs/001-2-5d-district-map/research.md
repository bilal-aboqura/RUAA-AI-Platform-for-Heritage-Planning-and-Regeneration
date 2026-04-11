# Research: 2.5D District Map Generator

**Branch**: `001-2-5d-district-map` | **Date**: 2026-04-08

## R-001: Background Removal Model via Replicate

**Decision**: Use `briaai/rmbg-1.4` via Replicate API for automated background removal.

**Rationale**: This is a lightweight, purpose-built background removal model available through the existing Replicate integration. It produces clean alpha-masked cutouts in a single API call, with no additional dependencies required. The existing `replicate` npm package and `REPLICATE_API_TOKEN` environment variable are already configured across all services.

**Alternatives considered**:
- `rembg` (Python library) — Would require a separate Python process or microservice, adding deployment complexity to the Node.js monolith.
- Manual masking via Sharp — Sharp can do basic threshold-based masking but cannot intelligently separate a building from its environment (sky, ground, neighboring structures). Not suitable for architectural images.
- Client-side masking — Shifts burden to the user and degrades UX.

## R-002: Image Composition with Sharp

**Decision**: Use the existing `sharp` library for all image composition operations (resize, composite/overlay, format conversion).

**Rationale**: Sharp is already a core dependency (`^0.33.5`) used across Services 1–6 for image processing. It supports `composite()` with positioning (`left`, `top`), resizing with aspect ratio preservation (`fit: 'contain'`), and PNG alpha channel handling — exactly what's needed to overlay transparent building cutouts onto a base map.

**Alternatives considered**:
- Canvas/node-canvas — Adds a heavy native dependency (Cairo). Unnecessary when Sharp handles the required operations.
- ImageMagick via `child_process` — External binary dependency, harder to manage in deployment. Sharp is faster for the specific operations needed.

## R-003: AI Blending Model

**Decision**: Use `google/nano-banana-2` in image-to-image mode for visual blending (lighting, shadows, style unification).

**Rationale**: This model is already the primary image generation model used across Services 1, 2, 5, and 6. It supports image-to-image mode where a source image is provided with a text prompt describing the desired transformation. The prompt will instruct the model to unify lighting, shadow direction, and 2.5D architectural perspective while preserving building placement. Using `prompt_strength` of 0.3–0.4 ensures the composition structure is preserved while allowing style harmonization.

**Alternatives considered**:
- Dedicated style transfer models — Narrower scope, may introduce unwanted artistic stylization. Nano-banana's prompt-guided approach gives more control.
- `openai/gpt-4o` for guided editing — Text-only model, cannot perform pixel-level image blending.

## R-004: Edge-Control Model

**Decision**: Use `black-forest-labs/flux-canny-pro` for edge preservation as the final refinement step.

**Rationale**: This model is already used in Service 2 for edge-guided image generation. It takes a Canny edge map as a structural control signal, ensuring generated output preserves geometric boundaries. The workflow: extract Canny edges from the raw composite (pre-blending) → pass edges + blended image to Flux Canny Pro → output preserves the original building outlines and map structure. Graceful fallback: if this step fails, the blended image from the previous step is returned with a warning flag.

**Alternatives considered**:
- ControlNet with depth maps — More complex setup, depth extraction from 2D images is unreliable for architectural heritage content.
- Post-processing edge sharpening via Sharp — Cannot selectively preserve structural edges vs. texture detail. Too naive for architectural geometry preservation.

## R-005: Canny Edge Extraction

**Decision**: Use Sharp's built-in convolution capabilities or a simple Sobel/Canny implementation for extracting edge maps from the raw composite.

**Rationale**: Sharp can perform basic edge detection using `convolve()` with a Laplacian or Sobel kernel, followed by `threshold()`. For Canny-specific edge detection, a lightweight helper function can be implemented (Gaussian blur → gradient magnitude → non-maximum suppression → hysteresis threshold) using Sharp's pipeline. This avoids adding OpenCV or other heavy native dependencies.

**Alternatives considered**:
- OpenCV via `opencv4nodejs` — Heavy native dependency, complex build requirements on Windows. Overkill for edge extraction alone.
- Send to Replicate for edge extraction — Adds latency and API cost for a deterministic operation that should be local.

## R-006: Previous Job Discovery Pattern

**Decision**: Scan the `/public/outputs/` directory for subdirectories containing `metadata.json` files, filter for Service 1 and Service 2 jobs, extract building name, style, thumbnail path, and available view images.

**Rationale**: This follows the exact pattern established in Services 5 and 6, which already scan the outputs directory to discover previous job artifacts. Each job directory contains a `metadata.json` file with `service`, `buildingName`, `style`, and `outputFiles` fields. The new Service 3 will read these metadata files to build the building asset catalog.

**Alternatives considered**:
- MongoDB Job query — The Job model stores minimal metadata (service number, status, input/output paths). The filesystem-based metadata.json files contain the richer data needed for catalog display.
- Hardcoded paths — Not scalable, breaks when new jobs are added.

## R-007: Frontend Bounding Box Interaction

**Decision**: Implement a canvas-based overlay on the uploaded base map image where users can click-and-drag to draw numbered bounding rectangles. Each rectangle becomes a "spot" that can be assigned a building asset from the catalog.

**Rationale**: HTML5 Canvas provides the necessary mouse/touch event handling for drawing rectangles, displaying numbers, and rendering previews. It works within the existing static HTML + vanilla JS frontend architecture without requiring a framework. The canvas overlay sits on top of the displayed base map image.

**Alternatives considered**:
- SVG-based overlay — More complex DOM manipulation for drag interactions. Canvas is simpler for pixel-level drawing operations.
- Third-party libraries (Fabric.js, Konva.js) — Would add new dependencies. The interaction requirements (draw rectangles, display numbers, show thumbnails) are simple enough for vanilla Canvas.
