/**
 * project-side-panel 快捷动作清单测试
 *
 * 锁住「新能力有入口」：规划画布与设定实体图必须出现在合适的文件类型动作里。
 */

import { describe, expect, it } from 'vitest';
import { actionsForKind } from '@/ui/project-side-panel-view';

/** 取某类型的动作 id 列表。 */
const idsOf = (kind: Parameters<typeof actionsForKind>[0]): string[] =>
    actionsForKind(kind).map(action => action.id);

describe('快捷动作 · 入口覆盖', () => {
    it('正文文件提供「规划画布」入口（故事结构就在正文上下文里）', () => {
        expect(idsOf('body')).toContain('open-planning');
    });

    it('实体文件（人物/地点/势力/物品）提供「设定实体图」入口', () => {
        for (const kind of ['character', 'location', 'faction', 'item'] as const) {
            expect(idsOf(kind), kind).toContain('open-memory-graph');
        }
    });

    it('设定类文件（世界观/设定库/伏笔/时间线）同时提供实体图与规划画布', () => {
        for (const kind of ['worldview', 'settingLib', 'foreshadow', 'timeline'] as const) {
            expect(idsOf(kind), kind).toContain('open-memory-graph');
            expect(idsOf(kind), kind).toContain('open-planning');
        }
    });

    it('步骤结果文件不塞规划入口（避免动作面板噪音）', () => {
        expect(idsOf('step')).not.toContain('open-planning');
    });

    it('每个动作都有标签与图标', () => {
        for (const kind of ['body', 'character', 'worldview', 'step'] as const) {
            for (const action of actionsForKind(kind)) {
                expect(action.label.length, action.id).toBeGreaterThan(0);
                expect(action.icon.length, action.id).toBeGreaterThan(0);
            }
        }
    });
});
