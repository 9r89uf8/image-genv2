'use client';

import { useEffect, useState } from "react";

const initialSummary = { today: 0, last7: 0, last30: 0 };

export default function CostMeter() {
  const [summary, setSummary] = useState(initialSummary);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchSummary = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/costs/summary");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSummary({
        today: Number(data.today ?? 0),
        last7: Number(data.last7 ?? 0),
        last30: Number(data.last30 ?? 0),
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Cost Meter</h2>
          <button
            type="button"
            onClick={fetchSummary}
            disabled={isLoading}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Estimated spend using 1290 output tokens per image at $30 / 1M tokens.
        </p>
        {error && (
          <p className="mt-2 rounded-lg border border-rose-400 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </p>
        )}
      </div>

      <dl className="mt-6 grid gap-4 text-sm">
        <CostRow label="Today" value={summary.today} loading={isLoading} />
        <CostRow label="Last 7 days" value={summary.last7} loading={isLoading} />
        <CostRow
          label="Last 30 days"
          value={summary.last30}
          loading={isLoading}
        />
      </dl>
    </div>
  );
}

function CostRow({ label, value, loading }) {
  const formatted = `$${value.toFixed(3)}`;
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
      <dt className="text-slate-600 dark:text-slate-300">{label}</dt>
      <dd className="font-semibold text-slate-900 dark:text-slate-100">
        {loading ? "…" : formatted}
      </dd>
    </div>
  );
}
