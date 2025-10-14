export const MODEL_ID = "gemini-2.5-flash-image";

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

export const TOKENS_PER_IMAGE = 1290;
export const PRICE_PER_MILLION_OUTPUT = 30;

// Gemini Files API objects expire after ~48h; refresh with a small buffer.
export const FILE_URI_TTL_MS = 46 * 60 * 60 * 1000;
