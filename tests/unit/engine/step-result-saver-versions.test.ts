import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { StepResultSaver } from '../../../engine/step-result-saver';
import { MockFileSystem, type FrontmatterPort } from '../../../shared/file-system-port';

class FakeFrontmatter implements FrontmatterPort {
    states = new Map<string, Record<string, unknown>>();

    async processFrontmatter(file: TFile, updater: (fm: Record<string, unknown>) => void): Promise<void> {
        const fm = { ...(this.states.get(file.path) || {}) };
        updater(fm);
        this.states.set(file.path, fm);
    }
}

function setup() {
    const fs = new MockFileSystem();
    const frontmatter = new FakeFrontmatter();
    const saver = new StepResultSaver({ fs, frontmatter });
    return { fs, frontmatter, saver };
}

const ANALYSIS = '# 报告\n问题：主角动机不够明确。\n总结：整体合格，建议加强冲突。';

describe('StepResultSaver — 版本归因 frontmatter（v4.23）', () => {
    it('写入模板/规则/人味/实验组六个字段', async () => {
        const { fs, frontmatter, saver } = setup();
        const chapDir = '书甲/03-大纲与章节/步骤结果/第1卷/第1章';
        const target = `${chapDir}/第1章_分析报告.md`;

        await saver.saveStepResult('analysisReport', ANALYSIS, chapDir, '第1章', '第1卷', {
            model: 'flash-real',
            templateId: 'analysisReport.v1',
            templateVersion: '1.5.0',
            rulesVersion: '3.6.0',
            rulesHash: 'a1b2c3d4',
            voiceMode: 'exemplar',
            experimentGroup: 'R1-G2',
        });

        const fm = frontmatter.states.get(target) || {};
        expect(fm['step_template_id']).toBe('analysisReport.v1');
        expect(fm['step_template_version']).toBe('1.5.0');
        expect(fm['step_rules_version']).toBe('3.6.0');
        expect(fm['step_rules_hash']).toBe('a1b2c3d4');
        expect(fm['step_voice_mode']).toBe('exemplar');
        expect(fm['step_experiment_group']).toBe('R1-G2');
        // 原有元数据不受影响
        expect(fm['step_model']).toBe('flash-real');
        expect(await fs.read(target)).not.toContain('step_template_id');
    });

    it('缺省版本字段不写入（避免老数据被刷成空值）', async () => {
        const { frontmatter, saver } = setup();
        const chapDir = '书甲/03-大纲与章节/步骤结果/第1卷/第1章';
        const target = `${chapDir}/第1章_分析报告.md`;

        await saver.saveStepResult('analysisReport', ANALYSIS, chapDir, '第1章', '第1卷', { model: 'flash-real' });

        const fm = frontmatter.states.get(target) || {};
        for (const key of ['step_template_id', 'step_template_version', 'step_rules_version', 'step_rules_hash', 'step_voice_mode', 'step_experiment_group']) {
            expect(fm[key]).toBeUndefined();
        }
    });

    it('多次保存时旧版本字段被覆盖而不是堆叠', async () => {
        const { frontmatter, saver } = setup();
        const chapDir = '书甲/03-大纲与章节/步骤结果/第1卷/第1章';
        const target = `${chapDir}/第1章_分析报告.md`;

        await saver.saveStepResult('analysisReport', ANALYSIS, chapDir, '第1章', '第1卷', {
            templateVersion: '1.5.0', rulesVersion: '3.6.0', voiceMode: 'quota', experimentGroup: 'R1-G0',
        });
        await saver.saveStepResult('analysisReport', ANALYSIS, chapDir, '第1章', '第1卷', {
            templateVersion: '1.6.0', rulesVersion: '3.6.0-legacy', voiceMode: 'exemplar', experimentGroup: 'R1-G2',
        });

        const fm = frontmatter.states.get(target) || {};
        expect(fm['step_template_version']).toBe('1.6.0');
        expect(fm['step_rules_version']).toBe('3.6.0-legacy');
        expect(fm['step_voice_mode']).toBe('exemplar');
        expect(fm['step_experiment_group']).toBe('R1-G2');
    });

    it('contextBudget 写入 context_budget frontmatter（B8 预算恢复可观测）', async () => {
        const { fs, frontmatter, saver } = setup();
        const chapDir = '书甲/03-大纲与章节/步骤结果/第1卷/第1章';
        const target = `${chapDir}/第1章_质量控制.md`;

        await saver.saveStepResult('qualityControl', ANALYSIS, chapDir, '第1章', '第1卷', {
            model: 'flash-real',
            contextBudget: '压缩 2 段 · 已定向补检 · 输入 ~3200/120000 token',
        });

        const fm = frontmatter.states.get(target) || {};
        expect(fm['context_budget']).toBe('压缩 2 段 · 已定向补检 · 输入 ~3200/120000 token');
        // 不进正文，只进 frontmatter
        expect(await fs.read(target)).not.toContain('context_budget');
    });
});
