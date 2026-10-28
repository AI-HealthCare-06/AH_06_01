import { useEffect } from "react";
import { create } from "zustand";
import { useCloudStore } from "../cloud/sync";
import { cloudEnabled } from "../cloud/client";
import { appStorageKey, demoMode } from "../domain/demo-mode";

const store = create<{
  images: Record<string, string | null>;
  set: (owner: string, value: string | null) => void;
}>((set) => ({
  images: {},
  set: (owner, value) => set((s) => ({ images: { ...s.images, [owner]: value } })),
}));
const key = (owner: string) => appStorageKey("rexrun-local-avatar:" + owner);
const safeImage = (value: string | null) =>
  value &&
  value.length < 2_900_000 &&
  /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
export function useAvatarMedia() {
  const user = useCloudStore((s) => s.userId);
  const owner = demoMode ? "demo" : cloudEnabled ? (user ?? "signed-out") : "local";
  const image = store((s) => s.images[owner] ?? null);
  useEffect(() => {
    try {
      store.getState().set(owner, safeImage(localStorage.getItem(key(owner))));
    } catch {
      store.getState().set(owner, null);
    }
  }, [owner]);
  function clear() {
    try {
      localStorage.removeItem(key(owner));
    } catch {
      /* In-memory selection still changes. */
    }
    store.getState().set(owner, null);
  }
  async function upload(file: File) {
    if (owner === "signed-out") throw new Error("로그인 후 선택해 주세요.");
    if (file.size > 2 * 1024 * 1024) throw new Error("2MB 이하의 이미지나 GIF를 선택해 주세요.");
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const head = String.fromCharCode(...bytes);
    const mime =
      head.startsWith("GIF87a") || head.startsWith("GIF89a")
        ? "image/gif"
        : bytes[0] === 137 && head.slice(1, 4) === "PNG"
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? "image/jpeg"
            : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP"
              ? "image/webp"
              : null;
    if (!mime) throw new Error("PNG, JPG, WebP 또는 GIF 파일을 선택해 주세요.");
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("파일을 읽지 못했어요."));
      reader.readAsDataURL(new Blob([file], { type: mime }));
    });
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        img.naturalWidth * img.naturalHeight <= 16_777_216
          ? resolve()
          : reject(new Error("이미지 크기를 줄여 주세요."));
      img.onerror = () => reject(new Error("이미지를 열지 못했어요."));
      img.src = data;
    });
    try {
      localStorage.setItem(key(owner), data);
    } catch {
      throw new Error("기기 저장 공간을 확보한 뒤 다시 선택해 주세요.");
    }
    store.getState().set(owner, data);
  }
  return { image, upload, clear };
}
