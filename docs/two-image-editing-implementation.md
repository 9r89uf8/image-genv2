# Two-Image Iterative Editing Feature 

## Current State Overview

### What Works ✅
- Backend can handle multiple ordered images (up to 3)
- Images can be library references OR external URLs
- Generated images are saved and displayed with public URLs
- Job rerun capability exists
- Image order is maintained through the pipeline (library → URLs)

### What's Missing ❌
- "Edit This" button on generated outputs
- Ability to populate composer with a previous output and be able to see the image
- Temporary upload feature (one-time use images)
- Visual indicators for image order (1st, 2nd, 3rd)
- Prompt templates for multi-image editing

---

## Target Workflow

The desired user flow for editing generated images:

```
1. User generates image → output saved as job.result.publicUrl
   Example: "https://storage.googleapis.com/.../generations/job123.png"

2. User clicks "Edit This" button on the generated output
   → Composer pre-fills with:
     - type: "edit"
     - First reference: the generated image URL (users sees the image)
     - Prompt cleared (ready for edit instructions)

3. User uploads image of object or clothing item ( will not upload to reference library for that girl)
   → Becomes second reference/image
   - NOT saved to library
   - Just used for this edit operation

4. User writes prompt: "replace the leggings from the first image with the leggings from the second image"

5. Submit → Gemini receives:
   - First image: previous generation (as file URI, we don't have to uploaded since its already in firebase)
   - Second image: temporary reference (as file URI, we do have to uploaded)
   - Prompt: edit instruction

6. New edited image is generated and saved
```

---

## Relevant Components & Routes

### 1. JobComposer Component

**File:** `components/JobComposer.js` (386 lines)

**Current Capabilities:**
- Library image selection (grid of thumbnails)
- External URL input field
- Max 3 total references (imageIds + refUrls combined)
- Generate/Edit type toggle
- Prompt textarea with aspect ratio and options

**FUll Code Section:**

