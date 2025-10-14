Awesome—let’s move from blueprint → **working scaffolding**.
Below is a **focused code drop** for the *important* parts (server, queue, Gemini, files, job executor, core API routes). For simpler UI widgets and minor utilities I give short, exact instructions your coding agent can implement quickly.

> **Why these choices?**
> We use the **Google Gen AI SDK** `@google/genai` with `generateContent` + `responseModalities` and `imageConfig.aspectRatio` for Gemini 2.5 Flash Image; the **Files API** to reuse reference images (48‑hour TTL); and a tiny **in‑process queue** so you can enqueue multiple generations and retry failures—no Cloud Functions. ([Google APIs][1])

---

## 0) Install + env

**Packages**

```bash
npm i next@latest react react-dom @google/genai firebase firebase-admin uuid
# tailwind (if not already)
npm i -D tailwindcss postcss autoprefixer
```

**.env.local**

```
GOOGLE_API_KEY=YOUR_AI_STUDIO_API_KEY
FIREBASE_PROJECT_ID=your-proj
FIREBASE_CLIENT_EMAIL=svc-account@your-proj.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
PUBLIC_URL=http://localhost:3000
```

> The **SDK** to use is `@google/genai` (“Google Gen AI SDK”). We’ll call `ai.models.generateContent()` and (optionally) `ai.chats.create()` for Chat mode. ([Google APIs][1])

---

## 1) `lib/constants.js` (models, AR, pricing)

> Gemini 2.5 Flash Image model id & aspect ratios; cost math uses **~1290 output tokens per image** and **$30 / 1M output tokens** (≈ **$0.039 / image**). ([Google Cloud][2])

```js
// lib/constants.js
export const MODEL_ID = 'gemini-2.5-flash-image';

export const ASPECT_RATIOS = [
  '1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9'
];

export const TOKENS_PER_IMAGE = 1290;         // rough guidance
export const PRICE_PER_MILLION_OUTPUT = 30;   // USD

export const FILE_URI_TTL_MS = 46 * 60 * 60 * 1000; // reuse under Files API 48h window
```

> **Notes**
>
> * `imageConfig.aspectRatio` is the official knob. Supported ARs: *1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9*. ([Google AI for Developers][3])

---

## 2) Firebase Admin singletons

```js
// lib/firebase-admin.js
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
  });
}

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
```

**Firestore shape reminder**

* `girls/{id}`
* `library/{imageId}`
* `jobs/{jobId}`
* `filesCache/{imageId}`  (cache of Gemini File URIs + expiry)

(From your blueprint.)

---

## 3) Google Gen AI client + helpers

```js
// lib/gemini.js
import { GoogleGenAI, Modality } from '@google/genai';
import { MODEL_ID } from './constants';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Generate or edit image(s) with optional refs.
 * @param {Object} p
 * @param {Array<{mimeType:string,fileUri:string}>} p.fileRefs - ordered file URIs for "first image", "second image", etc.
 * @param {string} p.prompt
 * @param {string} p.aspectRatio - e.g., "1:1","16:9"
 * @param {boolean} p.imageOnly - if true, request only image output
 */
export async function generateImage({ fileRefs = [], prompt, aspectRatio = '1:1', imageOnly = false }) {
  const parts = [];

  // Attach reference images first, in order.
  for (const ref of fileRefs) {
    parts.push({ fileData: { mimeType: ref.mimeType, fileUri: ref.fileUri } });
  }
  // Then the instruction text.
  parts.push({ text: prompt || '' });

  const config = {
    // Request images in response; include text if you want captions.
    responseModalities: imageOnly ? [Modality.IMAGE] : [Modality.TEXT, Modality.IMAGE],
    imageConfig: { aspectRatio },
  };

  const res = await ai.models.generateContent({
    model: MODEL_ID,
    contents: [{ role: 'user', parts }],
    config,
  });

  // Collect image parts (inlineData) and optional accompanying text
  const out = { images: [], text: '' };
  const partsOut = res?.candidates?.[0]?.content?.parts || [];
  for (const p of partsOut) {
    if (p.inlineData?.data) {
      // inlineData.data is base64-encoded bytes for images
      const mime = p.inlineData.mimeType || 'image/png';
      const buf = Buffer.from(p.inlineData.data, 'base64');
      out.images.push({ mimeType: mime, buffer: buf });
    } else if (p.text) {
      out.text += p.text;
    }
  }
  return out;
}

/** Chat (optional) — used on /chat page if you add it */
export function createImageChat({ history = [], aspectRatio = '1:1' } = {}) {
  return ai.chats.create({
    model: MODEL_ID,
    history,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio },
    },
  });
}
```

