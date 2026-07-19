import { describe, it, expect } from 'vitest';
import {
  lineDiff,
  charDiff,
  computeDiffStats,
  countWords,
  generateVersionId,
  formatVersionTime,
  VERSION_TYPE_LABELS,
  CONTENT_TYPE_LABELS,
} from '../../../shared/diff-utils';

describe('diff-utils — countWords 字数统计', () => {
  it('空字符串返回 0', () => {
    expect(countWords('')).toBe(0);
  });

  it('纯中文字符按字数算', () => {
    expect(countWords('你好世界')).toBe(4);
  });

  it('纯英文按词数算', () => {
    expect(countWords('hello world test')).toBe(3);
  });

  it('中英文混合分别统计', () => {
    expect(countWords('你好 hello 世界 world')).toBe(4 + 2);
  });

  it('标点符号不计入', () => {
    expect(countWords('你好，世界！Hello, world.')).toBe(4 + 2);
  });

  it('空格不计入', () => {
    expect(countWords('   ')).toBe(0);
  });

  it('数字不计入字数', () => {
    expect(countWords('123 456')).toBe(0);
  });
});

describe('diff-utils — generateVersionId 版本 ID 生成', () => {
  it('生成的 ID 不为空', () => {
    const id = generateVersionId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(5);
  });

  it('两次生成的 ID 不相同', () => {
    const id1 = generateVersionId();
    const id2 = generateVersionId();
    expect(id1).not.toBe(id2);
  });

  it('ID 以 v_ 开头', () => {
    const id = generateVersionId();
    expect(id.startsWith('v_')).toBe(true);
  });
});

describe('diff-utils — formatVersionTime 时间格式化', () => {
  it('格式化 ISO 时间字符串', () => {
    const iso = '2024-01-15T10:30:45.000Z';
    const result = formatVersionTime(iso);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('月份和日期补零', () => {
    const iso = '2024-01-05T03:05:09.000Z';
    const result = formatVersionTime(iso);
    const parts = result.split(' ');
    const datePart = parts[0];
    const timePart = parts[1];
    expect(datePart).toMatch(/-\d{2}-\d{2}$/);
    expect(timePart).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('diff-utils — lineDiff 行级 Diff', () => {
  it('完全相同的文本全部 equal', () => {
    const text = 'line1\nline2\nline3';
    const result = lineDiff(text, text);
    expect(result.length).toBe(3);
    expect(result.every(r => r.op === 'equal')).toBe(true);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].oldLine).toBe(i);
      expect(result[i].newLine).toBe(i);
    }
  });

  it('空文本 vs 非空文本：包含 insert 操作', () => {
    const result = lineDiff('', 'a\nb\nc');
    const insertOps = result.filter(r => r.op === 'insert');
    expect(insertOps.length).toBeGreaterThan(0);
  });

  it('非空文本 vs 空文本：包含 delete 操作', () => {
    const result = lineDiff('a\nb\nc', '');
    const deleteOps = result.filter(r => r.op === 'delete');
    expect(deleteOps.length).toBeGreaterThan(0);
  });

  it('空 vs 空返回一个 equal 空行', () => {
    const result = lineDiff('', '');
    expect(result.length).toBe(1);
    expect(result[0].op).toBe('equal');
    expect(result[0].content).toBe('');
  });

  it('末尾插入一行正确识别', () => {
    const oldText = 'line1\nline2';
    const newText = 'line1\nline2\nline3';
    const result = lineDiff(oldText, newText);
    expect(result[result.length - 1].op).toBe('insert');
    expect(result[result.length - 1].content).toBe('line3');
  });

  it('开头删除一行正确识别', () => {
    const oldText = 'line1\nline2\nline3';
    const newText = 'line2\nline3';
    const result = lineDiff(oldText, newText);
    expect(result[0].op).toBe('delete');
    expect(result[0].content).toBe('line1');
  });

  it('修改一行识别为 replace', () => {
    const oldText = 'line1\nline2\nline3';
    const newText = 'line1\nmodified\nline3';
    const result = lineDiff(oldText, newText);
    const replaceOps = result.filter(r => r.op === 'replace');
    expect(replaceOps.length).toBeGreaterThanOrEqual(1);
  });

  it('oldLine 和 newLine 映射正确（equal 行）', () => {
    const oldText = 'a\nb\nc';
    const newText = 'a\nb\nc';
    const result = lineDiff(oldText, newText);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].oldLine).toBe(i);
      expect(result[i].newLine).toBe(i);
    }
  });
});

