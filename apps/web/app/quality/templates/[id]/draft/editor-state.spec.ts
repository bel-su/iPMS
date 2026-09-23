import { describe, expect, it } from 'vitest';
import { editorReducer, fieldKey, fromSections, nextItemNumber, nextSectionNumber, normalizeErrors, toDocument, type EditorState } from './editor-state';

const WIRE = [
  { number: '1', title: 'EHS', items: [
    { number: '1.1', requirementText: 'PPE', severity: 'CRITICAL' as const, responseType: 'RESULT_ONLY' as const, selectOptions: [], minPhotos: 1, maxPhotos: 3, allowsNa: false, isRequired: true, guidanceText: 'Helmet' },
    { number: '1.2', requirementText: 'Mount', severity: 'NORMAL' as const, responseType: 'SELECT' as const, selectOptions: ['Pole', 'Wall'], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true, guidanceText: null },
  ] },
  { number: '2', title: 'Antenna', items: [] },
];

const start = (): EditorState => fromSections(WIRE);
const numbers = (state: EditorState) => state.sections.map((s) => [s.number, s.items.map((i) => i.number)]);

describe('fromSections / toDocument', () => {
  it('round-trips a version, joining options one per line', () => {
    const state = start();
    expect(state.sections[0]!.items[1]!.optionsText).toBe('Pole\nWall');
    expect(state.dirty).toBe(false);
    expect(toDocument(state)).toEqual({
      sections: [
        { number: '1', title: 'EHS', items: [
          { number: '1.1', requirementText: 'PPE', severity: 'CRITICAL', responseType: 'RESULT_ONLY', selectOptions: [], minPhotos: 1, maxPhotos: 3, allowsNa: false, isRequired: true, guidanceText: 'Helmet' },
          { number: '1.2', requirementText: 'Mount', severity: 'NORMAL', responseType: 'SELECT', selectOptions: ['Pole', 'Wall'], minPhotos: 0, maxPhotos: 0, allowsNa: false, isRequired: true },
        ] },
        { number: '2', title: 'Antenna', items: [] },
      ],
    });
  });

  it('drops options when the item is no longer a Select', () => {
    const state = start();
    const s = state.sections[0]!;
    const next = editorReducer(state, { type: 'updateItem', sectionKey: s.key, itemKey: s.items[1]!.key, patch: { responseType: 'TEXT' } });
    expect(toDocument(next).sections[0]!.items[1]!.selectOptions).toEqual([]);
  });
});

describe('numbering', () => {
  it('suggests the next section and item numbers', () => {
    const state = start();
    expect(nextSectionNumber(state.sections)).toBe('3');
    expect(nextItemNumber(state.sections[0]!)).toBe('1.3');
    expect(nextItemNumber(state.sections[1]!)).toBe('2.1');
  });

  it('adds a section and an item with those numbers and marks the state dirty', () => {
    let state = editorReducer(start(), { type: 'addSection' });
    state = editorReducer(state, { type: 'addItem', sectionKey: state.sections[2]!.key });
    expect(numbers(state)).toEqual([['1', ['1.1', '1.2']], ['2', []], ['3', ['3.1']]]);
    expect(state.dirty).toBe(true);
  });

  it('renumbers everything from position', () => {
    let state = start();
    state = editorReducer(state, { type: 'moveSection', sectionKey: state.sections[1]!.key, direction: -1 });
    state = editorReducer(state, { type: 'renumber' });
    expect(numbers(state)).toEqual([['1', []], ['2', ['2.1', '2.2']]]);
  });
});

describe('moving and removing', () => {
  it('moves an item within its section and ignores a move past the edge', () => {
    const state = start();
    const s = state.sections[0]!;
    const moved = editorReducer(state, { type: 'moveItem', sectionKey: s.key, itemKey: s.items[1]!.key, direction: -1 });
    expect(moved.sections[0]!.items.map((i) => i.number)).toEqual(['1.2', '1.1']);
    expect(editorReducer(state, { type: 'moveItem', sectionKey: s.key, itemKey: s.items[0]!.key, direction: -1 })).toBe(state);
  });

  it('removes a section and an item', () => {
    let state = start();
    state = editorReducer(state, { type: 'removeItem', sectionKey: state.sections[0]!.key, itemKey: state.sections[0]!.items[0]!.key });
    state = editorReducer(state, { type: 'removeSection', sectionKey: state.sections[1]!.key });
    expect(numbers(state)).toEqual([['1', ['1.2']]]);
  });

  it('clears dirty on save', () => {
    const dirty = editorReducer(start(), { type: 'addSection' });
    expect(editorReducer(dirty, { type: 'saved' }).dirty).toBe(false);
  });
});

describe('normalizeErrors', () => {
  it('strips the request wrapper and folds option indexes into the field', () => {
    expect(normalizeErrors({
      'document.sections.0.items.1.maxPhotos': 'Must be at least Min Photos (2)',
      'sections.0.items.1.selectOptions.3': 'Too long',
      'sections.1.items': 'Every section needs at least one item',
    })).toEqual({
      'sections.0.items.1.maxPhotos': 'Must be at least Min Photos (2)',
      'sections.0.items.1.selectOptions': 'Too long',
      'sections.1.items': 'Every section needs at least one item',
    });
    expect(fieldKey(0, 1, 'maxPhotos')).toBe('sections.0.items.1.maxPhotos');
    expect(fieldKey(1, null, 'items')).toBe('sections.1.items');
  });
});
