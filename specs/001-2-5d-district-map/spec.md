# Feature Specification: 2.5D District Map Generator

**Feature Branch**: `001-2-5d-district-map`  
**Created**: 2026-04-08  
**Status**: Draft  
**Input**: User description: "Redesign Service 03: Geospatial Analysis into a visual-based 2.5D district map generator. The user uploads a base map image that contains specific numbered locations. The system must programmatically take previously generated building assets (from Service 1 and 2) and overlay them onto the corresponding numbered spots on the uploaded map. Once the raw composition is done, the system must use AI image-to-image processing to visually blend the buildings into the map, unifying the lighting, perspective, and style to create a seamless 2.5D output. Finally, an AI edge-control model must be applied to ensure the geometric boundaries of the map and buildings are strictly preserved without distortion. The final output is a polished 2.5D image ready to be used as an input for 3D modeling."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Upload Base Map and Assign Building Assets (Priority: P1)

A heritage researcher uploads a base map image of a historical district. The map contains clearly numbered location markers (e.g., "1", "2", "3") indicating where specific buildings exist. The system detects or accepts these numbered spots. The user then links each numbered spot to a previously generated building asset from Service 1 (restored images) or Service 2 (architectural visualizations). The system displays a preview of each assignment so the user can confirm the mapping before proceeding.

**Why this priority**: This is the foundational interaction — without accurate map upload and building-to-spot assignment, no downstream processing can occur. It is the core data entry point for the entire feature.

**Independent Test**: Can be fully tested by uploading a sample base map with 3 numbered spots, assigning 3 building images to those spots, and confirming the assignment preview renders correctly.

**Acceptance Scenarios**:

1. **Given** the user has completed processing for at least one building in Service 1 or Service 2, **When** the user navigates to Service 3 and uploads a base map image with numbered locations, **Then** the system accepts the upload and displays the map with its numbered spots visible.
2. **Given** a base map has been uploaded, **When** the user assigns a building asset from a prior service job to a numbered spot on the map, **Then** the system shows a visual preview of the building thumbnail positioned at that spot.
3. **Given** the user has assigned one or more buildings to map spots, **When** the user reviews the assignment list, **Then** each entry shows the spot number, the building name, and a thumbnail of the assigned asset.
4. **Given** the user has made an incorrect assignment, **When** the user changes the building linked to a spot, **Then** the preview updates to reflect the new assignment immediately.

---

### User Story 2 — Automated Composition and AI Blending (Priority: P1)

After confirming all building-to-spot assignments, the user initiates the composition process. The system programmatically overlays each building asset onto its corresponding numbered location on the base map, creating a raw composite image. The system then applies AI image-to-image processing to visually blend the inserted buildings into the map canvas, unifying lighting, perspective, color temperature, and stylistic tone to produce a seamless 2.5D district scene.

**Why this priority**: This is the core value proposition of the feature — the AI-driven visual transformation that converts a raw collage into a professional-grade 2.5D output. Without this, the feature provides no differentiation over manual image editing.

**Independent Test**: Can be tested by providing a base map with 2 assigned buildings, running the composition pipeline, and verifying the output image shows buildings visually integrated into the map with consistent lighting and perspective.

**Acceptance Scenarios**:

1. **Given** the user has assigned at least one building asset to a map spot, **When** the user initiates the composition process, **Then** the system generates a raw composite image with each building overlaid at its designated location.
2. **Given** a raw composite image has been created, **When** the AI blending step runs, **Then** the output image shows unified lighting, matched color temperature, and consistent shadow direction across the base map and all inserted buildings.
3. **Given** the AI blending is complete, **When** the user views the result, **Then** the boundaries between the original map and the inserted buildings are visually seamless with no obvious cut-out artifacts, color mismatches, or perspective inconsistencies.
4. **Given** the base map uses a warm golden-hour tone and the building asset was rendered with neutral daylight, **When** blending completes, **Then** the building adopts the same warm tone as the surrounding map context.

---

### User Story 3 — Edge-Control Refinement and Final Output (Priority: P1)

After the AI blending step, the system applies an edge-control model to the blended output. This step ensures that the geometric boundaries of both the base map and the individual buildings are strictly preserved — preventing warping, shape distortion, or loss of architectural detail that the blending step may have introduced. The final polished 2.5D image is saved as a high-resolution output, ready to be used as an input for Service 5 (3D Modeling).

**Why this priority**: Without edge control, the AI blending step may soften or distort critical architectural geometry, rendering the output unsuitable as a 3D modeling reference. This step is essential for downstream usability.

**Independent Test**: Can be tested by comparing the geometric outlines of buildings before and after the edge-control step — architectural edges, rooflines, and window openings must remain geometrically consistent with the source assets.

**Acceptance Scenarios**:

