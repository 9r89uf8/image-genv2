export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db, FieldValue, Timestamp } from "@/lib/firebase-admin";
import {
  ensureFileUriForLibraryImage,
  ensureFileUriFromUrl,
} from "@/lib/files";
import {
  buildGeminiHistoryFromTurns,
  createChat,
  saveChatImageBuffer,
} from "@/lib/chat";
import {
  DEFAULT_ASPECT_RATIO,
  FILE_URI_TTL_MS,
  TOKENS_PER_IMAGE,
} from "@/lib/constants";
import { estimateCostUsd } from "@/lib/costs";
import { Modality } from "@google/genai";

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

export async function POST(request, context) {
  const { params } = context;
  const { id: sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const {
    text = "",
    imageIds = [],
    refUrls = [],
    imageOnly = false,
    aspectRatio,
  } = body;

  if (
    !text.trim() &&
    !isNonEmptyArray(imageIds) &&
    !isNonEmptyArray(refUrls)
  ) {
    return Response.json(
      { error: "Message requires text or attachments" },
      { status: 400 }
    );
  }

  const sessionRef = db.collection("chatSessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    return new Response("session not found", { status: 404 });
  }

  const session = sessionSnap.data() || {};
  const aspect =
    aspectRatio || session.aspectRatio || DEFAULT_ASPECT_RATIO;

  const existingTurnsSnap = await sessionRef
    .collection("turns")
    .orderBy("createdAt", "asc")
    .get();
  const history = await buildGeminiHistoryFromTurns(existingTurnsSnap.docs);

  const messageParts = [];
  const attachmentsForTurn = [];
  const nowMs = Date.now();

  for (const id of imageIds) {
    try {
      const uploaded = await ensureFileUriForLibraryImage(id);
      messageParts.push({
        fileData: { fileUri: uploaded.fileUri, mimeType: uploaded.mimeType },
      });

      const libraryDoc = await db.collection("library").doc(id).get();
      const libraryData = libraryDoc.data() || {};

      attachmentsForTurn.push({
        url: `library://${id}`,
        libraryId: id,
        source: "library",
        mimeType: uploaded.mimeType || libraryData.mimeType || "image/png",
        fileUri: uploaded.fileUri,
        expiresAtMs: nowMs + FILE_URI_TTL_MS,
        previewUrl: libraryData.publicUrl || "",
      });
    } catch (error) {
      console.error("Failed to attach library image:", error);
      return Response.json(
        { error: `Failed to process library image ${id}` },
        { status: 500 }
      );
    }
  }

  for (const url of refUrls) {
    try {
      const uploaded = await ensureFileUriFromUrl(url);
      messageParts.push({
        fileData: { fileUri: uploaded.fileUri, mimeType: uploaded.mimeType },
      });
      attachmentsForTurn.push({
        url,
        source: "url",
        mimeType: uploaded.mimeType || "image/png",
        fileUri: uploaded.fileUri,
        expiresAtMs: nowMs + FILE_URI_TTL_MS,
        previewUrl: url,
      });
    } catch (error) {
      console.error("Failed to attach reference URL:", error);
      return Response.json(
        { error: `Failed to fetch attachment ${url}` },
        { status: 500 }
      );
    }
  }

  if (text) {
    messageParts.push({ text });
  }

  let response;
  try {
    const chat = createChat({ history, aspectRatio: aspect });
    response = await chat.sendMessage({
      message: messageParts,
      config: {
        responseModalities: imageOnly
          ? [Modality.IMAGE]
          : [Modality.TEXT, Modality.IMAGE],
        imageConfig: { aspectRatio: aspect },
      },
    });
  } catch (error) {
    console.error("Gemini chat sendMessage failed:", error);
    return Response.json(
      { error: "Gemini chat request failed" },
      { status: 500 }
    );
  }

  const userTurnRef = sessionRef.collection("turns").doc();
  const now = Timestamp.now();
  await userTurnRef.set({
    role: "user",
    text,
    attachments: attachmentsForTurn,
    createdAt: now,
  });

  const partsOut = response?.candidates?.[0]?.content?.parts || [];
  const imageBuffers = [];
  let modelText = "";

  for (const part of partsOut) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType || "image/png";
      const buffer = Buffer.from(part.inlineData.data, "base64");
      imageBuffers.push({ buffer, mimeType: mime });
    } else if (part.text) {
      modelText += part.text;
    }
  }

  if (!imageBuffers.length && !modelText) {
    modelText = "Model returned no content.";
  }

  const modelTurnRef = sessionRef.collection("turns").doc();
  const savedImages = [];

  for (let i = 0; i < imageBuffers.length; i += 1) {
    const saved = await saveChatImageBuffer(
      sessionId,
      modelTurnRef.id,
      i,
      imageBuffers[i]
    );
    savedImages.push(saved);
  }

  const usageMeta =
    response?.usageMetadata ||
    response?.candidates?.[0]?.usageMetadata ||
    {};
  const inputTokens =
    Number(usageMeta.inputTokenCount ?? usageMeta.promptTokenCount ?? 0) || 0;
  const outputTokens =
    Number(usageMeta.outputTokenCount ?? usageMeta.candidatesTokenCount ?? 0) ||
    0;
  const totalTokensRaw =
    Number(
      usageMeta.totalTokenCount ??
        usageMeta.tokenCount ??
        inputTokens + outputTokens
    ) || inputTokens + outputTokens;
  const imagesOut = savedImages.length;
  const fallbackTokens = imagesOut * TOKENS_PER_IMAGE;
  const totalTokens = totalTokensRaw || fallbackTokens;

  const usage = {
    imagesOut,
    inputTokens,
    outputTokens,
    totalTokens,
  };

  const costUsd = estimateCostUsd({
    imagesOut,
    totalTokens,
    outputTokens,
  });
  const costIncrement = Number.isFinite(costUsd) ? costUsd : 0;
  const tokenIncrement = Number.isFinite(totalTokens) ? totalTokens : 0;
  const imageIncrement = imagesOut;

  await modelTurnRef.set({
    role: "model",
    text: modelText,
    images: savedImages,
    usage,
    costUsd,
    createdAt: Timestamp.now(),
  });

  await sessionRef.update({
    lastActive: Timestamp.now(),
    aspectRatio: aspect,
    totalCostUsd: FieldValue.increment(costIncrement),
    totalTokens: FieldValue.increment(tokenIncrement),
    totalImages: FieldValue.increment(imageIncrement),
  });

  const sessionTotals = {
    totalCostUsd: Number(
      ((Number(session.totalCostUsd ?? 0) || 0) + costIncrement).toFixed(4)
    ),
    totalTokens: Number(session.totalTokens ?? 0) + tokenIncrement,
    totalImages: Number(session.totalImages ?? 0) + imageIncrement,
  };

  return Response.json({
    turn: {
      id: modelTurnRef.id,
      role: "model",
      text: modelText,
      images: savedImages,
      usage,
      costUsd,
    },
    sessionTotals,
  });
}