describe('diff-utils — charDiff 字符级 Diff', () => {
  it('完全相同的文本为一个 equal 块', () => {
    const result = charDiff('hello', 'hello');
    expect(result.length).toBe(1);
    expect(result[0].op).toBe('equal');
    expect(result[0].content).toBe('hello');
  });

  it('空 vs 非空：一个 insert 块', () => {
    const result = charDiff('', 'hello');
    expect(result.length).toBe(1);
    expect(result[0].op).toBe('insert');
    expect(result[0].content).toBe('hello');
  });

  it('非空 vs 空：一个 delete 块', () => {
    const result = charDiff('hello', '');
    expect(result.length).toBe(1);
    expect(result[0].op).toBe('delete');
    expect(result[0].content).toBe('hello');
  });

  it('空 vs 空返回空数组', () => {
    const result = charDiff('', '');
    expect(result).toEqual([]);
  });

  it('中间插入字符正确识别', () => {
    const result = charDiff('abc', 'aXbc');
    const ops = result.map(r => r.op);
    expect(ops).toContain('insert');
  });

  it('中间删除字符正确识别', () => {
    const result = charDiff('abcde', 'ace');
    const ops = result.map(r => r.op);
    expect(ops).toContain('delete');
  });

  it('相邻相同字符合并为一个块', () => {
    const result = charDiff('abcdef', 'abcdef');
    expect(result.length).toBe(1);
    expect(result[0].content).toBe('abcdef');
  });
});

describe('diff-utils — computeDiffStats Diff 统计', () => {
  it('完全相同时变化率为 0', () => {
    const text = 'a\nb\nc';
    const diff = lineDiff(text, text);
    const stats = computeDiffStats(diff, text, text);
    expect(stats.changeRatio).toBe(0);
    expect(stats.addedLines).toBe(0);
    expect(stats.deletedLines).toBe(0);
    expect(stats.modifiedLines).toBe(0);
    expect(stats.unchangedLines).toBe(3);
    expect(stats.totalLines).toBe(3);
  });

  it('全部新增时统计正确（有新增行）', () => {
    const diff = lineDiff('a', 'a\nb\nc');
    const stats = computeDiffStats(diff, 'a', 'a\nb\nc');
    expect(stats.addedLines).toBeGreaterThan(0);
    expect(stats.totalLines).toBe(3);
  });

  it('全部删除时统计正确（有删除行）', () => {
    const diff = lineDiff('a\nb\nc', 'a');
    const stats = computeDiffStats(diff, 'a\nb\nc', 'a');
    expect(stats.deletedLines).toBeGreaterThan(0);
  });

  it('字符数统计正确（增加）', () => {
    const diff = lineDiff('hello', 'hello world');
    const stats = computeDiffStats(diff, 'hello', 'hello world');
    expect(stats.addedChars).toBe(6);
    expect(stats.deletedChars).toBe(0);
  });

  it('字符数统计正确（减少）', () => {
    const diff = lineDiff('hello world', 'hello');
    const stats = computeDiffStats(diff, 'hello world', 'hello');
    expect(stats.addedChars).toBe(0);
    expect(stats.deletedChars).toBe(6);
  });

  it('changeRatio 在 0-1 之间', () => {
    const oldText = 'a\nb\nc\nd\ne';
    const newText = 'a\nX\nc\nY\ne';
    const diff = lineDiff(oldText, newText);
    const stats = computeDiffStats(diff, oldText, newText);
    expect(stats.changeRatio).toBeGreaterThanOrEqual(0);
    expect(stats.changeRatio).toBeLessThanOrEqual(1);
  });

  it('空文本时 changeRatio 为 0 不报错', () => {
    const stats = computeDiffStats([], '', '');
    expect(stats.changeRatio).toBe(0);
    expect(stats.totalLines).toBe(1);
  });
});

describe('diff-utils — 标签映射', () => {
  it('VERSION_TYPE_LABELS 包含所有类型', () => {
    expect(VERSION_TYPE_LABELS['manual']).toBeTruthy();
    expect(VERSION_TYPE_LABELS['ai-generate']).toBeTruthy();
    expect(VERSION_TYPE_LABELS['polish']).toBeTruthy();
    expect(VERSION_TYPE_LABELS['import']).toBeTruthy();
    expect(VERSION_TYPE_LABELS['rollback']).toBeTruthy();
  });

  it('CONTENT_TYPE_LABELS 包含所有类型', () => {
    expect(CONTENT_TYPE_LABELS['chapter']).toBeTruthy();
    expect(CONTENT_TYPE_LABELS['outline']).toBeTruthy();
    expect(CONTENT_TYPE_LABELS['worldview']).toBeTruthy();
    expect(CONTENT_TYPE_LABELS['character']).toBeTruthy();
    expect(CONTENT_TYPE_LABELS['setting']).toBeTruthy();
  });
});
