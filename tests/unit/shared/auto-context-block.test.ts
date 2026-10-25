import { describe, it, expect } from 'vitest';
import {
    AUTO_CONTEXT_START,
    AUTO_CONTEXT_END,
    buildAutoContextBlock,
    stripAutoContext,
    upsertAutoContext,
} from '../../../shared/auto-context-block';

const MARKER = '<!-- 正文从这里开始 -->';

function countBlocks(text: string): number {
    return text.split(AUTO_CONTEXT_START).length - 1;
}

describe('自动注入上下文块 — 幂等', () => {
    it('首次注入插到 marker 之后，正文前后保持不变', () => {
        const text = `# 第1章 开端\n\n${MARKER}\n\n正文第一段。`;
        const result = upsertAutoContext(text, '### 关联人物\n\n| 姓名 |\n|---|', MARKER);

        expect(countBlocks(result)).toBe(1);
        expect(result).toContain(AUTO_CONTEXT_END);
        expect(result.indexOf(MARKER)).toBeLessThan(result.indexOf(AUTO_CONTEXT_START));
        expect(result).toContain('正文第一段。');
        expect(result).toContain('# 第1章 开端');
    });

    it('重复注入只替换旧块，不追加第二段', () => {
        const text = `# 第1章\n\n${MARKER}\n\n正文。`;
        const first = upsertAutoContext(text, '旧上下文', MARKER);
        const second = upsertAutoContext(first, '新上下文', MARKER);

        expect(countBlocks(second)).toBe(1);
        expect(second).toContain('新上下文');
        expect(second).not.toContain('旧上下文');
        expect(second).toContain('正文。');
    });

    it('清理旧版无标记块后只写一块', () => {
        const text = `# 第1章\n\n${MARKER}\n\n---\n## 自动注入上下文\n\n旧版内容\n---\n\n正文第一段。`;
        const result = upsertAutoContext(text, '新版内容', MARKER);

        expect(countBlocks(result)).toBe(1);
        expect(result).not.toContain('旧版内容');
        expect(result).toContain('新版内容');
        expect(result).toContain('正文第一段。');
    });

    it('无 marker 时插到一级标题之后', () => {
        const text = '# 第2章 夜行\n\n正文内容。';
        const result = upsertAutoContext(text, '关联信息', '');

        expect(countBlocks(result)).toBe(1);
        expect(result.indexOf('# 第2章 夜行')).toBeLessThan(result.indexOf(AUTO_CONTEXT_START));
        expect(result).toContain('正文内容。');
    });

    it('无 marker 无标题时追加到末尾', () => {
        const text = '纯正文，没有标题。';
        const result = upsertAutoContext(text, '关联信息', '');

        expect(countBlocks(result)).toBe(1);
        expect(result.startsWith('纯正文，没有标题。')).toBe(true);
    });

    it('只有同名标题、没有旧版 --- 包裹时不误删用户内容', () => {
        const text = `# 第1章\n\n## 自动注入上下文\n\n用户自己写的段落。\n\n正文。`;
        const stripped = stripAutoContext(text);

        expect(stripped).toContain('## 自动注入上下文');
        expect(stripped).toContain('用户自己写的段落。');
    });

    it('生成的块带 start/end 且 body 两端不残留空行', () => {
        const block = buildAutoContextBlock('\n\n### 关联地点\n\n- 某地\n\n');

        expect(block.startsWith(AUTO_CONTEXT_START)).toBe(true);
        expect(block.endsWith(AUTO_CONTEXT_END)).toBe(true);
        expect(block).toContain('### 关联地点');
        expect(block).not.toContain(`${AUTO_CONTEXT_START}\n\n\n`);
    });
});
