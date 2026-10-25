import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Rev 185 源码契约：
 *   1. 步骤完成 = 结构校验 complete（保存成功/字符数够都不算）
 *   2. 上下文加载步骤有输入清单与完整性判定，不再无条件标完成
 *   3. 章节选择器按「项目/卷/章」复用标签页，并同步旧标签页数据
 * 只做源码文本对账，避免 vitest 拉起 Obsidian API。
 */

const ROOT = path.resolve(__dirname, '../../..');

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Rev 185 · 步骤完成度以结构校验为准', () => {
    it('单步生成保存后必须过 validateStepResult，不完整则撤销完成态', () => {
        const src = read('engine/step-runner.ts');
        expect(src).toContain('const verdict = validateStepResult(stepKey, finalContent)');
        expect(src).toContain("if (verdict.level === 'complete')");
        expect(src).toContain('ctx.stepCompleted.delete(stepKey)');
        expect(src).toContain('已保存但内容不完整');
    });

    it('合并规划把结构校验作为 generated 的必要条件', () => {
        const src = read('engine/step-runner.ts');
        expect(src).toContain('evaluateCombinedPlanning(');
        expect(src).toMatch(/\(key, moduleContent\)\s*=>\s*validateStepResult\(key, moduleContent\)\.level === 'complete'/);
    });

    it('evaluateCombinedPlanning 支持 isValid 谓词且默认行为不变', () => {
        const src = read('engine/planning-combined.ts');
        expect(src).toContain('isValid?: (key: CombinedPlanningStepKey, content: string) => boolean');
        expect(src).toContain('return isValid ? isValid(key, content) : true;');
    });

    it('章节状态恢复不再无条件把 context 标完成', () => {
        const src = read('ui/states/chapter-state-manager.ts');
        expect(src).not.toContain("this.stepLevels['context'] = 'complete'");
        expect(src).not.toContain("this.stepCompleted.add('context')");
        expect(src).toContain('其状态由 ContextLoaderController.loadContext()');
    });
});

describe('Rev 185 · 上下文加载步骤显示输入并判定完整性', () => {
    it('loadContext 用 assessContextReadiness 决定 complete/partial', () => {
        const src = read('ui/full-writer/context-loader-controller.ts');
        expect(src).toContain('assessContextReadiness(context, this.deps.state.chapterNum)');
        expect(src).toContain("cs.stepLevels['context'] = 'complete'");
        expect(src).toContain("cs.stepLevels['context'] = 'partial'");
        expect(src).toContain('上下文缺少必做输入');
    });

    it('角色灵魂自动提取保存后还要过结构校验', () => {
        const src = read('ui/full-writer/context-loader-controller.ts');
        expect(src).toContain("validateStepResult('characterSoul', allSouls)");
        expect(src).toContain('saved && soulVerdict.level');
    });

    it('上下文步骤渲染输入清单与重新加载入口', () => {
        const src = read('ui/full-writer/step-render-controller.ts');
        expect(src).toContain('renderContextInputs');
        expect(src).toContain('novel-writer-fw-context-input-row');
        expect(src).toContain('🔄 重新加载上下文');
        expect(src).toContain('reloadContext: () => Promise<void>');
        expect(src).not.toContain("area.createEl('p', { text: '✅ 上下文已加载完成。'");
    });

    it('宿主视图注入 getContext/getChapterNum/reloadContext', () => {
        const src = read('ui/full-writer-view.ts');
        expect(src).toContain('getContext: () => this.context');
        expect(src).toContain('getChapterNum: () => this.chapterNum');
        expect(src).toContain('reloadContext: async () => {');
    });

    it('CSS 定义了输入清单样式', () => {
        const css = read('styles.css');
        expect(css).toContain('.novel-writer-fw-context-readiness');
        expect(css).toContain('.novel-writer-fw-context-input-row');
        expect(css).toContain('.novel-writer-fw-context-input-detail');
    });
});

describe('Rev 185 · 章节选择器切换加固', () => {
    it('chapterKey 带卷，复用标签页时同步章节字段', () => {
        const src = read('ui/full-writer/tab-controller.ts');
        expect(src).toContain('const chapKey = `${project}/${volumeKey}/${chapter.chapter}`');
        expect(src).toContain('existingTab.chapterName = chapter.chapter');
        expect(src).toContain('existingTab.volume = chapter.volume');
        expect(src).toContain('existingTab.chapDir = chapDir || existingTab.chapDir');
    });

    it('切换后校验当前章节，失败有明确提示', () => {
        const src = read('ui/full-writer/tab-controller.ts');
        expect(src).toContain("if (this.deps.state.chapterName !== chapter.chapter)");
        expect(src).toContain('章节切换未生效');
    });

    it('标题栏选择器仍绑定 change → selectChapter', () => {
        const src = read('ui/full-writer/title-bar-controller.ts');
        expect(src).toContain('chapterSelectEl.onchange');
        expect(src).toContain('selectChapter(this.deps.state.project');
    });
});