> * `ai.models.generateContent` is the core API.
> * `responseModalities` with `Modality.IMAGE` is the lever to return images; you can include text too.
> * `imageConfig.aspectRatio` controls output AR.
    >   These are the officially supported fields in the modern SDK. ([Google APIs][1])

---

## 4) Files pipeline (Firebase Storage → Gemini *Files API* cache)

> The Files API holds uploads for **48 hours**, so we cache its `fileUri` per image and auto‑refresh when expired. ([Google AI for Developers][4])

```js
// lib/files.js
import { bucket, db, Timestamp } from './firebase-admin';
import { FILE_URI_TTL_MS } from './constants';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function readStorageBytes(storagePath) {
  const [buf] = await bucket.file(storagePath).download();
  return buf;
}

/** Upload a Buffer to Gemini Files; returns { fileUri, mimeType } */
export async function uploadToGeminiFiles(buffer, mimeType = 'image/png', displayName = 'ref.png') {
  // Node 18+ has Blob
  const blob = new Blob([buffer], { type: mimeType });
  const file = await ai.files.upload({ file: blob, config: { mimeType, displayName } });
  // SDK returns a File object; we use its URI (name works too).
  const fileUri = file.uri || file.name; // prefer .uri; fallback .name (e.g., "files/abc123")
  return { fileUri, mimeType };
}

/** Ensure we have a live fileUri for a library imageId (reupload if expired). */
export async function ensureFileUriForLibraryImage(imageId) {
  const cacheRef = db.collection('filesCache').doc(imageId);
  const cacheSnap = await cacheRef.get();
  const now = Date.now();

  if (cacheSnap.exists) {
    const data = cacheSnap.data();
    if (data.fileUri && data.expiresAtMs && data.expiresAtMs > now + 5 * 60 * 1000) {
      return { fileUri: data.fileUri, mimeType: data.mimeType || 'image/png' };
    }
  }

  // Need to (re)upload
  const libDoc = await db.collection('library').doc(imageId).get();
  if (!libDoc.exists) throw new Error('library imageId not found: ' + imageId);
  const { storagePath, mimeType, filename } = libDoc.data();
  const buf = await readStorageBytes(storagePath);
  const uploaded = await uploadToGeminiFiles(buf, mimeType, filename || `${imageId}.png`);

  await cacheRef.set({
    fileUri: uploaded.fileUri,
    mimeType: uploaded.mimeType,
    // store a safe margin under 48h
    expiresAtMs: now + FILE_URI_TTL_MS,
    updatedAt: Timestamp.now(),
  });

  return uploaded;
}

/** Ensure a fileUri given a public URL (e.g., Firebase public URL) */
export async function ensureFileUriFromUrl(url, mimeType = 'image/png') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed for ${url}`);
  const arrBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrBuf);
  return await uploadToGeminiFiles(buf, mimeType);
}
```

---

## 5) Costs helper

```js
// lib/costs.js
import { TOKENS_PER_IMAGE, PRICE_PER_MILLION_OUTPUT } from './constants';

export function estimateCostUsd({ imagesOut = 1 }) {
  const outTokens = imagesOut * TOKENS_PER_IMAGE;
  return +( (outTokens / 1_000_000) * PRICE_PER_MILLION_OUTPUT ).toFixed(4);
}
```

---

## 6) Minimal DB helpers

```js
// lib/db.js
import { db, Timestamp } from './firebase-admin';

