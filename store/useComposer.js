'use client';
//store/useComposer.js
import { create } from "zustand";
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
  MAX_REFERENCES,
  CONTEXT_TYPES,
} from "@/lib/constants";
import {
  createEmptyContextAssets,
  normalizeContextAssets,
  isValidContextType,
} from "@/lib/context";

const createDefaultContextSelections = () =>
  CONTEXT_TYPES.reduce((acc, type) => {
    acc[type] = { useImage: false, useText: false };
    return acc;
  }, {});

const countActiveContextImages = (contextAssets, contextSelections) =>
  CONTEXT_TYPES.reduce((total, type) => {
    const selection = contextSelections?.[type];
    const asset = contextAssets?.[type];
    if (selection?.useImage && asset?.imageId) {
      return total + 1;
    }
    return total;
  }, 0);

const createDefaultState = () => ({
  type: "generate",
  girlId: "",
  imageIds: [],
  refUrls: [],
  prompt: "",
  aspectRatio: DEFAULT_ASPECT_RATIO,
  imageSize: DEFAULT_IMAGE_SIZE,
  imageOnly: false,
  chatMode: false,
  isSubmitting: false,
  editingFromJob: null,
  contextAssets: createEmptyContextAssets(),
  contextSelections: createDefaultContextSelections(),
});

const computeMaxManualImages = (state) => {
  const activeContextImages = countActiveContextImages(
    state.contextAssets,
    state.contextSelections
  );
  return Math.max(
    0,
    MAX_REFERENCES - state.refUrls.length - activeContextImages
  );
};

const computeMaxUrls = (state) => {
  const activeContextImages = countActiveContextImages(
    state.contextAssets,
    state.contextSelections
  );
  return Math.max(
    0,
    MAX_REFERENCES - state.imageIds.length - activeContextImages
  );
};

export const useComposer = create((set, get) => ({
  ...createDefaultState(),
  setField: (field, value) => set({ [field]: value }),
  setImageIds: (ids) => {
    const state = get();
    const maxImages = computeMaxManualImages(state);
    const unique = Array.from(new Set(ids));
    set({ imageIds: unique.slice(0, maxImages) });
  },
  toggleImageId: (id) =>
    set((state) => {
      const { imageIds } = state;
      if (imageIds.includes(id)) {
        return { imageIds: imageIds.filter((item) => item !== id) };
      }
      const maxImages = computeMaxManualImages(state);
      if (imageIds.length >= maxImages) {
        return {};
      }
      return { imageIds: [...imageIds, id] };
    }),
  addRefUrl: (url) => {
    if (!url) return;
    set((state) => {
      const trimmed = url.trim();
      if (!trimmed) return {};
      if (state.refUrls.includes(trimmed)) return {};
      const activeContextImages = countActiveContextImages(
        state.contextAssets,
        state.contextSelections
      );
      const currentTotal =
        state.imageIds.length + state.refUrls.length + activeContextImages;
      if (currentTotal >= MAX_REFERENCES) {
        return {};
      }
      return { refUrls: [...state.refUrls, trimmed] };
    });
  },
  removeRefUrl: (url) =>
    set((state) => ({
      refUrls: state.refUrls.filter((item) => item !== url),
    })),
  setRefUrls: (urls) => {
    const state = get();
    const unique = Array.from(new Set(urls));
    const maxUrls = computeMaxUrls(state);
    set({ refUrls: unique.slice(0, maxUrls) });
  },
  clearReferences: () => set({ imageIds: [], refUrls: [] }),
  setContextAssets: (assets, options = {}) =>
    set((state) => {
      const normalized = normalizeContextAssets(assets);
      const next = { contextAssets: normalized };
      const resetSelections = options.resetSelections !== false;
      if (resetSelections) {
        next.contextSelections = createDefaultContextSelections();
      } else {
        const currentSelections = state.contextSelections;
        const patched = { ...currentSelections };
        CONTEXT_TYPES.forEach((type) => {
          const selection = patched[type] || {
            useImage: false,
            useText: false,
          };
          if (!normalized[type]?.imageId) {
            patched[type] = { ...selection, useImage: false };
          } else {
            patched[type] = selection;
          }
        });
        next.contextSelections = patched;
      }
      return next;
    }),
  setContextSelection: (type, partial) => {
    if (!isValidContextType(type)) return;
    set((state) => {
      const current = state.contextSelections[type] || {
        useImage: false,
        useText: false,
      };
      const merged = {
        ...current,
        ...partial,
      };

      const asset = state.contextAssets[type] || { imageId: "" };
      if (merged.useImage && !asset.imageId) {
        merged.useImage = false;
      }

      const enablingImage = !current.useImage && merged.useImage;
      if (enablingImage) {
        const activeContextImages = countActiveContextImages(
          state.contextAssets,
          state.contextSelections
        );
        const totalBefore =
          state.imageIds.length + state.refUrls.length + activeContextImages;
        if (totalBefore >= MAX_REFERENCES) {
          return {};
        }
      }

      return {
        contextSelections: {
          ...state.contextSelections,
          [type]: merged,
        },
      };
    });
  },
  resetContextSelections: () =>
    set({ contextSelections: createDefaultContextSelections() }),
  getContextSelection: (type) => {
    const selections = get().contextSelections;
    return selections[type] || { useImage: false, useText: false };
  },
  getReferenceUsage: () => {
    const state = get();
    const contextImages = countActiveContextImages(
      state.contextAssets,
      state.contextSelections
    );
    return {
      limit: MAX_REFERENCES,
      imageIds: state.imageIds.length,
      refUrls: state.refUrls.length,
      contextImages,
      total: state.imageIds.length + state.refUrls.length + contextImages,
    };
  },
  loadJobForEditing: (job) => {
    const base = createDefaultState();
    const firstUrl = job?.result?.publicUrl || "";
    base.type = "edit";
    base.girlId = job?.girlId || "";
    base.refUrls = firstUrl ? [firstUrl] : [];
    base.aspectRatio = job?.inputs?.aspectRatio || DEFAULT_ASPECT_RATIO;
    base.imageSize = job?.inputs?.imageSize || DEFAULT_IMAGE_SIZE;
    base.editingFromJob = job?.id || "prefilled";
    set(base);
  },
  clearEditingContext: () => set({ editingFromJob: null }),
  reset: () => set(createDefaultState()),
  submit: async () => {
    const state = get();
    const contextImageIds = CONTEXT_TYPES.reduce((acc, type) => {
      const selection = state.contextSelections[type];
      const asset = state.contextAssets[type];
      if (selection?.useImage && asset?.imageId) {
        acc.push(asset.imageId);
      }
      return acc;
    }, []);
    const combinedImageIds = [...state.imageIds, ...contextImageIds];

    const payload = {
      type: state.type,
      prompt: state.prompt,
      girlId: state.girlId || null,
      inputs: {
        imageIds: combinedImageIds,
        manualImageIds: state.imageIds,
        contextImageIds,
        refUrls: state.refUrls,
        aspectRatio: state.aspectRatio,
        imageSize: state.imageSize,
        imageOnly: state.imageOnly,
        chatMode: state.chatMode,
        contextSelections: state.contextSelections,
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
            imageSize: state.imageSize,
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
            imageIds: combinedImageIds,
            refUrls: state.refUrls,
            imageOnly: state.imageOnly,
            aspectRatio: state.aspectRatio,
            imageSize: state.imageSize,
            contextSelections: state.contextSelections,
            contextImageIds,
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
