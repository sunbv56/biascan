"use client";

import { useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { compressImage, dataUrlBytes, ImagePrepError } from "@/lib/image";
import type { SearchRequest } from "@/lib/types";

interface Props {
  busy: boolean;
  onSubmit: (req: Omit<SearchRequest, "session_id">) => void;
}

const MAX_QUERY = 1000;

function kb(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function SearchForm({ busy, onSubmit }: Props) {
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const ids = { query: useId(), help: useId(), drop: useId(), imgErr: useId() };

  async function accept(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    setPreparing(true);
    try {
      const url = await compressImage(file);
      setImage(url);
      setImageName(file.name || "ảnh chụp");
    } catch (err) {
      setImage(null);
      setImageError(err instanceof ImagePrepError ? err.message : "Không đọc được ảnh này. Thử ảnh khác.");
    } finally {
      setPreparing(false);
      if (pickRef.current) pickRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void accept(e.dataTransfer.files?.[0]);
  }

  function clearImage() {
    setImage(null);
    setImageName("");
    setImageError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || preparing) return;
    const q = query.trim();
    if (!q && !image) return;
    onSubmit({ query: q || undefined, image: image ?? undefined });
  }

  const canSubmit = !busy && !preparing && (Boolean(image) || query.trim().length > 0);

  return (
    <form className="search-form" onSubmit={submit} noValidate>
      <fieldset className="field">
        <legend className="field__label">Ảnh bìa</legend>
        {image ? (
          <div className="preview">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL cục bộ, next/image không tối ưu được */}
            <img src={image} alt="Ảnh bìa đã chọn" className="preview__img" />
            <div className="preview__meta">
              <p className="preview__name">{imageName}</p>
              <p className="mono-note">Đã nén còn {kb(dataUrlBytes(image))}, cạnh dài ≤ 1280 px</p>
              <div className="preview__actions">
                <button type="button" className="btn btn--text" onClick={() => pickRef.current?.click()} disabled={busy}>
                  Đổi ảnh
                </button>
                <button type="button" className="btn btn--text" onClick={clearImage} disabled={busy}>
                  Bỏ ảnh
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            id={ids.drop}
            className="dropzone"
            data-dragging={dragging || undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <p className="dropzone__hint">{preparing ? "Đang nén ảnh…" : "Thả ảnh bìa vào đây"}</p>
            <div className="dropzone__actions">
              <button type="button" className="btn btn--ghost dropzone__camera" onClick={() => cameraRef.current?.click()} disabled={preparing || busy}>
                Chụp bìa
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => pickRef.current?.click()} disabled={preparing || busy}>
                Chọn ảnh
              </button>
            </div>
            <p className="mono-note">JPEG, PNG hoặc WebP · tự nén trước khi gửi</p>
          </div>
        )}
        <input
          ref={pickRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          aria-label="Chọn ảnh bìa từ máy"
          aria-describedby={imageError ? ids.imgErr : undefined}
          onChange={(e) => void accept(e.target.files?.[0])}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          aria-label="Chụp ảnh bìa bằng camera"
          onChange={(e) => void accept(e.target.files?.[0])}
        />
        {imageError && (
          <p id={ids.imgErr} className="field__error" role="alert">
            {imageError}
          </p>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor={ids.query} className="field__label">
          Mô tả cuốn sách
        </label>
        <textarea
          id={ids.query}
          className="textarea"
          rows={4}
          maxLength={MAX_QUERY}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          placeholder="VD: tiểu thuyết về cậu bé chăn cừu đi tìm kho báu ở Ai Cập"
          aria-describedby={ids.help}
        />
        <p id={ids.help} className="field__help">
          Tên sách, tác giả, hay chỉ là nội dung bạn nhớ được. Ctrl + Enter để gửi.
        </p>
      </div>

      <button type="submit" className="btn btn--primary btn--block" disabled={!canSubmit} aria-disabled={!canSubmit}>
        {busy ? "Đang tìm…" : "Tìm sách"}
      </button>
    </form>
  );
}
