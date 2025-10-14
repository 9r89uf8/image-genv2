Awesome—this is totally doable with **Next.js 15 + Firebase + Tailwind**, using the official **Google Gen AI SDK** (“genai”) to call **Gemini 2.5 Flash Image** (a.k.a. *Nano Banana*). Below is a **practical blueprint** you can follow end‑to‑end. I’ve pulled the specific model capabilities we’ll rely on (multi‑image composition, iterative chat editing, aspect ratios, files handling, pricing tokens, etc.) straight from Google’s docs so we stay aligned with how the API actually works. ([Google AI for Developers][1])

---

## 0) What we’re building (scope recap)

A local web app (localhost:3000) where you can:

* Create “**Girls**” (character profiles) with 1–2 reference images.
* Generate **new images** of a selected girl (“same girl, different outfit/environment”).
* **Edit** with two images (e.g., “replace the leggings from the first image with the leggings from the second image”). Multi‑image composition like this is supported (“first image / second image”) right in the official prompt patterns. ([Google AI for Developers][1])
* Maintain a **reference image library** so you don’t re‑upload every time.
* Add **chat mode** to iteratively refine outputs (recommended). ([Google Developers Blog][2])
* **Queue** long generations (~minutes), allow multiple enqueued jobs, retry on fail, rerun successful jobs with prompt tweaks.
* **Download** images, **delete** generations, and **track costs**.

> Notes from the docs we’ll lean on:
>
> * **Image + text editing** and **multi‑image composition** (style/object transfer across “first/second image”). ([Google AI for Developers][1])
> * **Iterative refinement** in **chat sessions**. ([Google AI for Developers][1])
> * Control **aspect ratio** via `imageConfig.aspectRatio`. ([Google AI for Developers][1])
> * Default returns text+image; can force **image‑only** output via `responseModalities`. ([Google AI for Developers][1])
> * **Files API** to upload media once and reuse by **file URI** (but files auto‑expire after **48h**, so we’ll re‑upload from Firebase Storage when needed). ([Google AI for Developers][3])
> * Each generated image is **~1290 output tokens**; model priced at **$30 / 1M output tokens** (≈ **$0.039 per image**). ([Google AI for Developers][1])
> * All generated images include **SynthID watermark**. ([Google AI for Developers][1])

---

## 1) High‑level architecture (keep it simple)

**Front‑end (Next.js app router + Tailwind):**

* Minimal routes, few components. No auth, no rules, no TS.
* Uses **Zustand** only for **UI state** (local queue display, selections, forms, chat pane state).

**Backend (Next.js API routes):**

* Uses **firebase‑admin** to read/write **Firestore** (metadata) & **Storage** (images).
* Uses **@google/genai** (“genai”) to call **gemini‑2.5‑flash‑image**.
* Maintains a **tiny in‑memory queue** (singleton module) to run jobs sequentially/concurrently (configurable). No Cloud Functions.

**Firebase:**

* **Firestore**: store Girls, Library images, Jobs, Cost logs.
* **Storage**: original references + generated outputs (public or signed URLs for local dev).

**Gemini Files API:**

* At job time, backend **reads bytes from Firebase Storage** and uploads to Gemini **Files API**, obtaining `file_uri` for prompts (because Gemini’s uploaded files are temporary—48h). ([Google AI for Developers][3])

> Why not pass your Firebase Storage URL directly to Gemini?
> The most reliable path is to **upload to Gemini Files** then reference `file_uri`; that’s how the guides and SDK samples are structured. We’ll therefore keep the authoritative copy in Firebase Storage and re‑push to Files when a job starts. ([Google AI for Developers][3])

---

## 2) Data model (Firestore + Storage)

**Collections**

* `girls/{girlId}`

    * `name`, `notes` (text traits), `createdAt`
    * `refImageIds`: [imageId, …] (up to 2 “primary” references)
    * `chatId` (local logical id we’ll use to group chat turns)
* `library/{imageId}`

    * `storagePath`, `publicUrl`, `mimeType`, `width`, `height`, `owner: 'local'`, `createdAt`, `tags` (e.g., “leggings”, “jacket”)
