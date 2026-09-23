import type { ResponseType, Severity, TemplateDocumentInput } from '@ipms/contracts';

export interface EditorItem {
  key: string; number: string; requirementText: string; severity: Severity; responseType: ResponseType;
  optionsText: string; minPhotos: number; maxPhotos: number; allowsNa: boolean; isRequired: boolean; guidanceText: string;
}
export interface EditorSection { key: string; number: string; title: string; items: EditorItem[] }
export interface EditorState { sections: EditorSection[]; dirty: boolean }

export interface WireSection {
  number: string; title: string;
  items: readonly {
    number: string; requirementText: string; severity: Severity; responseType: ResponseType; selectOptions: readonly string[];
    minPhotos: number; maxPhotos: number; allowsNa: boolean; isRequired: boolean; guidanceText: string | null;
  }[];
}

export type ItemPatch = Partial<Omit<EditorItem, 'key'>>;
export type EditorAction =
  | { type: 'addSection' }
  | { type: 'removeSection'; sectionKey: string }
  | { type: 'moveSection'; sectionKey: string; direction: -1 | 1 }
  | { type: 'updateSection'; sectionKey: string; patch: Partial<Pick<EditorSection, 'number' | 'title'>> }
  | { type: 'addItem'; sectionKey: string }
  | { type: 'removeItem'; sectionKey: string; itemKey: string }
  | { type: 'moveItem'; sectionKey: string; itemKey: string; direction: -1 | 1 }
  | { type: 'updateItem'; sectionKey: string; itemKey: string; patch: ItemPatch }
  | { type: 'renumber' }
  | { type: 'saved' };

let counter = 0;
const newKey = (): string => `k${(counter += 1).toString(36)}`;

export function fromSections(sections: readonly WireSection[]): EditorState {
  return {
    dirty: false,
    sections: sections.map((section) => ({
      key: newKey(), number: section.number, title: section.title,
      items: section.items.map((item) => ({
        key: newKey(), number: item.number, requirementText: item.requirementText, severity: item.severity,
        responseType: item.responseType, optionsText: item.selectOptions.join('\n'), minPhotos: item.minPhotos,
        maxPhotos: item.maxPhotos, allowsNa: item.allowsNa, isRequired: item.isRequired, guidanceText: item.guidanceText ?? '',
      })),
    })),
  };
}

export function toDocument(state: EditorState): TemplateDocumentInput {
  return {
    sections: state.sections.map((section) => ({
      number: section.number.trim(),
      title: section.title.trim(),
      items: section.items.map((item) => ({
        number: item.number.trim(),
        requirementText: item.requirementText.trim(),
        severity: item.severity,
        responseType: item.responseType,
        selectOptions: item.responseType === 'SELECT' ? item.optionsText.split('\n').map((option) => option.trim()).filter(Boolean) : [],
        minPhotos: item.minPhotos,
        maxPhotos: item.maxPhotos,
        allowsNa: item.allowsNa,
        isRequired: item.isRequired,
        ...(item.guidanceText.trim() ? { guidanceText: item.guidanceText.trim() } : {}),
      })),
    })),
  };
}

const leadingInt = (text: string): number => Number.parseInt(text, 10);

export function nextSectionNumber(sections: readonly EditorSection[]): string {
  return String(Math.max(0, ...sections.map((section) => leadingInt(section.number)).filter(Number.isFinite)) + 1);
}

export function nextItemNumber(section: EditorSection): string {
  const prefix = `${section.number}.`;
  const used = section.items
    .map((item) => (item.number.startsWith(prefix) ? leadingInt(item.number.slice(prefix.length)) : Number.NaN))
    .filter(Number.isFinite);
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

function blankItem(number: string): EditorItem {
  return {
    key: newKey(), number, requirementText: '', severity: 'NORMAL', responseType: 'RESULT_ONLY', optionsText: '',
    minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true, guidanceText: '',
  };
}

function move<T extends { key: string }>(list: readonly T[], key: string, direction: -1 | 1): T[] | null {
  const from = list.findIndex((entry) => entry.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return null;
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}

function withSection(state: EditorState, key: string, change: (section: EditorSection) => EditorSection): EditorState {
  return { dirty: true, sections: state.sections.map((section) => (section.key === key ? change(section) : section)) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'addSection':
      return { dirty: true, sections: [...state.sections, { key: newKey(), number: nextSectionNumber(state.sections), title: '', items: [] }] };
    case 'removeSection':
      return { dirty: true, sections: state.sections.filter((section) => section.key !== action.sectionKey) };
    case 'moveSection': {
      const sections = move(state.sections, action.sectionKey, action.direction);
      return sections ? { dirty: true, sections } : state;
    }
    case 'updateSection':
      return withSection(state, action.sectionKey, (section) => ({ ...section, ...action.patch }));
    case 'addItem':
      return withSection(state, action.sectionKey, (section) => ({ ...section, items: [...section.items, blankItem(nextItemNumber(section))] }));
    case 'removeItem':
      return withSection(state, action.sectionKey, (section) => ({ ...section, items: section.items.filter((item) => item.key !== action.itemKey) }));
    case 'moveItem': {
      const section = state.sections.find((entry) => entry.key === action.sectionKey);
      const items = section ? move(section.items, action.itemKey, action.direction) : null;
      return items ? withSection(state, action.sectionKey, (entry) => ({ ...entry, items })) : state;
    }
    case 'updateItem':
      return withSection(state, action.sectionKey, (section) => ({
        ...section,
        items: section.items.map((item) => (item.key === action.itemKey ? { ...item, ...action.patch } : item)),
      }));
    case 'renumber':
      return {
        dirty: true,
        sections: state.sections.map((section, s) => ({
          ...section,
          number: String(s + 1),
          items: section.items.map((item, i) => ({ ...item, number: `${s + 1}.${i + 1}` })),
        })),
      };
    case 'saved':
      return { ...state, dirty: false };
  }
}

export function fieldKey(sectionIndex: number, itemIndex: number | null, field: string): string {
  return itemIndex === null ? `sections.${sectionIndex}.${field}` : `sections.${sectionIndex}.items.${itemIndex}.${field}`;
}

/** Server paths arrive as `document.sections.0.items.1.selectOptions.3`; the editor marks `sections.0.items.1.selectOptions`. */
export function normalizeErrors(details: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [path, message] of Object.entries(details)) {
    const key = path.replace(/^document\./, '').replace(/\.selectOptions\.\d+$/, '.selectOptions');
    normalized[key] ??= message;
  }
  return normalized;
}
