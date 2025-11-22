'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { DEFAULT_ASPECT_RATIO, DEFAULT_IMAGE_SIZE } from "@/lib/constants";

export default function ChatPane({ sessionId, onRefreshSessions }) {
  const [session, setSession] = useState(null);
  const [turns, setTurns] = useState([]);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    queueMicrotask(() => {
      const el = scrollerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    });
  }, []);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      const sanitizedSession = data.session
        ? {
            ...data.session,
            imageSize: data.session.imageSize || DEFAULT_IMAGE_SIZE,
            totalCostUsd: Number(data.session.totalCostUsd ?? 0),
            totalTokens: Number(data.session.totalTokens ?? 0),
            totalImages: Number(data.session.totalImages ?? 0),
          }
        : null;
      setSession(sanitizedSession);
      const sanitizedTurns = (data.turns || []).map((turn) => ({
        ...turn,
        costUsd: Number(turn.costUsd ?? 0),
        usage: turn.usage
          ? {
              ...turn.usage,
              imagesOut: Number(turn.usage.imagesOut ?? 0),
              inputTokens: Number(turn.usage.inputTokens ?? 0),
              outputTokens: Number(turn.usage.outputTokens ?? 0),
              totalTokens: Number(turn.usage.totalTokens ?? 0),
            }
          : null,
      }));
      setTurns(sanitizedTurns);
      scrollToBottom();
    } catch (error) {
      console.error("Failed to load chat session", error);
      alert("Failed to load chat session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId, scrollToBottom]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (turns.length > 0) {
      scrollToBottom();
    }
  }, [scrollToBottom, turns]);

  const uploadTemp = useCallback(async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload/temp", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    return data.publicUrl;
  }, []);

  const handleFileChange = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const url = await uploadTemp(file);
        setAttachments((prev) => [...prev, url]);
      } catch (error) {
        console.error("Image upload failed", error);
        alert("Failed to upload image.");
      } finally {
        event.target.value = "";
      }
    },
    [uploadTemp]
  );

  const handleRemoveAttachment = useCallback((url) => {
    setAttachments((prev) => prev.filter((item) => item !== url));
  }, []);

  const sendMessage = useCallback(async () => {
    if (sending) return;
    if (!message.trim() && attachments.length === 0) return;

    setSending(true);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: message,
          refUrls: attachments,
          imageOnly: false,
          aspectRatio: session?.aspectRatio || DEFAULT_ASPECT_RATIO,
          imageSize: session?.imageSize || DEFAULT_IMAGE_SIZE,
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const { turn, sessionTotals } = await res.json();

      const timestamp = new Date().toISOString();
      const userTurn = {
        id: `user-${timestamp}`,
        role: "user",
        text: message,
        attachments: attachments.map((url) => ({
          url,
          previewUrl: url,
        })),
        createdAt: timestamp,
      };
      const modelTurn = {
        id: turn.id,
        role: turn.role || "model",
        text: turn.text,
        images: turn.images || [],
        costUsd: Number(turn.costUsd ?? 0),
        usage: turn.usage || null,
        createdAt: timestamp,
      };

      setTurns((prev) => [...prev, userTurn, modelTurn]);
      if (sessionTotals) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                totalCostUsd: Number(
                  sessionTotals.totalCostUsd ?? prev.totalCostUsd ?? 0
                ),
                totalTokens:
                  Number(sessionTotals.totalTokens ?? prev.totalTokens ?? 0),
                totalImages:
                  Number(sessionTotals.totalImages ?? prev.totalImages ?? 0),
              }
            : prev
        );
      }
      setMessage("");
      setAttachments([]);
      scrollToBottom();
      await onRefreshSessions?.();
    } catch (error) {
      console.error("Failed to send message", error);
      alert("Failed to send message.");
    } finally {
      setSending(false);
    }
  }, [
    attachments,
    message,
    onRefreshSessions,
    scrollToBottom,
    sending,
    session?.aspectRatio,
    session?.imageSize,
    sessionId,
  ]);

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">
            {session?.title || "Chat"}
          </h2>
          <p className="truncate text-sm text-slate-500 sm:text-xs">
            Aspect ratio: {session?.aspectRatio || DEFAULT_ASPECT_RATIO} · Size:{" "}
            {session?.imageSize || DEFAULT_IMAGE_SIZE}
          </p>
          <p className="truncate text-sm text-slate-500 sm:text-xs">
            Total cost: $
            {(Number(session?.totalCostUsd ?? 0) || 0).toFixed(4)} · Tokens:{" "}
            {Number(session?.totalTokens ?? 0) || 0}
          </p>
        </div>
        <button
          type="button"
          onClick={loadSession}
          className="w-full rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 sm:w-auto sm:px-3 sm:py-1 sm:text-xs dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Refresh
        </button>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-auto rounded-lg border border-slate-200 p-4 sm:p-3 dark:border-slate-700"
      >
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading conversation…</p>
        ) : turns.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            No messages yet. Say hello to get started.
          </p>
        ) : (
          <div className="grid gap-3">
            {turns.map((turn) => {
              const isUser = turn.role === "user";
              return (
                <div
                  key={turn.id}
                  className={`max-w-[95%] break-words rounded-lg p-3 text-sm sm:max-w-[85%] ${
                    isUser
                      ? "ml-auto bg-slate-100 dark:bg-slate-800"
                      : "bg-white shadow-sm dark:bg-slate-900"
                  }`}
                >
                  {turn.text && (
                    <p className="mb-2 break-words whitespace-pre-line">{turn.text}</p>
                  )}

                  {turn.attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {turn.attachments.map((attachment, index) => {
                        const displayUrl =
                          attachment.previewUrl || attachment.url;
                        if (!displayUrl) return null;
                        return (
                          <a
                            key={`${displayUrl}-${index}`}
                            href={displayUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block w-full max-w-[200px] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
                          >
                            <Image
                              src={displayUrl}
                              alt="attachment"
                              width={600}
                              height={600}
                              className="h-auto w-full rounded-lg object-contain"
                              style={{ height: "auto" }}
                            />
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {!isUser && (turn.costUsd || turn.usage) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500 sm:text-[11px]">
                      {typeof turn.costUsd === "number" && turn.costUsd > 0 && (
                        <span>Cost ${turn.costUsd.toFixed(4)}</span>
                      )}
                      {turn.usage?.totalTokens ? (
                        <span>{turn.usage.totalTokens} tokens</span>
                      ) : null}
                      {turn.usage?.imagesOut ? (
                        <span>{turn.usage.imagesOut} image(s)</span>
                      ) : null}
                    </div>
                  )}

                  {turn.images?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {turn.images.map((image, index) => (
                        <a
                          key={`${image.publicUrl}-${index}`}
                          href={image.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="relative block w-full max-w-[220px] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
                        >
                          <Image
                            src={image.publicUrl}
                            alt="model output"
                            width={1024}
                            height={1024}
                            className="h-auto w-full rounded-lg object-contain"
                            style={{ height: "auto" }}
                          />
                          <span className="absolute inset-x-2 bottom-2 rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold backdrop-blur dark:bg-slate-900/80">
                            Open
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-2">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((url) => (
              <span
                key={url}
                className="inline-flex items-center gap-2 rounded-full bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-800 sm:py-1 sm:text-xs dark:bg-slate-700 dark:text-slate-100"
              >
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[180px] truncate underline decoration-dotted sm:max-w-[140px]"
                >
                  {url}
                </a>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(url)}
                  className="rounded-full bg-slate-300 px-1.5 py-0.5 text-xs dark:bg-slate-600 sm:px-1 sm:text-[10px]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="text-sm sm:text-xs"
          />
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder='Describe the change. Example: "Replace the leggings from the first image with the leggings from the second image. Keep the same face and pose."'
            rows={2}
            className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={sending}
            className="w-full rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto sm:px-4 sm:py-2 dark:bg-slate-100 dark:text-slate-900"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
