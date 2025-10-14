'use client';

import { useEffect, useState } from "react";
import LibraryGrid from "@/components/LibraryGrid";
import UploadButton from "@/components/UploadButton";

export default function LibraryPage() {
  const [images, setImages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/library?limit=200");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setImages(data.images ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 lg:p-8">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Upload new reference material and send selections to the composer.
          </p>
        </div>
        <UploadButton onUploaded={refresh} />
      </header>
      <LibraryGrid
        images={images}
        loading={isLoading}
        error={error}
        onRefresh={refresh}
      />
    </div>
  );
}
