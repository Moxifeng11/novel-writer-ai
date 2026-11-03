import { describe, expect, it } from 'vitest';
import { mergeFrontmatterRaw } from '../../../engine/body-writer';

describe('mergeFrontmatterRaw — patch 写前合成（归因字段丢失回归）', () => {
    it('已有键覆盖、新键追加', () => {
        const merged = mergeFrontmatterRaw('卷: "第1卷"\nstatus: written\n涉及人物: []', {
            status: 'written',
            'step_template_id': 'bodyGeneration.v3',
            'step_template_version': '3.0.0',
        });
        expect(merged).toContain('status: written');
        expect(merged).toContain('step_template_id: bodyGeneration.v3');
        expect(merged).toContain('step_template_version: 3.0.0');
        expect(merged).toContain('卷: "第1卷"');
    });

    it('数组值序列化为 YAML 内联', () => {
        const merged = mergeFrontmatterRaw('', { 涉及人物: ['沈砚', '姜晚'] });
        expect(merged).toContain('涉及人物: ["沈砚","姜晚"]');
    });

    it('布尔与数字原样', () => {
        const merged = mergeFrontmatterRaw('', { step_truncated: false, word_count: 4380 });
        expect(merged).toContain('step_truncated: false');
        expect(merged).toContain('word_count: 4380');
    });

    it('空 patch 返回原文', () => {
        expect(mergeFrontmatterRaw('status: written', {})).toBe('status: written');
    });
});

describe('BodyWriter — 覆盖前备份（P0-3）', () => {
    it('无 app 时不尝试备份（解耦模式不报错）', async () => {
        const { BodyWriter } = await import('../../../engine/body-writer');
        const { MockFileSystem } = await import('../../../shared/file-system-port');
        const fs = new MockFileSystem();
        fs.setFile('书/作品信息.md', '# 书');
        fs.setFile('书/03-大纲与章节/正文/第1卷/第1章_正文.md', '---\nstatus: written\n---\n\n# 第1章 旧稿\n\n旧正文内容足够长。');
        const writer = new BodyWriter({ fs });
        const result = await writer.write({
            path: '书/03-大纲与章节/正文/第1卷/第1章_正文.md',
            raw: '# 第1章 新稿\n\n新正文内容足够长。',
            chapterNum: 1,
            chapterName: '第1章',
            volume: '第1卷',
            project: '书',
            writingMode: 'pipeline',
        });
        expect(result.created).toBe(false);
        expect(await fs.read(result.path)).toContain('新正文内容');
    });

    it('backupBeforeOverwrite=false 时即便有 app 也跳过', async () => {
        const { BodyWriter } = await import('../../../engine/body-writer');
        const { MockFileSystem } = await import('../../../shared/file-system-port');
        const fs = new MockFileSystem();
        fs.setFile('书/作品信息.md', '# 书');
        fs.setFile('书/正文/第1章_正文.md', '旧正文内容足够长。');
        const app = {} as never;
        const writer = new BodyWriter({ app, fs });
        const result = await writer.write({
            path: '书/正文/第1章_正文.md',
            raw: '# 第1章 新稿\n\n新正文内容足够长。',
            chapterNum: 1,
            chapterName: '第1章',
            project: '书',
            writingMode: 'pipeline',
            backupBeforeOverwrite: false,
        });
        expect(result.created).toBe(false);
    });
});