export async function createJobDoc(payload) {
  const ref = db.collection('jobs').doc();
  const now = Timestamp.now();
  await ref.set({
    ...payload,
    status: 'PENDING',
    retries: 0,
    createdAt: now,
  });
  return ref.id;
}

export async function getJob(jobId) {
  const snap = await db.collection('jobs').doc(jobId).get();
  return snap.exists ? { id: jobId, ...snap.data() } : null;
}

export async function updateJob(jobId, patch) {
  await db.collection('jobs').doc(jobId).update(patch);
}

export async function listJobs(limit = 50) {
  const qs = await db.collection('jobs').orderBy('createdAt', 'desc').limit(limit).get();
  return qs.docs.map(d => ({ id: d.id, ...d.data() }));
}
```

---

## 7) The **Job Executor** (where the image gets created/edited)

This is the heart of the system: it gathers inputs, ensures Gemini `fileUri`s, calls the model, saves output image(s) to Storage, and updates Firestore.

```js
// lib/job-executor.js
import { bucket, Timestamp } from './firebase-admin';
import { ensureFileUriForLibraryImage, ensureFileUriFromUrl } from './files';
import { estimateCostUsd } from './costs';
import { generateImage } from './gemini';
import { updateJob, getJob } from './db';

async function saveImageBufferToStorage(jobId, { buffer, mimeType }) {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `generations/${jobId}.${ext}`;
  const file = bucket.file(storagePath);
  await file.save(buffer, { contentType: mimeType, resumable: false, public: true });
  // Open dev bucket: make public for quick download
  try { await file.makePublic(); } catch {}
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  return { storagePath, publicUrl };
}

/**
 * Executes a single job:
 *  - type: "generate" | "edit"
 *  - inputs: { imageIds?:[], refUrls?:[], aspectRatio, imageOnly, chatMode }
 *  - prompt: string
 */
export async function executeJob(jobId) {
  const job = await getJob(jobId);
  if (!job) return;

  // Skips if was cancelled mid-flight
  if (job.status === 'CANCELLED') return;

  await updateJob(jobId, { status: 'RUNNING', startedAt: Timestamp.now() });

  try {
    const { prompt = '', inputs = {} } = job;
    const { imageIds = [], refUrls = [], aspectRatio = '1:1', imageOnly = false } = inputs;

    // Build ordered fileRefs: library images first (in selection order), then any URLs
    const fileRefs = [];
    for (const id of imageIds) {
      const { fileUri, mimeType } = await ensureFileUriForLibraryImage(id);
      fileRefs.push({ fileUri, mimeType });
    }
    for (const url of refUrls) {
      const { fileUri, mimeType } = await ensureFileUriFromUrl(url);
      fileRefs.push({ fileUri, mimeType });
    }

    // Example of natural-language disambiguation you’ll use in UI:
    // If two refs, user prompt can say: "Replace the leggings from the first image with the leggings from the second image."
    const out = await generateImage({ fileRefs, prompt, aspectRatio, imageOnly });

    if (!out.images.length) {
      throw new Error('Model returned no images.');
    }

    // Save first image (keep it simple; UI can show all later if you wish)
    const img0 = out.images[0];
    const saved = await saveImageBufferToStorage(jobId, img0);

    const usage = { imagesOut: out.images.length, outputTokens: 1290 * out.images.length };
    const costUsd = estimateCostUsd({ imagesOut: out.images.length });

    await updateJob(jobId, {
      status: 'SUCCEEDED',
      finishedAt: Timestamp.now(),
      result: {
        ...saved,
        note: out.text || '', // optional caption the model returned, if any
      },
      usage,
      costUsd,
    });
  } catch (err) {
    const retries = (job.retries || 0) + 1;
    await updateJob(jobId, {
      status: 'FAILED',
      error: String(err?.message || err),
      retries,
      finishedAt: Timestamp.now(),
    });
    // Leave retry policy to the queue (below)
  }
}
```

---

## 8) Tiny **in‑memory queue** (no Cloud Functions)

> This is a single‑process queue with bounded concurrency. Good enough for **localhost** development (Next dev server). If the process restarts, we “resume” by re‑enqueuing any `PENDING` jobs.

```js
// lib/queue.js
import { db } from './firebase-admin';
import { executeJob } from './job-executor';

