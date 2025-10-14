Great—let’s wire the **front‑end** so you can do **two‑image iterative edits** exactly as you described:

* pick a **generated image** as the **first image** (not a girl’s library ref)
* upload a **one‑time use** image as the **second image** (also **not** in the library)
* send a prompt like *“replace the leggings from the first image with the leggings from the second image”*
* see **clear order indicators** (1st/2nd/3rd) and a **side‑by‑side preview**, and submit.

Below are **drop‑in files / patches** for the important parts. Minor glue instructions are noted inline for your agent.

---

## 1) New API route for **temporary (one‑time) uploads**

> These are **not** added to the library collection. They’re uploaded to Storage under `temps/` and immediately usable as a **URL reference**.

**`app/api/upload/temp/route.js`**

```js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { bucket } from '@/lib/firebase-admin';
import { v4 as uuid } from 'uuid';

export async function POST(req) {
  const form = await req.formData();
  const file = form.get('file'); // <input type="file" name="file">

  if (!file) return new Response(JSON.stringify({ error: 'missing file' }), { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/png';
  const id = uuid().replace(/-/g, '');
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `temps/${id}.${ext}`;
  const gcsFile = bucket.file(storagePath);

  await gcsFile.save(bytes, { contentType: mime, resumable: false, public: true });
  try { await gcsFile.makePublic(); } catch {}

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  // No Firestore doc created on purpose (not a library item)
  return Response.json({ publicUrl, storagePath, mimeType: mime });
}
```

**Why:** The backend already supports `refUrls`. Uploading a temporary image returns a public URL you add to `refUrls[1]` (the “second image”).

---

## 2) Zustand **Composer store**: add an *“Edit This” prefill* action

We’ll add `editingFromJob` state and a `loadJobForEditing(job)` action that pre‑populates:

* type = `"edit"`
* **first** ref = `job.result.publicUrl` (as a **URL**, not library)
* clears library selections
* carries over aspect ratio if present
* optional: keep `girlId` for context

**Drop‑in replacement:** `store/useComposer.js`

```js
'use client';

import { create } from 'zustand';
import { ASPECT_RATIOS } from '@/lib/constants';

const defaultState = {
  type: 'generate',
  girlId: '',
  imageIds: [],
  refUrls: [],
  prompt: '',
  aspectRatio: ASPECT_RATIOS[0],
  imageOnly: false,
  chatMode: false,
  isSubmitting: false,

  // new
  editingFromJob: null, // jobId when prefilled from "Edit This"
};

export const useComposer = create((set, get) => ({
  ...defaultState,

  setField: (field, value) => set({ [field]: value }),

  // library refs (ordered by selection)
  setImageIds: (ids) => {
    const refUrls = get().refUrls;
    const maxImages = Math.max(0, 3 - refUrls.length);
    const unique = Array.from(new Set(ids));
    set({ imageIds: unique.slice(0, maxImages) });
  },
  toggleImageId: (id) => {
    const { imageIds, refUrls } = get();
    const maxImages = Math.max(0, 3 - refUrls.length);
    if (imageIds.includes(id)) {
      set({ imageIds: imageIds.filter((x) => x !== id) });
    } else {
      if (imageIds.length >= maxImages) return;
      set({ imageIds: [...imageIds, id] });
    }
  },

  // external/temporary URLs
  addRefUrl: (url) => {
    const { refUrls, imageIds } = get();
    if (!url) return;
    if (refUrls.includes(url)) return;
    if (refUrls.length + imageIds.length >= 3) return;
    set({ refUrls: [...refUrls, url] });
  },
  removeRefUrl: (url) => set({ refUrls: get().refUrls.filter((u) => u !== url) }),
  setRefUrls: (urls) => {
    const imageIds = get().imageIds;
    const maxUrls = Math.max(0, 3 - imageIds.length);
    const unique = Array.from(new Set(urls));
    set({ refUrls: unique.slice(0, maxUrls) });
  },

  clearReferences: () => set({ imageIds: [], refUrls: [] }),

  // NEW: prefill composer from a finished job's output (as FIRST image)
  loadJobForEditing: (job) => {
    const firstUrl = job?.result?.publicUrl || '';
    const ar = job?.inputs?.aspectRatio || ASPECT_RATIOS[0];
    set({
      type: 'edit',
      girlId: job?.girlId || '',
      imageIds: [],                 // IMPORTANT: no library refs in this edit
      refUrls: firstUrl ? [firstUrl] : [],
      prompt: '',                   // empty; user will write edit instruction
      aspectRatio: ar,
      imageOnly: false,
      chatMode: false,
      editingFromJob: job?.id || 'prefilled',
    });
  },

  clearEditingContext: () => set({ editingFromJob: null }),

  reset: () => set({ ...defaultState }),

  submit: async () => {
    const state = get();
    const payload = {
      type: state.type,
      prompt: state.prompt,
      girlId: state.girlId || null,
      inputs: {
        imageIds: state.imageIds,
        refUrls: state.refUrls,
        aspectRatio: state.aspectRatio,
        imageOnly: state.imageOnly,
        chatMode: state.chatMode,
      },
    };

    set({ isSubmitting: true });
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data.jobId;
    } finally {
      set({ isSubmitting: false });
    }
  },
}));
```

