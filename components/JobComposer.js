'use client';
//components/JobComposer.js
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ASPECT_RATIOS, MAX_REFERENCES, CONTEXT_TYPES } from "@/lib/constants";
import { useComposer } from "@/store/useComposer";
import { useQueueView } from "@/store/useQueueView";
import {
  createEmptyContextAssets,
  normalizeContextAssets,
  CONTEXT_LABELS,
} from "@/lib/context";

const cn = (...classes) => classes.filter(Boolean).join(" ");
const ordinal = (index) => {
  const labels = ["1st", "2nd", "3rd"];
  return labels[index] || `${index + 1}th`;
};

const getUrlMeta = (url) => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const rawName = segments[segments.length - 1] || parsed.hostname || url;
    let displayName = rawName;
    try {
      displayName = decodeURIComponent(rawName);
    } catch {
      displayName = rawName;
    }
    return {
      displayName,
      hostname: parsed.hostname || "",
    };
  } catch {
    return {
      displayName: url,
      hostname: "",
    };
  }
};

function RefUrlPreview({ url, orderLabel, onRemove }) {
  const [failed, setFailed] = useState(false);
  const { displayName, hostname } = useMemo(() => getUrlMeta(url), [url]);

  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm sm:p-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white sm:px-2 sm:py-0.5 sm:text-[10px] dark:bg-slate-100 dark:text-slate-900">
          {orderLabel}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full bg-slate-300 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-400 sm:px-2.5 sm:py-1 sm:text-[11px] dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500"
        >
          Remove
        </button>
      </div>
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
        {failed ? (
          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-slate-500 sm:text-[11px] dark:text-slate-400">
            Preview unavailable
          </div>
        ) : (
          // Use plain img to avoid domain restrictions from next/image.
          <img
            src={url}
            alt={`Reference ${orderLabel}`}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
            draggable={false}
          />
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-sm font-medium text-slate-700 underline decoration-dotted underline-offset-2 sm:text-xs dark:text-slate-200"
        >
          {displayName}
        </a>
        {hostname && (
          <span className="truncate text-xs uppercase tracking-wide text-slate-500 sm:text-[10px] dark:text-slate-400">
            {hostname}
          </span>
        )}
      </div>
    </div>
  );
}

export default function JobComposer() {
  const type = useComposer((state) => state.type);
  const setField = useComposer((state) => state.setField);
  const girlId = useComposer((state) => state.girlId);
  const setImageIds = useComposer((state) => state.setImageIds);
  const imageIds = useComposer((state) => state.imageIds);
  const toggleImageId = useComposer((state) => state.toggleImageId);
  const refUrls = useComposer((state) => state.refUrls);
  const addRefUrl = useComposer((state) => state.addRefUrl);
  const removeRefUrl = useComposer((state) => state.removeRefUrl);
  const prompt = useComposer((state) => state.prompt);
  const aspectRatio = useComposer((state) => state.aspectRatio);
  const imageOnly = useComposer((state) => state.imageOnly);
  const chatMode = useComposer((state) => state.chatMode);
  const isSubmitting = useComposer((state) => state.isSubmitting);
  const clearReferences = useComposer((state) => state.clearReferences);
  const composerContextAssets = useComposer((state) => state.contextAssets);
  const contextSelections = useComposer((state) => state.contextSelections);
  const setContextAssets = useComposer((state) => state.setContextAssets);
  const setContextSelection = useComposer(
    (state) => state.setContextSelection
  );
  const resetContextSelections = useComposer(
    (state) => state.resetContextSelections
  );
  const submit = useComposer((state) => state.submit);
  const editingFromJob = useComposer((state) => state.editingFromJob);
  const clearEditingContext = useComposer(
    (state) => state.clearEditingContext
  );

  const refreshQueue = useQueueView((state) => state.refresh);

  const [girls, setGirls] = useState([]);
  const [library, setLibrary] = useState([]);
  const [ownedLibrary, setOwnedLibrary] = useState([]);
  const [loading, setLoading] = useState({
    girls: false,
    library: false,
    ownedLibrary: false,
  });
  const [errors, setErrors] = useState({
    girls: "",
    library: "",
    ownedLibrary: "",
    submit: "",
  });
  const [urlInput, setUrlInput] = useState("");
  const [tempUploading, setTempUploading] = useState(false);
  const [contextLimitMessage, setContextLimitMessage] = useState("");
  const ownedRequestRef = useRef(0);
  const previousContextGirlRef = useRef("");
  const [showSharedLibrary, setShowSharedLibrary] = useState(false);
  const [showOwnedLibrary, setShowOwnedLibrary] = useState(true);

  useEffect(() => {
    const loadGirls = async () => {
      setLoading((prev) => ({ ...prev, girls: true }));
      try {
        const res = await fetch("/api/girls");
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        setGirls(data.girls ?? []);
        setErrors((prev) => ({ ...prev, girls: "" }));
      } catch (error) {
        setErrors((prev) => ({
          ...prev,
          girls: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setLoading((prev) => ({ ...prev, girls: false }));
      }
    };

    loadGirls();
  }, []);

  useEffect(() => {
    const loadLibrary = async () => {
      setLoading((prev) => ({ ...prev, library: true }));
      try {
        const res = await fetch("/api/library?limit=160");
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        setLibrary(data.images ?? []);
        setErrors((prev) => ({ ...prev, library: "" }));
      } catch (error) {
        setErrors((prev) => ({
          ...prev,
          library: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setLoading((prev) => ({ ...prev, library: false }));
      }
    };

    loadLibrary();
  }, []);

  useEffect(() => {
    const loadOwnedLibrary = async () => {
      const requestId = Date.now();
      ownedRequestRef.current = requestId;

      if (!girlId) {
        setOwnedLibrary([]);
        setErrors((prev) => ({ ...prev, ownedLibrary: "" }));
        setLoading((prev) => ({ ...prev, ownedLibrary: false }));
        return;
      }

      setLoading((prev) => ({ ...prev, ownedLibrary: true }));
      try {
        const res = await fetch(`/api/girls/${girlId}/images`);
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();
        if (ownedRequestRef.current === requestId) {
          setOwnedLibrary(data.images ?? []);
          setErrors((prev) => ({ ...prev, ownedLibrary: "" }));
        }
      } catch (error) {
        if (ownedRequestRef.current === requestId) {
          setErrors((prev) => ({
            ...prev,
            ownedLibrary: error instanceof Error ? error.message : String(error),
          }));
        }
      } finally {
        if (ownedRequestRef.current === requestId) {
          setLoading((prev) => ({ ...prev, ownedLibrary: false }));
        }
      }
    };

    loadOwnedLibrary();
  }, [girlId]);

  const selectedGirl = useMemo(
    () => girls.find((girl) => girl.id === girlId),
    [girls, girlId]
  );

  useEffect(() => {
    if (editingFromJob) return;
    if (selectedGirl?.refImageIds?.length && type === "generate") {
      setImageIds(selectedGirl.refImageIds);
    }
  }, [selectedGirl, setImageIds, editingFromJob, type]);

  useEffect(() => {
    const girlKey = selectedGirl?.id || "";
    if (!girlKey) {
      setContextAssets(createEmptyContextAssets(), { resetSelections: true });
      resetContextSelections();
      previousContextGirlRef.current = "";
      setContextLimitMessage("");
      return;
    }
    const normalized = normalizeContextAssets(selectedGirl.contextAssets);
    const shouldReset = previousContextGirlRef.current !== girlKey;
    setContextAssets(normalized, { resetSelections: shouldReset });
    if (shouldReset) {
      resetContextSelections();
      setContextLimitMessage("");
    }
    previousContextGirlRef.current = girlKey;
  }, [
    selectedGirl,
    setContextAssets,
    resetContextSelections,
  ]);

  const ownedImageMap = useMemo(() => {
    const map = new Map();
    ownedLibrary.forEach((image) => {
      map.set(image.id, image);
    });
    return map;
  }, [ownedLibrary]);

  const contextImageCount = useMemo(
    () =>
      CONTEXT_TYPES.reduce((count, typeKey) => {
        const selection = contextSelections[typeKey];
        const asset = composerContextAssets[typeKey];
        if (selection?.useImage && asset?.imageId) {
          return count + 1;
        }
        return count;
      }, 0),
    [contextSelections, composerContextAssets]
  );

  const contextAssetsWithMeta = useMemo(
    () =>
      CONTEXT_TYPES.reduce((acc, typeKey) => {
        const asset = composerContextAssets[typeKey] || {
          imageId: "",
          description: "",
        };
        const image = asset.imageId
          ? ownedImageMap.get(asset.imageId)
          : null;
        acc[typeKey] = { asset, image };
        return acc;
      }, {}),
    [composerContextAssets, ownedImageMap]
  );

  const contextImageIdsSet = useMemo(() => {
    const set = new Set();
    CONTEXT_TYPES.forEach((typeKey) => {
      const asset = composerContextAssets[typeKey];
      if (asset?.imageId) {
        set.add(asset.imageId);
      }
    });
    return set;
  }, [composerContextAssets]);

  const ownedSubjectLibrary = useMemo(
    () =>
      ownedLibrary.filter((image) => {
        if (!image) return false;
        if (contextImageIdsSet.has(image.id)) return false;
        const contextType = typeof image.contextType === "string" ? image.contextType.toLowerCase() : "";
        if (contextType && CONTEXT_TYPES.includes(contextType)) {
          return false;
        }
        const category = typeof image.category === "string" ? image.category.toLowerCase() : "";
        if (category === "context") {
          return false;
        }
        return true;
      }),
    [ownedLibrary, contextImageIdsSet]
  );

  const contextImageOrderMap = useMemo(() => {
    let position = imageIds.length;
    const order = {};
    CONTEXT_TYPES.forEach((typeKey) => {
      const selection = contextSelections[typeKey];
      const asset = composerContextAssets[typeKey];
      if (selection?.useImage && asset?.imageId) {
        position += 1;
        order[typeKey] = position;
      }
    });
    return order;
  }, [imageIds, contextSelections, composerContextAssets]);

  const hasActiveContextSelections = useMemo(
    () =>
      CONTEXT_TYPES.some((typeKey) => {
        const selection = contextSelections[typeKey];
        return Boolean(selection?.useImage || selection?.useText);
      }),
    [contextSelections]
  );

  const totalRefs = imageIds.length + refUrls.length + contextImageCount;
  const remainingSlots = Math.max(0, MAX_REFERENCES - totalRefs);
  const limitReached = totalRefs >= MAX_REFERENCES;
  const maxManualSlots = Math.max(
    0,
    MAX_REFERENCES - refUrls.length - contextImageCount
  );
  const manualSlotsRemaining = Math.max(
    0,
    maxManualSlots - imageIds.length
  );
  const maxTemporarySlots = Math.max(
    0,
    MAX_REFERENCES - imageIds.length - contextImageCount
  );
  const temporarySlotsRemaining = Math.max(
    0,
    maxTemporarySlots - refUrls.length
  );

  useEffect(() => {
    if (
      contextLimitMessage &&
      contextLimitMessage.includes("No reference slots left") &&
      remainingSlots > 0
    ) {
      setContextLimitMessage("");
    }
  }, [contextLimitMessage, remainingSlots]);

  useEffect(() => {
    if (type !== "edit" && editingFromJob) {
      clearEditingContext();
    }
  }, [type, editingFromJob, clearEditingContext]);

  const baseRefUrl =
    editingFromJob && refUrls.length > 0 ? refUrls[0] : "";

  useEffect(() => {
    if (editingFromJob) {
      setShowOwnedLibrary(false);
      setShowSharedLibrary(true);
    } else {
      setShowOwnedLibrary(true);
      setShowSharedLibrary(false);
    }
  }, [editingFromJob]);

  const handleAddUrl = () => {
    if (limitReached) return;
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    addRefUrl(trimmed);
    setUrlInput("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      setErrors((prev) => ({ ...prev, submit: "" }));
      const jobId = await submit();
      if (jobId) {
        await refreshQueue();
      }
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        submit: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const handleContextImageToggle = (type, nextValue) => {
    const selection = contextSelections[type] || {
      useImage: false,
      useText: false,
    };
    const asset = composerContextAssets[type] || {
      imageId: "",
      description: "",
    };
    if (selection.useImage === nextValue) return;
    if (nextValue && !asset.imageId) {
      setContextLimitMessage(
        "Add an image for this context in the Girls manager before using it here."
      );
      return;
    }
    if (nextValue && totalRefs >= MAX_REFERENCES) {
      setContextLimitMessage(
        "No reference slots left. Remove another reference to include this context image."
      );
      return;
    }
    setContextSelection(type, { useImage: nextValue });
    setContextLimitMessage("");
  };

  const handleContextTextToggle = (type, nextValue) => {
    const selection = contextSelections[type] || {
      useImage: false,
      useText: false,
    };
    const asset = composerContextAssets[type] || {
      imageId: "",
      description: "",
    };
    if (selection.useText === nextValue) return;
    if (nextValue && !asset.description) {
      setContextLimitMessage(
        "Add a description for this context in the Girls manager before sending it to the prompt."
      );
      return;
    }
    setContextSelection(type, { useText: nextValue });
    setContextLimitMessage("");
  };

  const handleClearContextSelections = () => {
    resetContextSelections();
    setContextLimitMessage("");
  };

  const renderReferenceButton = (image, category) => {
    const isSelected = imageIds.includes(image.id);
    const orderIndex = isSelected ? imageIds.indexOf(image.id) : null;
    return (
      <button
        key={image.id}
        type="button"
        onClick={() => {
          toggleImageId(image.id);
        }}
        disabled={limitReached && !isSelected}
        className={cn(
          "group relative overflow-hidden rounded-xl border shadow-sm transition focus:outline-none focus:ring-2 focus:ring-slate-500",
          isSelected
            ? "border-slate-900 ring-2 ring-slate-400 dark:border-slate-100 dark:ring-slate-600"
            : limitReached
            ? "border-transparent opacity-40"
            : "border-transparent hover:-translate-y-px"
        )}
      >
        <Image
          src={image.publicUrl}
          alt={image.filename || "reference image"}
          width={200}
          height={200}
          className="h-full w-full object-cover"
        />
        {category === "owned" && (
          <span className="absolute left-2 top-2 rounded-full bg-slate-900/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-white dark:bg-slate-100/90 dark:text-slate-900">
            Private
          </span>
        )}
        <span
          className={cn(
            "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
            isSelected
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "bg-white/80 text-slate-600 backdrop-blur dark:bg-slate-900/80 dark:text-slate-200"
          )}
        >
          {isSelected
            ? ordinal(orderIndex)
            : limitReached
            ? "Max"
            : "Tap"}
        </span>
      </button>
    );
  };

  const renderContextControl = (type) => {
    const entry = contextAssetsWithMeta[type] || {
      asset: { imageId: "", description: "" },
      image: null,
    };
    const asset = entry.asset;
    const image = entry.image;
    const selection = contextSelections[type] || {
      useImage: false,
      useText: false,
    };
    const hasImage = Boolean(asset.imageId && image);
    const hasDescription = Boolean(asset.description);
    const referenceOrder = contextImageOrderMap[type];

    return (
      <div
        key={type}
        className={cn(
          "space-y-3 rounded-xl border p-4 shadow-sm transition",
          selection.useImage || selection.useText
            ? "border-slate-900/50 bg-slate-100 dark:border-slate-100/40 dark:bg-slate-800/40"
            : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {CONTEXT_LABELS[type]}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {hasImage ? "Image ready" : "No image assigned"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-[11px] font-semibold uppercase tracking-wide">
            {selection.useImage && hasImage && referenceOrder && (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white dark:bg-slate-100 dark:text-slate-900">
                {ordinal(referenceOrder - 1)} ref
              </span>
            )}
            {selection.useText && hasDescription && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                Prompt text
              </span>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          {hasImage ? (
            <Image
              src={image.publicUrl}
              alt={`${CONTEXT_LABELS[type]} reference`}
              width={320}
              height={320}
              className="h-32 w-full object-cover"
            />
          ) : (
            <div className="flex h-32 items-center justify-center px-3 text-center">
              Manage this {CONTEXT_LABELS[type].toLowerCase()} image from the
              Girls page.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 text-xs">
          <label
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition",
              hasImage
                ? "cursor-pointer border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800"
                : "cursor-not-allowed border-slate-200 bg-slate-100 opacity-60 dark:border-slate-700 dark:bg-slate-800"
            )}
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              checked={selection.useImage && hasImage}
              onChange={(event) =>
                handleContextImageToggle(type, event.target.checked)
              }
              disabled={!hasImage}
            />
            <span className="font-medium text-slate-600 dark:text-slate-300">
              Use image (counts toward limit)
            </span>
          </label>

          <label
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition",
              hasDescription
                ? "cursor-pointer border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800"
                : "cursor-not-allowed border-slate-200 bg-slate-100 opacity-60 dark:border-slate-700 dark:bg-slate-800"
            )}
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              checked={selection.useText && hasDescription}
              onChange={(event) =>
                handleContextTextToggle(type, event.target.checked)
              }
              disabled={!hasDescription}
            />
            <span className="font-medium text-slate-600 dark:text-slate-300">
              Add description to prompt
            </span>
          </label>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          {hasDescription
            ? asset.description
            : "No description yet. Add one in the Girls manager to describe this context."}
        </div>
      </div>
    );
  };

  const onTempFile = async (file) => {
    if (!file || limitReached) return;
    setTempUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/temp", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      if (data?.publicUrl) {
        addRefUrl(data.publicUrl);
      }
    } catch (error) {
      // eslint-disable-next-line no-alert
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setTempUploading(false);
    }
  };

  const applyTemplate = (kind) => {
    const templates = {
      bikini: `generate an image of the same girl using first and second image in her room, using third image. she is taking a mirror selfie. change the outfit and pose. use the fourth image as her phone. Keep her identity, face, body proportions unchanged.
photo of an adult woman (21+) wearing a simple two-piece bikini in her bedroom during daylight. relaxed pose, gentle smile. 50mm, f/2.8, editorial quality. No nudity, no sheer fabrics, non-sexualized framing.`,
      girl: `generate an image of the same girl using first and second image. she must be in her room, use the third image as her room(picture with bed). she is taking a mirror selfie. change the outfit and pose. use the fourth image as her phone (image with iphone). Keep her identity, face, body proportions unchanged.`,
    };
    const value = templates[kind];
    if (value) {
      setField("prompt", value);
    }
  };

  return (
    <form
      id="composer"
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900"
    >
      {editingFromJob && (
        <div className="mb-4 rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200">
          Editing from previous output{" "}
          <span className="font-mono">
            {String(editingFromJob).slice(0, 8)}
          </span>
          . The first image below is that generated output.
        </div>
      )}

      <div className="mb-4">
        <h2 className="break-words text-lg font-semibold sm:text-xl">Job Composer</h2>
        <p className="break-words text-sm text-slate-500 sm:text-sm dark:text-slate-400">
          Assemble prompt, references, and options. Max {MAX_REFERENCES} references per job.
        </p>
      </div>

      <div className="grid min-w-0 gap-4 sm:gap-6">
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Girl
            </span>
            <select
              value={girlId}
              onChange={(event) => setField("girlId", event.target.value)}
              disabled={Boolean(editingFromJob)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 sm:py-2 sm:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
            >
              <option value="">None</option>
              {girls.map((girl) => (
                <option key={girl.id} value={girl.id}>
                  {girl.name || "Unnamed"}
                </option>
              ))}
            </select>
            {loading.girls && (
              <span className="text-sm text-slate-500 sm:text-xs">Loading girls…</span>
            )}
            {errors.girls && (
              <span className="text-sm text-red-500 sm:text-xs">{errors.girls}</span>
            )}
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Aspect ratio
            </span>
            <select
              value={aspectRatio}
              onChange={(event) => setField("aspectRatio", event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 sm:py-2 sm:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
            >
              {ASPECT_RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ratio}
                </option>
              ))}
            </select>
          </label>
        </div>

        {editingFromJob && baseRefUrl && (
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Base image
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  This is the original output and counts as the first reference URL below.
                </p>
              </div>
              <a
                href={baseRefUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full rounded-full border border-slate-300 px-4 py-2 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:w-auto sm:px-3 sm:py-1 sm:text-xs dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Open full size
              </a>
            </div>
            <div className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-black/5 dark:border-slate-700">
              <div className="relative mx-auto max-h-72 w-full max-w-2xl">
                <div className="relative h-0 w-full pb-[56.25%]">
                  <Image
                    src={baseRefUrl}
                    alt="Base reference"
                    fill
                    className="rounded-xl object-contain"
                    sizes="(min-width: 1024px) 640px, 100vw"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="grid min-w-0 gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                References in use
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {totalRefs}/{MAX_REFERENCES} slots • {imageIds.length} library • {contextImageCount} context • {refUrls.length} uploads • {remainingSlots} left
              </p>
            </div>
            {limitReached && (
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                All slots filled
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Context assets
              </span>
              <button
                type="button"
                onClick={handleClearContextSelections}
                disabled={!hasActiveContextSelections}
                className="rounded-full border border-slate-300 px-4 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Clear context selections
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CONTEXT_TYPES.map((type) => renderContextControl(type))}
            </div>
            {contextLimitMessage && (
              <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
                {contextLimitMessage}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Library references{" "}
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                {maxManualSlots
                  ? `${imageIds.length}/${maxManualSlots} slots used`
                  : `${imageIds.length} selected`}
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-3 text-xs sm:text-xs">
              {manualSlotsRemaining === 0 && maxManualSlots > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  Manual slots full
                </span>
              )}
              {loading.library && (
                <span className="text-slate-500">Loading shared…</span>
              )}
              {girlId && loading.ownedLibrary && (
                <span className="text-slate-500">Loading private…</span>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Girl-specific references
                </span>
                {ownedSubjectLibrary.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setShowOwnedLibrary((prev) => !prev)
                    }
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:px-3 sm:py-1 sm:text-xs dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {showOwnedLibrary ? "Hide private images" : "Show private images"}
                  </button>
                )}
              </div>
              {!girlId ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 sm:text-xs dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  Select a girl above to access private references.
                </div>
              ) : errors.ownedLibrary ? (
                <div className="rounded-lg border border-red-400 bg-red-50 p-3 text-sm text-red-700 sm:text-xs dark:border-red-500/60 dark:bg-red-500/10 dark:text-red-200">
                  {errors.ownedLibrary}
                </div>
              ) : ownedSubjectLibrary.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 sm:text-xs dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  No private references yet. Upload them from the Girls page.
                </div>
              ) : showOwnedLibrary ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {ownedSubjectLibrary.map((image) =>
                    renderReferenceButton(image, "owned")
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 sm:text-xs dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  Private references hidden. Click "Show private images" to browse them.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Shared library images
                </span>
                {library.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setShowSharedLibrary((prev) => !prev)
                    }
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:px-3 sm:py-1 sm:text-xs dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {showSharedLibrary ? "Hide shared images" : "Show shared images"}
                  </button>
                )}
              </div>
              {errors.library ? (
                <div className="rounded-lg border border-red-400 bg-red-50 p-3 text-sm text-red-700 sm:text-xs dark:border-red-500/60 dark:bg-red-500/10 dark:text-red-200">
                  {errors.library}
                </div>
              ) : library.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 sm:text-xs dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  Upload reference images on the Library page.
                </div>
              ) : showSharedLibrary ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {library.map((image) =>
                    renderReferenceButton(image, "shared")
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 sm:text-xs dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  Shared library hidden. Click "Show shared images" to browse all shared assets.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-2">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Temporary images{" "}
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                {maxTemporarySlots
                  ? `${refUrls.length}/${maxTemporarySlots} slots used`
                  : `${refUrls.length} selected`}
              </span>
            </label>
            <div className="break-words text-xs text-slate-500 dark:text-slate-400 sm:text-right">
              Upload from device • Not saved to library
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {refUrls.map((url, index) => (
              <RefUrlPreview
                key={url}
                url={url}
                orderLabel={ordinal(
                  imageIds.length + contextImageCount + index
                )}
                onRemove={() => removeRefUrl(url)}
              />
            ))}
          </div>

          {temporarySlotsRemaining > 0 && (
            <div className="flex items-center gap-3">
              <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 sm:w-auto sm:px-4 sm:py-3 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Upload image from device</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    onTempFile(file);
                    event.target.value = "";
                  }}
                  disabled={tempUploading}
                  className="hidden"
                />
              </label>
              {tempUploading && (
                <span className="text-sm text-slate-500 sm:text-xs">Uploading…</span>
              )}
            </div>
          )}
        </div>

        <div className="grid min-w-0 gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-xs">
              Prompt templates
            </span>
            <button
              type="button"
              onClick={() => applyTemplate("bikini")}
              className="w-full rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:w-auto sm:px-3 sm:py-1 sm:text-xs dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Bikini Pic
            </button>
            <button
              type="button"
              onClick={() => applyTemplate("girl")}
              className="w-full rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:w-auto sm:px-3 sm:py-1 sm:text-xs dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Same Girl Pic
            </button>
          </div>

          <textarea
            value={prompt}
            onChange={(event) => setField("prompt", event.target.value)}
            rows={6}
            placeholder="Describe the edit. Example: Replace the leggings from the first image with the leggings from the second image. Keep the same face and pose. Do not change aspect ratio."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-600"
          />
        </div>

        <div className="flex flex-col gap-3 text-sm sm:flex-row sm:gap-4">
          <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={imageOnly}
              onChange={(event) => setField("imageOnly", event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            Image-only output
          </label>
          <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={chatMode}
              onChange={(event) => setField("chatMode", event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            Keep chat history (beta)
          </label>
        </div>
      </div>

      {errors.submit && (
        <p className="mt-4 rounded-lg border border-rose-400 bg-rose-50 p-3 text-sm text-rose-700 sm:text-xs dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
          {errors.submit}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <span className="text-slate-500 dark:text-slate-400">
          {totalRefs} references selected ·{" "}
          {type === "edit" ? "Edit" : "Generate"} job
        </span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => {
              setField("prompt", "");
              setField("girlId", "");
              setField("type", "generate");
              clearReferences();
              clearEditingContext();
            }}
            className="w-full rounded-full border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 transition hover:bg-slate-100 sm:w-auto sm:py-2 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 sm:w-auto sm:py-2 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {isSubmitting ? "Enqueuing…" : "Enqueue job"}
          </button>
        </div>
      </div>
    </form>
  );
}