```javascript
'use client';

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ASPECT_RATIOS } from "@/lib/constants";
import { useComposer } from "@/store/useComposer";
import { useQueueView } from "@/store/useQueueView";

const cn = (...classes) => classes.filter(Boolean).join(" ");

export default function JobComposer() {
   const type = useComposer((state) => state.type);
   const setField = useComposer((state) => state.setField);
   const girlId = useComposer((state) => state.girlId);
   const setImageIds = useComposer((state) => state.setImageIds);
   const imageIds = useComposer((state) => state.imageIds);
   const toggleImageId = useComposer((state) => state.toggleImageId);
   const refUrls = useComposer((state) => state.refUrls);
   const addRefUrl = useComposer((state) => state.addRefUrl);
   const removeRefUrl = useComposer((state) => state.removeRefUrl);
   const prompt = useComposer((state) => state.prompt);
   const aspectRatio = useComposer((state) => state.aspectRatio);
   const imageOnly = useComposer((state) => state.imageOnly);
   const chatMode = useComposer((state) => state.chatMode);
   const isSubmitting = useComposer((state) => state.isSubmitting);
   const clearReferences = useComposer((state) => state.clearReferences);
   const submit = useComposer((state) => state.submit);

   const refreshQueue = useQueueView((state) => state.refresh);

   const [girls, setGirls] = useState([]);
   const [library, setLibrary] = useState([]);
   const [loading, setLoading] = useState({ girls: false, library: false });
   const [errors, setErrors] = useState({ girls: "", library: "", submit: "" });
   const [urlInput, setUrlInput] = useState("");

   useEffect(() => {
      const loadGirls = async () => {
         setLoading((prev) => ({ ...prev, girls: true }));
         try {
            const res = await fetch("/api/girls");
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            setGirls(data.girls ?? []);
            setErrors((prev) => ({ ...prev, girls: "" }));
         } catch (error) {
            setErrors((prev) => ({
               ...prev,
               girls: error instanceof Error ? error.message : String(error),
            }));
         } finally {
            setLoading((prev) => ({ ...prev, girls: false }));
         }
      };

      loadGirls();
   }, []);

   useEffect(() => {
      const loadLibrary = async () => {
         setLoading((prev) => ({ ...prev, library: true }));
         try {
            const res = await fetch("/api/library?limit=120");
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            setLibrary(data.images ?? []);
            setErrors((prev) => ({ ...prev, library: "" }));
         } catch (error) {
            setErrors((prev) => ({
               ...prev,
               library: error instanceof Error ? error.message : String(error),
            }));
         } finally {
            setLoading((prev) => ({ ...prev, library: false }));
         }
      };

      loadLibrary();
   }, []);

   const selectedGirl = useMemo(
           () => girls.find((girl) => girl.id === girlId),
           [girls, girlId]
   );

   useEffect(() => {
      if (selectedGirl?.refImageIds?.length) {
         setImageIds(selectedGirl.refImageIds);
      }
   }, [selectedGirl, setImageIds]);

   const handleAddUrl = () => {
      if (limitReached) return;
      const trimmed = urlInput.trim();
      if (!trimmed) return;
      addRefUrl(trimmed);
      setUrlInput("");
   };

   const handleSubmit = async (event) => {
      event.preventDefault();
      try {
         setErrors((prev) => ({ ...prev, submit: "" }));
         const jobId = await submit();
         if (jobId) {
            await refreshQueue();
         }
      } catch (error) {
         setErrors((prev) => ({
            ...prev,
            submit: error instanceof Error ? error.message : String(error),
         }));
      }
   };

   const totalRefs = imageIds.length + refUrls.length;
   const limitReached = totalRefs >= 3;

   return (
           <form
                   onSubmit={handleSubmit}
                   className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
           >
              <div className="mb-4 flex items-center justify-between gap-4">
                 <div>
                    <h2 className="text-lg font-semibold">Job Composer</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                       Assemble prompt, references, and options. Max three references per
                       job.
                    </p>
                 </div>
                 <div className="flex rounded-full border border-slate-200 bg-slate-100 p-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
                    {["generate", "edit"].map((value) => (
                            <button
                                    key={value}
                                    type="button"
                                    onClick={() => setField("type", value)}
                                    className={cn(
                                            "rounded-full px-3 py-1 transition",
                                            type === value
                                                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                                    )}
                            >
                               {value === "generate" ? "Generate" : "Edit"}
                            </button>
                    ))}
                 </div>
              </div>

              <div className="grid gap-6">
                 <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm">
                       <span className="font-medium text-slate-700 dark:text-slate-200">
                          Girl
                       </span>
                       <select
                               value={girlId}
                               onChange={(event) => setField("girlId", event.target.value)}
                               className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
                       >
                          <option value="">None</option>
                          {girls.map((girl) => (
                                  <option key={girl.id} value={girl.id}>
                                     {girl.name || "Unnamed"}
                                  </option>
                          ))}
                       </select>
                       {loading.girls && (
                               <span className="text-xs text-slate-500">Loading girls…</span>
                       )}
                       {errors.girls && (
                               <span className="text-xs text-red-500">{errors.girls}</span>
                       )}
                    </label>

                    <label className="flex flex-col gap-2 text-sm">
                       <span className="font-medium text-slate-700 dark:text-slate-200">
                          Aspect ratio
                       </span>
                       <select
                               value={aspectRatio}
                               onChange={(event) => setField("aspectRatio", event.target.value)}
                               className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
                       >
                          {ASPECT_RATIOS.map((ratio) => (
                                  <option key={ratio} value={ratio}>
                                     {ratio}
                                  </option>
                          ))}
                       </select>
                    </label>
                 </div>

                 <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                       <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                          Library references ({imageIds.length}/3)
                       </span>
                       <div className="flex items-center gap-3 text-xs">
                          {limitReached && (
                                  <span className="text-amber-600 dark:text-amber-400">
                                     Max 3 references reached
                                  </span>
                          )}
                          {loading.library && (
                                  <span className="text-slate-500">Loading library…</span>
                          )}
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
                               {library.map((image) => {
                                  const isSelected = imageIds.includes(image.id);
                                  return (
                                          <button
                                                  key={image.id}
                                                  type="button"
                                                  onClick={() => toggleImageId(image.id)}
                                                  disabled={limitReached && !isSelected}
                                                  className={cn(
                                                          "group relative overflow-hidden rounded-xl border shadow-sm transition focus:outline-none focus:ring-2 focus:ring-slate-500",
                                                          isSelected
                                                                  ? "border-slate-900 ring-2 ring-slate-400 dark:border-slate-100 dark:ring-slate-600"
                                                                  : limitReached
                                                                          ? "border-transparent opacity-40"
                                                                          : "border-transparent hover:translate-y-[-1px]"
                                                  )}
                                          >
                                             <Image
                                                     src={image.publicUrl}
                                                     alt={image.filename || "reference image"}
                                                     width={200}
                                                     height={200}
                                                     className="h-full w-full object-cover"
                                             />
                                             <span
                                                     className={cn(
                                                             "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                                                             isSelected
                                                                     ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                                                     : "bg-white/80 text-slate-600 backdrop-blur dark:bg-slate-900/80 dark:text-slate-200"
                                                     )}
                                             >
                                                {isSelected ? "Selected" : "Tap"}
                                             </span>
                                          </button>
                                  );
                               })}
                            </div>
                    )}
                 </div>

                 <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                       External reference URLs ({refUrls.length}/3)
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                       {refUrls.map((url) => (
                               <span
                                       key={url}
                                       className="group inline-flex items-center gap-2 rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100"
                               >
                                  <a
                                          href={url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="max-w-[160px] truncate underline decoration-dotted underline-offset-2"
                                  >
                                     {url}
                                  </a>
                                  <button
                                          type="button"
                                          onClick={() => removeRefUrl(url)}
                                          className="rounded-full bg-slate-300 px-1 text-[10px] uppercase tracking-wide text-slate-700 transition hover:bg-slate-400 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500"
                                  >
                                     ×
                                  </button>
                               </span>
                       ))}
                       {refUrls.length < 3 && (
                               <div className="flex items-center gap-2 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-xs dark:border-slate-700 dark:bg-slate-950">
                                  <input
                                          type="url"
                                          placeholder="https://…"
                                          value={urlInput}
                                          onChange={(event) => setUrlInput(event.target.value)}
                                          onKeyDown={(event) => {
                                             if (event.key === "Enter") {
                                                event.preventDefault();
                                                handleAddUrl();
                                             }
                                          }}
                                          className="w-32 bg-transparent text-xs focus:outline-none"
                                  />
                                  <button
                                          type="button"
                                          onClick={handleAddUrl}
                                          className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white transition hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                                          disabled={!urlInput.trim() || limitReached}
                                  >
                                     Add
                                  </button>
                               </div>
                       )}
                    </div>
                 </div>

                 <label className="grid gap-2 text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                       Prompt
                    </span>
                    <textarea
                            value={prompt}
                            onChange={(event) => setField("prompt", event.target.value)}
                            rows={6}
                            placeholder="Describe the scene, clothing, lighting, and identity constraints."
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
                    />
                 </label>

                 <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
                       <input
                               type="checkbox"
                               checked={imageOnly}
                               onChange={(event) => setField("imageOnly", event.target.checked)}
                               className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                       />
                       Image-only output
                    </label>
                    <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
                       <input
                               type="checkbox"
                               checked={chatMode}
                               onChange={(event) => setField("chatMode", event.target.checked)}
                               className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                       />
                       Keep chat history (beta)
                    </label>
                 </div>
              </div>

              {errors.submit && (
                      <p className="mt-4 rounded-lg border border-rose-400 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
                         {errors.submit}
                      </p>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
                 <span className="text-slate-500 dark:text-slate-400">
                    {totalRefs} references selected · {type === "edit" ? "Edit" : "Generate"}{" "}
                    job
                 </span>
                 <div className="flex gap-2">
                    <button
                            type="button"
                            onClick={() => {
                               setField("prompt", "");
                               setField("girlId", "");
                               clearReferences();
                            }}
                            className="rounded-full border border-slate-300 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                       Clear
                    </button>
                    <button
                            type="submit"
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                       {isSubmitting ? "Enqueuing…" : "Enqueue job"}
                    </button>
                 </div>
              </div>
           </form>
   );
}
```