const MAX_CONCURRENCY = 2;

class JobQueue {
  constructor() {
    this.pending = [];
    this.running = new Set();
    this.paused = false;
    this.bootstrapped = false;
    this.timer = null;
  }

  async resumeOnBoot() {
    if (this.bootstrapped) return;
    this.bootstrapped = true;

    const qs = await db.collection('jobs')
      .where('status', 'in', ['PENDING','RUNNING'])
      .get();
    const ids = qs.docs.map(d => d.id);
    for (const id of ids) this.add(id);

    this._tick();
  }

  add(jobId) {
    if (!this.pending.includes(jobId) && !this.running.has(jobId)) {
      this.pending.push(jobId);
      this._tick();
    }
  }

  cancel(jobId) {
    this.pending = this.pending.filter(id => id !== jobId);
    // If currently running, we can't truly cancel the API call; mark desired state in DB
    // The API route will set status=CANCELLED; executor checks before start.
  }

  _tick() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._loop(), 50);
  }

  async _loop() {
    if (this.paused) return;

    while (this.running.size < MAX_CONCURRENCY && this.pending.length) {
      const id = this.pending.shift();
      this.running.add(id);
      this._runOne(id);
    }
  }

  async _runOne(jobId) {
    try {
      await executeJob(jobId);
    } finally {
      this.running.delete(jobId);
      this._tick();
    }
  }
}

// Make it a dev-hot-reload-safe singleton
const g = globalThis;
export const queue = g.__JOB_QUEUE__ || (g.__JOB_QUEUE__ = new JobQueue());
queue.resumeOnBoot();
```

---

## 9) API routes (server = *backend*)

Keep them **flat** and minimal. All use **Node runtime**.

> We rely on: `POST /api/jobs` (enqueue), `GET /api/jobs` and `/api/jobs/:id` (poll), `DELETE /api/jobs/:id` (cancel/delete), `POST /api/jobs/:id/rerun`, `POST /api/upload`, `GET /api/library`, `GET/POST /api/girls`, `PATCH /api/girls/:id`, `GET /api/costs/summary`.

### 9.1 `POST /api/upload` — Library image upload

```js
// app/api/upload/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { bucket, db, Timestamp } from '@/lib/firebase-admin';
import { v4 as uuid } from 'uuid';

