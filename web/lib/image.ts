export const MAX_EDGE = 1280;
export const MAX_BYTES = 4 * 1024 * 1024;

export class ImagePrepError extends Error {}

export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // một số trình duyệt không nhận tuỳ chọn imageOrientation — thử lại bằng <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImagePrepError("Trình duyệt không đọc được ảnh này. Dùng ảnh JPEG, PNG hoặc WebP.");
  }
}

export async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new ImagePrepError("Tệp đã chọn không phải ảnh.");
  const decoded = await decode(file);
  try {
    let { width, height } = fitWithin(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImagePrepError("Không nén được ảnh trên trình duyệt này.");

    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(decoded.source, 0, 0, width, height);
      for (const quality of [0.86, 0.76, 0.66]) {
        const url = canvas.toDataURL("image/jpeg", quality);
        if (dataUrlBytes(url) <= MAX_BYTES) return url;
      }
      width = Math.round(width * 0.8);
      height = Math.round(height * 0.8);
    }
    throw new ImagePrepError("Ảnh vẫn lớn hơn 4 MB sau khi nén. Thử ảnh khác.");
  } finally {
    decoded.close();
  }
}
