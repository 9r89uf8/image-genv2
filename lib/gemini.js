import { GoogleGenAI, Modality } from "@google/genai";
import { MODEL_ID } from "./constants";

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.warn(
    "[gemini] GOOGLE_API_KEY is not set. All model calls will fail until it is configured."
  );
}

const ai = new GoogleGenAI({ apiKey });

export async function generateImage({
  fileRefs = [],
  prompt = "",
  aspectRatio = "1:1",
  imageOnly = false,
}) {
  const parts = [];

  for (const ref of fileRefs) {
    parts.push({
      fileData: {
        mimeType: ref.mimeType ?? "image/png",
        fileUri: ref.fileUri,
      },
    });
  }

  parts.push({ text: prompt });

  const DEFAULT_SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_NONE' },
  ];

  const config = {
    responseModalities: imageOnly
      ? [Modality.IMAGE]
      : [Modality.TEXT, Modality.IMAGE],
    imageConfig: { aspectRatio },
    safetySettings: DEFAULT_SAFETY_SETTINGS
  };

  const res = await ai.models.generateContent({
    model: MODEL_ID,
    contents: [{ role: "user", parts }],
    config,
  });

  const candidate = res?.candidates?.[0];
  const outputParts = candidate?.content?.parts ?? [];

  const images = [];
  let text = "";

  for (const part of outputParts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      const buffer = Buffer.from(part.inlineData.data, "base64");
      images.push({ buffer, mimeType });
    } else if (part.text) {
      text += part.text;
    }
  }

  return { images, text };
}

export function createImageChat({
  history = [],
  aspectRatio = "1:1",
} = {}) {
  return ai.chats.create({
    model: MODEL_ID,
    history,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio },
    },
  });
}
