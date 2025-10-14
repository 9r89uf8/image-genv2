export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db, Timestamp } from "@/lib/firebase-admin";

export async function GET() {
  const snapshot = await db
    .collection("girls")
    .orderBy("createdAt", "desc")
    .get();

  const girls = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null,
    };
  });

  return Response.json({ girls });
}

export async function POST(request) {
  const { name, notes = "", refImageIds = [] } = await request.json();

  if (!name) {
    return Response.json({ error: "name required" }, { status: 400 });
  }

  const ref = db.collection("girls").doc();
  await ref.set({
    name,
    notes,
    refImageIds,
    createdAt: Timestamp.now(),
  });

  return Response.json({ id: ref.id });
}