export async function POST(req) {
  const form = await req.formData();
  const file = form.get('file'); // <input name="file" type="file">
  if (!file) return new Response(JSON.stringify({ error: 'missing file' }), { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/png';
  const id = uuid().replace(/-/g,'');
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `library/${id}.${ext}`;
  const gcsFile = bucket.file(storagePath);

  await gcsFile.save(bytes, { contentType: mime, resumable: false, public: true });
  try { await gcsFile.makePublic(); } catch {}
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  await db.collection('library').doc(id).set({
    storagePath, publicUrl, mimeType: mime, createdAt: Timestamp.now(),
    filename: file.name || `${id}.${ext}`, tags: [],
  });

  return Response.json({ imageId: id, publicUrl, storagePath, mimeType: mime });
}
```

### 9.2 `GET|POST /api/jobs` — list & enqueue

```js
// app/api/jobs/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { createJobDoc, listJobs } from '@/lib/db';
import { queue } from '@/lib/queue';

export async function GET() {
  const jobs = await listJobs(50);
  return Response.json({ jobs });
}

export async function POST(req) {
  const body = await req.json();
  // Expected: { type:"generate"|"edit", prompt, inputs:{ imageIds?, refUrls?, aspectRatio?, imageOnly?, chatMode? }, girlId? }
  const jobId = await createJobDoc({
    type: body.type || 'generate',
    prompt: body.prompt || '',
    inputs: body.inputs || {},
    girlId: body.girlId || null,
  });
  queue.add(jobId);
  return Response.json({ jobId });
}
```

### 9.3 `GET|DELETE /api/jobs/[id]` — poll & cancel/delete

```js
// app/api/jobs/[id]/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db, bucket } from '@/lib/firebase-admin';
import { getJob, updateJob } from '@/lib/db';
import { queue } from '@/lib/queue';

export async function GET(_req, { params }) {
  const job = await getJob(params.id);
  if (!job) return new Response('not found', { status: 404 });
  return Response.json(job);
}

export async function DELETE(_req, { params }) {
  const job = await getJob(params.id);
  if (!job) return new Response('not found', { status: 404 });

  if (['PENDING','RUNNING'].includes(job.status)) {
    queue.cancel(params.id);
    await updateJob(params.id, { status: 'CANCELLED' });
    return new Response(null, { status: 204 });
  }

  // Remove generated asset & job doc
  if (job?.result?.storagePath) {
    try { await bucket.file(job.result.storagePath).delete(); } catch {}
  }
  await db.collection('jobs').doc(params.id).delete();
  return new Response(null, { status: 204 });
}
```

### 9.4 `POST /api/jobs/[id]/rerun` — rerun with optional prompt tweak

```js
// app/api/jobs/[id]/rerun/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/firebase-admin';
import { createJobDoc, getJob } from '@/lib/db';
import { queue } from '@/lib/queue';

export async function POST(req, { params }) {
  const original = await getJob(params.id);
  if (!original) return new Response('not found', { status: 404 });

  const body = await req.json().catch(() => ({}));
  const prompt = body.prompt ?? original.prompt;

  const jobId = await createJobDoc({
    type: original.type,
    prompt,
    inputs: original.inputs,
    girlId: original.girlId || null,
    rerunOf: params.id,
  });
  // Link back on original (optional)
  await db.collection('jobs').doc(params.id).update({ lastRerunId: jobId });

  queue.add(jobId);
  return Response.json({ jobId });
}
```

### 9.5 `GET /api/library` — list library images

```js
// app/api/library/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/firebase-admin';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get('limit') || 100);
  const qs = await db.collection('library').orderBy('createdAt', 'desc').limit(limit).get();
  const images = qs.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ images });
}
```

### 9.6 `GET|POST /api/girls` and `PATCH /api/girls/[id]`

```js
// app/api/girls/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db, Timestamp } from '@/lib/firebase-admin';

export async function GET() {
  const qs = await db.collection('girls').orderBy('createdAt', 'desc').get();
  const girls = qs.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ girls });
}

export async function POST(req) {
  const { name, notes, refImageIds = [] } = await req.json();
  const ref = db.collection('girls').doc();
  await ref.set({ name, notes: notes || '', refImageIds, createdAt: Timestamp.now() });
  return Response.json({ id: ref.id });
}
```

```js
// app/api/girls/[id]/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/firebase-admin';

export async function PATCH(req, { params }) {
  const body = await req.json();
  await db.collection('girls').doc(params.id).update(body);
  return new Response(null, { status: 204 });
}
```

### 9.7 `GET /api/costs/summary` — simple rollups

```js
// app/api/costs/summary/route.js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db, Timestamp } from '@/lib/firebase-admin';

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }

export async function GET() {
  const now = new Date();
  const todayStart = Timestamp.fromDate(startOfDay(now));
  const d7 = new Date(now.getTime() - 7*24*60*60*1000);
  const d30 = new Date(now.getTime() - 30*24*60*60*1000);

  const qs = await db.collection('jobs').where('status','==','SUCCEEDED').get();
  let today = 0, last7 = 0, last30 = 0;
  for (const doc of qs.docs) {
    const j = doc.data();
    const t = j.finishedAt?.toDate?.() || j.createdAt?.toDate?.() || new Date(0);
    const c = Number(j.costUsd || 0);
    if (t >= startOfDay(now)) today += c;
    if (t >= d7) last7 += c;
    if (t >= d30) last30 += c;
  }
  return Response.json({ today: +today.toFixed(4), last7: +last7.toFixed(4), last30: +last30.toFixed(4) });
}
```

---

## 10) Pages & minimal UI (instructions)

Keep pages flat; wire only what’s needed to test end‑to‑end.

### 10.1 `/` Dashboard — **instructions**

* Build a minimal composer with:

    * `<select>` Girl (optional) populated from `GET /api/girls`.
    * A multiselect chip list of **Library** images (fetch first 60 via `GET /api/library`).
    * Prompt `<textarea>`.
    * Aspect Ratio `<select>` from `ASPECT_RATIOS`.
    * Toggle: **Image‑only** (defaults to **false** so you also see text).
    * Button **Generate** → `POST /api/jobs` with `{ type:'generate'|'edit', prompt, inputs:{ imageIds, aspectRatio, imageOnly } }`.

* Add a **Jobs List** that polls `GET /api/jobs` every 2–3s and renders:

    * Status pill: PENDING/RUNNING/SUCCEEDED/FAILED.
    * If `result.publicUrl`, render thumbnail + **Download** link (direct to URL).
    * Actions: **Rerun** → `POST /api/jobs/:id/rerun` (modal to edit prompt), **Delete** → `DELETE /api/jobs/:id`.

* Add **Cost Meter** by calling `GET /api/costs/summary`.

> Use **Zustand** only for page UI state (composer form + local jobs view). The job processing lives server‑side already.

**Quick component checklist** (all easy):

* `components/JobComposer.js`
* `components/JobQueueList.js`
* `components/CostMeter.js`
* `components/LibraryGrid.js` (selection only; uploads live on `/library`)
* `components/UploadButton.js` (wraps `/api/upload`)

*(Your agent can implement each as ~50–120 LOC Tailwind components.)*

### 10.2 `/library` — **instructions**

* File input → `POST /api/upload` (multipart).
* Render grid from `GET /api/library`.
* Allow selecting 1–2 refs, then button “Use in Composer” → write to a small Zustand atom that the `/` page reads.

### 10.3 `/girls` — **instructions**

* CRUD UI with `GET/POST/PATCH` endpoints; associate selected library images to a girl.

### 10.4 `/chat` (optional) — **instructions**

* Start a chat with `ai.chats.create({ model: MODEL_ID, config:{ responseModalities:[TEXT,IMAGE] }})`.
* Each send attaches selected references as `fileData` + the user message text.
* Parse returned `parts` to render both text + images.
  *(Chat is optional now; wire later if you want iterative edits.)* ([Google APIs][5])

---

## 11) How this satisfies your “AI girls” workflow

* **Create a “girl”** on `/girls`, attach 1–2 primary reference images from `/library`.
* In `/` compose a job:

    * Select the girl → her refs auto‑preselect (you can add 2nd ref to do e.g., *“replace leggings from first image with leggings from second image”*).
    * Set AR (e.g. `3:4`) and prompt (environment/clothing).
    * **Generate** → enqueues; queue runs; image saved to `generations/…`.
* **Rerun**: Click **Rerun**, tweak prompt (e.g., new background), run again.
* **Edit generated results using a URL**: send the previous `result.publicUrl` as `inputs.refUrls=[url]` with a new prompt. The server fetches bytes → **Files API** upload → reuses it; no need to re‑download to your machine. ([Google AI for Developers][4])
* **Library of refs**: your uploads live under `/library`, selectable any time.
* **Downloads / deletions / cost tracking**: handled via the endpoints above.

---

## 12) A couple of guardrails & gotchas (so you don’t get stuck)

* **SDK + params**: Use `@google/genai` and pass

    * `config.responseModalities: [Modality.IMAGE]` (image‑only) or `[Modality.TEXT, Modality.IMAGE]` (image + caption).
    * `config.imageConfig.aspectRatio: "1:1" | "3:4" | ...`. ([Google APIs][1])
* **Files API**: URIs expire **~48h**. The `filesCache` doc and `ensureFileUri*` refresh automatically. ([Google AI for Developers][4])
* **Pricing math** (for your cost meter): use ~$0.039/image = `1290 tokens * $30 / 1M`. Adjust if Google updates. ([Google Developers Blog][6])
* **Concurrency**: local queue concurrency is `2` by default. Raise carefully; each job can be ~3 min.
* **Cancellations**: we remove from pending immediately. If already calling the model, we can’t abort the HTTP call; we mark `CANCELLED` and executor will skip if it hasn’t started.
* **Bucket access**: code calls `makePublic()` for dev simplicity. For production, prefer **signed URLs** or proper security rules.

---

## 13) What to code next (small tasks for your agent)

1. **UI components** from the checklist (simple fetch + Tailwind).
2. Add a checkbox “Use Image‑only output” (maps to `inputs.imageOnly`).
3. On **Rerun**, open a small modal to edit the previous prompt before posting to `/api/jobs/:id/rerun`.
4. In `JobQueueList`, show a **Retry** button when `status==='FAILED'` → simply call `/api/jobs/:id/rerun`.
5. In `JobComposer`, if a **Girl** is picked, preselect her `refImageIds` as the first two library chips.
6. Add a **“Add result to Library”** action in the job card: do a small POST to `/api/upload` with the `result.publicUrl` (fetch → bytes) server‑side or alternatively write a tiny `POST /api/library/add-from-url` route to ingest by URL.

---

## 14) Quick Tailwind glue (optional)

Set up `globals.css` with Tailwind base/layers, then your components can use a few shared classes (`btn`, `card`, etc.). Keep it flat and simple; avoid over‑nesting.

---

### That’s it — you now have the **core working backend** + a clear to‑do list for the small UI parts.



**Docs referenced for correctness** (SDK, Files API, image settings, pricing):

* `@google/genai` quickstart & modules (`ai.models`, `ai.files`, `ai.chats`). ([Google APIs][1])
* Files API retention & usage (48h store). ([Google AI for Developers][4])
* Image generation config: `responseModalities` (IMAGE/TEXT) + `imageConfig.aspectRatio`. ([Google AI for Developers][3])
* Gemini 2.5 Flash Image pricing & tokens/image (0.039 USD / image; 30 USD / 1M tokens; 1290 tokens per image). ([Google Developers Blog][6])

---

#### Bonus: Example `curl` to sanity‑check the pipeline (after boot)

```bash
# 1) Upload a reference image
curl -F "file=@/path/to/ref1.jpg" http://localhost:3000/api/upload