---

## 3) “**Edit This**” button on each finished job (Queue list)

This injects the job’s output URL as the **first** reference in the composer and takes the user back to the composer.

**Patch** `components/JobQueueList.js`

* **Add imports** at the top:

```js
import { useRouter } from 'next/navigation';
import { useComposer } from '@/store/useComposer';
```

* **Inside the component**, create bindings:

```js
const router = useRouter();
const loadJobForEditing = useComposer((s) => s.loadJobForEditing);
```

* **In the footer button group**, add this button (only when job succeeded with an image):

```jsx
{job.status === 'SUCCEEDED' && job.result?.publicUrl && (
  <button
    type="button"
    onClick={() => {
      loadJobForEditing(job);     // prefill composer with FIRST ref = this output
      router.push('/#composer');  // jump to composer (we'll add id="composer")
    }}
    className="rounded-full border border-indigo-500 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 dark:border-indigo-400/60 dark:text-indigo-300 dark:hover:bg-indigo-400/10"
  >
    Edit This
  </button>
)}
```

> Minor: If you don’t want a hash anchor, you can `router.push('/')` and `scrollIntoView` in the composer on mount.

---

## 4) Job Composer with **order indicators**, **temp upload**, and **side‑by‑side preview**

Below is a **drop‑in replacement** for your `components/JobComposer.js`.
It keeps your existing behavior but adds:

* **Editing banner** when prefilled with a previous output
* **Order indicators** (1st/2nd/3rd) for both library and URL refs
* **Temporary one‑time upload** section that posts to `/api/upload/temp` and appends the returned URL
* **Side‑by‑side preview** when you have ≥ 2 refs (clearly labeled “First image (base)” and “Second image (donor)”)
* A tiny **prompt templates** dropdown (leggings/object/background) to speed edits

**`components/JobComposer.js`**

