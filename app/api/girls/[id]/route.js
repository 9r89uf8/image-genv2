export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db } from "@/lib/firebase-admin";

export async function PATCH(request, context) {
  const { params } = context;
  const { id } = await params;
  const body = await request.json();
  await db.collection("girls").doc(id).update(body);
  return new Response(null, { status: 204 });
}
