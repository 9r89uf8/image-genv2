# Girl Environment Context Plan

## Goals
- Keep each girl's bedroom, bathroom, and phone visually consistent across generations.
- Let artists attach either an image reference or a short descriptive snippet for each item.
- Make the composer UX fast: a single click should add the correct assets to the job and keep reference ordering obvious for Gemini prompts.

## Assumptions & Open Questions
- We can raise the current 3-reference cap (otherwise there is no room for both subject + environment). Target 5–6 total refs unless SRAM/latency proves prohibitive.
- All per-girl environment assets should stay private to that girl; shared library continues to surface only generic items.
- When both image and text exist for an item, we prefer to send the image and still append the descriptive text to the prompt.
- Need confirmation on which environments to support first (bedroom, bathroom, phone are v1; living room / car etc. may follow).
- Migration: existing girl docs currently have `refImageIds` only. We can backfill the new structure with empty placeholders.

## Phase 1 – Data Model & Storage
- Add `contextAssets` to each `girls/{girlId}` document: `{ bedroom: { imageId, notes, promptHint }, bathroom: {...}, phone: {...} }`.
- Store environment images in the `library` collection with new metadata fields: `category: "context"`, `contextType: "bedroom" | "bathroom" | "phone"`, `ownerId: girlId`.
- Extend upload flow so context assets land under the same Storage bucket path (`library/{imageId}`) and remain eligible for Gemini file re-upload.
- Backfill: write a one-off script (can live in `/scripts`) that iterates girls and sets `contextAssets` to an object with empty entries if missing.

## Phase 2 – API Surface
- `GET /api/girls`: include `contextAssets` in the payload; keep shape stable for existing consumers.
- `PATCH /api/girls/:id`: validate and persist partial updates to `contextAssets`, ensuring only allowed keys are stored and every asset references an image owned by the girl.
- New routes for asset management:
  - `POST /api/girls/:id/context-assets` to upload/link a context image, returning updated asset metadata.
  - `DELETE /api/girls/:id/context-assets/:type` to remove an image or clear descriptions.
- Reuse existing `/api/upload` where possible; only add minimal glue logic to tag uploads as context assets.

## Phase 3 – Girl Management UI
- Update `components/GirlsGrid` (or dedicated girl detail drawer) with a "Context Assets" section showing bedroom, bathroom, phone cards.
- Each card should allow:
  - Previewing the current image (if any) and viewing its text description.
  - Uploading a new image (reusing `UploadButton`) or selecting from owned library items filtered by `contextType`.
  - Editing the text description / prompt hint.
  - Clearing the asset.
- Persist changes via the new API endpoints and reflect optimistic UI feedback.

## Phase 4 – Composer Enhancements
- Load `contextAssets` when a girl is selected; keep them in composer state.
- Introduce a dedicated `composer.contextSelections` state capturing which assets are active and whether the user wants the image, text, or both.
- Surface a "Context" row in `JobComposer` with toggles for bedroom, bathroom, phone:
  - Clicking a toggle adds the asset's image to the ordered reference list (unless text-only mode is chosen).
  - Show the resulting order explicitly (e.g., badges "1st", "2nd", …) so users know which reference is which.
- Update limit logic:
  - Replace the global `3` hardcode with a `MAX_REFERENCES` constant (e.g., 6).
  - Adjust `store/useComposer` helpers (`setImageIds`, `toggleImageId`, `addRefUrl`) to respect the new limit and include context assets seamlessly.
- When building the prompt, automatically append structured snippets for selected contexts, e.g., `"Use the bedroom from reference image 3 (light grey walls, skylight)..."`.
- Ensure the submit payload keeps the reference order deterministic: subject refs first, then context (or allow drag-and-drop reorder if necessary).

## Phase 5 – Job Execution & Storage
- No Gemini integration changes required: `fileRefs` already accept any number of images. Just ensure the new limit keeps payload size reasonable.
- Update job documents to record which context assets were used (`inputs.contextSelections`) so reruns can restore the same setup.
- Optionally enhance generated job result metadata with context info for auditing/debugging.

## Phase 6 – Testing & Verification
- Unit tests: add coverage for the updated composer store (new limit handling, context selection logic).
- Integration/manual:
  - Create a girl, upload bedroom/bathroom/phone assets, then generate jobs using each combination.
  - Verify Gemini receives images in the promised order (inspect job document and debug logs).
  - Confirm context assets remain hidden from other girls and from the shared library view.
- Regression check: ensure existing flows (three-image jobs, editing jobs, chat mode) still work.