**What's Missing:**
- No visual indicators of image order (1st, 2nd, 3rd)
- No temporary file upload input
- No way to pre-populate from a job result

---

### 2. JobQueueList Component

**File:** `components/JobQueueList.js` (207 lines)

**Current Capabilities:**
- Displays all jobs with status badges
- Shows generated image thumbnails
- Actions: Cancel, Download, Rerun, Delete
- Auto-polling every few seconds

**Full Code Sections:**

```javascript
'use client';

import { useEffect } from "react";
import Image from "next/image";
import { useQueueView } from "@/store/useQueueView";

const statusStyles = {
   PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
   RUNNING: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200",
   SUCCEEDED:
           "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
   FAILED: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
   CANCELLED:
           "bg-slate-200 text-slate-600 dark:bg-slate-700/50 dark:text-slate-200",
};

const formatDate = (value) => {
   if (!value) return "—";
   const date = new Date(value);
   if (Number.isNaN(date.getTime())) return "—";
   return date.toLocaleString();
};

const formatCost = (cost) => {
   if (cost === null || cost === undefined) return "—";
   return `$${Number(cost).toFixed(3)}`;
};

export default function JobQueueList() {
   const jobs = useQueueView((state) => state.jobs);
   const isLoading = useQueueView((state) => state.isLoading);
   const error = useQueueView((state) => state.error);
   const refresh = useQueueView((state) => state.refresh);
   const startPolling = useQueueView((state) => state.startPolling);
   const stopPolling = useQueueView((state) => state.stopPolling);
   const cancelJob = useQueueView((state) => state.cancelJob);
   const deleteJob = useQueueView((state) => state.deleteJob);
   const rerunJob = useQueueView((state) => state.rerunJob);

   useEffect(() => {
      startPolling();
      return () => stopPolling();
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   return (
           <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                 <div>
                    <h2 className="text-lg font-semibold">Job Queue</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                       Live view of pending, running, and completed generations.
                    </p>
                 </div>
                 <button
                         type="button"
                         onClick={refresh}
                         disabled={isLoading}
                         className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                 >
                    Refresh
                 </button>
              </div>

              {error && (
                      <div className="mb-4 rounded-lg border border-rose-400 bg-rose-100 p-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
                         {error}
                      </div>
              )}

              {jobs.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                         {isLoading
                                 ? "Loading jobs…"
                                 : "No jobs yet. Compose one from the panel above."}
                      </div>
              ) : (
                      <div className="grid gap-4">
                         {jobs.map((job) => {
                            const statusStyle = statusStyles[job.status] ?? statusStyles.PENDING;
                            const canCancel = ["PENDING", "RUNNING"].includes(job.status);
                            const canRerun = ["SUCCEEDED", "FAILED"].includes(job.status);
                            const canDelete = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(
                                    job.status
                            );

                            return (
                                    <article
                                            key={job.id}
                                            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
                                    >
                                       <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
                                          <div className="flex items-center gap-3">
                                             <span
                                                     className={`rounded-full px-2 py-1 text-xs font-semibold ${statusStyle}`}
                                             >
                                                {job.status}
                                             </span>
                                             <span className="text-slate-500 dark:text-slate-400">
                                                {job.type === "edit" ? "Edit" : "Generate"} · ID {job.id}
                                             </span>
                                          </div>
                                          <span className="text-xs text-slate-400">
                                             Created {formatDate(job.createdAt)}
                                          </span>
                                       </header>

                                       <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_160px]">
                                          <div className="space-y-2 text-sm">
                                             <p className="whitespace-pre-line text-slate-700 dark:text-slate-200">
                                                {job.prompt || "—"}
                                             </p>
                                             <div className="grid gap-1 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-2">
                                                <span>
                                                   Finished: {job.finishedAt ? formatDate(job.finishedAt) : "—"}
                                                </span>
                                                <span>Cost: {formatCost(job.costUsd)}</span>
                                                <span>
                                                   Images out: {job.usage?.imagesOut ?? "—"}
                                                </span>
                                                <span>Retries: {job.retries ?? 0}</span>
                                             </div>
                                             {job.error && (
                                                     <p className="rounded-lg border border-rose-400 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
                                                        {job.error}
                                                     </p>
                                             )}
                                          </div>

                                          {job.result?.publicUrl ? (
                                                  <a
                                                          href={job.result.publicUrl}
                                                          target="_blank"
                                                          rel="noreferrer"
                                                          className="group relative block overflow-hidden rounded-lg border border-slate-200 transition hover:shadow-lg dark:border-slate-700"
                                                  >
                                                     <Image
                                                             src={job.result.publicUrl}
                                                             alt="Generated output"
                                                             width={160}
                                                             height={160}
                                                             className="h-40 w-full object-cover"
                                                     />
                                                     <span className="absolute inset-x-2 bottom-2 rounded-full bg-white/80 px-2 py-1 text-center text-[11px] font-medium text-slate-700 backdrop-blur dark:bg-slate-900/80 dark:text-slate-200">
                                                        Open full image
                                                     </span>
                                                  </a>
                                          ) : (
                                                  <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                                                     Awaiting output
                                                  </div>
                                          )}
                                       </div>

                                       <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/60">
                                          <span className="text-xs text-slate-500 dark:text-slate-400">
                                             Aspect ratio: {job.inputs?.aspectRatio ?? "—"} · Image-only:{" "}
                                             {job.inputs?.imageOnly ? "Yes" : "No"}
                                          </span>
                                          <div className="flex flex-wrap items-center gap-2">
                                             {canCancel && (
                                                     <button
                                                             type="button"
                                                             onClick={() => cancelJob(job.id)}
                                                             className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                                                     >
                                                        Cancel
                                                     </button>
                                             )}
                                             {job.result?.publicUrl && (
                                                     <a
                                                             href={job.result.publicUrl}
                                                             download
                                                             className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                                                     >
                                                        Download
                                                     </a>
                                             )}
                                             {canRerun && (
                                                     <button
                                                             type="button"
                                                             onClick={() => rerunJob(job.id)}
                                                             className="rounded-full border border-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-900/90 dark:border-slate-100 dark:text-slate-100 dark:hover:bg-slate-100/80"
                                                     >
                                                        Rerun
                                                     </button>
                                             )}
                                             {canDelete && (
                                                     <button
                                                             type="button"
                                                             onClick={() => deleteJob(job.id)}
                                                             className="rounded-full border border-rose-400 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/60 dark:text-rose-300 dark:hover:bg-rose-500/20"
                                                     >
                                                        Delete
                                                     </button>
                                             )}
                                          </div>
                                       </footer>
                                    </article>
                            );
                         })}
                      </div>
              )}
           </div>
   );
}

```

