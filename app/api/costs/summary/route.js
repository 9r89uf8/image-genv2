export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db } from "@/lib/firebase-admin";

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export async function GET() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const snapshot = await db
    .collection("jobs")
    .where("status", "==", "SUCCEEDED")
    .get();

  let today = 0;
  let last7 = 0;
  let last30 = 0;

  for (const doc of snapshot.docs) {
    const job = doc.data();
    const cost = Number(job.costUsd || 0);
    const finished =
      job.finishedAt?.toDate?.() ??
      job.createdAt?.toDate?.() ??
      new Date(0);

    if (finished >= todayStart) {
      today += cost;
    }
    if (finished >= sevenDaysAgo) {
      last7 += cost;
    }
    if (finished >= thirtyDaysAgo) {
      last30 += cost;
    }
  }

  return Response.json({
    today: Number(today.toFixed(4)),
    last7: Number(last7.toFixed(4)),
    last30: Number(last30.toFixed(4)),
  });
}
