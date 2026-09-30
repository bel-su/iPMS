import type { ResponseType, TemplateCategory, TemplateTab } from '../../lib/qc-api';

export const CATEGORY_LABELS: Record<TemplateCategory, string> = { QUALITY: 'Quality', EHS: 'EHS', OTHER: 'Other' };
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as TemplateCategory[];

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  RESULT_ONLY: 'Result only', TEXT: 'Text', NUMBER: 'Number', BOOLEAN: 'Yes/No', SELECT: 'Select',
};
export const RESPONSE_TYPES = Object.keys(RESPONSE_TYPE_LABELS) as ResponseType[];

export const TABS: readonly { key: TemplateTab; label: string }[] = [
  { key: 'enabled', label: 'Enabled' }, { key: 'draft', label: 'Draft Box' }, { key: 'disabled', label: 'Disabled' },
];

function countLabel(noun: 'photo' | 'video') {
  const plural = (n: number): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return (min: number, max: number): string | null => {
    if (max === 0) return null;
    if (min === 0) return `Optional, up to ${plural(max)}`;
    return min === max ? plural(min) : `${min}–${max} ${noun}s`;
  };
}

export const photoLabel = countLabel('photo');
export const videoLabel = countLabel('video');

export function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
