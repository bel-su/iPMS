import type { ResponseType, Severity, TemplateCategory } from '@ipms/contracts';

export const SHEETS = { template: 'Template', checklist: 'Checklist', instructions: 'Instructions' } as const;

export const COLUMNS = [
  { key: 'sectionNo', header: 'Section No', width: 12 },
  { key: 'sectionTitle', header: 'Section Title', width: 28 },
  { key: 'itemNo', header: 'Item No', width: 10 },
  { key: 'requirement', header: 'Requirement', width: 60 },
  { key: 'severity', header: 'Severity', width: 12 },
  { key: 'responseType', header: 'Response Type', width: 16 },
  { key: 'options', header: 'Options', width: 30 },
  { key: 'minPhotos', header: 'Min Photos', width: 12 },
  { key: 'maxPhotos', header: 'Max Photos', width: 12 },
  { key: 'allowNa', header: 'Allow N/A', width: 11 },
  { key: 'required', header: 'Required', width: 11 },
  { key: 'guidance', header: 'Guidance', width: 50 },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]['key'];
export const REQUIRED_COLUMNS: readonly ColumnKey[] = ['sectionNo', 'sectionTitle', 'itemNo', 'requirement'];

export function headerOf(key: ColumnKey): string {
  return COLUMNS.find((column) => column.key === key)!.header;
}

/** Case- and punctuation-blind, so "Allow N/A", "allow na" and "ALLOW_NA" all match. */
export function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const CATEGORY_LABELS: Record<TemplateCategory, string> = { QUALITY: 'Quality', EHS: 'EHS', OTHER: 'Other' };
export const SEVERITY_LABELS: Record<Severity, string> = { NORMAL: 'Normal', CRITICAL: 'Critical' };
export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  RESULT_ONLY: 'Result only', TEXT: 'Text', NUMBER: 'Number', BOOLEAN: 'Yes/No', SELECT: 'Select',
};

export const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

function lookup<T extends string>(labels: Record<T, string>, synonyms: Record<string, T> = {}): (text: string) => T | undefined {
  const map = new Map<string, T>();
  for (const [value, label] of Object.entries(labels) as [T, string][]) {
    map.set(normalizeHeader(label), value);
    map.set(normalizeHeader(value), value);
  }
  for (const [text, value] of Object.entries(synonyms)) map.set(normalizeHeader(text), value);
  return (text) => map.get(normalizeHeader(text));
}

export const parseCategory = lookup(CATEGORY_LABELS);
export const parseSeverity = lookup(SEVERITY_LABELS);
export const parseResponseType = lookup(RESPONSE_TYPE_LABELS, { result: 'RESULT_ONLY' });

const BOOLEANS = new Map<string, boolean>([
  ['yes', true], ['y', true], ['true', true], ['1', true],
  ['no', false], ['n', false], ['false', false], ['0', false],
]);
export const parseBoolean = (text: string): boolean | undefined => BOOLEANS.get(text.trim().toLowerCase());