* `jobs/{jobId}`

    * `type`: `"generate" | "edit"`
    * `girlId`, `prompt`, `inputs`: { `imageIds`: [...], `aspectRatio`, `responseModalities`, `chatMode` (bool) }
    * `status`: `"PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"`
    * `result`: { `storagePath`, `publicUrl`, `width`, `height` }
    * `error`, `retries`, `createdAt`, `startedAt`, `finishedAt`
    * `usage`: `{ imagesOut: n, outputTokens: n }` (estimate)
    * `costUsd`: number (estimated, see §9)
* `chatTurns/{turnId}` (or nested under `girls/{girlId}/chatTurns`)

    * `girlId`, `role`: `"user"|"model"`, `contents` (text + references), `imagesOut` (urls), `createdAt`

**Storage layout**

* `library/{imageId}.png|jpg|webp`
* `generations/{jobId}.png`
* Make files public (or serve signed URLs) for easy download in local dev.

---

## 3) Minimal routes (avoid over‑nesting)

**Pages**

* `/` — **Dashboard**: New job composer + queue list + cost summary.
* `/girls` — List + inline drawer to manage a girl (refs, quick generate, recent outputs).
* `/library` — Simple grid of reference images; tag & select; upload form (posts to API).
* `/chat` — Optional: one global “nanobanana” chat canvas; can also open per‑girl chat as a drawer.

**API routes (Next.js /app/api)**

* `POST /api/upload` — upload file from client -> Storage -> return metadata.
* `POST /api/jobs` — enqueue a job (generate/edit); returns `jobId`.
* `GET /api/jobs/:id` — poll status/result.
* `POST /api/jobs/:id/rerun` — rerun with same inputs; optional body to tweak prompt.
* `DELETE /api/jobs/:id` — mark cancelled + (optional) delete image & doc.
* `GET /api/jobs` — list recent.
* `POST /api/girls` / `PATCH /api/girls/:id` / `GET /api/girls`
* `GET /api/costs/summary` — last 7/30 days estimated costs.

> All Gemini calls live inside the job runner on the server. The browser never sees your API key.

---

## 4) The queue (simple and local)

* **Singleton module** `lib/queue.js` loaded by API routes. Holds:

    * `pending[]`, `running[]`, `MAX_CONCURRENCY` (e.g., 1–2)
    * `start()` kicks a loop: pop next, mark RUNNING, execute, mark SUCCEEDED/FAILED, continue.
    * Uses `setTimeout`/`Promise`—no external broker.
* **Persistence**: Every job is stored in Firestore. On server boot or first API hit, the queue scans for `PENDING`/`RUNNING` and resumes them.
* **Retry**: On failure, increment `retries` and put back to `pending` (cap e.g., 2 retries).
* **Client UX**: The UI uses **Zustand** only to **display** jobs and let you create/cancel/rerun; it does not execute jobs.

> This keeps the system dead simple and avoids Cloud Functions entirely, while letting you enqueue more while one is running.

---

## 5) Gemini integration details we will implement

### Models & output

* Model: `gemini-2.5-flash-image`. (Image generation & editing; production ready). ([Google Developers Blog][4])
* Return images only or images+text. Use `responseModalities: ['Image']` to silence text. ([Google AI for Developers][1])
* Control **aspect ratio** via `imageConfig.aspectRatio` (`'1:1','3:4','4:5','16:9','21:9',…`). Docs include the list and pixel resolutions. ([Google AI for Developers][1])

### Editing & multi‑image composition

* For “replace leggings from first image with leggings from second image”: send **two images + text** prompt that names “first” and “second” image. This *exact* composition pattern is documented (e.g., put the dress from the first image onto the person in the second image). ([Google AI for Developers][1])
* Works best with up to **3 input images** per request. ([Google AI for Developers][1])

### Chat mode (recommended)

* Create a chat session via `ai.chats.create({ model, config })` and send incremental `sendMessage` with images + text each turn; the SDK maintains history for iterative edits (“keep everything the same…”). ([Google APIs][5])

