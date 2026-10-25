import { describe, it, expect, beforeEach } from 'vitest';
import { App, TFile, TFolder } from 'obsidian';
import { StepResultSaver } from '../../../engine/step-result-saver';
import { MockFileSystem } from '../../../shared/file-system-port';
import { ChapterStateManager } from '../../../ui/states/chapter-state-manager';
import { isStepResultComplete } from '../../../engine/step-validator';

const CHAP_DIR = '测试项目/03-大纲与章节/步骤结果/第1卷/第1章';

/** 骨架：有标题结构，但没有实质内容（正是批量建章预生成的模板形态） */
const SKELETON_OUTLINE = `# 第1章 · 大纲摘要

> 核心冲突：（待定）

（待补充）`;

/** 完整大纲：三个必填模块都有实质内容 */
const COMPLETE_OUTLINE = `# 第1章 · 大纲摘要

## 全书定位
本章是开篇后的第一次正面冲突，承担交代主角处境与引出反派的任务。

## 关键场景
| 序号 | 场景 | 地点 | 人物 |
| --- | --- | --- | --- |
| 1 | 主角在集市被围堵 | 集市 | 主角、反派 |
| 2 | 主角反击并暴露底牌 | 集市 | 主角、旁观者 |
| 3 | 幕后势力介入 | 暗巷 | 神秘人 |

## 结尾钩子
神秘人留下半枚玉佩，主角发现与父亲遗物一模一样。`;

/** 覆盖 getFile，使 saver 能进入 frontmatter 分支（MockFileSystem 默认返回普通对象） */
class FrontmatterTestFS extends MockFileSystem {
    async getFile(path: string): Promise<TFile | null> {
        const file = new TFile();
        file.path = path;
        file.name = path.split('/').pop() || '';
        return file;
    }
}

function makeApp(): App {
    return {
        vault: {
            getAbstractFileByPath: () => null,
            getFiles: () => [],
        },
    } as unknown as App;
}

describe('A4-1 StepResultSaver 落盘状态由内容结构决定', () => {
    let fs: FrontmatterTestFS;
    let captured: Record<string, unknown>;

    beforeEach(() => {
        fs = new FrontmatterTestFS();
        captured = {};
    });

    const makeSaver = () => new StepResultSaver({
        app: makeApp(),
        fs,
        frontmatter: {
            processFrontmatter: async (_file: TFile, updater: (fm: Record<string, unknown>) => void) => {
                captured = {};
                updater(captured);
            },
        },
    });

    it('模板骨架写入 → step_status=partial，不得标成 generated', async () => {
        const saved = await makeSaver().saveStepResult('outline', SKELETON_OUTLINE, CHAP_DIR, '第1章', '第1卷');
        expect(saved).toBe(true);
        expect(captured['step_status']).toBe('partial');
    });

    it('结构完整写入 → step_status=generated', async () => {
        const saved = await makeSaver().saveStepResult('outline', COMPLETE_OUTLINE, CHAP_DIR, '第1章', '第1卷');
        expect(saved).toBe(true);
        expect(captured['step_status']).toBe('generated');
    });
});

describe('A4-2 restoreChapterState 不再信任 generated 标记', () => {
    it('旧数据 generated + 骨架内容 → 恢复后不算完成', async () => {
        const app = new App();
        const folder = new TFolder();
        folder.path = CHAP_DIR;
        folder.name = '第1章';
        const file = new TFile();
        file.path = `${CHAP_DIR}/第1章_大纲摘要.md`;
        file.name = '第1章_大纲摘要.md';
        file.parent = folder;
        folder.children = [file];

        app.vault.getAbstractFileByPath = () => folder;
        app.vault.read = async () => SKELETON_OUTLINE;
        app.metadataCache.getFileCache = () => ({ frontmatter: { step_status: 'generated' } });

        const mgr = new ChapterStateManager(app);
        await mgr.restoreChapterState(CHAP_DIR);

        expect(mgr.stepCompleted.has('outline')).toBe(false);
        expect(mgr.stepLevels['outline']).not.toBe('complete');
    });
});

describe('A4-3 / A4-4 完成度统一由 validateStepResult 决定', () => {
    it('手动保存骨架内容（不带 forceComplete）→ 不推进为完成', () => {
        const mgr = new ChapterStateManager({} as App);
        mgr.updateStepState('outline', SKELETON_OUTLINE);
        expect(mgr.stepCompleted.has('outline')).toBe(false);
        expect(mgr.stepMissing['outline'].length).toBeGreaterThan(0);
    });

    it('批量续跑：非空骨架不算完成，完整内容才算完成', () => {
        expect(isStepResultComplete('outline', SKELETON_OUTLINE)).toBe(false);
        expect(isStepResultComplete('outline', COMPLETE_OUTLINE)).toBe(true);
    });
});
