'use client';
//components/UploadButton.js
import { useMemo, useRef, useState } from "react";

export default function UploadButton({
  onUploaded,
  ownerGirlId = "",
  label,
  uploadingLabel,
}) {
  const inputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const buttonLabel = useMemo(
    () => label || "Upload images",
    [label]
  );
  const buttonUploadingLabel = useMemo(
    () => uploadingLabel || "Uploading…",
    [uploadingLabel]
  );

  const handleClick = () => {
    setError("");
    inputRef.current?.click();
  };

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setIsUploading(true);
    setError("");
    try {
      const uploaded = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        if (ownerGirlId) {
          formData.append("girlId", ownerGirlId);
        }

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          throw new Error(await res.text());
        }
        const result = await res.json();
        uploaded.push(result);
      }
      if (typeof onUploaded === "function") {
        await onUploaded(uploaded);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div className="flex flex-col items-end gap-2 text-sm">
      <button
        type="button"
        onClick={handleClick}
        disabled={isUploading}
        className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
      >
        {isUploading ? buttonUploadingLabel : buttonLabel}
      </button>
      {error && <span className="text-xs text-rose-500">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFiles}
      />
    </div>
  );
}
