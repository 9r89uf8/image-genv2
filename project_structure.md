Perfect—here’s a **clear, no‑frills project structure** for a **Next.js 15 (App Router) + Firebase + Tailwind** app.
It lists each route/folder and exactly what it’s responsible for. No code—just the map.

---

## 1) Top‑level layout (flat, minimal)

```
/ (repo root)
├─ app/                      # Next.js 15 App Router pages + API routes
│  ├─ (ui)/                  # (optional) grouping for UI pages (no deep nesting)
│  │  ├─ page.js             # "/" Dashboard: compose jobs, see queue, cost
│  │  ├─ girls/              # "/girls" manage girls and refs
│  │  │  └─ page.js
│  │  ├─ library/            # "/library" reference image grid + upload
│  │  │  └─ page.js
│  │  └─ chat/               # "/chat" optional chat canvas with "nanobanana"
│  │     └─ page.js
│  └─ api/                   # All server endpoints (acts as backend)
│     ├─ upload/route.js     # POST /api/upload (upload file to Firebase Storage)
│     ├─ jobs/
│     │  ├─ route.js         # GET list jobs, POST create job (enqueue)
│     │  └─ [id]/
│     │     ├─ route.js      # GET status/result, DELETE (cancel+delete)
│     │     └─ rerun/route.js# POST rerun successful job (prompt tweak optional)
│     ├─ girls/
│     │  ├─ route.js         # GET list girls, POST create girl
│     │  └─ [id]/route.js    # PATCH update girl (name, notes, primary refs)
│     ├─ library/
│     │  └─ route.js         # GET list library images (paginated, simple filters)
│     └─ costs/
│        └─ summary/route.js # GET cost summaries (today/7d/30d)
│
├─ components/               # Small, flat UI parts (no deep trees)
│  ├─ JobComposer.js         # Girl selector, refs chips, prompt, AR, toggles
│  ├─ JobQueueList.js        # PENDING/RUNNING/SUCCEEDED/FAILED list, actions
│  ├─ CostMeter.js           # Today/7d/30d estimations
│  ├─ GirlsGrid.js           # Grid + drawer to manage a girl + quick generate
│  ├─ LibraryGrid.js         # Reference image grid, select, tag, delete
│  ├─ UploadButton.js        # Wraps POST /api/upload
│  ├─ OutputGallery.js       # Thumbnails from recent jobs
│  └─ ChatPane.js            # Iterative chat UI (attach images, send prompts)
│
├─ store/                    # Zustand (UI-only state)
│  ├─ useComposer.js         # prompt, AR, imageOnly, chatMode, selections
│  └─ useQueueView.js        # local view of jobs (polls /api/jobs)
│
├─ lib/                      # Server-side helpers (used by API routes)
│  ├─ firebase-admin.js      # init Firestore + Storage (admin SDK)
│  ├─ gemini.js              # init @google/genai client; small helpers
│  ├─ files.js               # read bytes from Storage; upload to Gemini Files; cache
│  ├─ queue.js               # in-memory runner: pending[], running[], concurrency
│  ├─ job-executor.js        # core “run job” (generate/edit, save output, update DB)
│  ├─ costs.js               # estimate token usage -> $; daily/7d/30d rollups
│  ├─ db.js                  # tiny Firestore wrappers (get/set job/girl/library)
│  └─ constants.js           # model id, AR presets, token prices, limits
│
├─ styles/
│  └─ globals.css            # Tailwind base + app styles
│
├─ .env.local.example        # GOOGLE_API_KEY, Firebase creds, PUBLIC_URL base
├─ package.json
└─ README.md                 # brief run notes (localhost:3000)
```

---

## 2) Page routes and what they do

### `/` (Dashboard) — `app/(ui)/page.js`

* **Compose a job** (generate or edit):

    * Pick **Girl** (optional), pick **1–2 ref images** from Library chips.
    * Enter prompt; set **Aspect Ratio**; **Image‑only** toggle; **Chat mode** toggle.
    * **Generate** → POST `/api/jobs` (creates a `PENDING` job).
* **Queue list** (live polling): show job status, elapsed, errors.

    * Actions: **Rerun**, **Cancel/Delete**, **Open Result**.
* **Cost meter**: reads `/api/costs/summary` (today/7d/30d).

### `/girls` — `app/(ui)/girls/page.js`

* List Girls; click opens **drawer**:

    * Update **name/notes**; select/update **primary refs**.
    * **Quick generate** with a small inline prompt.
    * Show recent outputs for that girl.

### `/library` — `app/(ui)/library/page.js`

* Upload new images → POST `/api/upload`.
* Grid view of all reference images (with simple tags).
* Select images to attach to a Girl or to use in the composer.

