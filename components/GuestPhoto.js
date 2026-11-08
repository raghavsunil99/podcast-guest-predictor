"use client";

import { createContext, useCallback, useContext, useRef } from "react";
import { Avatar } from "./ui";
import Icon from "./icons";

// Resize an uploaded photo to a small square JPEG so it can live in the guest record.
export function resizePhoto(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

const PhotoCtx = createContext(null);

// One hidden file picker for the whole app; any guest photo can open it.
export function PhotoProvider({ patch, flash, children }) {
  const input = useRef(null);
  const target = useRef(null);
  const save = useCallback(async (id, file) => {
    if (!id || !file || !file.type?.startsWith("image/")) return;
    await patch(id, { patch: { photoUrl: await resizePhoto(file, 256) } });
    flash?.("Photo updated");
  }, [patch, flash]);
  const pick = useCallback((id) => { target.current = id; input.current?.click(); }, []);
  return (
    <PhotoCtx.Provider value={{ pick, save }}>
      {children}
      <input ref={input} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; save(target.current, f); }} />
    </PhotoCtx.Provider>
  );
}

// A guest's avatar that can be changed in place: click the camera, or drop an image on it.
export default function GuestPhoto({ g, size = 36, ring }) {
  const ctx = useContext(PhotoCtx);
  const avatar = <Avatar name={g.name} src={g.photoUrl} alt={g.gravatarUrl} size={size} ring={ring} />;
  if (!ctx || !g?.id) return avatar;
  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  return (
    <span
      className={`gPhoto${size < 30 ? " tiny" : ""}`}
      style={{ width: size, height: size }}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) stop(e); }}
      onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { stop(e); ctx.save(g.id, f); } }}
    >
      {avatar}
      <span
        className="gPhotoBtn"
        role="button"
        tabIndex={0}
        title={`Change ${g.name}'s photo`}
        aria-label={`Change ${g.name}'s photo`}
        onClick={(e) => { stop(e); ctx.pick(g.id); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { stop(e); ctx.pick(g.id); } }}
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
      >
        <Icon name="image" size={Math.max(11, Math.min(18, size * 0.32))} />
      </span>
    </span>
  );
}