# 2) Create a job (two refs, replace leggings, 3:4, image + text)
curl -X POST http://localhost:3000/api/jobs \
  -H "content-type: application/json" \
  -d '{
    "type": "edit",
    "prompt": "Replace the leggings from the first image with the leggings from the second image. Keep same face & hair; set in a Tokyo street at night.",
    "inputs": {
      "imageIds": ["<ref1Id>", "<ref2Id>"],
      "aspectRatio": "3:4",
      "imageOnly": false
    }
  }'
# 3) Poll:
curl http://localhost:3000/api/jobs
```

[1]: https://googleapis.github.io/js-genai/release_docs/index.html "@google/genai"
[2]: https://cloud.google.com/blog/products/ai-machine-learning/gemini-2-5-flash-image-on-vertex-ai?utm_source=chatgpt.com "Use Gemini 2.5 Flash Image (nano banana) on Vertex AI"
[3]: https://ai.google.dev/api/generate-content?utm_source=chatgpt.com "Generating content | Gemini API - Google AI for Developers"
[4]: https://ai.google.dev/gemini-api/docs/files?utm_source=chatgpt.com "Files API | Gemini API - Google AI for Developers"
[5]: https://googleapis.github.io/js-genai/release_docs/classes/chats.Chats.html?utm_source=chatgpt.com "Chats | @google/genai"
[6]: https://developers.googleblog.com/en/gemini-2-5-flash-image-now-ready-for-production-with-new-aspect-ratios/?utm_source=chatgpt.com "Gemini 2.5 Flash Image now ready for production with new ..."