1. **Given** a blended 2.5D image has been produced, **When** the edge-control model is applied, **Then** the geometric boundaries of every building match those in the original source asset within acceptable tolerance (no visible warping or shape loss).
2. **Given** the edge-control step is complete, **When** the user views the final output, **Then** the image retains the seamless visual blending from the previous step while preserving sharp, accurate architectural edges.
3. **Given** the final 2.5D image is generated, **When** the user downloads or the system stores it, **Then** the output is saved at a resolution of at least 2048 pixels on the longest side and in a lossless or high-quality format suitable for 3D modeling input.
4. **Given** the final output is complete, **When** the user navigates to Service 5, **Then** the 2.5D output from Service 3 is available as a selectable input reference for 3D model generation.

---

### User Story 4 — Review and Re-process (Priority: P2)

After the final 2.5D output is generated, the user reviews the result. If the outcome is unsatisfactory (e.g., poor blending in a specific area, incorrect building placement), the user can adjust assignments and re-run the pipeline. The system preserves the base map and previous assignments so the user does not need to restart from scratch.

**Why this priority**: Iteration is essential for a creative tool — first-pass AI output may not always meet expectations. However, the core pipeline must work before iteration becomes meaningful.

**Independent Test**: Can be tested by completing a full pipeline run, then changing one building assignment and re-running, and verifying the updated output reflects the change without requiring a full re-upload.

**Acceptance Scenarios**:

1. **Given** a final 2.5D output has been generated, **When** the user modifies the building assignment for one spot and re-runs the pipeline, **Then** the system produces a new output reflecting the updated assignment while keeping all other assignments intact.
2. **Given** a re-processing request, **When** the pipeline runs again, **Then** the previous output is preserved as a version and the new output is saved alongside it.

---

### User Story 5 — Automatic Building Discovery from Previous Jobs (Priority: P2)

When the user opens Service 3, the system automatically scans for completed jobs from Service 1 and Service 2. It presents a catalog of available building assets organized by building name, architectural style, and service source. The user selects from this catalog when assigning buildings to map spots, rather than manually uploading building images.

**Why this priority**: This automates the cross-service integration and reduces manual effort, but the core pipeline can function with manual file selection if needed.

**Independent Test**: Can be tested by completing 2 jobs in Service 2, navigating to Service 3, and verifying both jobs appear in the available assets catalog with correct metadata.

**Acceptance Scenarios**:

1. **Given** the user has completed jobs in Service 1 and Service 2, **When** the user opens Service 3, **Then** all completed building assets are listed in a catalog with building name, style, and a thumbnail preview.
2. **Given** no prior service jobs exist, **When** the user opens Service 3, **Then** the system displays a clear message indicating that building assets must be generated in Service 1 or Service 2 first.

---

### Edge Cases

- What happens when the user uploads a base map with no pre-marked numbered locations? → This is the expected default flow; the user always manually clicks to place and number spots on the map.
- What happens when a numbered spot on the map has no building asset assigned? → The system skips unassigned spots during composition and notifies the user which spots were omitted.
- What happens when the uploaded base map is very low resolution? → The system warns the user that output quality may be degraded and recommends a minimum resolution (e.g., 1500×1500 pixels).
- What happens when a building asset image is significantly larger or smaller in scale than the map spot? → The system scales the building asset to fit within the user-drawn bounding rectangle while preserving aspect ratio; any remaining space within the rectangle is left transparent.
- What happens when the AI blending step fails or times out? → The system saves the raw composite image as a fallback output and notifies the user that blending could not be completed.
- What happens when the edge-control step fails after successful blending? → The system delivers the blended image as the final output with a warning that edge refinement was not applied; the output is still usable.
- What happens when the user has 15+ buildings to place on the map? → The system processes all assignments sequentially, with a progress indicator showing completion percentage.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a base map image upload in common image formats (JPEG, PNG, TIFF, WebP) with a maximum file size of 100 MB.
- **FR-002**: System MUST allow the user to manually place numbered location spots on the base map by clicking to set a position and then drawing a bounding rectangle to define the area each building will occupy. No AI-based marker detection is performed; the user defines all spots explicitly.
- **FR-003**: System MUST display a catalog of available building assets sourced from completed Service 1 and Service 2 jobs, showing building name, style, and thumbnail for each.
- **FR-003a**: When a building asset from a multi-output job is assigned to a spot, the system MUST default to the aerial/bird-eye view image but allow the user to select any other available view from that job's outputs.
- **FR-004**: System MUST allow the user to assign exactly one building asset to each numbered spot on the base map.
- **FR-005**: System MUST display a visual preview of each building-to-spot assignment overlaid on the base map before the user confirms and initiates processing.
- **FR-005a**: System MUST automatically remove the background from each building asset image before compositing it onto the base map, isolating the building structure from its original sky, ground, and surrounding context.
- **FR-006**: System MUST programmatically overlay each assigned building asset onto the corresponding spot's bounding rectangle on the base map, scaling the asset to fit within the rectangle while preserving aspect ratio.
- **FR-007**: System MUST apply AI image-to-image processing to the raw composite to unify lighting, color temperature, shadow direction, and stylistic tone, producing a visually seamless 2.5D scene.
- **FR-008**: System MUST apply an AI edge-control model to the blended image to preserve the geometric boundaries, edges, and architectural details of both the base map and all inserted buildings without distortion.
- **FR-009**: System MUST save the final polished 2.5D output at a minimum resolution of 2048 pixels on the longest side in a high-quality image format.
- **FR-010**: System MUST save the output with a job metadata record so it is discoverable by Service 5 (3D Modeling) as a selectable input reference.
- **FR-011**: System MUST allow the user to modify building assignments and re-run the pipeline without re-uploading the base map.
- **FR-012**: System MUST preserve previous outputs as versions when the user re-processes with updated assignments.
- **FR-013**: System MUST display a progress indicator during the composition and AI processing steps, reflecting the current stage (compositing → blending → edge control → complete).
- **FR-014**: System MUST gracefully handle failures at each pipeline stage: if AI blending fails, the raw composite image is saved as fallback output; if edge-control fails, the blended image is saved as the final output. In both cases, the user is notified which stage was skipped and why.
- **FR-015**: System MUST warn the user if the uploaded base map resolution is below the recommended minimum (1500×1500 pixels).

