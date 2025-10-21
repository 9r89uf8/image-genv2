'use client';
//store/useComposer.js
import { create } from "zustand";
import { ASPECT_RATIOS, DEFAULT_ASPECT_RATIO } from "@/lib/constants";

const defaultState = {
  type: "generate",
  girlId: "",
  imageIds: [],
  refUrls: [],
  prompt: "",
  aspectRatio: DEFAULT_ASPECT_RATIO,
  imageOnly: false,
  chatMode: false,
  isSubmitting: false,

  // Track when composer is prefilled from an existing job result.
  editingFromJob: null,
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
    if (!url) return;
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

  loadJobForEditing: (job) => {
    const firstUrl = job?.result?.publicUrl || "";
    const aspectRatio = job?.inputs?.aspectRatio || DEFAULT_ASPECT_RATIO;
    set({
      type: "edit",
      girlId: job?.girlId || "",
      imageIds: [],
      refUrls: firstUrl ? [firstUrl] : [],
      prompt: "",
      aspectRatio,
      imageOnly: false,
      chatMode: false,
      editingFromJob: job?.id || "prefilled",
    });
  },

  clearEditingContext: () => set({ editingFromJob: null }),

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
      if (state.chatMode) {
        const res1 = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Composer chat",
            girlId: state.girlId || "",
            aspectRatio: state.aspectRatio,
          }),
        });
        if (!res1.ok) {
          throw new Error((await res1.text()) || "Failed to create chat");
        }
        const { id: sessionId } = await res1.json();

        const res2 = await fetch(`/api/chat/sessions/${sessionId}/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: state.prompt,
            imageIds: state.imageIds,
            refUrls: state.refUrls,
            imageOnly: state.imageOnly,
            aspectRatio: state.aspectRatio,
          }),
        });
        if (!res2.ok) {
          throw new Error((await res2.text()) || "Failed to send chat message");
        }

        if (typeof window !== "undefined") {
          const url = new URL("/chat", window.location.origin);
          url.searchParams.set("session", sessionId);
          window.location.assign(url.toString());
        }
        return null;
      }

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