### Files / media handling

* Upload images to **Gemini Files API** (via SDK), get a `file_uri`, then include them as `file_data` parts. Files can be **reused** across requests but auto‑delete in **48 hours**, so we always keep the **source of truth** in Firebase Storage and re‑upload when a job starts. ([Google AI for Developers][3])
* The image generation page notes **SynthID** watermark is included in outputs (inform users). ([Google AI for Developers][1])

### Prompting templates we’ll use

* **Character generation**: use detailed features in the prompt + reference image(s); iterate via chat if the face drifts. The “best practices” blog explicitly recommends this approach. ([Google Developers Blog][2])
* **Editing**: “Using the provided image of [subject], replace the leggings from the **first** image with the leggings from the **second** image. Keep the person’s face, skin tone, body shape, and pose unchanged. Match fabric folds and lighting realistically.” (mirrors docs’ multi‑image composition guidance). ([Google AI for Developers][1])

---

## 6) Core user flows (exactly how things connect)

### A) Create a Girl + first generation

1. Upload 1–2 **reference images** to `/api/upload` → stored in **Storage** + an entry in `library`.
2. Create a **Girl** (name + notes + pick the two refs from Library).
3. In the Dashboard or Girls drawer: enter prompt (“same girl, sunny beach, sundress”), pick AR (e.g., **3:4**), choose **Image‑only** output, **Chat mode** optional.
4. Click **Generate** → `POST /api/jobs` creates `PENDING` job and wakes the **queue**.
5. Runner:

    * Fetches the girl’s ref image bytes from **Storage**.
    * Uploads to **Gemini Files** → gets `file_uri`s. ([Google AI for Developers][3])
    * Calls `generateContent` with:
      `parts: [file_data (ref1), file_data (ref2?), text prompt]`, `config: { imageConfig.aspectRatio, responseModalities }`. ([Google AI for Developers][1])
    * Parses **image part(s)** from response; saves the file to **Storage** (`generations/{jobId}.png`), updates Firestore with `publicUrl`, `status: SUCCEEDED`, and **usage estimate**.
6. UI polls `GET /api/jobs/:id` and shows result; you can **download** or **Add to Library**.

### B) Edit by referencing two images (your leggings example)

1. Choose **First image** (the base)—can be a past generation, or a library image.
2. Choose **Second image** (leggings donor).
3. Compose prompt exactly like the docs pattern (“take the leggings from the second image and put them on the person from the first image; keep face/body unchanged; match folds/shadows”). ([Google AI for Developers][1])
4. Enqueue job. Runner uploads both sources to Files; calls `generateContent` with both images + prompt; stores output.

### C) Iterative chat (“nanobanana”)

1. Open **Chat** (global or per‑girl).
2. Attach the current output image (or girl’s ref) as context; send refinement prompts (“keep the same person; make the lighting warmer; do not change aspect ratio”). The docs recommend being explicit for AR while editing. ([Google Developers Blog][2])
3. Each turn creates a durable `chatTurn` record; any **image output** is also saved to Storage.

### D) Rerun / prompt tweak

* From a succeeded job, “**Rerun**” either repeats inputs or opens a minimal edit box to tweak the prompt and re‑enqueue.

### E) Download / delete

* Download uses the Storage public URL.
* Delete removes the Storage object + Firestore doc (job) and unlinks it from the Girl, leaving audit history optional.

---

## 7) Cost tracking (simple but useful)

* Per docs, **each image output = 1290 tokens**; pricing **$30 per 1M output tokens** → **$0.0387 per image**. We’ll compute:

  `costUsd = imagesOut * 1290 * (30 / 1_000_000)`

  Save this estimate in `jobs.costUsd` and aggregate in `GET /api/costs/summary`. (Keep price in an env var so you can change it later.) ([Google AI for Developers][1])

---

## 8) Prompts we’ll standardize (short library)

