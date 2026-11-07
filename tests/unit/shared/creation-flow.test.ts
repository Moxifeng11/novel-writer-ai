import { describe, expect, it } from 'vitest';
import type { CreationMode } from '../../../shared/creation-mode';
import {
    getCreationFlowStages,
    hasMeaningfulDocContent,
    resolveCreationFlow,
    type CreationFlowFacts,
} from '../../../shared/creation-flow';

function facts(overrides: Partial<CreationFlowFacts> = {}): CreationFlowFacts {
    return {
        preResearchDone: false,
        docs: {},
        unitTotal: 0,
        unitTarget: 20,
        unitWritten: 0,
        unitSettled: 0,
        nextUnitNumber: null,
        exportExists: false,
        ...overrides,
    };
}

const MODES: CreationMode[] = ['long', 'short', 'script'];

describe('creation-flow — 阶段定义', () => {
    it('三种模式的权重之和都是 1，阶段 id 唯一', () => {
        for (const mode of MODES) {
            const stages = getCreationFlowStages(mode);
            const total = stages.reduce((sum, stage) => sum + stage.weight, 0);
            expect(total).toBeCloseTo(1, 5);
            expect(new Set(stages.map(stage => stage.id)).size).toBe(stages.length);
        }
    });

    it('短篇 4 阶段、剧本 5 阶段、长篇 4 阶段', () => {
        expect(getCreationFlowStages('short').map(s => s.id)).toEqual(['research', 'outline', 'units', 'export']);
        expect(getCreationFlowStages('script').map(s => s.id)).toEqual(['research', 'outline', 'storyboard', 'units', 'export']);
        expect(getCreationFlowStages('long').map(s => s.id)).toEqual(['wizard', 'chapters', 'settlement', 'export']);
    });
});

describe('creation-flow — 短篇', () => {
    it('全新项目：调研 active，其后阶段 blocked 且带原因', () => {
        const snapshot = resolveCreationFlow('short', '新短篇', facts());
        expect(snapshot.overallRatio).toBe(0);
        expect(snapshot.nextStageId).toBe('research');
        expect(snapshot.stages.map(s => s.state)).toEqual(['active', 'blocked', 'blocked', 'blocked']);
        expect(snapshot.stages[1].blockedReason).toContain('前期调研');
    });

    it('调研完成：大纲 active，写作 blocked', () => {
        const snapshot = resolveCreationFlow('short', '短篇', facts({ preResearchDone: true }));
        expect(snapshot.stages.map(s => s.state)).toEqual(['done', 'active', 'blocked', 'blocked']);
        expect(snapshot.nextStageId).toBe('outline');
    });

    it('没有骨架时主按钮是创建骨架，文案带目标数量', () => {
        const snapshot = resolveCreationFlow('short', '短篇', facts({
            preResearchDone: true,
            docs: { outline: true },
            unitTarget: 30,
        }));
        const units = snapshot.stages[2];
        expect(units.primaryAction).toBe('create-units');
        expect(units.ctaLabel).toBe('创建 30 节骨架');
        expect(units.progressText).toBe('尚未创建节骨架');
    });

    it('3/20 已写：进度 15%，CTA 指向第 4 节', () => {
        const snapshot = resolveCreationFlow('short', '短篇', facts({
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 20,
            unitWritten: 3,
            nextUnitNumber: 4,
        }));
        const units = snapshot.stages[2];
        expect(units.state).toBe('active');
        expect(units.ratio).toBeCloseTo(0.15, 5);
        expect(units.progressText).toBe('3/20 节已写');
        expect(units.ctaLabel).toBe('继续写第4节');
        expect(units.primaryAction).toBe('write-unit');
        // 0.15*1 + 0.1*1 + 0.6*0.15 = 0.34
        expect(snapshot.overallRatio).toBe(0.34);
        expect(snapshot.nextUnitNumber).toBe(4);
    });

    it('全部写完且已导出才是 100%', () => {
        const allWritten = resolveCreationFlow('short', '短篇', facts({
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 10,
            unitWritten: 10,
            nextUnitNumber: null,
        }));
        expect(allWritten.overallRatio).toBeCloseTo(0.85, 5);
        expect(allWritten.nextStageId).toBe('export');
        expect(allWritten.stages[3].ctaLabel).toBe('导出当前成稿');

        const exported = resolveCreationFlow('short', '短篇', facts({
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 10,
            unitWritten: 10,
            nextUnitNumber: null,
            exportExists: true,
        }));
        expect(exported.overallRatio).toBe(1);
        expect(exported.nextStageId).toBe('');
    });

    it('老项目缺前置但已有正文：前置阶段按既有正文跳过，下一步仍是写作', () => {
        const snapshot = resolveCreationFlow('short', '老短篇', facts({
            unitTotal: 10,
            unitWritten: 5,
            nextUnitNumber: 6,
        }));
        expect(snapshot.stages[0].state).toBe('done');
        expect(snapshot.stages[0].progressText).toBe('已按既有正文跳过');
        expect(snapshot.stages[1].state).toBe('done');
        expect(snapshot.stages[2].state).toBe('active');
        expect(snapshot.stages[2].progressText).toBe('5/10 节已写');
        expect(snapshot.nextStageId).toBe('units');
    });
});