### Key Entities

- **Base Map**: An uploaded image of a heritage district that serves as the canvas for building placement. Contains or receives numbered location markers. Key attributes: image file, resolution, number of spots, district name.
- **Location Spot**: A numbered position on the base map where a building asset will be placed, defined by a user-drawn bounding rectangle. Key attributes: spot number, bounding rectangle coordinates (x, y, width, height), assigned building asset reference.
- **Building Asset**: A previously generated image output from Service 1 (restored image) or Service 2 (architectural visualization). When sourced from a multi-output job (e.g., Service 2 with 8 views), the aerial/bird-eye view is selected by default but the user may choose any available view. Key attributes: source service, source job ID, building name, architectural style, selected view type, image file path, thumbnail.
- **Composition Job**: A processing record that tracks the entire pipeline from base map upload through final output. Key attributes: job ID, status (pending/compositing/blending/edge-control/done/failed), base map reference, spot assignments, intermediate outputs, final output path.
- **2.5D Output**: The final polished image produced by the pipeline. Key attributes: resolution, file path, parent composition job, creation timestamp, version number.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete the full workflow — from base map upload to final 2.5D output — in under 10 minutes for a map with up to 6 buildings.
- **SC-002**: 90% of final 2.5D outputs are accepted by users without requiring re-processing (first-pass success rate).
- **SC-003**: Final output images maintain building edge fidelity — architectural outlines are preserved with no visible warping or shape loss compared to source assets.
- **SC-004**: The blended output shows no visible cut-out artifacts, color mismatches, or lighting inconsistencies when viewed at 100% zoom.
- **SC-005**: 100% of final 2.5D outputs are automatically discoverable by Service 5 (3D Modeling) as available input references.
- **SC-006**: The system handles maps with up to 15 buildings in a single composition without degradation in output quality or user experience.
- **SC-007**: The pipeline completes processing (all three stages) within 5 minutes for a map with 6 buildings under standard operating conditions.

## Assumptions

- Users have already completed at least one job in Service 1 or Service 2 before using this feature, so building assets exist in the system.
- Base map images uploaded by users contain a clear overhead or near-overhead perspective suitable for 2.5D composition (the system does not correct extreme perspective skew in the base map itself).
- Spot placement is always user-driven via click-to-place interaction; the system does not attempt to detect or read numbered markers from the base map image.
- Building assets from Service 1 and Service 2 include surrounding context (sky, ground, neighboring structures); the system is responsible for automatically isolating the building before composition — users are not expected to pre-crop or mask assets manually.
- The output 2.5D image is a single flat image (not an interactive or layered file), optimized as a visual reference for 3D modeling rather than a navigable 3D scene.
- The existing Service 3 geospatial analysis functionality (GIS parsing, KML, terrain analysis) is being replaced by this new feature, not extended alongside it.
- The system operates on a single machine with sufficient processing power for image composition; distributed computing is not assumed.
- The three-stage pipeline (composite → blend → edge control) runs sequentially, not in parallel.

## Clarifications

### Session 2026-04-08

- Q: Should the system auto-detect numbered markers on the base map or rely on manual spot placement? → A: Manual click-to-place only. The user explicitly clicks on the map to define and number each spot. No AI-based marker detection.
- Q: Which image should be used when a building job has multiple output views? → A: Default to the aerial/bird-eye view (best match for 2.5D overhead perspective), but allow the user to select any other view from the job's outputs.
- Q: How is the size/area for each building placement determined on the map? → A: The user draws a bounding rectangle for each spot on the map. The building asset is scaled to fit within that rectangle, preserving aspect ratio.
- Q: What happens if the edge-control step fails after blending succeeds? → A: The blended image is delivered as the final output with a warning that edge refinement was skipped. The user always receives a usable output.
- Q: Should the system auto-remove backgrounds from building assets before compositing? → A: Yes, fully automated. The system removes sky, ground, and surrounding context from each building asset before overlaying it onto the base map.
