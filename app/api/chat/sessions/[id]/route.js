export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db } from "@/lib/firebase-admin";
import { DEFAULT_ASPECT_RATIO } from "@/lib/constants";

function serializeTimestamp(ts) {
  return ts?.toDate?.()?.toISOString?.() ?? null;
}

const libraryCache = new Map();

async function resolveLibraryAttachment(att) {
  if (!att) return att;

  const urlValue = att.url;
  const rawId =
    att.libraryId ||
    (typeof urlValue === "string" && urlValue.startsWith("library://")
      ? urlValue.replace("library://", "")
      : null);

  if (!rawId) return att;

  if (!libraryCache.has(rawId)) {
    const snap = await db.collection("library").doc(rawId).get();
    libraryCache.set(rawId, snap.exists ? snap.data() || null : null);
  }

  const data = libraryCache.get(rawId);

  return {
    ...att,
    libraryId: rawId,
    previewUrl: att.previewUrl || data?.publicUrl || "",
    mimeType: att.mimeType || data?.mimeType || "image/png",
  };
}

export async function GET(_request, context) {
  const { params } = context;
  const { id } = await params;
  libraryCache.clear();

  const sessionRef = db.collection("chatSessions").doc(id);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    return new Response("not found", { status: 404 });
  }

  const turnsSnap = await sessionRef
    .collection("turns")
    .orderBy("createdAt", "asc")
    .get();

  const turns = [];

  for (const doc of turnsSnap.docs) {
    const data = doc.data() || {};
    const attachments = Array.isArray(data.attachments)
      ? await Promise.all(
          data.attachments.map((att) => resolveLibraryAttachment(att))
        )
      : [];

    turns.push({
      id: doc.id,
      role: data.role,
      text: data.text || "",
      attachments,
      images: data.images || [],
      createdAt: serializeTimestamp(data.createdAt),
    });
  }

  const session = sessionSnap.data() || {};

  return Response.json({
    session: {
      id: sessionSnap.id,
      title: session.title || "Untitled",
      girlId: session.girlId || "",
      aspectRatio: session.aspectRatio || DEFAULT_ASPECT_RATIO,
      systemPrompt: session.systemPrompt || "",
      createdAt: serializeTimestamp(session.createdAt),
      lastActive: serializeTimestamp(session.lastActive),
    },
    turns,
  });
}

export async function DELETE(_request, context) {
  const { params } = context;
  const { id } = await params;
  const sessionRef = db.collection("chatSessions").doc(id);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    return new Response(null, { status: 204 });
  }

  const turnsSnap = await sessionRef.collection("turns").get();
  const batch = db.batch();

  turnsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  await sessionRef.delete();

  return new Response(null, { status: 204 });
}
