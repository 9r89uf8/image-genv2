'use client';

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useComposer } from "@/store/useComposer";
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
  const router = useRouter();
  const loadJobForEditing = useComposer((state) => state.loadJobForEditing);
  const jobs = useQueueView((state) => state.jobs);
  const isLoading = useQueueView((state) => state.isLoading);
  const error = useQueueView((state) => state.error);
  const refresh = useQueueView((state) => state.refresh);
  const startPolling = useQueueView((state) => state.startPolling);
  const stopPolling = useQueueView((state) => state.stopPolling);
  const cancelJob = useQueueView((state) => state.cancelJob);
  const deleteJob = useQueueView((state) => state.deleteJob);
  const rerunJob = useQueueView((state) => state.rerunJob);
  const [girls, setGirls] = useState([]);
  const [selectedGirlId, setSelectedGirlId] = useState("");
  const [girlsError, setGirlsError] = useState("");
  const [isGirlsLoading, setIsGirlsLoading] = useState(false);
  const [copiedJobId, setCopiedJobId] = useState(null);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadGirls = async () => {
      setIsGirlsLoading(true);
      try {
        const res = await fetch("/api/girls");
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        if (!isMounted) return;
        setGirls(Array.isArray(data.girls) ? data.girls : []);
        setGirlsError("");
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error ? err.message : "Unable to load girls.";
        setGirlsError(message);
      } finally {
        if (isMounted) {
          setIsGirlsLoading(false);
        }
      }
    };

    loadGirls();

    return () => {
      isMounted = false;
    };
  }, []);

  const girlOptions = useMemo(() => {
    const sortedGirls = [...girls].sort((a, b) => {
      const nameA = (a?.name || "").toLowerCase();
      const nameB = (b?.name || "").toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });

    const options = [
      { value: "", label: "All girls" },
      ...sortedGirls.map((girl) => ({
        value: girl.id ?? "",
        label: girl.name?.trim() || "Untitled",
      })),
    ];

    if (
      selectedGirlId &&
      !options.some((option) => option.value === selectedGirlId)
    ) {
      options.push({ value: selectedGirlId, label: "Unknown girl" });
    }

    return options;
  }, [girls, selectedGirlId]);

  const girlNameById = useMemo(() => {
    return girls.reduce((acc, girl) => {
      if (!girl?.id) {
        return acc;
      }
      const trimmed = typeof girl.name === "string" ? girl.name.trim() : "";
      acc[girl.id] = trimmed.length > 0 ? trimmed : "Untitled";
      return acc;
    }, {});
  }, [girls]);

  const filteredJobs = useMemo(() => {
    if (!selectedGirlId) return jobs;
    return jobs.filter((job) => job?.girlId === selectedGirlId);
  }, [jobs, selectedGirlId]);

  const hasFilterApplied = Boolean(selectedGirlId);

  const handleDownload = async (url, jobId) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch image');
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `image-${jobId}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed:', error);
      // Fallback: open in new tab
      window.open(url, '_blank');
    }
  };

  const handleCopyPrompt = async (prompt, jobId) => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedJobId(jobId);
      setTimeout(() => setCopiedJobId(null), 2000);
    } catch (error) {
      console.error('Failed to copy prompt:', error);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Job Queue</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Live view of pending, running, and completed generations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col text-left">
            <label
              htmlFor="job-queue-girl-filter"
              className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400"
            >
              Filter by girl
            </label>
            <select
              id="job-queue-girl-filter"
              value={selectedGirlId}
              onChange={(event) => setSelectedGirlId(event.target.value)}
              className="mt-1 min-w-[160px] rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500"
              disabled={isGirlsLoading && girlOptions.length <= 1}
            >
              {isGirlsLoading && girlOptions.length <= 1 ? (
                <option value="">Loading girls…</option>
              ) : (
                girlOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
            {girlsError && (
              <span className="mt-1 text-xs text-rose-500 dark:text-rose-300">
                {girlsError}
              </span>
            )}
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
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-400 bg-rose-100 p-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      )}

      {filteredJobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {isLoading
            ? "Loading jobs…"
            : hasFilterApplied
            ? "No jobs found for this girl yet."
            : "No jobs yet. Compose one from the panel above."}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredJobs.map((job) => {
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
                    {job.girlId && (
                      <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
                        {girlNameById[job.girlId] ?? "Unknown girl"}
                      </span>
                    )}
                    {/*<span className="text-slate-500 dark:text-slate-400">*/}
                    {/*  {job.type === "edit" ? "Edit" : "Generate"} · ID {job.id}*/}
                    {/*</span>*/}
                  </div>
                  <span className="text-xs text-slate-400">
                    Created {formatDate(job.createdAt)}
                  </span>
                </header>

                <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_160px]">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 whitespace-pre-line text-slate-700 dark:text-slate-200">
                        {job.prompt || "—"}
                      </p>
                      {job.prompt && (
                        <button
                          type="button"
                          onClick={() => handleCopyPrompt(job.prompt, job.id)}
                          className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {copiedJobId === job.id ? "Copied!" : "Copy"}
                        </button>
                      )}
                    </div>
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
                    {job.status === "SUCCEEDED" && job.result?.publicUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          loadJobForEditing(job);
                          router.push("/#composer");
                        }}
                        className="rounded-full border border-indigo-500 px-3 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 dark:border-indigo-400/60 dark:text-indigo-300 dark:hover:bg-indigo-400/10"
                      >
                        Edit This
                      </button>
                    )}
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
                      <button
                        type="button"
                        onClick={() => handleDownload(job.result.publicUrl, job.id)}
                        className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Download
                      </button>
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
