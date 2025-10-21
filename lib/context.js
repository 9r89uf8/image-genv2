import { CONTEXT_TYPES } from "./constants";

export const CONTEXT_LABELS = {
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  phone: "Phone",
};

const EMPTY_CONTEXT_ASSET = Object.freeze({
  imageId: "",
  description: "",
});

export function isValidContextType(value) {
  return CONTEXT_TYPES.includes(value);
}

export function createEmptyContextAsset() {
  return { ...EMPTY_CONTEXT_ASSET };
}

export function createEmptyContextAssets() {
  return CONTEXT_TYPES.reduce((acc, type) => {
    acc[type] = createEmptyContextAsset();
    return acc;
  }, {});
}

export function normalizeContextAssets(raw) {
  const source = typeof raw === "object" && raw !== null ? raw : {};
  return CONTEXT_TYPES.reduce((acc, type) => {
    const input = source[type];
    if (typeof input !== "object" || input === null) {
      acc[type] = createEmptyContextAsset();
      return acc;
    }
    const imageId =
      typeof input.imageId === "string" && input.imageId.trim()
        ? input.imageId.trim()
        : "";
    const description =
      typeof input.description === "string" ? input.description.trim() : "";

    acc[type] = {
      imageId,
      description,
    };
    return acc;
  }, {});
}

export function sanitizeContextAssetPayload(payload = {}) {
  const result = {};
  if (typeof payload.imageId === "string") {
    result.imageId = payload.imageId.trim();
  }
  if (payload.imageId === null) {
    result.imageId = "";
  }
  if (typeof payload.description === "string") {
    result.description = payload.description.trim();
  }
  return result;
}

export function mergeContextAsset(existing, updates) {
  const base =
    typeof existing === "object" && existing !== null
      ? existing
      : createEmptyContextAsset();
  const patch = sanitizeContextAssetPayload(updates);
  return {
    imageId:
      typeof patch.imageId === "string" ? patch.imageId : base.imageId || "",
    description:
      typeof patch.description === "string"
        ? patch.description
        : base.description || "",
  };
}
