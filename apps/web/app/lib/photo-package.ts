/** Largest package we will build in memory; past this the user downloads photos one by one. */
export const MAX_PACKAGE_BYTES = 250 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };

/** The file name inside a `content-disposition` header, if it names one. */
export function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1]!.trim()); } catch { /* fall through to the plain form */ }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain ? plain[1]!.trim() : null;
}

/** Keeps a name safe as a zip entry: no folders, no characters file systems reject. */
function clean(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim();
}

/**
 * `03-2-<original name>`: checklist item position, then the photo's position
 * within that item, so the folder sorts in checklist order. Two photos can
 * share an original name, hence the prefix.
 */
export function entryName(itemNumber: number, indexInItem: number, original: string | null, contentType: string | null): string {
  const prefix = `${String(itemNumber).padStart(2, '0')}-${indexInItem}`;
  const base = original ? clean(original) : '';
  if (base) return `${prefix}-${base}`;
  const extension = EXTENSIONS[(contentType ?? '').split(';')[0]!.trim().toLowerCase()] ?? 'jpg';
  return `${prefix}.${extension}`;
}

/** `PROJ-001_SITE-12_photos.zip`, safe in a header. */
export function packageFilename(projectCode: string, siteCode: string): string {
  return `${clean(projectCode) || 'project'}_${clean(siteCode) || 'site'}_photos.zip`.replace(/\s+/g, '-');
}
