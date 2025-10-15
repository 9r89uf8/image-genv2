export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db, Timestamp } from "@/lib/firebase-admin";
import { DEFAULT_ASPECT_RATIO } from "@/lib/constants";

function serializeTimestamp(ts) {
  return ts?.toDate?.()?.toISOString?.() ?? null;
}

export async function GET() {
  const snapshot = await db
    .collection("chatSessions")
    .orderBy("lastActive", "desc")
    .limit(30)
    .get();

  const sessions = snapshot.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      id: doc.id,
      title: data.title || "Untitled",
      girlId: data.girlId || "",
      aspectRatio: data.aspectRatio || DEFAULT_ASPECT_RATIO,
      systemPrompt: data.systemPrompt || "",
      createdAt: serializeTimestamp(data.createdAt),
      lastActive: serializeTimestamp(data.lastActive),
    };
  });

  return Response.json({ sessions });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const {
    title = "New chat",
    girlId = "",
    aspectRatio = DEFAULT_ASPECT_RATIO,
    systemPrompt = "",
  } = body;

  const ref = db.collection("chatSessions").doc();
  const now = Timestamp.now();

  await ref.set({
    title,
    girlId,
    aspectRatio,
    systemPrompt,
    createdAt: now,
    lastActive: now,
  });

  return Response.json({ id: ref.id });
}
