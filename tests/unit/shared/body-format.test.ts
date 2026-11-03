import { describe, it, expect } from 'vitest';
import {
    DEFAULT_BODY_FORMAT,
    INDENT_TWO_FULL_WIDTH,
    deriveBodyFormat,
    describeBodyFormat,
    normalizeBodyText,
} from '../../../shared/body-format';

describe('deriveBodyFormat', () => {
    it('项目写作规则「每段开头空两格」+「一句一段」→ 空两格 + 单换行', () => {
        const rules = [
            '### 段落',
            '- 每段开头空两格（全角空格）',
            '- 一段一个句号收尾',
            '- 一句一段，一段一个画面。对话单独成段。',
        ].join('\n');
        const contract = deriveBodyFormat(rules);
        expect(contract.indent).toBe('\u3000\u3000');
        expect(contract.separator).toBe('\n');
        expect(contract.source).toBe('writing-rules');
    });

    it('写作规则要求「段落之间空行」时使用空行分隔', () => {
        const contract = deriveBodyFormat('番茄小说格式：每段开头空两格，段落间空行，对话独立成段');
        expect(contract.separator).toBe('\n\n');
    });

    it('写作规则明确「不要留空行」时单换行优先', () => {
        const contract = deriveBodyFormat('一句一段，段落之间只用一个换行，不要留空行');
        expect(contract.separator).toBe('\n');
    });

    it('「禁止用空格/Tab 代替分段」不应被误判为禁止缩进', () => {
        const contract = deriveBodyFormat('禁止用空格/Tab/多余空行代替分段');
        // 没有明确肯定式时沿用默认（空两格），避免把「不要用空格凑分段」当成「不要缩进」
        expect(contract.indent).toBe(DEFAULT_BODY_FORMAT.indent);
    });

    it('空规则回退默认契约', () => {
        expect(deriveBodyFormat('')).toEqual(DEFAULT_BODY_FORMAT);
    });
});

describe('normalizeBodyText', () => {
    it('单换行契约：压掉空行、剥离标题、统一空两格缩进', () => {
        const raw = [
            '# 第3章 试炼',
            '',
            '他抬手。',
            '',
            '风从袖口灌进来。',
            '   “走。”',
        ].join('\n');

        const out = normalizeBodyText(raw, DEFAULT_BODY_FORMAT);

        expect(out).toBe([
            `${INDENT_TWO_FULL_WIDTH}他抬手。`,
            `${INDENT_TWO_FULL_WIDTH}风从袖口灌进来。`,
            `${INDENT_TWO_FULL_WIDTH}“走。”`,
        ].join('\n'));
        expect(out).not.toContain('#');
        expect(out).not.toContain('\n\n');
    });

    it('空行契约：保留段落边界，段落之间恰好一个空行', () => {
        const out = normalizeBodyText('第一段。\n\n\n第二段。', {
            separator: '\n\n',
            indent: '',
            allowTitle: false,
            source: 'default',
        });
        expect(out).toBe('第一段。\n\n第二段。');
    });

    it('剥离模型写在首行的元叙述', () => {
        const out = normalizeBodyText('好的，我将按照您的要求续写。\n他抬手。', DEFAULT_BODY_FORMAT);
        expect(out).toBe(`${INDENT_TWO_FULL_WIDTH}他抬手。`);
    });

    it('剥离 <think> 段，不把思考写进正文', () => {
        const out = normalizeBodyText('<think>\n先想想。\n</think>\n他抬手。', DEFAULT_BODY_FORMAT);
        expect(out).toBe(`${INDENT_TWO_FULL_WIDTH}他抬手。`);
    });

    it('已经符合契约的文本再规整一次保持不变（幂等）', () => {
        const once = normalizeBodyText('他抬手。\n风灌进来。', DEFAULT_BODY_FORMAT);
        const twice = normalizeBodyText(once, DEFAULT_BODY_FORMAT);
        expect(twice).toBe(once);
    });
});

describe('describeBodyFormat', () => {
    it('格式说明与契约一致：空两格 + 不写标题', () => {
        const text = describeBodyFormat(DEFAULT_BODY_FORMAT);
        expect(text).toContain('每段开头空两格');
        expect(text).toContain('不要写章节标题');
        // 不允许再出现与「空两格」矛盾的 Tab 说法
        expect(text).not.toContain('Tab');
    });

    it('单换行契约要求自然段，而不是一句一段', () => {
        const text = describeBodyFormat(DEFAULT_BODY_FORMAT);
        expect(text).toContain('一个自然段写成一行');
        // v4.26 引导版：不再给 2–6 句硬指标
        expect(text).not.toContain('2–6 句');
        expect(text).toContain('一句成段也可以');
        expect(text).toContain('不要留空行');
    });

    it('空行契约时说明里要求段间空行', () => {
        const text = describeBodyFormat({
            separator: '\n\n',
            indent: '',
            allowTitle: false,
            source: 'default',
        });
        expect(text).toContain('每个段落之间空一行');
    });

    it('allowTitle 时要求首行写章节标题，且不再要求「不写标题」', () => {
        const text = describeBodyFormat({ ...DEFAULT_BODY_FORMAT, allowTitle: true });
        expect(text).toContain('第一行写章节标题');
        expect(text).not.toContain('不要写章节标题');
    });

    it('allowTitle=false（建议/联想/协同）时不要求写标题', () => {
        const text = describeBodyFormat({ ...DEFAULT_BODY_FORMAT, allowTitle: false });
        expect(text).toContain('不要写章节标题');
        expect(text).not.toContain('第一行写章节标题');
    });
});
