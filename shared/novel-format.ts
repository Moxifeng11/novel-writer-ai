/**
 * novel-format.ts — 小说正文排版与段落工具（纯函数）
 *
 * 协同写作编辑器的「一键排版 / 段落工具 / Markdown 包裹」都走这里，
 * 保证 UI 行为可单测、与 BodyWriter 的落盘契约同源（shared/body-format.ts）。
 */

import {
  BodyFormatContract,
  DEFAULT_BODY_FORMAT,
  normalizeBodyText,
} from './body-format';

export interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const CHAPTER_TITLE_LINE = /^(#{1,6}\s*)?第[0-9一二三四五六七八九十百千]+章[^\n]*$/;
const LEADING_INDENT = /^[\u3000\t ]*/;
const HEADING_PREFIX = /^#{1,6}\s+/;

/** 选中范围扩展为完整行（不含末尾换行） */
function lineBounds(text: string, start: number, end: number): { start: number; end: number } {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  const lineStart = text.lastIndexOf('\n', Math.max(0, safeStart - 1)) + 1;
  const lastIndex = safeEnd > safeStart ? safeEnd - 1 : safeEnd;
  const nextNewline = text.indexOf('\n', lastIndex);
  const lineEnd = nextNewline < 0 ? text.length : nextNewline;
  return { start: lineStart, end: lineEnd };
}

function splitLines(block: string): string[] {
  return block.split('\n');
}

function selectionForRange(start: number, length: number): { selectionStart: number; selectionEnd: number } {
  return { selectionStart: start, selectionEnd: start + length };
}

/**
 * 按小说格式排版全文。
 * - 保留 frontmatter 原文；
 * - 保留首行章节标题（统一为 `# 第N章 …`，不参与缩进）；
 * - 正文按项目契约分段/缩进，并剥离模型元叙述；
 * - 其他 Markdown 标题会被视为正文标题剥离（小说正文不使用 Markdown 标题）。
 */
export function formatNovelManuscript(
  raw: string,
  contract: BodyFormatContract = DEFAULT_BODY_FORMAT,
): string {
  if (!raw || !raw.trim()) return '';

  const fmMatch = raw.match(FRONTMATTER_BLOCK);
  const frontmatter = fmMatch ? fmMatch[0].trimEnd() : '';
  let body = fmMatch ? raw.slice(fmMatch[0].length) : raw;

  const lines = splitLines(body);
  let title = '';
  const firstContentIndex = lines.findIndex((line) => line.trim() !== '');
  if (firstContentIndex >= 0) {
    const candidate = lines[firstContentIndex].trim();
    if (CHAPTER_TITLE_LINE.test(candidate)) {
      title = HEADING_PREFIX.test(candidate) ? candidate : `# ${candidate}`;
      lines.splice(firstContentIndex, 1);
      body = lines.join('\n');
    }
  }

  const formatted = normalizeBodyText(body, contract, { stripTitle: true });
  const parts: string[] = [];
  if (frontmatter) parts.push(frontmatter);
  if (title) parts.push(title);
  if (formatted) parts.push(formatted);
  return parts.join('\n\n');
}

/** 段首缩进切换：选中行全部已缩进时移除，否则补齐一次 */
export function toggleFirstLineIndent(
  text: string,
  start: number,
  end: number,
  indent: string,
): TextEdit {
  if (!indent) return { text, selectionStart: start, selectionEnd: end };
  const bounds = lineBounds(text, start, end);
  const lines = splitLines(text.slice(bounds.start, bounds.end));
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  const allIndented = nonEmpty.length > 0 && nonEmpty.every((line) => line.startsWith(indent));
  const nextLines = lines.map((line) => {
    if (line.trim() === '') return line;
    if (allIndented) return line.slice(indent.length);
    return line.startsWith(indent) ? line : indent + line;
  });
  const block = nextLines.join('\n');
  const next = text.slice(0, bounds.start) + block + text.slice(bounds.end);
  return { text: next, ...selectionForRange(bounds.start, block.length) };
}

/** 增加/减少段落缩进（delta = 1 / -1） */
export function indentParagraphs(
  text: string,
  start: number,
  end: number,
  indent: string,
  delta: 1 | -1,
): TextEdit {
  if (!indent) return { text, selectionStart: start, selectionEnd: end };
  const bounds = lineBounds(text, start, end);
  const lines = splitLines(text.slice(bounds.start, bounds.end));
  const nextLines = lines.map((line) => {
    if (line.trim() === '') return line;
    if (delta > 0) return indent + line;
    return line.startsWith(indent) ? line.slice(indent.length) : line;
  });
  const block = nextLines.join('\n');
  const next = text.slice(0, bounds.start) + block + text.slice(bounds.end);
  return { text: next, ...selectionForRange(bounds.start, block.length) };
}

/** 合并选中段落：去掉段内换行，保留首行缩进 */
export function mergeSelectedParagraphs(text: string, start: number, end: number): TextEdit {
  const bounds = lineBounds(text, start, end);
  const block = text.slice(bounds.start, bounds.end);
  const lines = splitLines(block).filter((line) => line.trim() !== '');
  if (lines.length <= 1) return { text, selectionStart: start, selectionEnd: end };
  const indent = lines[0].match(LEADING_INDENT)?.[0] ?? '';
  const merged = indent + lines.map((line) => line.replace(LEADING_INDENT, '').trim()).join('');
  const next = text.slice(0, bounds.start) + merged + text.slice(bounds.end);
  return { text: next, ...selectionForRange(bounds.start, merged.length) };
}

/** 在光标处拆分段落（使用契约的分段符） */
export function splitParagraphAtCursor(
  text: string,
  cursor: number,
  contract: BodyFormatContract = DEFAULT_BODY_FORMAT,
): TextEdit {
  const safe = Math.max(0, Math.min(cursor, text.length));
  const separator = contract.separator === '\n\n' ? '\n\n' : '\n';
  const next = text.slice(0, safe) + separator + text.slice(safe);
  return { text: next, selectionStart: safe + separator.length, selectionEnd: safe + separator.length };
}

/** Markdown 包裹/取消包裹（粗体、斜体、行内代码） */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string = prefix,
): TextEdit {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  if (safeStart === safeEnd) {
    const next = text.slice(0, safeStart) + prefix + suffix + text.slice(safeStart);
    return {
      text: next,
      selectionStart: safeStart + prefix.length,
      selectionEnd: safeStart + prefix.length,
    };
  }
  const selected = text.slice(safeStart, safeEnd);
  if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length) {
    const inner = selected.slice(prefix.length, selected.length - suffix.length);
    const next = text.slice(0, safeStart) + inner + text.slice(safeEnd);
    return { text: next, ...selectionForRange(safeStart, inner.length) };
  }
  const next = text.slice(0, safeStart) + prefix + selected + suffix + text.slice(safeEnd);
  return { text: next, ...selectionForRange(safeStart, prefix.length + selected.length + suffix.length) };
}