describe('creation-flow — 剧本', () => {
    it('大纲完成后必须先做分镜，写作阶段被分镜表阻塞（2026-11-07 拍板）', () => {
        const snapshot = resolveCreationFlow('script', '剧本', facts({
            preResearchDone: true,
            docs: { outline: true },
            unitTotal: 80,
        }));
        expect(snapshot.stages.map(s => s.id)).toEqual(['research', 'outline', 'storyboard', 'units', 'export']);
        expect(snapshot.stages[2].state).toBe('active');
        expect(snapshot.stages[2].ctaLabel).toBe('编写分镜表');
        expect(snapshot.stages[3].state).toBe('blocked');
        expect(snapshot.stages[3].blockedReason).toBe('先完成：分镜表');
        expect(snapshot.stages[3].ctaLabel).toBe('先完成：分镜表');
    });
});

describe('creation-flow — 长篇', () => {
    it('已有章节骨架时视为初始化完成，不会永远卡在第一步', () => {
        const snapshot = resolveCreationFlow('long', '长篇', facts({
            unitTotal: 12,
            unitWritten: 4,
            unitSettled: 2,
            nextUnitNumber: 5,
        }));
        expect(snapshot.stages[0].state).toBe('done');
        expect(snapshot.stages[1].state).toBe('active');
        expect(snapshot.stages[1].progressText).toBe('4/12 章已写');
        expect(snapshot.stages[1].ctaLabel).toBe('继续写第5章');
        expect(snapshot.stages[2].progressText).toBe('2/12 章已结算（已写 4）');
        expect(snapshot.stages[2].ratio).toBeCloseTo(2 / 12, 5);
    });

    it('只写并结算第 1 章（全书 10 章）不能被判成结算完成', () => {
        const snapshot = resolveCreationFlow('long', '长篇', facts({
            wizardDone: true,
            unitTotal: 10,
            unitWritten: 1,
            unitSettled: 1,
            nextUnitNumber: 2,
        }));
        const settlement = snapshot.stages[2];
        expect(settlement.state).toBe('active');
        expect(settlement.ratio).toBeCloseTo(0.1, 5);
        expect(settlement.progressText).toBe('1/10 章已结算');
        expect(settlement.ctaLabel).toBe('结算下一章');
        // 0.25 + 0.5*0.1 + 0.15*0.1 = 0.315 → 32%
        expect(snapshot.overallRatio).toBe(0.32);
        expect(snapshot.nextStageId).toBe('chapters');
    });

    it('全部结算但未导出：导出阶段 active', () => {
        const snapshot = resolveCreationFlow('long', '长篇', facts({
            wizardDone: true,
            unitTotal: 3,
            unitWritten: 3,
            unitSettled: 3,
            nextUnitNumber: null,
        }));
        expect(snapshot.stages[2].state).toBe('done');
        expect(snapshot.stages[3].state).toBe('active');
        expect(snapshot.nextStageId).toBe('export');
        expect(snapshot.overallRatio).toBeCloseTo(0.9, 5);
    });
});

describe('hasMeaningfulDocContent — 骨架不算完成', () => {
    it('与 starter 完全一致 → 未完成', () => {
        const starter = '# 分节大纲\n\n## 第1节\n- 目标：\n- 冲突：\n';
        expect(hasMeaningfulDocContent(starter, starter)).toBe(false);
        expect(hasMeaningfulDocContent(starter.replace(/\n/g, '\r\n'), starter)).toBe(false);
    });

    it('填写两个字段但增量不足 20 字符 → 仍算完成（实质行数兜底）', () => {
        const starter = '# 标题\n- 目标：\n- 冲突：\n';
        const filled = '# 标题\n- 目标：追回记忆\n- 冲突：反派阻挠';
        expect(hasMeaningfulDocContent(filled, starter)).toBe(true);
    });

    it('只加了一个空字段或标题 → 未完成', () => {
        const starter = '# 故事核\n\n## 一句话故事\n';
        expect(hasMeaningfulDocContent(`${starter}\n## 核心冲突\n`, starter)).toBe(false);
    });

    it('空内容 → 未完成；无 starter 时按长度/实质行判断', () => {
        expect(hasMeaningfulDocContent('', '')).toBe(false);
        expect(hasMeaningfulDocContent('只是一句话', '')).toBe(false);
        expect(hasMeaningfulDocContent('- 目标：找回记忆\n- 冲突：反派阻挠', '')).toBe(true);
    });

    it('分镜表：只保留示例行算未完成，新增一行真实镜头才算完成', () => {
        const starter = [
            '# 分镜表',
            '| 镜号 | 景别 | 角度 | 运镜 | 时长 | 画面 | 动作/表演 | 台词/音效 | 转场 | 目的 |',
            '|---|---|---|---|---|---|---|---|---|---|',
            '| E01-S01-SH01 | 中景 | 平视 | 固定 | 2.5s |  |  |  | 切 |  |',
            '',
        ].join('\n');
        expect(hasMeaningfulDocContent(starter, starter)).toBe(false);

        const withRow = `${starter}\n| E01-S01-SH02 | 近景 | 仰视 | 推镜 | 1.5s | 主角回头 | 震惊 | 心跳声 | 切 | 强调 |\n`;
        expect(hasMeaningfulDocContent(withRow, starter)).toBe(true);
    });
});
