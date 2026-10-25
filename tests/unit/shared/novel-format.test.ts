import { describe, expect, it } from 'vitest';
import {
  countParagraphs,
  convertToChineseQuotes,
  describeContractShort,
  formatNovelManuscript,
  indentParagraphs,
  insertBlock,
  mergeSelectedParagraphs,
  splitParagraphAtCursor,
  toggleFirstLineIndent,
  toggleLinePrefix,
  wrapSelection,
} from '../../../shared/novel-format';
import {
  DEFAULT_BODY_FORMAT,
  INDENT_TWO_FULL_WIDTH,
  type BodyFormatContract,
} from '../../../shared/body-format';

const TWO = INDENT_TWO_FULL_WIDTH;

function contract(overrides: Partial<BodyFormatContract> = {}): BodyFormatContract {
  return { ...DEFAULT_BODY_FORMAT, ...overrides };
}

describe('formatNovelManuscript — 小说格式', () => {
  it('保留 frontmatter 与章节标题，按默认契约单换行分段 + 首行空两格', () => {
    const raw = [
      '---',
      'status: draft',
      '---',
      '',
      '# 第3章 试炼',
      '',
      '好的，我将按照您的要求续写。',
      '',
      '他抬手。',
      '',
      '风从袖口灌进来。',
    ].join('\n');

    const result = formatNovelManuscript(raw, contract());
    expect(result.startsWith('---\nstatus: draft\n---')).toBe(true);
    expect(result).toContain('# 第3章 试炼');
    expect(result).not.toContain('好的，我将');
    expect(result).toContain(`${TWO}他抬手。\n${TWO}风从袖口灌进来。`);
  });

  it('空行分段契约保留段落空行与缩进', () => {
    const raw = '第一段。\n\n第二段。\n\n\n第三段。';
    const result = formatNovelManuscript(raw, contract({ separator: '\n\n' }));
    expect(result).toBe(`${TWO}第一段。\n\n${TWO}第二段。\n\n${TWO}第三段。`);
  });

  it('无 frontmatter / 标题时只规整正文', () => {
    const result = formatNovelManuscript('  第一段。  \n\n第二段。', contract());
    expect(result).toBe(`${TWO}第一段。\n${TWO}第二段。`);
  });

  it('纯空白返回空串', () => {
    expect(formatNovelManuscript('   \n\n ', contract())).toBe('');
  });
});

describe('段落工具', () => {
  it('toggleFirstLineIndent 全未缩进时补齐，再次调用移除', () => {
    const text = '第一段。\n\n第二段。';
    const added = toggleFirstLineIndent(text, 0, text.length, TWO);
    expect(added.text).toBe(`${TWO}第一段。\n\n${TWO}第二段。`);

    const removed = toggleFirstLineIndent(added.text, 0, added.text.length, TWO);
    expect(removed.text).toBe(text);
  });

  it('indentParagraphs 增加/减少缩进', () => {
    const text = '第一段。\n第二段。';
    const added = indentParagraphs(text, 0, text.length, TWO, 1);
    expect(added.text).toBe(`${TWO}第一段。\n${TWO}第二段。`);
    const removed = indentParagraphs(added.text, 0, added.text.length, TWO, -1);
    expect(removed.text).toBe(text);
  });

  it('mergeSelectedParagraphs 去掉段内换行并保留首行缩进', () => {
    const text = `${TWO}第一句。\n第二句。\n第三句。`;
    const result = mergeSelectedParagraphs(text, 0, text.length);
    expect(result.text).toBe(`${TWO}第一句。第二句。第三句。`);
  });

  it('splitParagraphAtCursor 按契约插入分段符', () => {
    const text = `${TWO}第一句。第二句。`;
    const cursor = text.indexOf('第二句');
    expect(splitParagraphAtCursor(text, cursor, contract()).text).toBe(`${TWO}第一句。\n第二句。`);
    expect(splitParagraphAtCursor(text, cursor, contract({ separator: '\n\n' })).text).toBe(`${TWO}第一句。\n\n第二句。`);
  });
});

describe('Markdown 工具', () => {
  it('wrapSelection 包裹与取消包裹', () => {
    const text = '重点';
    const bold = wrapSelection(text, 0, text.length, '**');
    expect(bold.text).toBe('**重点**');
    const unbold = wrapSelection(bold.text, 0, bold.text.length, '**');
    expect(unbold.text).toBe(text);
  });

  it('无选中时插入成对标记并把光标放在中间', () => {
    const edit = wrapSelection('abc', 1, 1, '**');
    expect(edit.text).toBe('a****bc');
    expect(edit.selectionStart).toBe(3);
  });

  it('toggleLinePrefix 标题/引用/列表', () => {
    const text = '第一段。\n第二段。';
    const heading = toggleLinePrefix(text, 0, text.length, '## ');
    expect(heading.text).toBe('## 第一段。\n## 第二段。');
    expect(toggleLinePrefix(heading.text, 0, heading.text.length, '## ').text).toBe(text);

    const quote = toggleLinePrefix(text, 0, text.length, '> ');
    expect(quote.text).toBe('> 第一段。\n> 第二段。');

    const list = toggleLinePrefix(text, 0, text.length, '- ');
    expect(list.text).toBe('- 第一段。\n- 第二段。');
  });

  it('insertBlock 自动补齐前后空行', () => {
    const edit = insertBlock('第一段。', 4, '---');
    expect(edit.text).toBe('第一段。\n\n---');
  });

  it('convertToChineseQuotes 包裹/转换 ASCII 引号', () => {
    const wrapped = convertToChineseQuotes('你好', 0, 2);
    expect(wrapped.text).toBe('“你好”');

    const converted = convertToChineseQuotes('他说"走吧"', 0, 6);
    expect(converted.text).toBe('他说“走吧”');
  });
});

describe('状态栏辅助', () => {
  it('countParagraphs 只统计非空行', () => {
    expect(countParagraphs('第一段。\n\n第二段。')).toBe(2);
  });

  it('describeContractShort 输出分段与缩进', () => {
    expect(describeContractShort(contract())).toBe('单换行分段 · 首行空两格');
    expect(describeContractShort(contract({ separator: '\n\n', indent: '' }))).toBe('空行分段 · 无缩进');
  });
});
