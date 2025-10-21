import { db, FieldValue, Timestamp } from "@/lib/firebase-admin";
import { CONTEXT_TYPES } from "@/lib/constants";

export function normalizeType(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function validateType(type) {
  return CONTEXT_TYPES.includes(type);
}

export async function loadGirlDoc(girlId) {
  const ref = db.collection("girls").doc(girlId);
  const snap = await ref.get();
  if (!snap.exists) {
    return null;
  }
  return { ref, data: snap.data() };
}

export async function setLibraryContextMetadata(imageId, type, ownerId) {
  if (!imageId) return;
  const ref = db.collection("library").doc(imageId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("context image not found");
  }
  const data = snap.data();
  if ((data.ownerId || null) !== ownerId) {
    throw new Error("context image must belong to this girl");
  }

  await ref.set(
    {
      contextType: type,
      category: "context",
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
}

export async function clearLibraryContextMetadata(imageId) {
  if (!imageId) return;
  const ref = db.collection("library").doc(imageId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({
    contextType: FieldValue.delete(),
    category: FieldValue.delete(),
    updatedAt: Timestamp.now(),
  });
}
