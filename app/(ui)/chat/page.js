import { Suspense } from "react";
import ChatPageClient from "./ChatPageClient";

function ChatPageFallback() {
  return (
    <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Sessions</h2>
          <div className="h-7 w-14 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="space-y-2">
          <div className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      </aside>
      <main className="min-h-[70vh] rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="h-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
      </main>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <ChatPageClient />
    </Suspense>
  );
}
