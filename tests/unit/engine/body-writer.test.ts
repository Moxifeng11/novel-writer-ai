import { describe, it, expect, beforeEach } from 'vitest';
import type { TFile } from 'obsidian';
import { BodyWriter, extractChapterTitle } from '../../../engine/body-writer';
import { MockFileSystem, FrontmatterPort } from '../../../shared/file-system-port';
import { DEFAULT_BODY_FORMAT, INDENT_TWO_FULL_WIDTH } from '../../../shared/body-format';

class FakeFrontmatter implements FrontmatterPort {
    states = new Map<string, Record<string, unknown>>();

    async processFrontmatter(file: TFile, updater: (fm: Record<string, unknown>) => void): Promise<void> {
        const fm = { ...(this.states.get(file.path) || {}) };
        updater(fm);
        this.states.set(file.path, fm);
    }
}

const PATH = '项目/03-大纲与章节/正文/第1卷/第3章_正文.md';

function longCompleteBody(): string {
    return Array.from({ length: 300 }, (_, i) => `他低声说：「第${i}句对话。」然后收声。`).join('\n');
}

describe('extractChapterTitle', () => {
    it('提取 Markdown 标题行里的章名', () => {
        expect(extractChapterTitle('# 第3章 试炼\n\n正文')).toBe('试炼');
    });

    it('提取「第3章：试炼」形式', () => {
        expect(extractChapterTitle('第3章：试炼\n\n正文')).toBe('试炼');
    });

    it('无标题时返回空串', () => {
        expect(extractChapterTitle('他抬手。')).toBe('');
    });
});

