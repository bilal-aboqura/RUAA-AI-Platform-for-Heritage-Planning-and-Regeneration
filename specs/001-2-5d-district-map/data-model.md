# Data Model: 2.5D District Map Generator

**Branch**: `001-2-5d-district-map` | **Date**: 2026-04-08

## Entities

### 1. Composition Job

Extends the existing `Job` Mongoose model (service number = 3).

| Field | Type | Description |
|-------|------|-------------|
| `service` | Number | Always `3` |
| `status` | String | `pending` → `compositing` → `blending` → `edge-control` → `done` \| `failed` |
| `inputFile` | String | Path to the uploaded base map image |
| `outputFile` | String | Path to the final 2.5D output image |
| `metadata` | Mixed | Contains `spots`, `baseMap`, `districtName`, timestamps, version info |

**State Transitions**:

```
pending → compositing → blending → edge-control → done
                 ↓            ↓              ↓
              failed       failed          failed (fallback to blended)
```

### 2. Base Map

Stored as part of `metadata` in the Job document. Not a separate collection.

| Field | Type | Description |
|-------|------|-------------|
| `originalName` | String | Original filename of uploaded map |
| `filePath` | String | Path in `/public/uploads/` |
| `width` | Number | Image width in pixels |
| `height` | Number | Image height in pixels |
| `districtName` | String | User-provided district name |

### 3. Location Spot

Array within `metadata.spots`. Each spot represents one building placement.

| Field | Type | Description |
|-------|------|-------------|
| `spotNumber` | Number | Sequential spot identifier (1, 2, 3...) |
| `boundingBox` | Object | `{ x, y, width, height }` — pixel coordinates on the base map |
| `buildingAsset` | Object | Reference to the assigned building (see below) |

### 4. Building Asset Reference

Nested within each Location Spot.

| Field | Type | Description |
|-------|------|-------------|
| `sourceService` | Number | `1` or `2` |
| `sourceJobId` | String | UUID of the source job directory |
| `buildingName` | String | Name from source job metadata |
| `architecturalStyle` | String | Style from source job metadata |
| `selectedView` | String | View type key (e.g., `aerial`, `street`, `facade`) — defaults to `aerial` |
| `imagePath` | String | Absolute path to the selected image file |

### 5. Output Metadata (metadata.json)

Written to `/public/outputs/{jobId}/metadata.json` for downstream service discovery.

| Field | Type | Description |
|-------|------|-------------|
| `service` | Number | `3` |
| `serviceName` | String | `"2.5D District Map Generator"` |
| `districtName` | String | User-provided district name |
| `spotsCount` | Number | Number of building spots placed |
| `buildings` | Array | `[{ name, style, sourceService, sourceJobId }]` |
| `processedAt` | String | ISO 8601 timestamp |
| `pipelineStages` | Object | `{ compositing: "done", blending: "done", edgeControl: "done"|"skipped" }` |
| `outputFiles` | Array | `[{ label, url, ext, stage }]` — all intermediate and final outputs |
| `version` | Number | Version number (increments on re-processing) |

## Relationships

```
Composition Job (1) ──contains──> Base Map (1)
Composition Job (1) ──contains──> Location Spots (1..15)
Location Spot (1) ──references──> Building Asset from Service 1/2 Job (1)
Composition Job (1) ──produces──> Output Files (1..N)
```

## Validation Rules

- `spots` array: minimum 1 spot, maximum 15 spots per job
- `boundingBox`: all values must be non-negative integers; `x + width ≤ baseMap.width`; `y + height ≤ baseMap.height`
- `buildingAsset.imagePath`: file must exist on disk at the referenced path
- `baseMap` image: minimum recommended resolution 1500×1500px (warning below, not blocking)
- `spotNumber`: must be unique within the spots array
- `selectedView`: must match an available view file in the source job's output directory
