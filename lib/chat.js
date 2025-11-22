import { bucket } from "@/lib/firebase-admin";
import {
  ensureFileUriForLibraryImage,
  ensureFileUriFromUrl,
} from "@/lib/files";
import { GoogleGenAI, Modality } from "@google/genai";
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
  FILE_URI_TTL_MS,
  MODEL_ID,
} from "@/lib/constants";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function saveChatImageBuffer(
  sessionId,
  turnId,
  idx,
  { buffer, mimeType }
) {
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
    ? "webp"
    : "jpg";
  const storagePath = `chats/${sessionId}/${turnId}-${idx}.${ext}`;
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    contentType: mimeType,
    resumable: false,
    public: true,
  });

  try {
    await file.makePublic();
  } catch {
    // Public access may fail on local buckets; ignore silently.
  }

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  return { storagePath, publicUrl, mimeType };
}

/** Convert Firestore turns into Gemini chat history (Parts/Contents). */
export async function buildGeminiHistoryFromTurns(turnDocs) {
  const history = [];

  for (const docSnap of turnDocs) {
    const data = docSnap.data();
    if (!data) continue;

    if (data.role === "user") {
      const parts = [];
      const attachments = Array.isArray(data.attachments)
        ? [...data.attachments]
        : [];
      let attachmentsChanged = false;

      for (let index = 0; index < attachments.length; index += 1) {
        const attachment = attachments[index];
        if (!attachment) continue;

        let {
          url = "",
          mimeType = "image/png",
          fileUri,
          expiresAtMs = 0,
          libraryId,
        } = attachment;
        const now = Date.now();

        const hasValidUri =
          typeof fileUri === "string" &&
          fileUri.length > 0 &&
          (!expiresAtMs || expiresAtMs > now + 5 * 60 * 1000);

        if (!hasValidUri) {
          try {
            if (libraryId) {
              const uploaded = await ensureFileUriForLibraryImage(libraryId);
              fileUri = uploaded.fileUri;
              mimeType = uploaded.mimeType ?? mimeType;
            } else if (
              typeof url === "string" &&
              url.startsWith("library://")
            ) {
              const id = url.replace("library://", "");
              const uploaded = await ensureFileUriForLibraryImage(id);
              fileUri = uploaded.fileUri;
              mimeType = uploaded.mimeType ?? mimeType;
              libraryId = id;
            } else if (typeof url === "string" && url) {
              const uploaded = await ensureFileUriFromUrl(url, mimeType);
              fileUri = uploaded.fileUri;
              mimeType = uploaded.mimeType ?? mimeType;
              expiresAtMs = now + FILE_URI_TTL_MS;
            } else {
              continue;
            }
          } catch (error) {
            console.error("Failed to ensure file URI for attachment:", error);
            continue;
          }

          attachments[index] = {
            ...attachment,
            fileUri,
            mimeType,
            expiresAtMs: expiresAtMs || now + FILE_URI_TTL_MS,
            libraryId: libraryId || attachment.libraryId,
          };
          attachmentsChanged = true;
        }

        if (fileUri) {
          parts.push({ fileData: { fileUri, mimeType } });
        }
      }

      if (attachmentsChanged) {
        await docSnap.ref
          .update({ attachments })
          .catch(() => {
            // Ignore transient update conflicts.
          });
      }

      if (data.text) {
        parts.push({ text: data.text });
      }
      if (parts.length > 0) {
        history.push({ role: "user", parts });
      }
    } else if (data.role === "model") {
      const parts = [];
      if (data.text) {
        parts.push({ text: data.text });
      }
      if (parts.length > 0) {
        history.push({ role: "model", parts });
      }
    }
  }

  return history;
}

/** Create a new chat instance with history + aspect ratio + image size. */
export function createChat({
  history = [],
  aspectRatio = DEFAULT_ASPECT_RATIO,
  imageSize = DEFAULT_IMAGE_SIZE,
}) {
  return ai.chats.create({
    model: MODEL_ID,
    history,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio, imageSize },
    },
  });
}
