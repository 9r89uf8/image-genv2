import {
  PRICE_PER_MILLION_OUTPUT,
  TOKENS_PER_IMAGE,
} from "./constants";

export function estimateCostUsd({ imagesOut = 1 } = {}) {
  const outputTokens = imagesOut * TOKENS_PER_IMAGE;
  const usd = (outputTokens / 1_000_000) * PRICE_PER_MILLION_OUTPUT;
  return Number(usd.toFixed(4));
}
