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
  clearLibraryContextMetadata,
} from "../helpers";

export async function DELETE(request, context) {
  const { params } = context;
  const { id, type } = await params;
  const normalizedType = normalizeType(type);

  if (!validateType(normalizedType)) {
    return Response.json({ error: "invalid context type" }, { status: 400 });
  }

  const girlDoc = await loadGirlDoc(id);
  if (!girlDoc) {
    return Response.json({ error: "girl not found" }, { status: 404 });
  }

  const normalizedAssets = normalizeContextAssets(girlDoc.data.contextAssets);
  const previous = normalizedAssets[normalizedType] ?? {
    imageId: "",
    description: "",
  };

  if (previous.imageId) {
    await clearLibraryContextMetadata(previous.imageId);
  }

  await girlDoc.ref.set(
    {
      contextAssets: {
        ...createEmptyContextAssets(),
        ...girlDoc.data.contextAssets,
        [normalizedType]: {
          imageId: null,
          description: "",
          updatedAt: Timestamp.now(),
        },
      },
    },
    { merge: true }
  );

  const updatedSnap = await girlDoc.ref.get();
  const updatedAssets = normalizeContextAssets(updatedSnap.data().contextAssets);

  return Response.json({ contextAssets: updatedAssets });
}
