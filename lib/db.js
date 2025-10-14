import { db, Timestamp } from "./firebase-admin";

export async function createJobDoc(payload) {
  const ref = db.collection("jobs").doc();
  const now = Timestamp.now();

  await ref.set({
    ...payload,
    status: "PENDING",
    retries: payload.retries ?? 0,
    createdAt: now,
  });

  return ref.id;
}

export async function getJob(jobId) {
  const snap = await db.collection("jobs").doc(jobId).get();
  if (!snap.exists) {
    return null;
  }
  return { id: jobId, ...snap.data() };
}

export async function updateJob(jobId, patch) {
  await db.collection("jobs").doc(jobId).update(patch);
}

export async function listJobs(limit = 50) {
  const qs = await db
    .collection("jobs")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return qs.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
