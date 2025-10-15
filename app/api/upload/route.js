export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { bucket, db, Timestamp } from "@/lib/firebase-admin";
import { v4 as uuid } from "uuid";

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const girlIdEntry = formData.get("girlId");
  const ownerId =
    typeof girlIdEntry === "string" && girlIdEntry.trim()
      ? girlIdEntry.trim()
      : null;

  if (!file || typeof file === "string") {
    return Response.json({ error: "missing file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/png";
  const id = uuid().replace(/-/g, "");
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
    ? "webp"
    : "jpg";
  const storagePath = `library/${id}.${ext}`;

  const storageFile = bucket.file(storagePath);

  await storageFile.save(buffer, {
    contentType: mimeType,
    resumable: false,
    public: true,
    metadata: {
      cacheControl: "public,max-age=31536000,immutable",
    },
  });

  try {
    await storageFile.makePublic();
  } catch {
    // ignore; buckets without IAM permissions will use signed URLs instead.
  }

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  await db.collection("library").doc(id).set({
    storagePath,
    publicUrl,
    mimeType,
    filename: file.name || `${id}.${ext}`,
    createdAt: Timestamp.now(),
    tags: [],
    ownerId,
  });

  return Response.json({
    imageId: id,
    publicUrl,
    storagePath,
    mimeType,
    ownerId,
  });
}
