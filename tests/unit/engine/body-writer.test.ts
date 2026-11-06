import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { BodyWriter, defaultBodyPath, extractChapterTitle } from '../../../engine/body-writer';
import { MockFileSystem, FrontmatterPort } from '../../../shared/file-system-port';
import { DEFAULT_BODY_FORMAT, INDENT_TWO_FULL_WIDTH } from '../../../shared/body-format';
import { ChapterVersionService } from '../../../services/chapter-version-service';
import type { VersionMeta } from '../../../shared/version-types';

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
        fs.setFile('项目/作品信息.md', '# 项目');
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

    it('项目已删除时拒绝写入，避免自动保存重建空项目', async () => {
        const path = '长篇小说/已删项目/03-大纲与章节/正文/第1卷/第1章_正文.md';
        await expect(writer.write({
            path,
            raw: '# 第1章 试炼\n\n他抬手。',
            chapterNum: 1,
            chapterName: '第1章',
            volume: '第1卷',
            project: '长篇小说/已删项目',
            writingMode: 'co-writer',
        })).rejects.toThrow('已不存在');
        expect(await fs.exists(path)).toBe(false);
    });

    it('空 path 直接拒绝，不触碰文件系统', async () => {
        await expect(writer.write({
            path: '',
            raw: '他抬手。',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        })).rejects.toThrow('path 为空');
        expect(await fs.exists(PATH)).toBe(false);
    });

    it('chapterNum 缺省时从 chapterName 的阿拉伯数字解析标题行', async () => {
        const res = await writer.write({
            path: PATH,
            raw: '他抬手。',
            chapterName: '第3章',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(res.title).toBe('');
        const content = await fs.read(PATH);
        expect(content.startsWith('# 第3章\n\n')).toBe(true);
        expect(frontmatter.states.get(PATH)!['章']).toBe('第3章');
    });

    it('chapterName 无章号时只写 frontmatter「章」，不生成标题行', async () => {
        await writer.write({
            path: PATH,
            raw: '他抬手。',
            chapterName: '楔子',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        });

        const content = await fs.read(PATH);
        expect(content.startsWith('# ')).toBe(false);
        const fm = frontmatter.states.get(PATH)!;
        expect(fm['章']).toBe('楔子');
        expect(fm['标题']).toBe('楔子');
    });

    it('章号为中文数字时无法解析，退化为无标题行且不写「章」以外的派生字段', async () => {
        await writer.write({
            path: PATH,
            raw: '他抬手。',
            chapterName: '第十二章',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        });

        const content = await fs.read(PATH);
        expect(content.startsWith('# ')).toBe(false);
        expect(frontmatter.states.get(PATH)!['标题']).toBeUndefined();
    });

    it('章号与章名都缺省时不产生标题行与标题字段', async () => {
        await writer.write({
            path: PATH,
            raw: '他抬手。',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        });

        const content = await fs.read(PATH);
        expect(content.startsWith('# ')).toBe(false);
        const fm = frontmatter.states.get(PATH)!;
        expect(fm['章']).toBeUndefined();
        expect(fm['标题']).toBeUndefined();
    });

    it('path 无目录分隔符时 dirOf 退化为空目录，写入照常完成', async () => {
        const flatPath = '第1章_正文.md';
        await writer.write({
            path: flatPath,
            raw: '他抬手。',
            chapterNum: 1,
            chapterName: '第1章',
            project: '项目',
            writingMode: 'manual',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(await fs.read(flatPath)).toContain('# 第1章');
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

describe('BodyWriter — 覆盖前备份（P0-3）', () => {
    const DIR = '项目/03-大纲与章节/正文/第1卷';
    const P_SUCCESS = `${DIR}/第7章_正文.md`;
    const P_OPT_OUT = `${DIR}/第8章_正文.md`;
    const P_EMPTY_OLD = `${DIR}/第9章_正文.md`;
    const P_NO_PROJECT = `${DIR}/第10章_正文.md`;
    const P_FAIL = `${DIR}/第11章_正文.md`;
    const P_THROTTLE = `${DIR}/第12章_正文.md`;

    function makeApp(): App {
        return { workspace: { trigger: vi.fn() } } as unknown as App;
    }

    function spySaveVersion() {
        return vi.spyOn(ChapterVersionService.prototype, 'saveVersion')
            .mockResolvedValue({} as unknown as VersionMeta);
    }

    let fs: MockFileSystem;
    let frontmatter: FakeFrontmatter;

    beforeEach(() => {
        fs = new MockFileSystem();
        fs.setFile('项目/作品信息.md', '# 项目');
        frontmatter = new FakeFrontmatter();
    });

    function makeWriter(): BodyWriter {
        return new BodyWriter({ app: makeApp(), fs, frontmatter });
    }

    afterEach(() => vi.restoreAllMocks());

    it('覆盖已有非空正文时备份一次，并把旧正文交给版本服务', async () => {
        await fs.write(P_SUCCESS, '---\nstatus: written\n---\n\n旧正文第一句。');
        const spy = spySaveVersion();

        await makeWriter().write({
            path: P_SUCCESS,
            raw: '# 第7章 新稿\n\n新正文第二句。',
            chapterNum: 7,
            chapterName: '第7章',
            volume: '第1卷',
            project: '项目',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(spy).toHaveBeenCalledTimes(1);
        const call = spy.mock.calls[0];
        expect(call[0]).toBe('项目');
        expect(call[1]).toBe('chapter');
        expect(call[2]).toBe('第7章');
        expect(call[3]).toBe(P_SUCCESS);
        expect(call[4]).toContain('旧正文第一句。');
        expect(call[5]).toMatchObject({ type: 'manual' });
        expect(String(call[5].note)).toContain('覆盖前自动备份');
        // 备份不阻断正文写入
        expect(await fs.read(P_SUCCESS)).toContain('新正文第二句。');
    });

    it('显式 backupBeforeOverwrite=false 时跳过备份（导入/迁移全量替换）', async () => {
        await fs.write(P_OPT_OUT, '---\nstatus: written\n---\n\n旧正文。');
        const spy = spySaveVersion();

        await makeWriter().write({
            path: P_OPT_OUT,
            raw: '# 第8章 新稿\n\n新正文。',
            chapterNum: 8,
            chapterName: '第8章',
            project: '项目',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
            backupBeforeOverwrite: false,
        });

        expect(spy).not.toHaveBeenCalled();
        expect(await fs.read(P_OPT_OUT)).toContain('新正文。');
    });

    it('旧文件只有 frontmatter（正文为空）时不备份', async () => {
        await fs.write(P_EMPTY_OLD, '---\n标题: 旧标题\n---\n');
        const spy = spySaveVersion();

        await makeWriter().write({
            path: P_EMPTY_OLD,
            raw: '# 第9章 新稿\n\n新正文。',
            chapterNum: 9,
            chapterName: '第9章',
            project: '项目',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(spy).not.toHaveBeenCalled();
    });

    it('请求缺 project 时不备份（无法定位版本库目标项目）', async () => {
        await fs.write(P_NO_PROJECT, '---\nstatus: written\n---\n\n旧正文。');
        const spy = spySaveVersion();

        await makeWriter().write({
            path: P_NO_PROJECT,
            raw: '# 第10章 新稿\n\n新正文。',
            chapterNum: 10,
            chapterName: '第10章',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(spy).not.toHaveBeenCalled();
    });

    it('版本服务抛错只记录日志，正文写入照常完成', async () => {
        await fs.write(P_FAIL, '---\nstatus: written\n---\n\n旧正文。');
        const spy = spySaveVersion();
        spy.mockRejectedValueOnce(new Error('版本库写入失败'));

        const res = await makeWriter().write({
            path: P_FAIL,
            raw: '# 第11章 新稿\n\n新正文。',
            chapterNum: 11,
            chapterName: '第11章',
            project: '项目',
            writingMode: 'pipeline',
            contract: DEFAULT_BODY_FORMAT,
        });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(res.created).toBe(false);
        expect(await fs.read(P_FAIL)).toContain('新正文。');
    });

    it('同一路径 5 分钟内重复写入只备份第一次（协同 2s 自动保存节流）', async () => {
        await fs.write(P_THROTTLE, '---\nstatus: written\n---\n\n旧正文。');
        const spy = spySaveVersion();
        const writerWithApp = makeWriter();

        for (const raw of ['# 第12章 一稿\n\n正文一。', '# 第12章 二稿\n\n正文二。']) {
            await writerWithApp.write({
                path: P_THROTTLE,
                raw,
                chapterNum: 12,
                chapterName: '第12章',
                project: '项目',
                writingMode: 'co-writer',
                contract: DEFAULT_BODY_FORMAT,
            });
        }

        expect(spy).toHaveBeenCalledTimes(1);
        expect(await fs.read(P_THROTTLE)).toContain('正文二。');
    });
});

describe('defaultBodyPath', () => {
    it('有卷号时落到 03-大纲与章节/正文/第N卷', () => {
        expect(defaultBodyPath('书', 1, 3)).toBe('书/03-大纲与章节/正文/第1卷/第3章_正文.md');
    });

    it('卷号缺省时退化为项目根目录，章名优先于章号', () => {
        expect(defaultBodyPath('书', 0, 7, '试炼')).toBe('书/试炼_正文.md');
    });

    it('卷号缺省且无章名时用章号兜底', () => {
        expect(defaultBodyPath('书', 0, 7)).toBe('书/第7章_正文.md');
    });
});