```js
'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ASPECT_RATIOS } from '@/lib/constants';
import { useComposer } from '@/store/useComposer';
import { useQueueView } from '@/store/useQueueView';

const cn = (...xs) => xs.filter(Boolean).join(' ');
const ordinal = (n) => (['1st', '2nd', '3rd'][n] || `${n + 1}th`);

export default function JobComposer() {
  // Store fields
  const type = useComposer((s) => s.type);
  const setField = useComposer((s) => s.setField);
  const girlId = useComposer((s) => s.girlId);
  const setImageIds = useComposer((s) => s.setImageIds);
  const imageIds = useComposer((s) => s.imageIds);
  const toggleImageId = useComposer((s) => s.toggleImageId);
  const refUrls = useComposer((s) => s.refUrls);
  const addRefUrl = useComposer((s) => s.addRefUrl);
  const removeRefUrl = useComposer((s) => s.removeRefUrl);
  const prompt = useComposer((s) => s.prompt);
  const aspectRatio = useComposer((s) => s.aspectRatio);
  const imageOnly = useComposer((s) => s.imageOnly);
  const chatMode = useComposer((s) => s.chatMode);
  const isSubmitting = useComposer((s) => s.isSubmitting);
  const clearReferences = useComposer((s) => s.clearReferences);
  const submit = useComposer((s) => s.submit);
  const editingFromJob = useComposer((s) => s.editingFromJob);
  const clearEditingContext = useComposer((s) => s.clearEditingContext);

  const refreshQueue = useQueueView((s) => s.refresh);

  const [girls, setGirls] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState({ girls: false, library: false });
  const [errors, setErrors] = useState({ girls: '', library: '', submit: '' });
  const [urlInput, setUrlInput] = useState('');
  const [tempUploading, setTempUploading] = useState(false);

  // Load girls
  useEffect(() => {
    const loadGirls = async () => {
      setLoading((p) => ({ ...p, girls: true }));
      try {
        const res = await fetch('/api/girls');
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setGirls(data.girls ?? []);
        setErrors((p) => ({ ...p, girls: '' }));
      } catch (e) {
        setErrors((p) => ({ ...p, girls: e instanceof Error ? e.message : String(e) }));
      } finally {
        setLoading((p) => ({ ...p, girls: false }));
      }
    };
    loadGirls();
  }, []);

  // Load library
  useEffect(() => {
    const loadLibrary = async () => {
      setLoading((p) => ({ ...p, library: true }));
      try {
        const res = await fetch('/api/library?limit=120');
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setLibrary(data.images ?? []);
        setErrors((p) => ({ ...p, library: '' }));
      } catch (e) {
        setErrors((p) => ({ ...p, library: e instanceof Error ? e.message : String(e) }));
      } finally {
        setLoading((p) => ({ ...p, library: false }));
      }
    };
    loadLibrary();
  }, []);

  const selectedGirl = useMemo(() => girls.find((g) => g.id === girlId), [girls, girlId]);

  // Only auto-apply girl refs when NOT editing from a previous output
  useEffect(() => {
    if (editingFromJob) return; // do not override when coming from "Edit This"
    if (selectedGirl?.refImageIds?.length && type === 'generate') {
      setImageIds(selectedGirl.refImageIds);
    }
  }, [selectedGirl, setImageIds, editingFromJob, type]);

  // ----- ordered refs (this is how the backend sends them) -----
  const orderedRefs = useMemo(() => {
    const libMap = new Map(library.map((x) => [x.id, x]));
    const libRefs = imageIds
      .map((id) => libMap.get(id))
      .filter(Boolean)
      .map((img) => ({ kind: 'library', url: img.publicUrl, id: img.id, filename: img.filename }));
    const urlRefs = refUrls.map((url) => ({ kind: 'url', url }));
    return [...libRefs, ...urlRefs]; // imageIds first, then refUrls (matches server)
  }, [imageIds, library, refUrls]);

  const totalRefs = imageIds.length + refUrls.length;
  const limitReached = totalRefs >= 3;

  const handleAddUrl = () => {
    if (limitReached) return;
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    addRefUrl(trimmed);
    setUrlInput('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setErrors((p) => ({ ...p, submit: '' }));
      const jobId = await submit();
      if (jobId) {
        await refreshQueue();
        // Optional: once submitted, you can clear editing context
        // clearEditingContext();
      }
    } catch (err) {
      setErrors((p) => ({
        ...p,
        submit: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  // temp one-time uploader
  const onTempFile = async (file) => {
    if (!file || limitReached) return;
    setTempUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload/temp', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      addRefUrl(data.publicUrl); // append as next URL reference
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setTempUploading(false);
    }
  };

  // Prompt templates
  const applyTemplate = (kind) => {
    const t = {
      leggings: `Replace the leggings from the first image with the leggings from the second image.
Keep the person's face, body proportions, pose, and background exactly the same.
Match the fabric folds and lighting so it looks natural.`,
      object: `Add the object from the second image to the person in the first image.
Place it naturally. Keep face, hair, pose, outfit, and background unchanged.`,
      background: `Keep the person from the first image but replace the background with the background from the second image.
