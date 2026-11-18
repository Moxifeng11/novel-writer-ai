/**
 * novel-format.ts — 小说正文排版与段落工具（纯函数）
 *
 * 协同写作编辑器的「一键排版 / 段落工具 / Markdown 包裹」都走这里，
 * 保证 UI 行为可单测、与 BodyWriter 的落盘契约同源（shared/body-format.ts）。
 */

import { hasMessage, t } from '@/i18n';
import {
  BodyFormatContract,
  DEFAULT_BODY_FORMAT,
  normalizeBodyText,
} from './body-format';

/**
 * TextEdit 类型定义。
 */
export interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const CHAPTER_TITLE_LINE = /^(#{1,6}\s*)?第[0-9一二三四五六七八九十百千]+章[^\n]*$/;
const LEADING_INDENT = /^[\u3000\t ]*/;
const HEADING_PREFIX = /^#{1,6}\s+/;

/**
 * 选中范围扩展为完整行（不含末尾换行）
 *
 * @param text - 文本内容
 * @param start - 起始位置
 * @param end - 结束位置
  * @returns number } 结果
 */
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
 * @param raw - 原始
 * @param contract - 正文契约
 * @returns 文本结果
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

/**
 * 段首缩进切换：选中行全部已缩进时移除，否则补齐一次
 *
 * @param text - 文本内容
 * @param start - 起始位置
 * @param end - 结束位置
 * @param indent - 缩进
  * @returns TextEdit 实例
 */
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

/**
 * 增加/减少段落缩进（delta = 1 / -1）
 *
 * @param text - 文本内容
 * @param start - 起始位置
 * @param end - 结束位置
 * @param indent - 缩进
 * @param delta - 增量
  * @returns TextEdit 实例
 */
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

/**
 * 合并选中段落：去掉段内换行，保留首行缩进
 *
 * @param text - 文本内容
 * @param start - 起始位置
 * @param end - 结束位置
  * @returns TextEdit 实例
 */
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

/**
 * 在光标处拆分段落（使用契约的分段符）
 *
 * @param text - 文本内容
 * @param cursor - 光标
 * @param contract - 正文契约
  * @returns TextEdit 实例
 */
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

/**
 * Markdown 包裹/取消包裹（粗体、斜体、行内代码）
 *
 * @param text - 文本内容
 * @param start - 起始位置
 * @param end - 结束位置
 * @param prefix - 前缀
 * @param suffix - 后缀
  * @returns TextEdit 实例
 */
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

/**
 * 行首前缀切换（标题 / 引用 / 列表）
 *
 * @param text - 文本内容
 * @param start - 起始位置
 * @param end - 结束位置
 * @param prefix - 前缀
  * @returns TextEdit 实例
 */
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

/**
 * 插入块级 Markdown（分隔线等），自动补齐前后空行
 *
 * @param text - 文本内容
 * @param cursor - 光标
 * @param block - 文本块
  * @returns TextEdit 实例
 */
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

/**
 * 选中文本转中文引号；无选中时插入一对空引号
 *
 * @param text - 文本内容
 * @param start - 起始位置
 * @param end - 结束位置
  * @returns TextEdit 实例
 */
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

/**
 * 统计非空段落数（供编辑器状态栏）
 *
 * @param text - 文本内容
 * @returns 数值结果
 */
export function countParagraphs(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '').length;
}

/**
 * 把契约里的实际字符转成**可见形式**，供界面展示给用户核对。
 *
 * 为什么需要（i18n 跨层数据⑧）：DSH 复核 ④ 时指出——契约字段不翻译是对的，
 * 但 en 用户看到「Blank line between paragraphs」时，**没法确认自己文件里到底是什么**。
 * 解法不是翻译值（那会破坏落盘契约），而是把**实际字符**也显示出来：
 * 让用户在界面上直接对上文件里的样子。
 *
 * 映射刻意选 ASCII/常见符号，避免依赖特定字体：
 * - `\n\n`   → `↵↵`（两次回车）
 * - `\n`     → `↵`（一次回车）
 * - `\u3000` → `▪`（全角空格，占位可见）
 * - `\t`     → `⇥`（Tab）
 * - 其他/空  → `∅`（无）
 *
 * @param contract - 正文契约
 * @returns 分隔与缩进的可见形式
 */
