/** The file's own first bytes, not its declared type or extension, decide what it is. */
export function sniffMatches(contentType: string, head: Buffer): boolean {
  if (contentType === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (contentType === 'video/mp4') return head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'ftyp';
  return false;
}