* **Same girl, new environment**
  “Using the provided reference image(s) of the same woman, create a new portrait **of the same person** at [environment]. Keep facial features, skin tone, hair color and length, and body proportions unchanged. Outfit: [describe]. Camera: [85mm portrait], Lighting: [soft golden hour]. **Do not change aspect ratio**.” (AR line aligns with the blog’s guidance.) ([Google Developers Blog][2])

* **Two‑image edit (clothing transfer)**
  “Take the **leggings from the second image** and put them on the **person in the first image**. Match fabric stretch, folds, and shading to the pose. Keep the face, body, hands, and background exactly the same.” (Doc pattern.) ([Google AI for Developers][1])

* **Minor refinements in chat**
  “Keep everything else the same, but slightly warm the key light and reduce contrast by 10%. Do not change the person’s identity or pose. **Do not change aspect ratio**.” ([Google Developers Blog][2])

---

## 9) Library behavior (so you don’t re‑upload from your laptop)

* You add images once to **Firebase Storage** (via `/api/upload`).
* When a job starts, the runner reads the bytes directly from Storage and **re‑uploads to Gemini Files** (getting a fresh `file_uri`) because Gemini Files **expire after 48h**. We cache the last `file_uri` and timestamp in Firestore; if <48h old, reuse; otherwise re‑upload. ([Google AI for Developers][3])

> This gives you “pick from library” convenience in the UI, while meeting the API’s ephemeral file behavior.

---

## 10) Minimal UI plan (Tailwind, no over‑nesting)

* **Dashboard (`/`)**

    * **Composer card**:

        * Select **Girl** (or “None”).
        * Add **1–2 reference images** from **Library** chips.
        * Prompt textarea (with small “insert template” menu).
        * Aspect Ratio select; “Image‑only” toggle; “Chat mode” toggle (“nanobanana”).
        * **Generate** button (enqueues).
    * **Queue** list: `status`, elapsed, retry, cancel, open result.
    * **Cost meter**: *Today / 7d / 30d* totals.

* **Girls (`/girls`)**

    * Grid list; selecting opens **drawer**:

        * View/update **primary refs**.
        * Quick prompt + generate.
        * Recent outputs (thumbnails).

* **Library (`/library`)**

    * Grid with upload; click to tag and select; “Add to Girl”.

* **Chat (`/chat`)**

    * Left: conversation, Right: current image panel (drop images).
    * “Use this output in composer” button.

> Keep components flat: one component per card/section; no deep trees.

---

## 11) API contracts (shape, not code)

**POST `/api/jobs`**
Body:

```json
{
  "type": "generate|edit",
  "girlId": "optional",
  "imageIds": ["img1","img2"], 
  "prompt": "text",
  "options": { "aspectRatio": "3:4", "imageOnly": true, "chatMode": false }
}
```

Response: `{ "jobId": "…" }`

**GET `/api/jobs/:id`** → `{ status, result?, error?, usage?, costUsd? }`

**POST `/api/jobs/:id/rerun`** → same as `POST /api/jobs` but inherits inputs.

**POST `/api/upload`** (multipart form) → `{ imageId, storagePath, publicUrl, mimeType, width, height }`

---

## 12) Implementation order (short, sequential)

1. **Project scaffold**: Next 15 app router + Tailwind; install `firebase`, `firebase-admin`, `@google/genai`, `zustand`.
2. **Firebase Admin init** (server): Firestore + Storage; `/api/upload` to Storage; `/api/library` list.
3. **Data models** + simple Library page (upload & grid).
4. **Job runner & queue** (in‑memory module) + `/api/jobs` create + `/api/jobs/:id` poll.
5. **GenAI client** + **Files upload** + **text‑to‑image generate** (happy path). ([Google AI for Developers][1])
6. **Save outputs to Storage** + link in Firestore; display in UI.
7. **Multi‑image editing** path (two images + prompt like “first/second”). ([Google AI for Developers][1])
8. **Aspect ratio** & **image‑only** toggles. ([Google AI for Developers][1])
9. **Girls** page + assigning primary refs; quick generate.
10. **Chat mode** (per‑girl or global) using `ai.chats.create` + `sendMessage`; store chat turns; allow “use last output” in composer. ([Google APIs][5])
11. **Rerun**, **Delete**, **Download**, **Cost summary** (use token formula). ([Google AI for Developers][1])
12. **Retries** in queue + cancel; basic error toasts.

