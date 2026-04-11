# API Contracts: 2.5D District Map Generator

**Branch**: `001-2-5d-district-map` | **Date**: 2026-04-08  
**Base URL**: `/api/service3`

---

## POST `/api/service3/discover-assets`

Discover available building assets from completed Service 1 and Service 2 jobs.

**Request**: No body required.

**Response** (200):
```json
{
  "assets": [
    {
      "sourceService": 2,
      "sourceJobId": "abc-123-def",
      "buildingName": "قصر سمحان",
      "architecturalStyle": "نجدي",
      "views": [
        { "key": "aerial", "label": "Aerial View", "imagePath": "/outputs/abc-123-def/aerial.png", "isDefault": true },
        { "key": "street", "label": "Street View", "imagePath": "/outputs/abc-123-def/street.png", "isDefault": false }
      ],
      "thumbnail": "/outputs/abc-123-def/aerial.png"
    }
  ],
  "totalAssets": 5
}
```

**Error** (404):
```json
{ "error": "No building assets found. Complete at least one job in Service 1 or Service 2 first." }
```

---

## POST `/api/service3/compose`

Execute the full 2.5D composition pipeline.

**Request**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseMap` | File | Yes | Base map image (JPEG, PNG, TIFF, WebP; max 100MB) |
| `districtName` | String | Yes | Name of the heritage district |
| `spots` | JSON String | Yes | Array of spot assignments (see below) |

**`spots` JSON schema**:
```json
[
  {
    "spotNumber": 1,
    "boundingBox": { "x": 100, "y": 200, "width": 300, "height": 250 },
    "sourceJobId": "abc-123-def",
    "sourceService": 2,
    "selectedView": "aerial"
  },
  {
    "spotNumber": 2,
    "boundingBox": { "x": 500, "y": 350, "width": 280, "height": 220 },
    "sourceJobId": "xyz-456-ghi",
    "sourceService": 1,
    "selectedView": "restored"
  }
]
```

**Response** (200 — pipeline complete):
```json
{
  "jobId": "job-789-xyz",
  "status": "done",
  "districtName": "حي سمحان",
  "pipelineStages": {
    "compositing": "done",
    "blending": "done",
    "edgeControl": "done"
  },
  "outputs": {
    "rawComposite": "/outputs/job-789-xyz/composite_raw.png",
    "blended": "/outputs/job-789-xyz/composite_blended.png",
    "final": "/outputs/job-789-xyz/district_2.5d_final.png"
  },
  "warnings": [],
  "version": 1
}
```

**Response** (200 — pipeline with edge-control fallback):
```json
{
  "jobId": "job-789-xyz",
  "status": "done",
  "pipelineStages": {
    "compositing": "done",
    "blending": "done",
    "edgeControl": "skipped"
  },
  "outputs": {
    "rawComposite": "/outputs/job-789-xyz/composite_raw.png",
    "blended": "/outputs/job-789-xyz/composite_blended.png",
    "final": "/outputs/job-789-xyz/composite_blended.png"
  },
  "warnings": ["Edge-control step was skipped due to a processing error. The blended image has been used as the final output."]
}
```

**Error** (400):
```json
{ "error": "Validation failed", "details": ["spots[0].boundingBox exceeds base map dimensions", "spots[2].sourceJobId not found"] }
```

**Error** (500):
```json
{ "error": "Pipeline failed at compositing stage", "fallback": null }
```

---

## GET `/api/service3/job/:jobId`

Get the status and outputs of a composition job.

**Response** (200):
```json
{
  "jobId": "job-789-xyz",
  "status": "done",
  "districtName": "حي سمحان",
  "spotsCount": 3,
  "pipelineStages": { "compositing": "done", "blending": "done", "edgeControl": "done" },
  "outputs": {
    "rawComposite": "/outputs/job-789-xyz/composite_raw.png",
    "blended": "/outputs/job-789-xyz/composite_blended.png",
    "final": "/outputs/job-789-xyz/district_2.5d_final.png"
  },
  "version": 1,
  "createdAt": "2026-04-08T12:00:00Z"
}
```

---

## POST `/api/service3/recompose/:jobId`

Re-run the pipeline with modified spot assignments, preserving the base map.

**Request**: `application/json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `spots` | Array | Yes | Updated array of spot assignments (same schema as compose) |

**Response**: Same as `POST /compose`, with incremented `version` number.
