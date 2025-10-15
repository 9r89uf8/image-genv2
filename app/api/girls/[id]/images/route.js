export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db } from "@/lib/firebase-admin";

export async function GET(request, context) {
  const { params } = context;
  const { id } = await params;

  if (!id) {
    return Response.json({ error: "missing girl id" }, { status: 400 });
  }

  const snapshot = await db
    .collection("library")
    .where("ownerId", "==", id)
    .orderBy("createdAt", "desc")
    .get();

  const images = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null,
    };
  });

  return Response.json({ images });
}
