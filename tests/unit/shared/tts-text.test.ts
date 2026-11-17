import { describe, expect, it } from 'vitest';
import {
    DEFAULT_MAX_CHARS,
    TTS_RATE_OPTIONS,
    clampRate,
    cleanForSpeech,
    estimateSpeechMs,
    frontmatterEndOffset,
    offsetToPosition,
    splitSentences,
} from '@/shared/tts-text';

describe('tts-text：frontmatter 与偏移', () => {
    it('跳过闭合的 YAML 头', () => {
        const text = '---\ntags: [a]\n---\n正文开始。';
        expect(frontmatterEndOffset(text)).toBe(text.indexOf('正文开始。'));
    });

    it('CRLF 换行也能识别', () => {
        const text = '---\r\ntags: [a]\r\n---\r\n正文。';
        expect(frontmatterEndOffset(text)).toBe(text.indexOf('正文。'));
    });

    it('没有 frontmatter / 未闭合都回落到 0', () => {
        expect(frontmatterEndOffset('正文')).toBe(0);
        expect(frontmatterEndOffset('---\ntags: [a]\n')).toBe(0);
        expect(frontmatterEndOffset('---\n')).toBe(0);
    });

    it('偏移换算成 0 基行列且越界收敛', () => {
        expect(offsetToPosition('ab\ncd', 0)).toEqual({ line: 0, ch: 0 });
        expect(offsetToPosition('ab\ncd', 3)).toEqual({ line: 1, ch: 0 });
        expect(offsetToPosition('ab\ncd', 4)).toEqual({ line: 1, ch: 1 });
        expect(offsetToPosition('ab\ncd', 99)).toEqual({ line: 1, ch: 2 });
        expect(offsetToPosition('ab\ncd', -5)).toEqual({ line: 0, ch: 0 });
    });
});

describe('tts-text：朗读文本清洗', () => {
    it('图片整段丢弃，链接只留文字', () => {
        expect(cleanForSpeech('![封面](a.png)')).toBe('');
        expect(cleanForSpeech('见[第一章](https://x/y)')).toBe('见第一章');
    });

    it('双链取别名，无别名取目标', () => {
        expect(cleanForSpeech('[[人物卡|张三]]走进来')).toBe('张三走进来');
        expect(cleanForSpeech('见[[第1章]]')).toBe('见第1章');
    });

    it('去掉标题 / 引用 / 列表 / 强调记号，保留文字', () => {
        expect(cleanForSpeech('## 标题')).toBe('标题');
        expect(cleanForSpeech('> 引用一句')).toBe('引用一句');
        expect(cleanForSpeech('- 列表项')).toBe('列表项');
        expect(cleanForSpeech('1. 有序项')).toBe('有序项');
        expect(cleanForSpeech('**加粗**与*斜体*')).toBe('加粗与斜体');
    });

    it('行内代码去反引号，分隔线不朗读', () => {
        expect(cleanForSpeech('命令 `npm run build` 用法')).toBe('命令 npm run build 用法');
        expect(cleanForSpeech('---')).toBe('');
    });
});

describe('tts-text：断句', () => {
    it('中文句末标点 + 引号收尾归上一句', () => {
        const sentences = splitSentences('他走了。她说：「等等！」然后追了出去。');
        expect(sentences.map(s => s.speech)).toEqual(['他走了。', '她说：「等等！」', '然后追了出去。']);
        expect(sentences.map(s => s.index)).toEqual([0, 1, 2]);
    });

    it('区间连续覆盖原文（不丢字、不重叠）', () => {
        const text = '第一句！第二句？第三句。';
        const sentences = splitSentences(text);
        for (let i = 1; i < sentences.length; i += 1) {
            expect(sentences[i].start).toBe(sentences[i - 1].end);
        }
        expect(sentences[0].start).toBe(0);
        expect(sentences[sentences.length - 1].end).toBe(text.length);
    });

    it('换行是软边界：段落各自成句', () => {
        const sentences = splitSentences('第一段没有句号\n第二段也没有');
        expect(sentences.map(s => s.speech)).toEqual(['第一段没有句号', '第二段也没有']);
    });

    it('英文句点成句，但版本号 / 小数不断开', () => {
        expect(splitSentences('Hello world. Next one.').map(s => s.speech)).toEqual(['Hello world.', 'Next one.']);
        expect(splitSentences('版本 v4.96.1 已发布').length).toBe(1);
    });

    it('超长句按逗号切分，每句不超过上限', () => {
        const clause = '这一句话很长很长';
        const text = Array.from({ length: 40 }, () => clause).join('，');
        const sentences = splitSentences(text, { maxChars: 60 });
        expect(sentences.length).toBeGreaterThan(1);
        for (const sentence of sentences) {
            expect(sentence.speech.length).toBeLessThanOrEqual(60);
        }
        expect(sentences.map(s => s.speech).join('')).toContain('这一句话很长很长');
    });

    it('无标点的超长文本硬切，不产生空洞', () => {
        const text = '啊'.repeat(300);
        const sentences = splitSentences(text, { maxChars: DEFAULT_MAX_CHARS });
        expect(sentences.length).toBe(3);
        expect(sentences.every(s => s.speech.length > 0)).toBe(true);
    });

    it('起止偏移生效（只读正文段）', () => {
        const text = '---\ntags: a\n---\n只念这一句。';
        const from = frontmatterEndOffset(text);
        const sentences = splitSentences(text, { from });
        expect(sentences).toHaveLength(1);
        expect(sentences[0].speech).toBe('只念这一句。');
        expect(sentences[0].raw).not.toContain('tags');
    });

    it('只有记号的片段被丢弃（空文本不产生句子）', () => {
        expect(splitSentences('')).toEqual([]);
        expect(splitSentences('---\n***\n')).toEqual([]);
    });
});

describe('tts-text：语速与时长', () => {
    it('语速收敛到 0.5–2，非法值回 1', () => {
        expect(clampRate(3)).toBe(2);
        expect(clampRate(0.2)).toBe(0.5);
        expect(clampRate(0)).toBe(1);
        expect(clampRate('1.5')).toBe(1.5);
        expect(clampRate('fast')).toBe(1);
        expect(clampRate(Number.NaN)).toBe(1);
        expect(clampRate(null)).toBe(1);
    });

    it('语速候选值都在合法区间且包含 1', () => {
        expect(TTS_RATE_OPTIONS).toContain(1);
        expect(TTS_RATE_OPTIONS.every(rate => clampRate(rate) === rate)).toBe(true);
    });

    it('时长随语速线性缩短', () => {
        expect(estimateSpeechMs('四个汉字', 1)).toBe(4 * 220);
        expect(estimateSpeechMs('四个汉字', 2)).toBe(4 * 110);
    });
});
