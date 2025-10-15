import {
  PRICE_PER_MILLION_OUTPUT,
  TOKENS_PER_IMAGE,
} from "./constants";

function normalizeTokens({
  imagesOut = 0,
  outputTokens,
  totalTokens,
} = {}) {
  if (typeof totalTokens === "number" && totalTokens > 0) {
    return totalTokens;
  }
  if (typeof outputTokens === "number" && outputTokens > 0) {
    return outputTokens;
  }
  return imagesOut * TOKENS_PER_IMAGE;
}

export function estimateCostUsd({
  imagesOut = 0,
  outputTokens,
  totalTokens,
} = {}) {
  const tokens = normalizeTokens({ imagesOut, outputTokens, totalTokens });
  if (!tokens) return 0;
  const usd = (tokens / 1_000_000) * PRICE_PER_MILLION_OUTPUT;
  return Number(usd.toFixed(4));
}