**What's Missing:**
- No "Edit This" button to load result into composer
- Rerun button just repeats job (doesn't populate composer for editing)

---

### 3. Zustand Composer Store

**File:** `store/useComposer.js` (88 lines)

**Current State Shape:**

```javascript
'use client';

import { create } from "zustand";
import { ASPECT_RATIOS } from "@/lib/constants";

const defaultState = {
   type: "generate",
   girlId: "",
   imageIds: [],
   refUrls: [],
   prompt: "",
   aspectRatio: ASPECT_RATIOS[0],
   imageOnly: false,
   chatMode: false,
   isSubmitting: false,
};

export const useComposer = create((set, get) => ({
   ...defaultState,
   setField: (field, value) => set({ [field]: value }),
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
         set({ imageIds: imageIds.filter((item) => item !== id) });
      } else {
         if (imageIds.length >= maxImages) return;
         set({ imageIds: [...imageIds, id] });
      }
   },
   addRefUrl: (url) => {
      const { refUrls, imageIds } = get();
      if (refUrls.includes(url)) return;
      if (refUrls.length + imageIds.length >= 3) return;
      set({ refUrls: [...refUrls, url] });
   },
   removeRefUrl: (url) =>
           set({ refUrls: get().refUrls.filter((item) => item !== url) }),
   setRefUrls: (urls) => {
      const imageIds = get().imageIds;
      const maxUrls = Math.max(0, 3 - imageIds.length);
      const unique = Array.from(new Set(urls));
      set({ refUrls: unique.slice(0, maxUrls) });
   },
   clearReferences: () => set({ imageIds: [], refUrls: [] }),
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
         const res = await fetch("/api/jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
         });

         if (!res.ok) {
            const message = await res.text();
            throw new Error(message || "Failed to create job");
         }

         const data = await res.json();
         return data.jobId;
      } finally {
         set({ isSubmitting: false });
      }
   },
}));

```

**What's Missing:**
- No `tempFiles` state for temporary uploads
- No `loadJobForEditing(job)` action to pre-populate from result

---

### 4. Job Executor (Backend)

**File:** `lib/job-executor.js` (124 lines)

**How It Processes References:**

```javascript
import { bucket, Timestamp } from "./firebase-admin";
import {
   ensureFileUriForLibraryImage,
   ensureFileUriFromUrl,
} from "./files";
import { estimateCostUsd } from "./costs";
import { generateImage } from "./gemini";
import { getJob, updateJob } from "./db";
import { TOKENS_PER_IMAGE } from "./constants";

async function saveImageBufferToStorage(jobId, { buffer, mimeType }) {
   const ext = mimeType.includes("png")
           ? "png"
           : mimeType.includes("webp")
                   ? "webp"
                   : "jpg";

   const storagePath = `generations/${jobId}.${ext}`;
   const file = bucket.file(storagePath);

   await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
      public: true,
      metadata: {
         cacheControl: "public,max-age=31536000,immutable",
      },
   });

   try {
      await file.makePublic();
   } catch {
      // On emulators we may not have IAM perms; ignore and rely on signed URLs if configured.
   }

   const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

   return { storagePath, publicUrl };
}

export async function executeJob(jobId) {
   const jobSnapshot = await getJob(jobId);
   if (!jobSnapshot) {
      return { status: "NOT_FOUND" };
   }

   if (jobSnapshot.status === "CANCELLED") {
      return { status: "CANCELLED" };
   }

   await updateJob(jobId, {
      status: "RUNNING",
      startedAt: Timestamp.now(),
      error: null,
   });

   try {
      const prompt = jobSnapshot.prompt ?? "";
      const inputs = jobSnapshot.inputs ?? {};
      const {
         imageIds = [],
         refUrls = [],
         aspectRatio = "1:1",
         imageOnly = false,
      } = inputs;

      const fileRefs = [];

      for (const imageId of imageIds) {
         const ref = await ensureFileUriForLibraryImage(imageId);
         fileRefs.push(ref);
      }

      for (const url of refUrls) {
         const ref = await ensureFileUriFromUrl(url);
         fileRefs.push(ref);
      }

      const output = await generateImage({
         fileRefs,
         prompt,
         aspectRatio,
         imageOnly,
      });

      if (!output.images.length) {
         throw new Error("Model returned no images");
      }

      const primary = output.images[0];
      const saved = await saveImageBufferToStorage(jobId, primary);

      const imagesOut = output.images.length;
      const usage = {
         imagesOut,
         outputTokens: imagesOut * TOKENS_PER_IMAGE,
      };
      const costUsd = estimateCostUsd({ imagesOut });

      await updateJob(jobId, {
         status: "SUCCEEDED",
         finishedAt: Timestamp.now(),
         result: {
            ...saved,
            note: output.text ?? "",
         },
         usage,
         costUsd,
      });

      return { status: "SUCCEEDED" };
   } catch (error) {
      const retries = (jobSnapshot.retries || 0) + 1;
      await updateJob(jobId, {
         status: "FAILED",
         error: error instanceof Error ? error.message : String(error),
         retries,
         finishedAt: Timestamp.now(),
      });

      return { status: "FAILED", retries };
   }
}

```

**Key Points:**
- ✅ Already handles ordered arrays: imageIds → refUrls
- ✅ Can accept generated output URLs in `refUrls`
- ✅ Maintains order through entire pipeline
- ✅ No changes needed to support your workflow

---

### 5. Files Handler

**File:** `lib/files.js`

**Full code:**

```javascript
import { Blob } from "buffer";
import { GoogleGenAI } from "@google/genai";
import { bucket, db, Timestamp } from "./firebase-admin";
import { FILE_URI_TTL_MS } from "./constants";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function readStorageBytes(storagePath) {
   const [buffer] = await bucket.file(storagePath).download();
   return buffer;
}

export async function uploadToGeminiFiles(
        buffer,
        mimeType = "image/png",
        displayName = "reference.png"
) {
   const blob = new Blob([buffer], { type: mimeType });
   const file = await ai.files.upload({
      file: blob,
      config: { mimeType, displayName },
   });
   const fileUri = file.uri || file.name;
   return { fileUri, mimeType };
}

export async function ensureFileUriForLibraryImage(imageId) {
   const cacheRef = db.collection("filesCache").doc(imageId);
   const cacheSnap = await cacheRef.get();
   const now = Date.now();

   if (cacheSnap.exists) {
      const data = cacheSnap.data();
      if (
              data?.fileUri &&
              data?.expiresAtMs &&
              data.expiresAtMs > now + 5 * 60 * 1000
      ) {
         return { fileUri: data.fileUri, mimeType: data.mimeType ?? "image/png" };
      }
   }

   const libDoc = await db.collection("library").doc(imageId).get();

   if (!libDoc.exists) {
      throw new Error(`library imageId not found: ${imageId}`);
   }

   const { storagePath, mimeType, filename } = libDoc.data();
   const buffer = await readStorageBytes(storagePath);
   const uploaded = await uploadToGeminiFiles(
           buffer,
           mimeType,
           filename || `${imageId}.png`
   );

   await cacheRef.set({
      fileUri: uploaded.fileUri,
      mimeType: uploaded.mimeType,
      expiresAtMs: now + FILE_URI_TTL_MS,
      updatedAt: Timestamp.now(),
   });

   return uploaded;
}

export async function ensureFileUriFromUrl(url, mimeType = "image/png") {
   const response = await fetch(url);
   if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
   }
   const arrayBuffer = await response.arrayBuffer();
   const buffer = Buffer.from(arrayBuffer);
   return uploadToGeminiFiles(buffer, mimeType);
}

```

**Key Points:**
- ✅ `ensureFileUriFromUrl` can fetch ANY URL (including generated outputs)
- ✅ Automatically uploads to Gemini Files API
- ✅ Returns fileUri that Gemini can use in prompts
- ✅ No changes needed

---

### 6. API Routes

**File:** `app/api/jobs/route.js`

```javascript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createJobDoc, listJobs } from "@/lib/db";
import { queue } from "@/lib/queue";

function serializeTimestamp(value) {
   if (!value) return null;
   if (typeof value.toDate === "function") {
      return value.toDate().toISOString();
   }
   return value;
}

function serializeJob(job) {
   if (!job) return null;
   return {
      ...job,
      createdAt: serializeTimestamp(job.createdAt),
      startedAt: serializeTimestamp(job.startedAt),
      finishedAt: serializeTimestamp(job.finishedAt),
   };
}

export async function GET() {
   const jobs = await listJobs(50);
   return Response.json({ jobs: jobs.map(serializeJob) });
}

export async function POST(request) {
   const body = await request.json();

   const jobId = await createJobDoc({
      type: body.type || "generate",
      prompt: body.prompt || "",
      inputs: body.inputs || {},
      girlId: body.girlId ?? null,
      rerunOf: body.rerunOf ?? null,
   });

   queue.add(jobId);

   return Response.json({ jobId });
}

```

**File:** `app/api/jobs/[id]/rerun/route.js`

```javascript
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db } from "@/lib/firebase-admin";
import { createJobDoc, getJob } from "@/lib/db";
import { queue } from "@/lib/queue";

export async function POST(request, { params }) {
   const original = await getJob(params.id);
   if (!original) {
      return new Response("not found", { status: 404 });
   }

   const body = await request.json().catch(() => ({}));
   const prompt = body.prompt ?? original.prompt;

   const jobId = await createJobDoc({
      type: original.type,
      prompt,
      inputs: original.inputs,
      girlId: original.girlId ?? null,
      rerunOf: params.id,
   });

   await db.collection("jobs").doc(params.id).update({
      lastRerunId: jobId,
   });

   queue.add(jobId);

   return Response.json({ jobId });
}
```

**Key Points:**
- ✅ Accepts `refUrls` array with ANY valid URLs
- ✅ Rerun endpoint exists but doesn't populate composer
- ✅ No API changes needed

---

## Data Flow: Current vs Needed

### Current Flow (Generate)

```
1. User selects library images
   → imageIds: ["lib1", "lib2"]

2. User adds external URL
   → refUrls: ["https://example.com/image.jpg"]

3. Submit → POST /api/jobs
   → Creates job doc in Firestore

4. Queue picks up job
   → Calls executeJob(jobId)

5. Executor processes references:
   - ensureFileUriForLibraryImage("lib1") → { fileUri: "files/abc123" }
   - ensureFileUriForLibraryImage("lib2") → { fileUri: "files/def456" }
   - ensureFileUriFromUrl("https://...") → { fileUri: "files/ghi789" }

6. Call Gemini:
   generateImage({
     fileRefs: [
       { fileUri: "files/abc123", mimeType: "image/png" },
       { fileUri: "files/def456", mimeType: "image/jpeg" },
       { fileUri: "files/ghi789", mimeType: "image/png" }
     ],
     prompt: "create image with these references"
   })

7. Gemini receives ordered images
   → Prompt can reference "first image", "second image", "third image"

8. Save output
   → job.result.publicUrl = "https://storage.googleapis.com/.../job123.png"
```

### Needed Flow (Edit Generated Output)

```
1. User generates image
   → job.result.publicUrl = "https://storage.googleapis.com/.../job123.png"

2. User clicks "Edit This" button
   → Composer pre-fills:
     - type: "edit"
     - refUrls: ["https://storage.googleapis.com/.../job123.png"]
     - imageIds: []
     - prompt: ""
     - girlId: original girlId (optional)

3. User uploads temporary reference file OR adds second URL
   → refUrls: [
       "https://storage.googleapis.com/.../job123.png",  // First
       "https://example.com/leggings.jpg"                 // Second
     ]

4. User writes prompt:
   "Replace the leggings from the first image with the leggings from the second image.
    Keep face, body, and background the same."

5. Submit → POST /api/jobs
   → Same flow as above

6. Executor processes:
   - ensureFileUriFromUrl("https://.../job123.png") → { fileUri: "files/prev" }
   - ensureFileUriFromUrl("https://.../leggings.jpg") → { fileUri: "files/new" }

7. Gemini receives:
   - First image: previous generation
   - Second image: new reference
   - Prompt: edit instruction with "first" and "second"

8. Generates edited result
   → New output saved with edited content
```

---


2. Add visual separator showing "First Image" / "Second Image" sections
3. Show count: "1st of 3" / "2nd of 3" / "3rd of 3"

**Deliverable:** Users can clearly see which image is "first" vs "second"

---

2. Add side-by-side preview when two images are loaded
5. Add example prompts in UI tooltip

**Deliverable:** Professional-grade editing UX

---

## API Compatibility Notes

### No Breaking Changes Required ✅

The existing API already supports everything needed:

1. **POST /api/jobs** accepts `refUrls` array
   - Can contain any valid URL (library, external, generated outputs)
   - Already maintains order

2. **Backend processes URLs in order**
   - First calls `ensureFileUriForLibraryImage` for `imageIds`
   - Then calls `ensureFileUriFromUrl` for `refUrls`
   - Maintains order in `fileRefs` array passed to Gemini

3. **Gemini receives ordered file references**
   - Prompt can reference "first image", "second image", "third image"
   - Model understands positional references


## Example Prompts for Two-Image Editing

### Clothing Transfer
```
Replace the leggings from the first image with the leggings from the second image.
Keep the person's face, body proportions, pose, and background exactly the same.
Match the fabric folds and lighting to make it look natural.
```

### Object Addition
```
Add the jacket from the second image to the person in the first image.
The person should be wearing the jacket naturally.
Keep everything else the same including face, hair, background, and lighting.
```

### Background Replacement
```
Keep the person from the first image but replace the background with the
background from the second image. Maintain proper lighting and shadows
so the person looks naturally placed in the new environment.
```

### Style Transfer
```
Apply the lighting and color grading style from the second image to the
first image. Keep the composition, pose, and clothing the same, but match
the mood and atmosphere of the second image.
```

---

## Conclusion

**The backend is already fully capable of supporting two-image editing.**

