export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Timestamp } from "@/lib/firebase-admin";
import {
  normalizeContextAssets,
  createEmptyContextAssets,
} from "@/lib/context";
import {
  normalizeType,
  validateType,
  loadGirlDoc,
  setLibraryContextMetadata,
  clearLibraryContextMetadata,
} from "./helpers";

export async function POST(request, context) {
  const { params } = context;
  const { id } = await params;
  const body = await request.json();
  const rawType = normalizeType(body.type);

  if (!validateType(rawType)) {
    return Response.json({ error: "invalid context type" }, { status: 400 });
  }

  const girlDoc = await loadGirlDoc(id);
  if (!girlDoc) {
    return Response.json({ error: "girl not found" }, { status: 404 });
  }

  const normalized = normalizeContextAssets(girlDoc.data.contextAssets);
  const previous = normalized[rawType] ?? { imageId: "", description: "" };

  let nextImageId = previous.imageId;
  if (Object.prototype.hasOwnProperty.call(body, "imageId")) {
    if (body.imageId === null) {
      nextImageId = "";
    } else if (typeof body.imageId === "string") {
      nextImageId = body.imageId.trim();
    } else {
      return Response.json({ error: "imageId must be string or null" }, { status: 400 });
    }
  }

  let nextDescription = previous.description;
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    if (body.description === null) {
      nextDescription = "";
    } else if (typeof body.description === "string") {
      nextDescription = body.description.trim();
    } else {
      return Response.json(
        { error: "description must be string or null" },
        { status: 400 }
      );
    }
  }

  const previousImageId = previous.imageId;
  const newImageId = nextImageId || "";

  try {
    if (previousImageId && previousImageId !== newImageId) {
      await clearLibraryContextMetadata(previousImageId);
    }
    if (newImageId) {
      await setLibraryContextMetadata(newImageId, rawType, id);
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "failed to link context image",
      },
      { status: 400 }
    );
  }

  const payload = {
    imageId: newImageId || null,
    description: nextDescription,
    updatedAt: Timestamp.now(),
  };

  await girlDoc.ref.set(
    {
      contextAssets: {
        ...createEmptyContextAssets(),
        ...girlDoc.data.contextAssets,
        [rawType]: payload,
      },
    },
    { merge: true }
  );

  const updatedSnap = await girlDoc.ref.get();
  const updatedData = updatedSnap.data() || {};
  const contextAssets = normalizeContextAssets(updatedData.contextAssets);

  return Response.json({ contextAssets });
}