Match lighting and shadows so the subject looks naturally placed.`,
    }[kind];
    setField('prompt', t);
  };

  return (
    <form id="composer" onSubmit={handleSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">

      {/* Editing banner */}
      {editingFromJob && (
        <div className="mb-4 rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200">
          Editing from previous output <span className="font-mono">{String(editingFromJob).slice(0,8)}</span>.
          The <strong>first image</strong> below is that generated image (not a library ref).
        </div>
      )}

      {/* Header + type toggle */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Job Composer</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Assemble prompt, references, and options. Max three references per job.
          </p>
        </div>
        <div className="flex rounded-full border border-slate-200 bg-slate-100 p-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
          {['generate','edit'].map((value) => (
            <button key={value} type="button" onClick={() => setField('type', value)}
              className={cn('rounded-full px-3 py-1 transition',
                type === value ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                               : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white')}>
              {value === 'generate' ? 'Generate' : 'Edit'}
            </button>
          ))}
        </div>
      </div>

      {/* Basic options */}
      <div className="grid gap-6">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Girl</span>
            <select
              value={girlId}
              onChange={(e) => setField('girlId', e.target.value)}
              disabled={Boolean(editingFromJob)} // optional: lock during edit-from-output
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600">
              <option value="">None</option>
              {girls.map((g) => (<option key={g.id} value={g.id}>{g.name || 'Unnamed'}</option>))}
            </select>
            {loading.girls && <span className="text-xs text-slate-500">Loading girls…</span>}
            {errors.girls && <span className="text-xs text-red-500">{errors.girls}</span>}
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Aspect ratio</span>
            <select
              value={aspectRatio}
              onChange={(e) => setField('aspectRatio', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600">
              {ASPECT_RATIOS.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
          </label>
        </div>

        {/* ORDERED REFS PREVIEW (always shows current order) */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Reference order ({orderedRefs.length}/3)
            </span>
            {orderedRefs.length >= 2 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">“First image” is the base; “Second image” is the donor.</span>
            )}
          </div>

          {orderedRefs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              Select library images and/or add URLs. For editing a previous output, click <em>Edit This</em> in the job list.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
              {orderedRefs.map((ref, idx) => (
                <div key={ref.url + idx} className="relative overflow-hidden rounded-xl border shadow-sm dark:border-slate-700">
                  <Image src={ref.url} alt={`ref ${idx+1}`} width={220} height={220} className="h-full w-full object-cover" />
                  <div className="absolute left-2 top-2 flex items-center gap-2">
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase text-white dark:bg-slate-100 dark:text-slate-900">
                      {ordinal(idx)} {idx===0 ? '(first)' : idx===1 ? '(second)' : ''}
                    </span>
                    {ref.kind === 'url' && (
                      <span className="rounded-full bg-indigo-600/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                        URL
                      </span>
                    )}
                    {ref.kind === 'library' && (
                      <span className="rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                        Library
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* LIBRARY PICKER (disabled if already 3 refs) */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Library references ({imageIds.length}/3)
            </span>
            <div className="flex items-center gap-3 text-xs">
              {limitReached && <span className="text-amber-600 dark:text-amber-400">Max 3 references reached</span>}
              {loading.library && <span className="text-slate-500">Loading library…</span>}
            </div>
          </div>

          {errors.library ? (
            <div className="rounded-lg border border-red-400 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/60 dark:bg-red-500/10 dark:text-red-200">
              {errors.library}
            </div>
          ) : library.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              Upload reference images on the Library page.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
              {library.map((img) => {
                const isSelected = imageIds.includes(img.id);
                const ord = isSelected ? ordinal(imageIds.indexOf(img.id)) : null;
                return (
                  <button key={img.id} type="button" disabled={(limitReached && !isSelected)}
                    onClick={() => toggleImageId(img.id)}
                    className={cn(
                      'group relative overflow-hidden rounded-xl border shadow-sm transition focus:outline-none focus:ring-2 focus:ring-slate-500',
                      isSelected
                        ? 'border-slate-900 ring-2 ring-slate-400 dark:border-slate-100 dark:ring-slate-600'
                        : limitReached ? 'border-transparent opacity-40' : 'border-transparent hover:translate-y-[-1px]'
                    )}>
                    <Image src={img.publicUrl} alt={img.filename || 'reference image'} width={200} height={200} className="h-full w-full object-cover" />
                    <span className={cn(
                      'absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                      isSelected
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-white/80 text-slate-600 backdrop-blur dark:bg-slate-900/80 dark:text-slate-200'
                    )}>
                      {isSelected ? ord : 'Tap'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* URL refs + TEMP uploader */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              External/temporary URLs ({refUrls.length}/3)
            </label>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              One‑time images: upload below; they won’t go to the library.
            </div>
          </div>

          {/* Chips */}
          <div className="flex flex-wrap items-center gap-2">
            {refUrls.map((url, i) => (
              <span key={url}
                className="group inline-flex items-center gap-2 rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                  {ordinal(imageIds.length + i)}
                </span>
                <a href={url} target="_blank" rel="noreferrer"
                   className="max-w-[160px] truncate underline decoration-dotted underline-offset-2">
                  {url}
                </a>
                <button type="button" onClick={() => removeRefUrl(url)}
                  className="rounded-full bg-slate-300 px-1 text-[10px] uppercase tracking-wide text-slate-700 transition hover:bg-slate-400 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                  ×
                </button>
              </span>
            ))}

            {/* Add URL input */}
            {refUrls.length + imageIds.length < 3 && (
              <div className="flex items-center gap-2 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-xs dark:border-slate-700 dark:bg-slate-950">
                <input type="url" placeholder="https://…" value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddUrl(); } }}
                  className="w-32 bg-transparent text-xs focus:outline-none"/>
                <button type="button" onClick={handleAddUrl}
                  className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white transition hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                  disabled={!urlInput.trim()}>
                  Add
                </button>
              </div>
            )}
          </div>

          {/* Temp one-time upload */}
          {refUrls.length + imageIds.length < 3 && (
            <div className="mt-2 flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium">
                <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">One‑time image:</span>
                <input type="file" accept="image/*"
                  onChange={(e) => onTempFile(e.target.files?.[0])}
                  disabled={tempUploading}
                  className="text-xs"/>
              </label>
              {tempUploading && <span className="text-xs text-slate-500">Uploading…</span>}
            </div>
          )}
        </div>

        {/* Side-by-side preview for edit scenarios */}
        {orderedRefs.length >= 2 && (
          <div className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                First image (base)
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <Image src={orderedRefs[0].url} alt="first" width={600} height={600} className="h-64 w-full object-cover"/>
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Second image (donor)
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <Image src={orderedRefs[1].url} alt="second" width={600} height={600} className="h-64 w-full object-cover"/>
              </div>
            </div>
          </div>
        )}

        {/* Prompt + tiny templates */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Prompt</span>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Templates:</span>
              <button type="button" onClick={() => applyTemplate('leggings')}
                className="rounded-full border border-slate-300 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                Replace leggings
              </button>
              <button type="button" onClick={() => applyTemplate('object')}
                className="rounded-full border border-slate-300 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                Add object
              </button>
              <button type="button" onClick={() => applyTemplate('background')}
                className="rounded-full border border-slate-300 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                Replace background
              </button>
            </div>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setField('prompt', e.target.value)}
            rows={6}
            placeholder="Describe the edit. Example: Replace the leggings from the first image with the leggings from the second image. Keep the same face and pose. Do not change aspect ratio."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
          />
        </div>

        {/* Options */}
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={imageOnly}
              onChange={(e) => setField('imageOnly', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            Image‑only output
          </label>
          <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={chatMode}
              onChange={(e) => setField('chatMode', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
            Keep chat history (beta)
          </label>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
        <span className="text-slate-500 dark:text-slate-400">
          {orderedRefs.length} references selected · {type === 'edit' ? 'Edit' : 'Generate'} job
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => {
              setField('prompt',''); setField('girlId',''); clearReferences(); clearEditingContext();
            }}
            className="rounded-full border border-slate-300 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            Clear
          </button>
          <button type="submit" disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
            {isSubmitting ? 'Enqueuing…' : 'Enqueue job'}
          </button>
        </div>
      </div>
    </form>
  );
}
```