export function describeContractVisible(contract: BodyFormatContract = DEFAULT_BODY_FORMAT): {
  separatorVisible: string;
  indentVisible: string;
} {
  // 用 string 变量承接：BodyFormatContract 的字段是字面量联合类型，
  // 穷举分支后 TS 会把剩余分支收窄成 never，导致兜底分支的 .replace 报错。
  const sep: string = contract.separator;
  const ind: string = contract.indent;
  const separatorVisible = sep === '\n\n'
    ? '↵↵'
    : sep === '\n'
      ? '↵'
      : sep
        ? `⟨${sep.replace(/\n/g, '↵')}⟩`
        : '∅';
  const indentVisible = ind === '\u3000\u3000'
    ? '▪▪'
    : ind === '\u3000'
      ? '▪'
      : ind === '\t'
        ? '⇥'
        : ind
          ? `⟨${ind.replace(/\u3000/g, '▪').replace(/\t/g, '⇥')}⟩`
          : '∅';
  return { separatorVisible, indentVisible };
}

/**
 * 契约的简短描述（状态栏/ Notice 用）
 *
 * 展示文案按语言求值（i18n 跨层数据④）；契约字段本身（separator/indent）是**结构数据**，
 * 不参与翻译——落盘与解析都按它们比对。
 *
 * @param contract - 正文契约
 * @returns 文本结果
 */
export function describeContractShort(contract: BodyFormatContract = DEFAULT_BODY_FORMAT): string {
  const parts = describeContractParts(contract);
  return `${parts.separator} · ${parts.indent}`;
}

/**
 * 带可见字符的契约描述（供 tooltip / 设置页展示）。
 *
 * 形如「空行分段（↵↵）· 首行空两格（▪▪）」——语义标签按语言求值，括号里是**实际字符**，
 * 用户因此能在任何语言下核对「我的文件里到底长什么样」。
 *
 * @param contract - 正文契约
 * @returns 带可见字符的描述
 */
export function describeContractWithVisible(contract: BodyFormatContract = DEFAULT_BODY_FORMAT): string {
  const parts = describeContractParts(contract);
  const visible = describeContractVisible(contract);
  return `${parts.separator}（${visible.separatorVisible}） · ${parts.indent}（${visible.indentVisible}）`;
}

/**
 * 契约描述的三个展示分量（已按当前语言求值 + 中文兜底 + 可见形式）。
 *
 * 供需要拆分展示或做单测断言的调用方使用；`describeContractShort()` / 
 * `describeContractWithVisible()` 在此之上拼串。
 *
 * **三件套（i18n 跨层数据⑧）**：每个分量给三样东西——
 * ① `*Key`：资源键（缺键断言用）；
 * ② `*Fallback`：中文兜底（资源缺失时的兜底值，绝不进落盘）；
 * ③ `*`：按当前语言求值的语义标签；
 * ④ `*Visible`：**实际字符的可见形式**（用户核对文件用，与语言无关）。
 *
 * @param contract - 正文契约
 * @returns 分隔方式与缩进方式（key / fallback / 展示值 / 可见形式）
 */
export function describeContractParts(contract: BodyFormatContract = DEFAULT_BODY_FORMAT): {
  separatorKey: string;
  separatorFallback: string;
  separator: string;
  separatorVisible: string;
  indentKey: string;
  indentFallback: string;
  indent: string;
  indentVisible: string;
} {
  const separatorKey = contract.separator === '\n\n' ? 'novelFormat.separator.blankLine' : 'novelFormat.separator.singleLine';
  const separatorFallback = contract.separator === '\n\n' ? '空行分段' : '单换行分段';
  const indentKey = contract.indent === '\u3000\u3000'
    ? 'novelFormat.indent.blankIndent'
    : contract.indent === '\t'
      ? 'novelFormat.indent.tab'
      : 'novelFormat.indent.none';
  const indentFallback = contract.indent === '\u3000\u3000'
    ? '首行空两格'
    : contract.indent === '\t'
      ? '首行 Tab'
      : '无缩进';
  const { separatorVisible, indentVisible } = describeContractVisible(contract);
  return {
    separatorKey,
    separatorFallback,
    separator: hasMessage(separatorKey) ? t(separatorKey) : separatorFallback,
    separatorVisible,
    indentKey,
    indentFallback,
    indent: hasMessage(indentKey) ? t(indentKey) : indentFallback,
    indentVisible,
  };
}
