'use client';

import { create } from "zustand";

const ACTIVE_STATUSES = new Set(["PENDING", "RUNNING"]);
const POLL_INTERVAL_MS = 2500;

const hasActiveJobs = (jobs = []) =>
  jobs.some((job) => job && ACTIVE_STATUSES.has(job.status));

export const useQueueView = create((set, get) => {
  let pollHandle = null;

  const clearPoll = () => {
    clearTimeout(pollHandle);
    pollHandle = null;
  };

  const scheduleNextPoll = () => {
    clearPoll();
    if (!get().isPolling) return;
    pollHandle = setTimeout(async () => {
      await get().refresh();
    }, POLL_INTERVAL_MS);
  };

  const handlePollingState = (jobs) => {
    const active = hasActiveJobs(jobs);
    const { isPolling } = get();

    if (active) {
      if (!isPolling) {
        set({ isPolling: true });
      }
      scheduleNextPoll();
    } else {
      if (isPolling) {
        set({ isPolling: false });
      }
      clearPoll();
    }
  };

  return {
    jobs: [],
    isLoading: false,
    error: null,
    isPolling: false,

    refresh: async () => {
      set({ isLoading: true, error: null });
      try {
        const res = await fetch("/api/jobs");
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        const jobs = data.jobs ?? [];
        set({ jobs });
        handlePollingState(jobs);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
        if (get().isPolling) {
          scheduleNextPoll();
        }
      } finally {
        set({ isLoading: false });
      }
    },

    startPolling: async () => {
      await get().refresh();
    },

    stopPolling: () => {
      set({ isPolling: false });
      clearPoll();
    },

    cancelJob: async (jobId) => {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      await get().refresh();
    },

    deleteJob: async (jobId) => {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      await get().refresh();
    },

    rerunJob: async (jobId, prompt) => {
      await fetch(`/api/jobs/${jobId}/rerun`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          prompt !== undefined ? { prompt } : {}
        ),
      });
      await get().refresh();
    },
  };
});
