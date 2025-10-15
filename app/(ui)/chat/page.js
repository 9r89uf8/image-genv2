'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatPane from "@/components/ChatPane";
import { DEFAULT_ASPECT_RATIO } from "@/lib/constants";

export default function ChatPage() {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState("");
  const [loading, setLoading] = useState(false);
  const pendingSessionRef = useRef(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/chat/sessions");
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      const sanitized =
        data.sessions?.map((session) => ({
          ...session,
          totalCostUsd: Number(session.totalCostUsd ?? 0),
          totalTokens: Number(session.totalTokens ?? 0),
          totalImages: Number(session.totalImages ?? 0),
        })) ?? [];
      setSessions(sanitized);
    } catch (error) {
      console.error("Failed to load sessions", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const searchParamsString = useMemo(() => {
    return searchParams?.toString() ?? "";
  }, [searchParams]);

  const querySessionId = useMemo(() => {
    const params = new URLSearchParams(searchParamsString);
    return params.get("session") || "";
  }, [searchParamsString]);

  useEffect(() => {
    if (!sessions.length) {
      setActiveSession("");
      pendingSessionRef.current = null;
      return;
    }

    const pendingId = pendingSessionRef.current;
    if (pendingId && sessions.some((session) => session.id === pendingId)) {
      if (querySessionId === pendingId) {
        pendingSessionRef.current = null;
      } else {
        if (activeSession !== pendingId) {
          setActiveSession(pendingId);
        }
        return;
      }
    }

    if (
      querySessionId &&
      sessions.some((session) => session.id === querySessionId)
    ) {
      if (activeSession !== querySessionId) {
        setActiveSession(querySessionId);
      }
      return;
    }

    if (activeSession && sessions.some((session) => session.id === activeSession)) {
      return;
    }

    setActiveSession(sessions[0]?.id || "");
    pendingSessionRef.current = null;
  }, [activeSession, sessions, querySessionId]);

  useEffect(() => {
    if (
      !activeSession ||
      querySessionId === activeSession ||
      pendingSessionRef.current !== activeSession
    ) {
      if (!activeSession && querySessionId) {
        const params = new URLSearchParams(searchParamsString);
        params.delete("session");
        const query = params.toString();
        router.replace(query ? `/chat?${query}` : "/chat", { scroll: false });
      }
      if (querySessionId === activeSession) {
        pendingSessionRef.current = null;
      }
      return;
    }

    const params = new URLSearchParams(searchParamsString);
    params.set("session", activeSession);
    router.replace(`/chat?${params.toString()}`, { scroll: false });
  }, [activeSession, querySessionId, router, searchParamsString]);

  const createSession = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "New chat",
          aspectRatio: DEFAULT_ASPECT_RATIO,
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const { id } = await res.json();
      await fetchSessions();
      pendingSessionRef.current = id;
      setActiveSession(id);
    } catch (error) {
      console.error("Failed to create chat session", error);
      alert("Failed to create chat session.");
    }
  }, [fetchSessions]);

  const deleteSession = useCallback(
    async (id) => {
      try {
        await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
        await fetchSessions();
        if (activeSession === id) {
          pendingSessionRef.current = null;
          setActiveSession("");
          const params = new URLSearchParams(searchParamsString);
          params.delete("session");
          const query = params.toString();
          router.replace(query ? `/chat?${query}` : "/chat", { scroll: false });
        }
      } catch (error) {
        console.error("Failed to delete session", error);
        alert("Failed to delete chat session.");
      }
    },
    [activeSession, fetchSessions, router, searchParamsString]
  );

  const handleSelect = useCallback(
    (id) => {
      pendingSessionRef.current = id;
      setActiveSession(id);
    },
    []
  );

  return (
    <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Sessions</h2>
          <button
            type="button"
            onClick={createSession}
            className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
          >
            New
          </button>
        </div>

        {loading && sessions.length === 0 ? (
          <p className="px-3 py-6 text-xs text-slate-500">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="px-3 py-6 text-xs text-slate-500">
            No chat sessions yet. Create one to get started.
          </p>
        ) : (
          <div className="grid gap-1">
            {sessions.map((session) => {
              const isActive = session.id === activeSession;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => handleSelect(session.id)}
                  className={`text-left rounded-lg px-3 py-2 text-sm transition ${
                    isActive
                      ? "bg-slate-100 dark:bg-slate-800"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="font-medium">
                    {session.title || "Untitled"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {session.aspectRatio} ·{" "}
                    {session.lastActive
                      ? new Date(session.lastActive).toLocaleString()
                      : "no activity"}
                  </div>
                  <div className="text-xs text-slate-500">
                    Cost ${session.totalCostUsd.toFixed(4)} · Tokens{" "}
                    {session.totalTokens}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {activeSession && (
          <button
            type="button"
            onClick={() => deleteSession(activeSession)}
            className="mt-4 w-full rounded-full border border-rose-400 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:border-rose-500/60 dark:text-rose-300"
          >
            Delete session
          </button>
        )}
      </aside>

      <main className="min-h-[70vh] rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {activeSession ? (
          <ChatPane sessionId={activeSession} onRefreshSessions={fetchSessions} />
        ) : (
          <p className="p-6 text-sm text-slate-500">
            Create or select a session.
          </p>
        )}
      </main>
    </div>
  );
}
