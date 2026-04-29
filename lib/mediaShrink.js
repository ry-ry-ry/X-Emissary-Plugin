export async function shrinkImage(blob, capBytes) {
  if (blob.size <= capBytes) return blob;

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }

  let width = bitmap.width;
  let height = bitmap.height;
  let quality = 0.85;
  let best = blob;

  for (let i = 0; i < 6; i++) {
    width = Math.max(1, Math.round(width * 0.85));
    height = Math.max(1, Math.round(height * 0.85));
    quality = Math.max(0.6, quality - 0.05);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality });

    if (out.size < best.size) best = out;
    if (out.size <= capBytes) {
      bitmap.close && bitmap.close();
      return out;
    }
    if (Math.max(width, height) < 480) break;
  }

  bitmap.close && bitmap.close();
  return best;
}
