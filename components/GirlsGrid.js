'use client';

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useComposer } from "@/store/useComposer";

const cn = (...classes) => classes.filter(Boolean).join(" ");

const emptyGirl = { name: "", notes: "" };

export default function GirlsGrid() {
  const [girls, setGirls] = useState([]);
  const [library, setLibrary] = useState([]);
  const [selectedGirlId, setSelectedGirlId] = useState("");
  const [createForm, setCreateForm] = useState(emptyGirl);
  const [editForm, setEditForm] = useState({
    name: "",
    notes: "",
    refImageIds: [],
  });
  const [loading, setLoading] = useState({
    girls: false,
    library: false,
    create: false,
    save: false,
  });
  const [errors, setErrors] = useState({ girls: "", library: "" });
  const [createError, setCreateError] = useState("");

  const setComposerField = useComposer((state) => state.setField);
  const setComposerImageIds = useComposer((state) => state.setImageIds);

  useEffect(() => {
    const loadGirls = async () => {
      setLoading((prev) => ({ ...prev, girls: true }));
      try {
        const res = await fetch("/api/girls");
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setGirls(data.girls ?? []);
        setErrors((prev) => ({ ...prev, girls: "" }));
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          girls: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setLoading((prev) => ({ ...prev, girls: false }));
      }
    };

    const loadLibrary = async () => {
      setLoading((prev) => ({ ...prev, library: true }));
      try {
        const res = await fetch("/api/library?limit=120");
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setLibrary(data.images ?? []);
        setErrors((prev) => ({ ...prev, library: "" }));
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          library: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setLoading((prev) => ({ ...prev, library: false }));
      }
    };

    loadGirls();
    loadLibrary();
  }, []);

  const selectedGirl = useMemo(
    () => girls.find((girl) => girl.id === selectedGirlId),
    [girls, selectedGirlId]
  );

  useEffect(() => {
    if (!selectedGirl) return;
    setEditForm({
      name: selectedGirl.name ?? "",
      notes: selectedGirl.notes ?? "",
      refImageIds: Array.isArray(selectedGirl.refImageIds)
        ? selectedGirl.refImageIds.slice(0, 2)
        : [],
    });
  }, [selectedGirl]);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!createForm.name.trim()) {
      setCreateError("Name is required");
      return;
    }
    setCreateError("");
    setLoading((prev) => ({ ...prev, create: true }));
    try {
      const res = await fetch("/api/girls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createForm.name.trim(),
          notes: createForm.notes.trim(),
          refImageIds: [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setCreateForm(emptyGirl);
      await refreshGirls();
      setSelectedGirlId(data.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading((prev) => ({ ...prev, create: false }));
    }
  };

  const refreshGirls = async () => {
    setLoading((prev) => ({ ...prev, girls: true }));
    try {
      const res = await fetch("/api/girls");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setGirls(data.girls ?? []);
      setErrors((prev) => ({ ...prev, girls: "" }));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        girls: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setLoading((prev) => ({ ...prev, girls: false }));
    }
  };

  const toggleRefImage = (id) => {
    setEditForm((prev) => {
      const exists = prev.refImageIds.includes(id);
      if (exists) {
        return {
          ...prev,
          refImageIds: prev.refImageIds.filter((item) => item !== id),
        };
      }
      if (prev.refImageIds.length >= 2) {
        return prev;
      }
      return { ...prev, refImageIds: [...prev.refImageIds, id] };
    });
  };

  const handleSave = async () => {
    if (!selectedGirl) return;
    setLoading((prev) => ({ ...prev, save: true }));
    try {
      await fetch(`/api/girls/${selectedGirl.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          notes: editForm.notes,
          refImageIds: editForm.refImageIds.slice(0, 2),
        }),
      });
      await refreshGirls();
    } finally {
      setLoading((prev) => ({ ...prev, save: false }));
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-6">
        <form
          onSubmit={handleCreate}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="text-lg font-semibold">Create Girl</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Add a new character with name and optional notes.
          </p>
          <div className="mt-4 grid gap-3 text-sm">
            <label className="grid gap-1">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Name
              </span>
              <input
                type="text"
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Notes
              </span>
              <textarea
                rows={3}
                value={createForm.notes}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    notes: event.target.value,
                  }))
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
              />
            </label>
          </div>
          {createError && (
            <p className="mt-2 text-xs text-rose-500">{createError}</p>
          )}
          <button
            type="submit"
            disabled={loading.create}
            className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {loading.create ? "Creating…" : "Create"}
          </button>
        </form>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Girls</h2>
            {loading.girls && (
              <span className="text-xs text-slate-500">Refreshing…</span>
            )}
          </header>
          {errors.girls ? (
            <p className="rounded-lg border border-rose-400 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
              {errors.girls}
            </p>
          ) : girls.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
              No girls yet. Create one to manage references.
            </p>
          ) : (
            <ul className="grid gap-3">
              {girls.map((girl) => (
                <li key={girl.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedGirlId(girl.id)}
                    className={cn(
                      "w-full rounded-xl border px-4 py-3 text-left transition",
                      selectedGirlId === girl.id
                        ? "border-slate-900 bg-slate-100 dark:border-slate-100 dark:bg-slate-800"
                        : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                    )}
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">
                        {girl.name || "Unnamed"}
                      </span>
                      <span className="text-xs text-slate-500">
                        {Array.isArray(girl.refImageIds)
                          ? `${girl.refImageIds.length} refs`
                          : "0 refs"}
                      </span>
                    </div>
                    {girl.notes && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-300">
                        {girl.notes}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {selectedGirl ? (
          <div className="flex h-full flex-col gap-4">
            <header className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Manage {selectedGirl.name || "Unnamed"}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setComposerField("girlId", selectedGirl.id);
                  setComposerImageIds(editForm.refImageIds);
                }}
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Use in composer
              </button>
            </header>
            <div className="grid gap-3 text-sm">
              <label className="grid gap-1">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Name
                </span>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
                />
              </label>
              <label className="grid gap-1">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Notes
                </span>
                <textarea
                  rows={4}
                  value={editForm.notes}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
                />
              </label>
            </div>

            <section className="flex-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Primary references ({editForm.refImageIds.length}/2)
                </span>
                <div className="flex items-center gap-3 text-xs">
                  {errors.library && (
                    <span className="text-rose-500">{errors.library}</span>
                  )}
                  {loading.library && (
                    <span className="text-slate-500">Loading…</span>
                  )}
                </div>
              </div>
              {library.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  Upload reference images in the Library tab.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-3 lg:grid-cols-4">
                  {library.map((image) => {
                    const isSelected = editForm.refImageIds.includes(image.id);
                    return (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => toggleRefImage(image.id)}
                        className={cn(
                          "relative overflow-hidden rounded-xl border shadow-sm transition focus:outline-none focus:ring-2 focus:ring-slate-500",
                          isSelected
                            ? "border-slate-900 ring-2 ring-slate-400 dark:border-slate-100 dark:ring-slate-600"
                            : "border-transparent hover:translate-y-[-1px]"
                        )}
                      >
                        <Image
                          src={image.publicUrl}
                          alt={image.filename || "reference"}
                          width={160}
                          height={160}
                          className="h-24 w-full object-cover"
                        />
                        <span
                          className={cn(
                            "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                            isSelected
                              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                              : "bg-white/80 text-slate-600 backdrop-blur dark:bg-slate-900/80 dark:text-slate-200"
                          )}
                        >
                          {isSelected ? "Primary" : "Select"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={loading.save}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                {loading.save ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
            Select a girl to manage references.
          </div>
        )}
      </div>
    </div>
  );
}
