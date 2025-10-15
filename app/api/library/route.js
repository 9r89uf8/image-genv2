export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db } from "@/lib/firebase-admin";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || 100);

  const snapshot = await db
    .collection("library")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const images = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null,
      };
    })
    .filter((image) => !image.ownerId);

  return Response.json({ images });
}
