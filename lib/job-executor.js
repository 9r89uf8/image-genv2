import { bucket, Timestamp } from "./firebase-admin";
import {
  ensureFileUriForLibraryImage,
  ensureFileUriFromUrl,
} from "./files";
import { estimateCostUsd } from "./costs";
import { generateImage } from "./gemini";
import { getJob, updateJob } from "./db";
import { TOKENS_PER_IMAGE } from "./constants";

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
    const prompt = jobSnapshot.prompt ?? "";
    const inputs = jobSnapshot.inputs ?? {};
    const {
      imageIds = [],
      refUrls = [],
      aspectRatio = "1:1",
      imageOnly = false,
    } = inputs;

    const fileRefs = [];

    for (const imageId of imageIds) {
      const ref = await ensureFileUriForLibraryImage(imageId);
      fileRefs.push(ref);
    }

    for (const url of refUrls) {
      const ref = await ensureFileUriFromUrl(url);
      fileRefs.push(ref);
    }

    const output = await generateImage({
      fileRefs,
      prompt,
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
      },
      usage,
      costUsd,
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