---

## 5) (Minor) Next Image config for Firebase Storage

If you haven’t already, add remote patterns so `<Image />` can render your Storage URLs.

**`next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: '*.storage.googleapis.com' },
    ],
  },
};

module.exports = nextConfig;
```

---

## 6) How it works end‑to‑end now

1. **Generate an image** as usual in the Dashboard.
2. In **Job Queue**, on a `SUCCEEDED` job click **Edit This**.

    * Composer is prefilled with: `type="edit"`, **FIRST** ref = the generated image URL.
3. In composer, **upload a one‑time image** via **One‑time image** input.

    * This calls `/api/upload/temp` and adds the returned public URL as the **SECOND** ref.
4. Pick a template or write your own edit prompt:

    * *“Replace the leggings from the first image with the leggings from the second image…”*
5. **Enqueue**. The backend already:

    * Fetches both URLs → uploads to **Gemini Files** → preserves **order** (first = base, second = donor)
    * Generates → saves to Storage → updates job.

You now have the full **“previous output + one‑time donor image”** flow with clear order indicators and a simple UI that matches exactly how the backend expects the inputs.

---

## 7) Tiny to‑dos for your agent (quick)

* (Optional) In `JobQueueList`, after clicking **Edit This**, you can also `window.scrollTo(0,0)` or use an element ref to smooth‑scroll to the composer.
* (Optional) Add a small ⚠️ tooltip near “Image‑only output” mentioning that captions can be helpful while iterating.
* (Optional) Add a “Use output as FIRST ref” button wherever you render a single image (e.g., in a girl’s drawer). It should just call `loadJobForEditing({ … })`.
* (Optional) If you want to prevent accidental mixing (girl’s library refs + previous output as FIRST URL), you can disable the library grid whenever `editingFromJob` is truthy.

That’s it—your **Two‑Image Iterative Editing** UI is live and adheres to the exact workflow you outlined.