describe('BodyWriter', () => {
    let fs: MockFileSystem;
    let frontmatter: FakeFrontmatter;
    let writer: BodyWriter;

    beforeEach(() => {
        fs = new MockFileSystem();
        frontmatter = new FakeFrontmatter();
        writer = new BodyWriter({ fs, frontmatter });
    });

    it('新建正文：统一标题行 + 空两格 + 单换行 + 剥离元叙述', async () => {
        const res = await writer.write({
            path: PATH,
            raw: '好的，我将按照您的要求续写。\n# 第3章 试炼\n\n他抬手。\n\n风从袖口灌进来。',
            chapterNum: 3,
            chapterName: '第3章',
            volume: '第1卷',
            writingMode: 'co-writer',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(res.created).toBe(true);
        expect(res.title).toBe('试炼');

        const content = await fs.read(PATH);
        expect(content.startsWith('# 第3章 试炼\n\n')).toBe(true);
        expect(content).not.toContain('好的，我将');
        expect(content).not.toContain('\n\n　　风');
        expect(res.body.split('\n').every(l => l.startsWith(INDENT_TWO_FULL_WIDTH))).toBe(true);
    });

    it('模型漏写标题时，用旧 frontmatter 标题兜底（避免 `# 第3章 ` 空标题）', async () => {
        await fs.write(PATH, '---\n标题: 旧章名\n---\n\n# 第3章 旧章名\n\n旧正文。');
        const res = await writer.write({
            path: PATH,
            raw: `# 第3章

${longCompleteBody()}`,
            chapterNum: 3,
            chapterName: '第3章',
            volume: '第1卷',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
        });
        expect(res.title).toBe('旧章名');
        const content = await fs.read(PATH);
        expect(content).toContain('# 第3章 旧章名');
    });

    it('不变量字段：完整正文 → status=written + step_status=generated', async () => {
        await writer.write({
            path: PATH,
            raw: '# 第3章 试炼\n\n' + longCompleteBody(),
            chapterNum: 3,
            chapterName: '第3章',
            volume: '第1卷',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
        });

        const fm = frontmatter.states.get(PATH)!;
        expect(fm['status']).toBe('written');
        expect(fm['step_status']).toBe('generated');
        expect(fm['writing_mode']).toBe('pipeline');
        expect(fm['卷']).toBe('第1卷');
        expect(fm['章']).toBe('第3章');
        expect(fm['tags']).toContain('正文');
        expect(typeof fm['word_count']).toBe('number');
    });

    it('短正文：不标记完成，且不会把已有 written 降级为 draft', async () => {
        frontmatter.states.set(PATH, { status: 'written', step_status: 'generated' });
        await writer.write({
            path: PATH,
            raw: '他抬手。',
            chapterNum: 3,
            chapterName: '第3章',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        });

        const fm = frontmatter.states.get(PATH)!;
        expect(fm['status']).toBe('written');
        expect(fm['step_status']).toBeUndefined();
    });

    it('已结算章节不会被写回 written（status 不降级）', async () => {
        fs.setFile(PATH, '---\nstatus: settled\ntags: [正文]\n---\n\n# 第3章 旧\n\n旧正文。');
        frontmatter.states.set(PATH, { status: 'settled', tags: ['正文'] });

        await writer.write({
            path: PATH,
            raw: '他抬手。',
            chapterNum: 3,
            chapterName: '第3章',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(frontmatter.states.get(PATH)!['status']).toBe('settled');
    });

    it('保留旧 frontmatter 原文（含块列表），不因重写而丢字段', async () => {
        const original = [
            '---',
            'status: written',
            'tags: [正文]',
            '涉及人物:',
            '  - 沈砚',
            '  - 苏晚',
            '自定义字段: 保留我',
            '---',
            '',
            '# 第3章 旧标题',
            '',
            '旧正文。',
        ].join('\n');
        fs.setFile(PATH, original);

        await writer.write({
            path: PATH,
            raw: '他抬手。',
            chapterNum: 3,
            chapterName: '第3章',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        });

        const content = await fs.read(PATH);
        expect(content).toContain('涉及人物:\n  - 沈砚\n  - 苏晚');
        expect(content).toContain('自定义字段: 保留我');
        expect(content).toContain('# 第3章');
        expect(content).not.toContain('# 第3章 旧标题');
        expect(content).not.toContain('旧正文');
    });

    it('空行契约：段落之间恰好一个空行', async () => {
        const res = await writer.write({
            path: PATH,
            raw: '第一段。\n\n\n第二段。',
            chapterNum: 3,
            chapterName: '第3章',
            writingMode: 'batch',
            contract: { separator: '\n\n', indent: '', allowTitle: false, source: 'default' },
        });

        expect(res.body).toBe('第一段。\n\n第二段。');
    });

    it('模型输出自带的 frontmatter 不得写进正文', async () => {
        const res = await writer.write({
            path: PATH,
            raw: '---\nstatus: generated\nstep_status: generated\n---\n\n他抬手。',
            chapterNum: 3,
            chapterName: '第3章',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(res.body).not.toContain('status');
        expect(res.body).not.toContain('---');
        const content = await fs.read(PATH);
        expect(content).not.toContain('step_status');
    });

    it('截断正文即使结构达标也不得标记 generated/written', async () => {
        await writer.write({
            path: PATH,
            raw: longCompleteBody(),
            chapterNum: 3,
            chapterName: '第3章',
            volume: '第1卷',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
            truncated: true,
        });

        const fm = frontmatter.states.get(PATH)!;
        expect(fm['status']).toBe('draft');
        expect(fm['step_status']).toBeUndefined();
        expect(fm['step_truncated']).toBe(true);
    });

    it('frontmatterPatch 由调用方计算后统一写入', async () => {
        await writer.write({
            path: PATH,
            raw: '他抬手。',
            chapterNum: 3,
            chapterName: '第3章',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
            frontmatterPatch: { 涉及人物: ['沈砚'] },
        });

        expect(frontmatter.states.get(PATH)!['涉及人物']).toEqual(['沈砚']);
    });

    it('pipeline 写入默认把相邻短段合并成自然段，并合并对话与说话人动作', async () => {
        const res = await writer.write({
            path: PATH,
            raw: '他抬手。\n风从袖口灌进来。\n“走。”\n沈铁山没回头。\n沈砚把背挺了挺。',
            chapterNum: 3,
            chapterName: '第3章',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(res.body).toContain('他抬手。风从袖口灌进来。');
        expect(res.body).toContain('“走。”沈铁山没回头。沈砚把背挺了挺。');
    });

    it('naturalize=false 时保留模型原始分行', async () => {
        const res = await writer.write({
            path: PATH,
            raw: '他抬手。\n风从袖口灌进来。',
            chapterNum: 3,
            chapterName: '第3章',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
            naturalize: false,
        });

        expect(res.body).toBe([
            `${INDENT_TWO_FULL_WIDTH}他抬手。`,
            `${INDENT_TWO_FULL_WIDTH}风从袖口灌进来。`,
        ].join('\n'));
    });
});
