"use client";

import { useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { compressImage, dataUrlBytes, ImagePrepError, MAX_EDGE } from "@/lib/image";

export type SendMode = "search" | "ask";

export interface ComposerSend {
  mode: SendMode;
  text: string;
  image: string | null;
  imageName: string;
}

interface Props {
  busy: boolean;
  hasResults: boolean;
  onSend: (msg: ComposerSend) => void;
}

const MAX_TEXT = 1000;

function kb(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.round(bytes / 1024)} KB`;
}

const PLACEHOLDER: Record<SendMode, string> = {
  search: "Tên sách, tác giả hay nội dung bạn nhớ",
  ask: "Hỏi về các cuốn vừa tìm",
};

export function Composer({ busy, hasResults, onSend }: Props) {
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [modeOverride, setModeOverride] = useState<SendMode | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const ids = { text: useId(), help: useId(), imgErr: useId() };

  const mode: SendMode = image ? "search" : (modeOverride ?? (hasResults ? "ask" : "search"));

  async function accept(file: File | undefined) {
    if (!file) return;
    setImageError(null);
    setPreparing(true);
    try {
      setImage(await compressImage(file));
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

  function clearImage() {
    setImage(null);
    setImageName("");
    setImageError(null);
  }

  function onDrop(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    setDragging(false);
    if (!busy) void accept(e.dataTransfer.files?.[0]);
  }

  const trimmed = text.trim();
  const canSend = !busy && !preparing && (mode === "ask" ? trimmed.length > 0 : trimmed.length > 0 || Boolean(image));

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    onSend({ mode, text: trimmed, image, imageName });
    setText("");
    clearImage();
    setModeOverride(null);
  }

  return (
    <form
      className="composer"
      onSubmit={submit}
      noValidate
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {hasResults && !image && (
        <fieldset className="composer__mode">
          <legend className="sr-only">Gửi để</legend>
          {(
            [
              ["search", "Tìm mới"],
              ["ask", "Hỏi tiếp"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="mode-pill">
              <input type="radio" name="composer-mode" value={value} checked={mode === value} onChange={() => setModeOverride(value)} className="mode-pill__input" />
              <span className="mode-pill__label">{label}</span>
            </label>
          ))}
        </fieldset>
      )}

      {image && (
        <div className="attach">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL cục bộ, next/image không tối ưu được */}
          <img src={image} alt="Ảnh bìa đã chọn" className="attach__img" />
          <div className="attach__meta">
            <p className="attach__name">{imageName}</p>
            <p className="mono-note">
              {kb(dataUrlBytes(image))} · cạnh dài ≤ {MAX_EDGE} px
            </p>
          </div>
          <button type="button" className="btn btn--text" onClick={clearImage} disabled={busy}>
            Bỏ ảnh
          </button>
        </div>
      )}

      <label htmlFor={ids.text} className="sr-only">
        {mode === "ask" ? "Câu hỏi cho trợ lý" : "Mô tả cuốn sách"}
      </label>
      <textarea
        id={ids.text}
        className="textarea composer__input"
        rows={2}
        maxLength={MAX_TEXT}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={dragging ? "Thả ảnh bìa vào đây" : PLACEHOLDER[mode]}
        aria-describedby={`${ids.help}${imageError ? ` ${ids.imgErr}` : ""}`}
      />

      <div className="composer__bar">
        <div className="composer__attach">
          <button type="button" className="btn btn--ghost composer__camera" onClick={() => cameraRef.current?.click()} disabled={preparing || busy}>
            Chụp bìa
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => pickRef.current?.click()} disabled={preparing || busy}>
            {preparing ? "Đang nén ảnh…" : image ? "Đổi ảnh" : "Thêm ảnh bìa"}
          </button>
        </div>
        <p id={ids.help} className="composer__help">
          {mode === "ask" ? "Trợ lý dựa trên kết quả gần nhất" : "Ảnh, chữ, hoặc cả hai"} · Enter gửi, Shift + Enter xuống dòng
        </p>
        <button type="submit" className="btn btn--primary composer__send" disabled={!canSend} aria-disabled={!canSend}>
          {busy ? "Đang chờ…" : mode === "ask" ? "Hỏi" : "Tìm sách"}
        </button>
      </div>

      {imageError && (
        <p id={ids.imgErr} className="field__error" role="alert">
          {imageError}
        </p>
      )}

      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Chọn ảnh bìa từ máy"
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
    </form>
  );
}