/** 行首前缀切换（标题 / 引用 / 列表） */
export function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  prefix: string,
): TextEdit {
  const bounds = lineBounds(text, start, end);
  const lines = splitLines(text.slice(bounds.start, bounds.end));
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  const isHeading = /^#{1,6}\s$/.test(prefix);
  const already = nonEmpty.length > 0 && nonEmpty.every((line) => {
    const trimmed = line.replace(LEADING_INDENT, '');
    return isHeading ? trimmed.startsWith(prefix) : trimmed.startsWith(prefix);
  });

  const nextLines = lines.map((line) => {
    if (line.trim() === '') return line;
    const indent = line.match(LEADING_INDENT)?.[0] ?? '';
    const content = line.slice(indent.length);
    if (already) {
      if (isHeading) return indent + content.replace(HEADING_PREFIX, '');
      return indent + (content.startsWith(prefix) ? content.slice(prefix.length) : content);
    }
    if (isHeading) return prefix + content.replace(HEADING_PREFIX, '');
    return indent + prefix + content;
  });

  const block = nextLines.join('\n');
  const next = text.slice(0, bounds.start) + block + text.slice(bounds.end);
  return { text: next, ...selectionForRange(bounds.start, block.length) };
}

/** 插入块级 Markdown（分隔线等），自动补齐前后空行 */
export function insertBlock(text: string, cursor: number, block: string): TextEdit {
  const safe = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safe);
  const after = text.slice(safe);
  const needsLeading = before.length > 0 && !before.endsWith('\n\n');
  const needsTrailing = after.length > 0 && !after.startsWith('\n\n');
  const inserted = `${needsLeading ? '\n\n' : ''}${block}${needsTrailing ? '\n\n' : ''}`;
  const next = before + inserted + after;
  return {
    text: next,
    selectionStart: safe + inserted.length,
    selectionEnd: safe + inserted.length,
  };
}

/** 选中文本转中文引号；无选中时插入一对空引号 */
export function convertToChineseQuotes(text: string, start: number, end: number): TextEdit {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  if (safeStart === safeEnd) {
    const next = text.slice(0, safeStart) + '“”' + text.slice(safeStart);
    return { text: next, selectionStart: safeStart + 1, selectionEnd: safeStart + 1 };
  }
  const selected = text.slice(safeStart, safeEnd);
  if (!selected.includes('"')) {
    const next = text.slice(0, safeStart) + '“' + selected + '”' + text.slice(safeEnd);
    return { text: next, ...selectionForRange(safeStart, selected.length + 2) };
  }
  let open = true;
  const converted = selected.replace(/"/g, () => {
    const quote = open ? '“' : '”';
    open = !open;
    return quote;
  });
  const next = text.slice(0, safeStart) + converted + text.slice(safeEnd);
  return { text: next, ...selectionForRange(safeStart, converted.length) };
}

/** 统计非空段落数（供编辑器状态栏） */
export function countParagraphs(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '').length;
}

/** 契约的简短中文描述（状态栏/ Notice 用） */
export function describeContractShort(contract: BodyFormatContract = DEFAULT_BODY_FORMAT): string {
  const separator = contract.separator === '\n\n' ? '空行分段' : '单换行分段';
  const indent = contract.indent === '\u3000\u3000'
    ? '首行空两格'
    : contract.indent === '\t'
      ? '首行 Tab'
      : '无缩进';
  return `${separator} · ${indent}`;
}
