'use client';

import Image from "next/image";
import { useComposer } from "@/store/useComposer";
import { MAX_REFERENCES, CONTEXT_TYPES } from "@/lib/constants";

const cn = (...classes) => classes.filter(Boolean).join(" ");

export default function LibraryGrid({ images, loading, error, onRefresh }) {
  const imageIds = useComposer((state) => state.imageIds);
  const refUrls = useComposer((state) => state.refUrls);
  const contextSelections = useComposer((state) => state.contextSelections);
  const contextAssets = useComposer((state) => state.contextAssets);
  const toggleImageId = useComposer((state) => state.toggleImageId);
  const setImageIds = useComposer((state) => state.setImageIds);

  const contextImageCount = CONTEXT_TYPES.reduce((count, type) => {
    const selection = contextSelections[type];
    const asset = contextAssets[type];
    if (selection?.useImage && asset?.imageId) {
      return count + 1;
    }
    return count;
  }, 0);

  const maxManualSlots = Math.max(
    0,
    MAX_REFERENCES - refUrls.length - contextImageCount
  );
  const manualSlotsRemaining = Math.max(
    0,
    maxManualSlots - imageIds.length
  );
  const limitReached = manualSlotsRemaining <= 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Reference Library</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Tap an image to toggle it in the composer. Manual slots left: {manualSlotsRemaining}
            {contextImageCount > 0
              ? ` • Context images active: ${contextImageCount}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setImageIds([])}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Clear selection
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-400 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      )}

      {limitReached && (
        <div className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
          Manual slots are full. Remove a reference or disable a context image to add more.
        </div>
      )}

      {images.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {loading ? "Loading images…" : "No reference images uploaded yet."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => {
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
                    ? "border-slate-200 opacity-40 dark:border-slate-700"
                    : "border-transparent hover:translate-y-[-1px]"
                )}
              >
                <Image
                  src={image.publicUrl}
                  alt={image.filename || "reference image"}
                  width={240}
                  height={240}
                  className="h-40 w-full object-cover"
                />
                <div className="absolute inset-x-2 bottom-2 flex items-center justify-between rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-600 backdrop-blur dark:bg-slate-900/80 dark:text-slate-200">
                  <span>{isSelected ? "Selected" : "Tap to use"}</span>
                  <span>{image.width && image.height ? `${image.width}×${image.height}` : ""}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
