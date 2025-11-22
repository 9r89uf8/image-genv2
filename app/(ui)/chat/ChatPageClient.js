'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ChatPane from "@/components/ChatPane";
import { DEFAULT_ASPECT_RATIO, DEFAULT_IMAGE_SIZE } from "@/lib/constants";

export default function ChatPageClient() {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState("");
  const [loading, setLoading] = useState(false);
  const pendingSessionRef = useRef(null);
  const [girls, setGirls] = useState([]);
  const [selectedGirlId, setSelectedGirlId] = useState("");
  const [isGirlsLoading, setIsGirlsLoading] = useState(false);
  const [girlsError, setGirlsError] = useState("");

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
          imageSize: session.imageSize || DEFAULT_IMAGE_SIZE,
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
      } catch (error) {
        if (!isMounted) return;
        const message =
          error instanceof Error ? error.message : "Unable to load girls.";
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

  const searchParamsString = useMemo(() => {
    return searchParams?.toString() ?? "";
  }, [searchParams]);

  const querySessionId = useMemo(() => {
    const params = new URLSearchParams(searchParamsString);
    return params.get("session") || "";
  }, [searchParamsString]);

  const girlOptions = useMemo(() => {
    const sorted = [...girls].sort((a, b) => {
      const nameA = (a?.name || "").toLowerCase();
      const nameB = (b?.name || "").toLowerCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });

    const options = [
      { value: "", label: "All girls" },
      ...sorted.map((girl) => ({
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

  const filteredSessions = useMemo(() => {
    if (!selectedGirlId) return sessions;
    return sessions.filter((session) => session.girlId === selectedGirlId);
  }, [sessions, selectedGirlId]);

  const hasFilterApplied = Boolean(selectedGirlId);

  useEffect(() => {
    if (!filteredSessions.length) {
      setActiveSession("");
      pendingSessionRef.current = null;
      return;
    }

    const pendingId = pendingSessionRef.current;
    if (pendingId && filteredSessions.some((session) => session.id === pendingId)) {
      if (querySessionId === pendingId) {
        pendingSessionRef.current = null;
      } else if (activeSession !== pendingId) {
        setActiveSession(pendingId);
        return;
      }
    }

    if (
      querySessionId &&
      filteredSessions.some((session) => session.id === querySessionId)
    ) {
      if (activeSession !== querySessionId) {
        setActiveSession(querySessionId);
      }
      return;
    }

    if (
      activeSession &&
      filteredSessions.some((session) => session.id === activeSession)
    ) {
      return;
    }

    setActiveSession(filteredSessions[0]?.id || "");
    pendingSessionRef.current = null;
  }, [activeSession, filteredSessions, querySessionId]);

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
          imageSize: DEFAULT_IMAGE_SIZE,
          girlId: selectedGirlId || "",
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
  }, [fetchSessions, selectedGirlId]);

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
    <div className="grid min-w-0 gap-4 sm:gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Sessions</h2>
          <button
            type="button"
            onClick={createSession}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:px-3 sm:py-1 sm:text-xs dark:bg-slate-100 dark:text-slate-900"
          >
            New
          </button>
        </div>

        <div className="mb-4">
          <label
            htmlFor="chat-girl-filter"
            className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400"
          >
            Filter by girl
          </label>
          <select
            id="chat-girl-filter"
            value={selectedGirlId}
            onChange={(event) => setSelectedGirlId(event.target.value)}
            className="mt-1 w-full rounded-full border border-slate-300 px-3 py-3 text-base text-slate-700 transition hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 sm:py-1.5 sm:text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500"
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
            <span className="mt-1 block text-xs text-rose-500 dark:text-rose-300">
              {girlsError}
            </span>
          )}
        </div>

        {loading && sessions.length === 0 ? (
          <p className="px-3 py-6 text-xs text-slate-500">Loading sessions…</p>
        ) : filteredSessions.length === 0 ? (
          <p className="px-3 py-6 text-xs text-slate-500">
            {hasFilterApplied
              ? "No sessions found for this girl yet."
              : "No chat sessions yet. Create one to get started."}
          </p>
        ) : (
          <div className="grid gap-1">
            {filteredSessions.map((session) => {
              const isActive = session.id === activeSession;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => handleSelect(session.id)}
                  className={`text-left rounded-lg px-4 py-3 text-sm transition sm:px-3 sm:py-2 ${
                    isActive
                      ? "bg-slate-100 dark:bg-slate-800"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="truncate font-medium">
                    {session.title || "Untitled"}
                  </div>
                  {session.girlId && (
                    <div className="truncate text-xs font-medium text-slate-500 sm:text-[11px] dark:text-slate-400">
                      {girlNameById[session.girlId] ?? "Unknown girl"}
                    </div>
                  )}
                  <div className="truncate text-sm text-slate-500 sm:text-xs">
                    {session.aspectRatio} · {session.imageSize} ·{" "}
                    {session.lastActive
                      ? new Date(session.lastActive).toLocaleString()
                      : "no activity"}
                  </div>
                  <div className="truncate text-sm text-slate-500 sm:text-xs">
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
            className="mt-4 w-full rounded-full border border-rose-400 px-4 py-2.5 text-sm font-semibold text-rose-600 sm:px-3 sm:py-1.5 sm:text-xs dark:border-rose-500/60 dark:text-rose-300"
          >
            Delete session
          </button>
        )}
      </aside>

      <main className="min-h-[70vh] rounded-2xl border border-slate-200 bg-white p-5 sm:p-4 dark:border-slate-800 dark:bg-slate-900">
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
