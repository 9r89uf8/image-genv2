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