### `/chat` — `app/(ui)/chat/page.js` (optional)

* Iterative “nanobanana” chat:

    * Attach current output or ref images.
    * Send adjustments (“keep same face, change outfit…”).
    * **Use last output** → sends into the Dashboard composer.

---

## 3) API routes (backend responsibilities)

### `POST /api/upload` — `app/api/upload/route.js`

* Accepts multipart file from client.
* Saves to Firebase **Storage** (`library/{imageId}.png|jpg|webp`).
* Creates a `library` doc: `{ storagePath, publicUrl, mimeType, width, height, tags }`.
* Returns `{ imageId, publicUrl, ... }`.

### `GET|POST /api/jobs` — `app/api/jobs/route.js`

* **GET**: list recent jobs (with status + links).
* **POST**: create a job:

    * Body: `{ type: "generate"|"edit", girlId?, imageIds[], prompt, options: { aspectRatio, imageOnly, chatMode } }`.
    * Writes `jobs/{jobId}` with `PENDING`.
    * Calls `queue.add(jobId)` to start processing (see `lib/queue.js`).

### `GET|DELETE /api/jobs/[id]` — `app/api/jobs/[id]/route.js`

* **GET**: returns job status (`PENDING|RUNNING|SUCCEEDED|FAILED`), result (image URL), usage, cost.
* **DELETE**: cancel if queued/running; or delete the generated image + job doc if done.

### `POST /api/jobs/[id]/rerun` — `app/api/jobs/[id]/rerun/route.js`

* Reruns a successful job with same inputs (optionally accept new prompt).
* Creates a new job doc linked to the original as `rerunOf`.

### `GET|POST /api/girls` — `app/api/girls/route.js`

* **GET**: list girls (id, name, notes, primary ref images).
* **POST**: create a girl (name, notes, selected primary refs).

### `PATCH /api/girls/[id]` — `app/api/girls/[id]/route.js`

* Update `name`, `notes`, or `refImageIds`.

### `GET /api/library` — `app/api/library/route.js`

* List library images, lightweight pagination, optional tag filtering.

### `GET /api/costs/summary` — `app/api/costs/summary/route.js`

* Aggregates `jobs.costUsd` by date: **today / last 7 days / last 30 days**.

> **Why no separate “download” route?**
> For local dev we expose Storage **public URLs**; the UI downloads directly.
> (We still support DELETE via the job route to remove outputs.)

---

## 4) Server helpers (`lib/`) and their roles

* **`firebase-admin.js`**
  Initialize Admin SDK once; export `db` (Firestore) and `bucket` (Storage).

* **`gemini.js`**
  Initialize **@google/genai** client with `process.env.GOOGLE_API_KEY`.
  Expose tiny helpers:

    * `generateImage({ files, prompt, aspectRatio, imageOnly })`
    * `chatSend({ sessionId, files, text })` (if/when you wire chat mode)

* **`files.js`**

    * `readStorageBytes(storagePath)` → Buffer
    * `uploadToGeminiFiles(buffer, mimeType)` → `{ fileUri, expiresAt }`
    * `ensureFileUri(imageId)` → checks Firestore cache of a `fileUri` (<48h old), else re‑uploads from Storage and updates cache.
      *(Gemini Files expire—this keeps it invisible to the UI.)*

* **`queue.js`** (in‑memory, simple)

    * Keeps `pending[]`, `running[]`, `MAX_CONCURRENCY`.
    * Methods: `add(jobId)`, internal `runLoop()`, `resumeOnBoot()` (scan Firestore for `PENDING/RUNNING` on first import).
    * Emits minimal events/logs (or just updates Firestore status).

* **`job-executor.js`**

    * `execute(jobDoc)`:

        1. Load job and its inputs (girl, imageIds).
        2. For each input image: `ensureFileUri(imageId)` (upload to Gemini Files if needed).
        3. Build prompt parts (two‑image edit uses “first/second image” phrasing).
        4. Call `gemini.generateImage(...)` with `imageConfig.aspectRatio` and `responseModalities`.
        5. Extract image bytes from response, save to Storage (`generations/{jobId}.png`).
        6. Update job doc: `SUCCEEDED`, `result.publicUrl`, `usage`, `costUsd`.
        7. On error: set `FAILED`, increment `retries`.
    * **Retry**: If `retries < 2`, `queue` can re‑enqueue automatically.

* **`costs.js`**

    * `estimateImageCost(imagesOut)` using fixed tokens per image (e.g., 1290) and price per 1M tokens.
    * `summarize(db)` for `/api/costs/summary`.

