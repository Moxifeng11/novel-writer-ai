import { describe, expect, it } from 'vitest';
import {
    buildUnitPrompt,
    canApplyRewrite,
    countUnitWords,
    generateUnitText,
    patchFrontmatterText,
    saveUnitBody,
    splitFrontmatter,
    type UnitAIEngine,
    type UnitFilePort,
    type UnitWriterContext,
} from '../../../engine/mode-unit-writer';

const SKELETON = `---
tags: [短篇正文]
节: "第01节"
status: pending
word_count: 0
---

# 第1节

## 本节目标
- 核心冲突：
`;

function context(overrides: Partial<UnitWriterContext> = {}): UnitWriterContext {
    return {
        mode: 'short',
        project: '短篇创作/测试短篇',
        unitNumber: 2,
        unitName: '第2节',
        unitPath: '短篇创作/测试短篇/03-正文/第02节.md',
        outlineSection: '### 第2节 反转\n- 目标：揭示身份',
        outlineDoc: '### 第1节 开局\n### 第2节 反转',
        storyDoc: '# 故事核\n一句话故事：找回记忆',
        characters: '主角：失忆的档案员',
        previousTail: '上一节的最后一句。',
        modeGuide: '短篇模式指南',
        targetWords: 3000,
        existingBody: '# 第2节\n\n已经写了一半。',
        ...overrides,
    };
}

describe('mode-unit-writer — frontmatter', () => {
    it('拆分 frontmatter 与正文', () => {
        const { frontmatter, body } = splitFrontmatter(SKELETON);
        expect(frontmatter).toContain('status: pending');
        expect(body.trim().startsWith('# 第1节')).toBe(true);
    });

    it('没有 frontmatter 时原样返回正文', () => {
        expect(splitFrontmatter('只有正文')).toEqual({ frontmatter: '', body: '只有正文' });
    });

    it('替换已有字段并保留其它字段与正文', () => {
        const patched = patchFrontmatterText(SKELETON, { status: 'written', word_count: 1200 });
        expect(patched).toContain('status: written');
        expect(patched).toContain('word_count: 1200');
        expect(patched).not.toContain('status: pending');
        expect(patched).toContain('tags: [短篇正文]');
        expect(patched).toContain('# 第1节');
    });

    it('追加不存在的字段', () => {
        const patched = patchFrontmatterText(SKELETON, { 标题: '第1节 开局' });
        expect(patched).toContain('标题: 第1节 开局');
        expect(patched).toContain('status: pending');
    });

    it('没有 frontmatter 时补一个', () => {
        const patched = patchFrontmatterText('正文内容', { status: 'written' });
        expect(patched.startsWith('---\nstatus: written\n---\n')).toBe(true);
        expect(patched).toContain('正文内容');
    });

    it('含半角冒号的标题会加引号，全角冒号保持原样', () => {
        const quoted = patchFrontmatterText(SKELETON, { 标题: '反转: 身份揭晓' });
        expect(quoted).toContain('标题: "反转: 身份揭晓"');
        const chineseColon = patchFrontmatterText(SKELETON, { 标题: '反转：身份揭晓' });
        expect(chineseColon).toContain('标题: 反转：身份揭晓');
    });
});

describe('mode-unit-writer — 字数', () => {
    it('不把 frontmatter 与标题符号计入字数', () => {
        const text = `${SKELETON}\n## 目标\n找回记忆`;
        // 统计的是去掉 frontmatter、# 号与空白后的正文字符
        expect(countUnitWords(text)).toBeGreaterThan(0);
        expect(countUnitWords(text)).toBeLessThan(text.length);
        expect(countUnitWords('---\nstatus: pending\n---\n')).toBe(0);
    });
});

describe('mode-unit-writer — 提示词', () => {
    it('生成本节：带大纲、故事核、人物、上一节结尾与目标字数', () => {
        const { system, user } = buildUnitPrompt(context(), 'generate');
        expect(system).toContain('短篇小说写作引擎');
        expect(system).toContain('短篇模式指南');
        expect(user).toContain('第2节 反转');
        expect(user).toContain('找回记忆');
        expect(user).toContain('失忆的档案员');
        expect(user).toContain('上一节的最后一句。');
        expect(user).toContain('约 3000 字');
    });

    it('剧本模式使用可拍格式约束', () => {
        const { system } = buildUnitPrompt(context({ mode: 'script', unitName: '第2集' }), 'generate');
        expect(system).toContain('剧本格式');
        expect(system).toContain('可拍');
    });

    it('续写：带上已写正文并禁止重复', () => {
        const { user } = buildUnitPrompt(context(), 'continue');
        expect(user).toContain('已经写了一半。');
        expect(user).toContain('不要重复已写内容');
    });

    it('改写：只输出改写文本，不解释', () => {
        const { user } = buildUnitPrompt(context(), 'rewrite', { selection: '原来的一句对白。' });
        expect(user).toContain('原来的一句对白。');
        expect(user).toContain('只输出改写后的文本');
        expect(user).not.toContain('已经写了一半。');
    });
});