---

## 13) Guardrails & notes

* **People images**: The API can generate/edit people, but policies restrict explicit sexual content, minors, and deception; expect refusals for policy‑violating prompts. (See policy links in the docs page’s “Policies”.) ([Google AI for Developers][1])
* **Aspect ratios during edits**: The blog notes edited outputs generally keep input AR; be explicit if it drifts: *“Do not change aspect ratio.”* ([Google Developers Blog][2])
* **“First/second image”**: The official guide demonstrates this exact phrasing for combining clothing/objects between images. ([Google AI for Developers][1])
* **Files**: Remember 48h auto‑deletion on Gemini Files; rely on Firebase Storage as permanent store. ([Google AI for Developers][3])
* **Watermark**: Outputs include **SynthID** watermark. ([Google AI for Developers][1])

---

## 14) What each part “does” (quick map)

* **Next.js UI**: composition forms, chat pane, job queue display, simple galleries.
* **Zustand**: local UI state only (selected girl/images, composer fields, client‑side queue list from polling).
* **API**: accepts uploads, creates jobs, tracks status, performs Gemini calls, writes outputs to Storage.
* **Firestore**: single source of truth for jobs, girls, library, cost entries.
* **Storage**: all media (ref + generated).
* **Gemini Files**: ephemeral working copies to pass images to the model conveniently; re‑created per job. ([Google AI for Developers][3])

---

## 15) “Nanobanana” persona (optional but fun)

* In chat config, set a **system instruction** like: *“You are ‘nanobanana’, an image assistant. Always preserve the subject’s identity when asked for the ‘same girl.’ Prefer subtle changes unless told otherwise.”*
* Keep **responseModalities** allowing image + short text hints in chat; switch to **image‑only** in batch jobs. ([Google AI for Developers][1])

---

## 16) Later polish (nice to have, still simple)

* **Seed / determinism**: Not documented as a stable parameter for this model; for consistency, always include the same ref images + constraints in prompts and iterate via chat if features drift (as the blog suggests). ([Google Developers Blog][2])
* **SSE** for live job progress (instead of polling).
* **Tagging**: one‑click “Add output to Library”.
* **Per‑girl templates**: auto‑prepend “identity lock” lines into prompts.
* **AR presets** with example visual ratios (16:9, 3:4, 4:5) from docs. ([Google AI for Developers][1])

---

### Sources (key parts we’re relying on)

* **Official Image Generation (aka Nano Banana)**: multi‑image composition (e.g., clothing transfer), aspect ratios, image‑only responses, SynthID, and limits. Last updated 2025‑10‑02. ([Google AI for Developers][1])
* **Gemini 2.5 Flash Image blog (production, new ARs)**. ([Google Developers Blog][4])
* **Prompting best practices for 2.5 Flash Image** (iterative refinement, AR guidance). ([Google Developers Blog][2])
* **Files API** (upload, reuse via `file_uri`, 48h lifetime). ([Google AI for Developers][3])
* **Chat sessions in the JS SDK** (`ai.chats.create`, `sendMessage`). ([Google APIs][5])

---


[1]: https://ai.google.dev/gemini-api/docs/image-generation "Image generation with Gemini (aka Nano Banana)  |  Gemini API  |  Google AI for Developers"
[2]: https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/ "

            How to prompt Gemini 2.5 Flash Image Generation for the best results
            
            
            \- Google Developers Blog
            
        "
[3]: https://ai.google.dev/gemini-api/docs/files "Files API  |  Gemini API  |  Google AI for Developers"
[4]: https://developers.googleblog.com/en/gemini-2-5-flash-image-now-ready-for-production-with-new-aspect-ratios/ "

            Gemini 2.5 Flash Image now ready for production with new aspect ratios
            
            
            \- Google Developers Blog
            
        "
[5]: https://googleapis.github.io/js-genai/release_docs/classes/chats.Chat.html "Chat | @google/genai"