* **`db.js`**

    * Small helpers to read/write `jobs`, `girls`, `library`, and the **Files cache**:

        * `filesCache/{imageId}` → `{ fileUri, expiresAt }`
        * `jobs/{jobId}` → job metadata
        * `girls/{girlId}` → name, notes, `refImageIds`
        * `library/{imageId}` → storagePath, publicUrl, mimeType, width, height, tags

* **`constants.js`**

    * `MODEL_ID = "gemini-2.5-flash-image"`
    * `ASPECT_RATIOS = ["1:1","3:4","4:5","16:9","21:9"]`
    * `TOKENS_PER_IMAGE = 1290`, `PRICE_PER_MILLION_OUTPUT = 30`
    * Small limits (max 3 input images per request, etc.)

---

## 5) Firestore & Storage (collections and fields)

**Collections**

* `girls/{girlId}`
  `{ name, notes, refImageIds: [imageId, ...], createdAt }`
* `library/{imageId}`
  `{ storagePath, publicUrl, mimeType, width, height, tags:[], createdAt }`
* `jobs/{jobId}`

  ```
  {
    type: "generate"|"edit",
    girlId, prompt,
    inputs: { imageIds:[], aspectRatio, imageOnly, chatMode },
    status: "PENDING"|"RUNNING"|"SUCCEEDED"|"FAILED"|"CANCELLED",
    result: { storagePath, publicUrl, width, height },
    retries: 0,
    usage: { imagesOut: 1, outputTokens: 1290 },
    costUsd: 0.039,
    createdAt, startedAt, finishedAt,
    rerunOf: originalJobId? // for traceability
  }
  ```
* `filesCache/{imageId}`
  `{ fileUri, expiresAt }` (for Gemini Files reuse within 48h)

**Storage**

* `library/{imageId}.png|jpg|webp` — your reference images
* `generations/{jobId}.png` — model outputs (downloadable)

---

## 6) Zustand stores (UI only, simple)

* `store/useComposer.js`
  Fields: `type`, `girlId`, `imageIds[]`, `prompt`, `aspectRatio`, `imageOnly`, `chatMode`.
  Actions: set field, reset, submit (calls `/api/jobs`).

* `store/useQueueView.js`
  Holds array of jobs **for the UI** (fetched via `GET /api/jobs`).
  Actions: `refresh()`, `cancel(jobId)`, `rerun(jobId, {prompt?})`.

*(All actual job work lives server‑side in API routes + `lib/queue.js`.)*

---

## 7) UI components (flat, re‑usable)

* **JobComposer**: fields + “Generate” button.
* **JobQueueList**: table/list; actions (Cancel, Rerun, Open).
* **CostMeter**: small summary card.
* **GirlsGrid**: grid + drawer (edit girl, add refs, quick generate).
* **LibraryGrid**: grid, upload, tags, select.
* **UploadButton**: wraps file input → POST `/api/upload`.
* **OutputGallery**: thumbnails with download/delete.
* **ChatPane**: conversation with attach‑image, send prompt, “use output”.

---

## 8) Job lifecycle (how pieces connect)

1. **UI** posts to **`POST /api/jobs`** → Firestore `jobs/{jobId}` = `PENDING`.
2. `queue.add(jobId)` picks it up; status `RUNNING`.
3. `job-executor`:

    * Reads inputs (girl + `imageIds`) → **`files.ensureFileUri`** for each.
    * Calls **Gemini** with refs + prompt + AR + response modality.
    * Saves output to **Storage** → updates job with `result.publicUrl`, `SUCCEEDED`, `usage`, `costUsd`.
4. UI polls **`GET /api/jobs/:id`** → shows result; allows **Download**, **Rerun**, **Delete**.

If the model call fails:

* Update job to `FAILED`; increment `retries`.
* If `retries < 2`, queue can re‑enqueue automatically (configurable).

---

## 9) Environment (what lives in `.env.local.example`)

* `GOOGLE_API_KEY=...` (for @google/genai)
* Firebase Admin service account bits (for local dev you can put the JSON path or individual vars):

    * `FIREBASE_PROJECT_ID=...`
    * `FIREBASE_CLIENT_EMAIL=...`
    * `FIREBASE_PRIVATE_KEY=...` (escaped newlines)
* `PUBLIC_URL=http://localhost:3000` (used for absolute links if needed)

---

### That’s the whole map

* **Pages**: `/`, `/girls`, `/library`, `/chat`
* **API**: `/api/upload`, `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/rerun`, `/api/girls`, `/api/girls/:id`, `/api/library`, `/api/costs/summary`
* **Server helpers**: `firebase-admin`, `gemini`, `files`, `queue`, `job-executor`, `costs`, `db`, `constants`
* **Data**: Firestore collections for girls, library, jobs, filesCache; Storage for images.


