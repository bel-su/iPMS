const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checked(value: string): string {
  if (!UUID.test(value)) throw new Error(`Invalid id in storage key: ${value}`);
  return value;
}

/**
 * IDs, never codes: a site code can be edited and R2 cannot rename. Everything
 * for one project sits under `projects/{projectId}/`, which is what the purge
 * in sub-project 5 deletes.
 */
/** An invoice photo: under its project, in a `finance` folder of its own. */
export function financeKeys(o: { projectId: string; id: string }): { storageKey: string; thumbnailKey: string } {
  const base = `projects/${checked(o.projectId)}/finance/${checked(o.id)}`;
  return { storageKey: `${base}.jpg`, thumbnailKey: `${base}.thumb.webp` };
}

export function evidenceKeys(o: { projectId: string; siteId: string; id: string; kind: 'PHOTO' | 'VIDEO' }): { storageKey: string; thumbnailKey: string } {
  const base = `projects/${checked(o.projectId)}/sites/${checked(o.siteId)}/evidence/${checked(o.id)}`;
  return o.kind === 'PHOTO'
    ? { storageKey: `${base}.jpg`, thumbnailKey: `${base}.thumb.webp` }
    : { storageKey: `${base}.mp4`, thumbnailKey: `${base}.poster.jpg` };
}
