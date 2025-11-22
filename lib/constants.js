export const MODEL_ID = "gemini-3-pro-image-preview";
//lib/constants.js
export const DEFAULT_ASPECT_RATIO = "9:16";
export const DEFAULT_IMAGE_SIZE = "2K";

export const ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
];

export const IMAGE_SIZES = ["1K", "2K", "4K"];

export const TOKENS_PER_IMAGE = 1290;
export const PRICE_PER_MILLION_OUTPUT = 30;

// Gemini Files API objects expire after ~48h; refresh with a small buffer.
export const FILE_URI_TTL_MS = 46 * 60 * 60 * 1000;

export const MAX_REFERENCES = 6;

export const CONTEXT_TYPES = ["bedroom", "bathroom", "phone"];