describe('mode-unit-writer — 生成', () => {
    it('非流式：返回模型内容并带上 writingTask/signal', async () => {
        const calls: Array<{ system: string; options?: unknown }> = [];
        const ai: UnitAIEngine = {
            callAI: async (system, _user, _model, _temperature, _maxTokens, options) => {
                calls.push({ system, options });
                return { content: '  生成结果  ' };
            },
        };
        const controller = new AbortController();
        const text = await generateUnitText(ai, context(), 'generate', {
            model: 'test-model',
            maxTokens: 4096,
            signal: controller.signal,
        });
        expect(text).toBe('生成结果');
        expect(calls[0].options).toMatchObject({ isWritingTask: true, signal: controller.signal });
    });

    it('模型报错时抛出可读错误', async () => {
        const ai: UnitAIEngine = { callAI: async () => ({ content: '', error: '额度不足' }) };
        await expect(generateUnitText(ai, context(), 'generate', { model: 'm', maxTokens: 100 }))
            .rejects.toThrow('额度不足');
    });

    it('流式：逐块回调，最终返回累计文本', async () => {
        const chunks: string[] = [];
        const ai: UnitAIEngine = {
            callAI: async () => ({ content: '不该走到这里' }),
            callAIAsyncIterator: async function* () {
                yield '第一段';
                yield '第二段';
            } as unknown as UnitAIEngine['callAIAsyncIterator'],
        };
        const text = await generateUnitText(ai, context(), 'continue', {
            model: 'm',
            maxTokens: 100,
            onDelta: chunk => chunks.push(chunk),
        });
        expect(text).toBe('第一段第二段');
        expect(chunks).toEqual(['第一段', '第二段']);
    });

    it('流式没有产出时回退到一次性调用', async () => {
        let called = false;
        const ai: UnitAIEngine = {
            callAI: async () => { called = true; return { content: '回退结果' }; },
            callAIAsyncIterator: async function* () { /* 空流 */ } as unknown as UnitAIEngine['callAIAsyncIterator'],
        };
        const text = await generateUnitText(ai, context(), 'generate', { model: 'm', maxTokens: 100 });
        expect(text).toBe('回退结果');
        expect(called).toBe(true);
    });
});

describe('mode-unit-writer — 保存', () => {
    function createPort(initial: string): UnitFilePort & { patches: Array<Record<string, unknown>>; written: string[] } {
        let content = initial;
        const patches: Array<Record<string, unknown>> = [];
        const written: string[] = [];
        return {
            patches,
            written,
            read: async () => content,
            write: async (_path, next) => { content = next; written.push(next); },
            updateFrontmatter: async (_path, patch) => { patches.push(patch); },
        };
    }

    it('保存正文时保留 frontmatter，并回写 word_count', async () => {
        const port = createPort(SKELETON);
        const { words } = await saveUnitBody(port, 'a.md', '# 第1节\n\n新的正文');
        expect(words).toBeGreaterThan(0);
        expect(port.written[0]).toContain('status: pending');
        expect(port.written[0]).toContain('新的正文');
        expect(port.patches[0]).toMatchObject({ word_count: words });
        expect(port.patches[0]).not.toHaveProperty('status');
    });

    it('完成本单元时写入 status=written', async () => {
        const port = createPort(SKELETON);
        await saveUnitBody(port, 'a.md', '正文', { markWritten: true, title: '开局' });
        expect(port.patches[0]).toMatchObject({ status: 'written', 标题: '开局' });
    });
});

describe('mode-unit-writer — 改写守卫', () => {
    it('目标区间未变才允许应用', () => {
        const text = '前面。原句。后面。';
        const start = text.indexOf('原句。');
        expect(canApplyRewrite(text, { start, end: start + 3, originalText: '原句。' })).toBe(true);
        expect(canApplyRewrite(text, { start, end: start + 3, originalText: '别的。' })).toBe(false);
        expect(canApplyRewrite(text, { start: -1, end: 2, originalText: '前' })).toBe(false);
        expect(canApplyRewrite(text, { start: 0, end: 999, originalText: text })).toBe(false);
    });
});
