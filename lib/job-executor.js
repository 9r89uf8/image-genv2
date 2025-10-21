//lib/job-executor.js
import { bucket, db, Timestamp } from "./firebase-admin";
import {
  ensureFileUriForLibraryImage,
  ensureFileUriFromUrl,
} from "./files";
import { estimateCostUsd } from "./costs";
import { generateImage } from "./gemini";
import { getJob, updateJob } from "./db";
import { DEFAULT_ASPECT_RATIO, TOKENS_PER_IMAGE, CONTEXT_TYPES } from "./constants";
import {
  createEmptyContextAssets,
  normalizeContextAssets,
  CONTEXT_LABELS,
} from "./context";

async function saveImageBufferToStorage(jobId, { buffer, mimeType }) {
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
    ? "webp"
    : "jpg";

  const storagePath = `generations/${jobId}.${ext}`;
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
    public: true,
    metadata: {
      cacheControl: "public,max-age=31536000,immutable",
    },
  });

  try {
    await file.makePublic();
  } catch {
    // On emulators we may not have IAM perms; ignore and rely on signed URLs if configured.
  }

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  return { storagePath, publicUrl };
}

export async function executeJob(jobId) {
  const jobSnapshot = await getJob(jobId);
  if (!jobSnapshot) {
    return { status: "NOT_FOUND" };
  }

  if (jobSnapshot.status === "CANCELLED") {
    return { status: "CANCELLED" };
  }

  await updateJob(jobId, {
    status: "RUNNING",
    startedAt: Timestamp.now(),
    error: null,
  });

  try {
    const submittedPromptRaw =
      typeof jobSnapshot.prompt === "string" ? jobSnapshot.prompt : "";
    const submittedPrompt = submittedPromptRaw.trim();
    const inputs = jobSnapshot.inputs ?? {};
    const {
      imageIds: inputImageIds = [],
      refUrls = [],
      aspectRatio = DEFAULT_ASPECT_RATIO,
      imageOnly = false,
      contextSelections = {},
      manualImageIds: manualImageIdsInput = [],
    } = inputs;

    let contextAssets = createEmptyContextAssets();
    if (jobSnapshot.girlId) {
      try {
        const girlSnap = await db.collection("girls").doc(jobSnapshot.girlId).get();
        if (girlSnap.exists) {
          contextAssets = normalizeContextAssets(girlSnap.data().contextAssets);
        }
      } catch (ctxError) {
        console.warn("Failed to load context assets for job", jobId, ctxError);
      }
    }

    const contextImageIdsByType = {};
    const resolvedContext = {};
    CONTEXT_TYPES.forEach((type) => {
      const selection = contextSelections?.[type] || {};
      const asset = contextAssets[type] || { imageId: "", description: "" };
      const requestedImage = Boolean(selection.useImage);
      const requestedText = Boolean(selection.useText);
      const hasImage = requestedImage && Boolean(asset.imageId);
      const hasText = requestedText && Boolean(asset.description);
      if (hasImage) {
        contextImageIdsByType[type] = asset.imageId;
      }
      resolvedContext[type] = {
        requestedImage,
        requestedText,
        imageId: asset.imageId || null,
        description: asset.description || "",
        appliedImage: hasImage,
        appliedText: hasText,
        referenceIndex: null,
      };
    });

    const manualIdsRaw = Array.isArray(manualImageIdsInput)
      ? manualImageIdsInput
      : Array.isArray(inputImageIds)
      ? inputImageIds
      : [];

    const seenImageIds = new Set();
    const manualImageIds = [];
    for (const id of manualIdsRaw) {
      if (typeof id === "string" && id && !seenImageIds.has(id)) {
        manualImageIds.push(id);
        seenImageIds.add(id);
      }
    }

    const contextImageTypeById = {};
    Object.entries(contextImageIdsByType).forEach(([type, imageId]) => {
      if (imageId) {
        contextImageTypeById[imageId] = type;
      }
    });

    const contextImageIdsOrdered = [];
    CONTEXT_TYPES.forEach((type) => {
      const imageId = contextImageIdsByType[type];
      if (imageId && !seenImageIds.has(imageId)) {
        contextImageIdsOrdered.push(imageId);
        seenImageIds.add(imageId);
      }
    });

    let combinedImageIds = [...manualImageIds, ...contextImageIdsOrdered];

    if (!combinedImageIds.length && Array.isArray(inputImageIds)) {
      for (const id of inputImageIds) {
        if (typeof id === "string" && id && !seenImageIds.has(id)) {
          combinedImageIds.push(id);
          seenImageIds.add(id);
        }
      }
    }

    const manualImageIdsFinal = manualImageIds.length
      ? manualImageIds
      : combinedImageIds.slice();

    const contextReferencePositions = {};
    combinedImageIds.forEach((id, index) => {
      const type = contextImageTypeById[id];
      if (type && !contextReferencePositions[type]) {
        contextReferencePositions[type] = index + 1;
      }
    });

    CONTEXT_TYPES.forEach((type) => {
      if (!resolvedContext[type]) return;
      resolvedContext[type].referenceIndex =
        contextReferencePositions[type] || null;
      resolvedContext[type].appliedImage =
        resolvedContext[type].requestedImage &&
        Boolean(resolvedContext[type].referenceIndex);
      resolvedContext[type].appliedText =
        resolvedContext[type].requestedText &&
        Boolean(resolvedContext[type].description);
    });

    const contextPromptPieces = [];
    CONTEXT_TYPES.forEach((type) => {
      const contextEntry = resolvedContext[type];
      if (!contextEntry || !contextEntry.appliedText) return;
      const label = CONTEXT_LABELS[type] || type;
      if (contextEntry.referenceIndex) {
        contextPromptPieces.push(
          `Use the ${label.toLowerCase()} from reference image ${contextEntry.referenceIndex}: ${contextEntry.description}`
        );
      } else {
        contextPromptPieces.push(
          `Use her ${label.toLowerCase()} as described: ${contextEntry.description}`
        );
      }
    });

    const promptWithContext =
      contextPromptPieces.length > 0
        ? [submittedPrompt, contextPromptPieces.join("\n")]
            .filter(Boolean)
            .join("\n\n")
        : submittedPrompt;

    const fileRefs = [];

    for (const imageId of combinedImageIds) {
      const ref = await ensureFileUriForLibraryImage(imageId);
      fileRefs.push(ref);
    }

    for (const url of refUrls) {
      const ref = await ensureFileUriFromUrl(url);
      fileRefs.push(ref);
    }

    const output = await generateImage({
      fileRefs,
      prompt: promptWithContext,
      aspectRatio,
      imageOnly,
    });

    if (!output.images.length) {
      throw new Error("Model returned no images");
    }

    const primary = output.images[0];
    const saved = await saveImageBufferToStorage(jobId, primary);

    const imagesOut = output.images.length;
    const usage = {
      imagesOut,
      outputTokens: imagesOut * TOKENS_PER_IMAGE,
    };
    const costUsd = estimateCostUsd({ imagesOut });

    await updateJob(jobId, {
      status: "SUCCEEDED",
      finishedAt: Timestamp.now(),
      result: {
        ...saved,
        note: output.text ?? "",
        promptApplied: promptWithContext,
        contextSnapshot: resolvedContext,
      },
      usage,
      costUsd,
      resolvedReferences: {
        manualImageIds: manualImageIdsFinal,
        contextImageIds: contextImageIdsByType,
        combinedImageIds,
        contextReferencePositions,
      },
    });

    return { status: "SUCCEEDED" };
  } catch (error) {
    const retries = (jobSnapshot.retries || 0) + 1;
    await updateJob(jobId, {
      status: "FAILED",
      error: error instanceof Error ? error.message : String(error),
      retries,
      finishedAt: Timestamp.now(),
    });

    return { status: "FAILED", retries };
  }
}
