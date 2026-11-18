/**
 * Splitting the agent's notes into per-comment chunks (D33, D34).
 */

import { describe, expect, it } from 'vitest';
import {
  joinChunks,
  NOTE_CHUNK_SEPARATOR,
  NOTES_MAX_CHARS,
  splitAgentNotes,
  splitChunks,
} from '../detect/agentNotes.js';

describe('splitAgentNotes', () => {
  it('attaches a chunk by #N', () => {
    const r = splitAgentNotes('Skipped #2 because it conflicts.', 3);
    expect(r.byNumber).toEqual(new Map([[2, ['Skipped #2 because it conflicts.']]]));
    expect(r.unattached).toEqual([]);
    expect(r.cut).toBe(false);
  });

  it('attaches a chunk by "comment 2"', () => {
    const r = splitAgentNotes('I disagree with comment 2 here.', 3);
    expect(r.byNumber).toEqual(new Map([[2, ['I disagree with comment 2 here.']]]));
  });

  it('attaches a chunk by "Item 3"', () => {
    const r = splitAgentNotes('Item 3 was already true.', 3);
    expect(r.byNumber).toEqual(new Map([[3, ['Item 3 was already true.']]]));
  });

  it('attaches a chunk by a leading "2."', () => {
    const r = splitAgentNotes('2. Left as is.', 3);
    expect(r.byNumber).toEqual(new Map([[2, ['2. Left as is.']]]));
    expect(r.unattached).toEqual([]);
  });

  it('a chunk naming two numbers attaches to both', () => {
    const r = splitAgentNotes('Both #1 and comment 3 are wrong.', 3);
    const chunk = 'Both #1 and comment 3 are wrong.';
    expect(r.byNumber).toEqual(
      new Map([
        [1, [chunk]],
        [3, [chunk]],
      ]),
    );
    expect(r.unattached).toEqual([]);
  });

  it('out-of-range number stays unattached', () => {
    const r = splitAgentNotes('See #99 for details.', 3);
    expect(r.byNumber).toEqual(new Map());
    expect(r.unattached).toEqual(['See #99 for details.']);
  });

  it('a chunk with no number is unattached, and unattached chunks keep their order', () => {
    const r = splitAgentNotes('First general.\n\nAbout #1.\n\nSecond general.', 2);
    expect(r.byNumber).toEqual(new Map([[1, ['About #1.']]]));
    expect(r.unattached).toEqual(['First general.', 'Second general.']);
  });

  it('list items split into chunks', () => {
    const r = splitAgentNotes('Intro line\n- #1 done\n- other\n  continued\n2) #2 done', 2);
    expect(r.byNumber).toEqual(
      new Map([
        [1, ['- #1 done']],
        [2, ['2) #2 done']],
      ]),
    );
    expect(r.unattached).toEqual(['Intro line', '- other\n  continued']);
  });

  it('CRLF and NFD input normalize', () => {
    const r = splitAgentNotes('Café one\r\nstill one\r\n\r\n#1 two', 1);
    expect(r.unattached).toEqual(['Café one\nstill one']);
    expect(r.byNumber).toEqual(new Map([[1, ['#1 two']]]));
  });

  it('cuts at NOTES_MAX_CHARS', () => {
    expect(NOTES_MAX_CHARS).toBe(16_000);
    const r = splitAgentNotes('a'.repeat(16_001), 1);
    expect(r.cut).toBe(true);
    expect(r.unattached).toEqual(['a'.repeat(16_000)]);
    expect(splitAgentNotes('a'.repeat(16_000), 1).cut).toBe(false);
  });

  it('blank input gives empty results', () => {
    expect(splitAgentNotes('  \n\n \r\n', 3)).toEqual({
      byNumber: new Map(),
      unattached: [],
      cut: false,
    });
    expect(splitAgentNotes('', 3).unattached).toEqual([]);
  });

  it('promptCount 0 makes every chunk unattached', () => {
    const r = splitAgentNotes('#1 here', 0);
    expect(r.byNumber).toEqual(new Map());
    expect(r.unattached).toEqual(['#1 here']);
  });
});

describe('joinChunks and splitChunks', () => {
  it('round-trip', () => {
    expect(NOTE_CHUNK_SEPARATOR).toBe('\n\n');
    const chunks = ['a', '- b\nc', 'd'];
    expect(joinChunks(chunks)).toBe('a\n\n- b\nc\n\nd');
    expect(splitChunks(joinChunks(chunks))).toEqual(chunks);
    expect(splitChunks('')).toEqual([]);
    expect(splitChunks('a\n\n\n\nb')).toEqual(['a', 'b']);
  });
});
