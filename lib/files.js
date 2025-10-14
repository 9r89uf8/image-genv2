import { Blob } from "buffer";
import { GoogleGenAI } from "@google/genai";
import { bucket, db, Timestamp } from "./firebase-admin";
import { FILE_URI_TTL_MS } from "./constants";

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function readStorageBytes(storagePath) {
  const [buffer] = await bucket.file(storagePath).download();
  return buffer;
}

export async function uploadToGeminiFiles(
  buffer,
  mimeType = "image/png",
  displayName = "reference.png"
) {
  const blob = new Blob([buffer], { type: mimeType });
  const file = await ai.files.upload({
    file: blob,
    config: { mimeType, displayName },
  });
  const fileUri = file.uri || file.name;
  return { fileUri, mimeType };
}

export async function ensureFileUriForLibraryImage(imageId) {
  const cacheRef = db.collection("filesCache").doc(imageId);
  const cacheSnap = await cacheRef.get();
  const now = Date.now();

  if (cacheSnap.exists) {
    const data = cacheSnap.data();
    if (
      data?.fileUri &&
      data?.expiresAtMs &&
      data.expiresAtMs > now + 5 * 60 * 1000
    ) {
      return { fileUri: data.fileUri, mimeType: data.mimeType ?? "image/png" };
    }
  }

  const libDoc = await db.collection("library").doc(imageId).get();

  if (!libDoc.exists) {
    throw new Error(`library imageId not found: ${imageId}`);
  }

  const { storagePath, mimeType, filename } = libDoc.data();
  const buffer = await readStorageBytes(storagePath);
  const uploaded = await uploadToGeminiFiles(
    buffer,
    mimeType,
    filename || `${imageId}.png`
  );

  await cacheRef.set({
    fileUri: uploaded.fileUri,
    mimeType: uploaded.mimeType,
    expiresAtMs: now + FILE_URI_TTL_MS,
    updatedAt: Timestamp.now(),
  });

  return uploaded;
}

export async function ensureFileUriFromUrl(url, mimeType = "image/png") {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return uploadToGeminiFiles(buffer, mimeType);
}
