import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { StepResultSaver } from '../../../engine/step-result-saver';
import { MockFileSystem, type FrontmatterPort } from '../../../shared/file-system-port';
import { pjBodyFile } from '../../../shared/paths';

class FakeFrontmatter implements FrontmatterPort {
    states = new Map<string, Record<string, unknown>>();

    async processFrontmatter(file: TFile, updater: (fm: Record<string, unknown>) => void): Promise<void> {
        const fm = { ...(this.states.get(file.path) || {}) };
        updater(fm);
        this.states.set(file.path, fm);
    }
}

function completeBody(): string {
    return '# 第1章 试炼\n\n' + Array.from(
        { length: 220 },
        (_, i) => `他低声说：「第${i}句对话，风从袖口灌进来。」然后收声。`,
    ).join('\n');
}

describe('StepResultSaver — M1 数据完整性', () => {
    it('analysisReport 保存时剥离完整 frontmatter，不把 YAML 键留在正文', async () => {
        const fs = new MockFileSystem();
        const frontmatter = new FakeFrontmatter();
        const saver = new StepResultSaver({ fs, frontmatter });
        const chapDir = '书甲/03-大纲与章节/步骤结果/第1卷/第1章';
        const target = `${chapDir}/第1章_分析报告.md`;

        const content = [
            '---',
            'tags:',
            '  - 分析报告',
            'source: model',
            '---',
            '# 报告',
            '问题：主角动机不够明确。',
            '总结：整体合格，建议加强冲突。',
            '第1节：开篇节奏正常。',
        ].join('\n');

        const saved = await saver.saveStepResult('analysisReport', content, chapDir, '第1章', '第1卷', {
            model: 'flash-real',
            finishReason: 'stop',
            truncated: false,
        });

        expect(saved).toBe(true);
        const written = await fs.read(target);
        expect(written.startsWith('# 报告')).toBe(true);
        expect(written).not.toContain('source: model');
        expect(frontmatter.states.get(target)?.['step_model']).toBe('flash-real');
        expect(frontmatter.states.get(target)?.['step_status']).toBe('generated');
    });

    it('截断正文不覆盖已有完整正文，改为写独立草稿', async () => {
        const fs = new MockFileSystem();
        const frontmatter = new FakeFrontmatter();
        const saver = new StepResultSaver({ fs, frontmatter });
        const project = '书甲';
        const chapDir = '书甲/03-大纲与章节/步骤结果/第1卷/第1章';
        const bodyPath = pjBodyFile(project, 1, 1);
        const original = completeBody();
        fs.setFile(bodyPath, original);

        const truncated = '# 第1章 试炼\n\n他抬手，话说到一半就被截';
        const saved = await saver.saveStepResult(
            'bodyGeneration',
            truncated,
            chapDir,
            '第1章',
            '第1卷',
            { model: 'pro-real', finishReason: 'length', truncated: true },
        );

        expect(saved).toBe(true);
        expect(await fs.read(bodyPath)).toBe(original);
        const draftPath = bodyPath.replace(/\.md$/i, '_截断草稿.md');
        expect(await fs.exists(draftPath)).toBe(true);
        expect(await fs.read(draftPath)).toContain('话说到一半');
    });
});
