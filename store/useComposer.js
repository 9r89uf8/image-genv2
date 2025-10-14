'use client';

import { create } from "zustand";
import { ASPECT_RATIOS } from "@/lib/constants";

const defaultState = {
  type: "generate",
  girlId: "",
  imageIds: [],
  refUrls: [],
  prompt: "",
  aspectRatio: ASPECT_RATIOS[0],
  imageOnly: false,
  chatMode: false,
  isSubmitting: false,
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
