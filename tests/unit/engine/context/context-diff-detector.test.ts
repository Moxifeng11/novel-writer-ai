/**
 * context-diff-detector.test.ts — 上下文变更检测器单元测试
 *
 * 覆盖：
 * - detectChanges: 各种变更类型的识别
 * - getAffectedSections: 返回受影响分区
 * - createChangeSetFromPaths: 文件路径到变更集的映射
 * - 变更范围计算与回退阈值
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextDiffDetector, INCREMENTAL_FALLBACK_THRESHOLD } from '../../../../engine/context/context-diff-detector';
import type { ContextChangeSet } from '../../../../engine/context/context-diff-detector';
import type { GatheredContext } from '../../../../engine/context/context-types';
import { pjTimelineBoard, pjForeshadowDB, pjWritingRulesTemplate } from '../../../../shared/paths';

describe('ContextDiffDetector', () => {
    let detector: ContextDiffDetector;

    beforeEach(() => {
        detector = new ContextDiffDetector();
    });

    // ── 辅助函数 ────────────────────────────────────────────

    function makeContext(data: Partial<GatheredContext['data']> = {}): GatheredContext {
        return {
            project: '测试项目',
            gatheredAt: new Date().toISOString(),
            data: { ...data },
            issues: [],
        };
    }

    // ============================================================
    // detectChanges - 变更检测
    // ============================================================

    describe('detectChanges - 变更检测', () => {
        it('两个完全相同的上下文返回空变更集', () => {
            const ctx = makeContext({
                character_state: [{ name: '主角' } as any],
                world_view: { raw: '世界观内容', sections: [] },
            });
            const changeSet = detector.detectChanges(ctx, ctx);
            expect(changeSet.changes).toHaveLength(0);
            expect(changeSet.affectedSections).toHaveLength(0);
            expect(changeSet.changeScope).toBe(0);
        });

        it('检测人物信息变更（character_state）', () => {
            const oldCtx = makeContext({
                character_state: [{ name: '主角', 年龄: '25' } as any],
            });
            const newCtx = makeContext({
                character_state: [{ name: '主角', 年龄: '26' } as any],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes).toHaveLength(1);
            expect(changeSet.changes[0].type).toBe('character-changed');
            expect(changeSet.affectedSections).toContain('character_state');
        });

        it('检测人物新增', () => {
            const oldCtx = makeContext({
                character_state: [{ name: '主角' } as any],
            });
            const newCtx = makeContext({
                character_state: [
                    { name: '主角' } as any,
                    { name: '配角' } as any,
                ],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('character-changed');
            expect(changeSet.changes[0].affectedIds).toContain('配角');
        });

        it('检测人物删除', () => {
            const oldCtx = makeContext({
                character_state: [
                    { name: '主角' } as any,
                    { name: '配角' } as any,
                ],
            });
            const newCtx = makeContext({
                character_state: [{ name: '主角' } as any],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('character-changed');
            expect(changeSet.changes[0].affectedIds).toContain('配角');
        });

        it('检测世界观变更', () => {
            const oldCtx = makeContext({
                world_view: { raw: '旧世界观', sections: [] },
            });
            const newCtx = makeContext({
                world_view: { raw: '新世界观', sections: [] },
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('worldview-changed');
            expect(changeSet.affectedSections).toContain('world_view');
        });

        it('检测时间线变更', () => {
            const oldCtx = makeContext({
                timeline: [{ time: '元年', chapter: '第1章', event: '事件A', impact: '' }],
            });
            const newCtx = makeContext({
                timeline: [{ time: '元年', chapter: '第1章', event: '事件B', impact: '' }],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('timeline-changed');
            expect(changeSet.affectedSections).toContain('timeline');
        });

        it('检测伏笔变更', () => {
            const oldCtx = makeContext({
                foreshadows: {
                    unrevealed: [{ id: 'F1', name: '伏笔1' }],
                    revealed: [],
                    abandoned: [],
                },
            });
            const newCtx = makeContext({
                foreshadows: {
                    unrevealed: [{ id: 'F1', name: '伏笔1-修改' }],
                    revealed: [],
                    abandoned: [],
                },
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('timeline-changed');
            expect(changeSet.affectedSections).toContain('foreshadows');
        });

        it('检测地点变更（entity-changed）', () => {
            const oldCtx = makeContext({
                locations: [{ name: '青云宗' } as any],
            });
            const newCtx = makeContext({
                locations: [{ name: '青云宗-修改' } as any],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('entity-changed');
            expect(changeSet.affectedSections).toContain('locations');
        });

        it('检测势力变更（entity-changed）', () => {
            const oldCtx = makeContext({
                factions: [{ name: '魔门' } as any],
            });
            const newCtx = makeContext({
                factions: [{ name: '魔门-改名' } as any],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('entity-changed');
            expect(changeSet.affectedSections).toContain('factions');
        });

        it('检测物品变更（entity-changed）', () => {
            const oldCtx = makeContext({
                items: [{ name: '诛仙剑' } as any],
            });
            const newCtx = makeContext({
                items: [{ name: '诛仙剑-升级' } as any],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('entity-changed');
            expect(changeSet.affectedSections).toContain('items');
        });

        it('检测章节大纲变更（chapter-changed）', () => {
            const oldCtx = makeContext({
                outline: { raw: '旧大纲', sections: [] },
            });
            const newCtx = makeContext({
                outline: { raw: '新大纲', sections: [] },
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes[0].type).toBe('chapter-changed');
            expect(changeSet.affectedSections).toContain('outline');
        });

        it('检测多个分区同时变更', () => {
            const oldCtx = makeContext({
                character_state: [{ name: '主角' } as any],
                world_view: { raw: '旧', sections: [] },
                timeline: [{ time: 't1', chapter: 'c1', event: 'e1', impact: '' }],
            });
            const newCtx = makeContext({
                character_state: [{ name: '主角-改' } as any],
                world_view: { raw: '新', sections: [] },
                timeline: [{ time: 't1', chapter: 'c1', event: 'e2', impact: '' }],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes.length).toBe(3);
            expect(changeSet.affectedSections).toContain('character_state');
            expect(changeSet.affectedSections).toContain('world_view');
            expect(changeSet.affectedSections).toContain('timeline');
        });

        it('null 与 undefined 视为相等（无变更）', () => {
            const oldCtx = makeContext({ world_view: null });
            const newCtx = makeContext({ world_view: undefined });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changes).toHaveLength(0);
        });

        it('null 与有值视为变更', () => {
            const oldCtx = makeContext({ world_view: null });
            const newCtx = makeContext({
                world_view: { raw: '新内容', sections: [] },
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.affectedSections).toContain('world_view');
        });

        it('changeScope 计算正确', () => {
            const oldCtx = makeContext({
                character_state: [{ name: '主角' } as any],
            });
            const newCtx = makeContext({
                character_state: [{ name: '主角-改' } as any],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            // character_state, character_cores, triggered_memories 都属于 character-changed
            // 但只有 character_state 变了，所以 changeScope = 1 / 总分区数
            expect(changeSet.changeScope).toBeGreaterThan(0);
            expect(changeSet.changeScope).toBeLessThan(1);
        });
    });

    // ============================================================
    // getAffectedSections
    // ============================================================

    describe('getAffectedSections - 获取受影响分区', () => {
        it('返回变更集中的分区列表', () => {
            const changeSet: ContextChangeSet = {
                changes: [{ type: 'character-changed', affectedIds: ['主角'], affectedPaths: [], timestamp: 0 }],
                affectedSections: ['character_state', 'character_cores'],
                changeScope: 0.1,
                detectedAt: 0,
            };
            const sections = detector.getAffectedSections(changeSet);
            expect(sections).toContain('character_state');
            expect(sections).toContain('character_cores');
            expect(sections).toHaveLength(2);
        });

        it('返回的是副本，修改不影响原对象', () => {
            const changeSet: ContextChangeSet = {
                changes: [],
                affectedSections: ['world_view'],
                changeScope: 0.05,
                detectedAt: 0,
            };
            const sections = detector.getAffectedSections(changeSet);
            sections.push('new_section');
            expect(changeSet.affectedSections).not.toContain('new_section');
        });
    });

    // ============================================================
    // createChangeSetFromPaths - 文件路径映射
    // ============================================================

    describe('createChangeSetFromPaths - 文件路径映射', () => {
        const project = '测试小说';

        it('人物文件路径映射到 character-changed', () => {
            const paths = [`${project}/01-世界架构/人物/主角.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('character-changed');
            expect(changeSet.changes[0].affectedIds).toContain('主角');
            expect(changeSet.affectedSections).toContain('character_state');
            expect(changeSet.affectedSections).toContain('character_cores');
            expect(changeSet.affectedSections).toContain('triggered_memories');
        });

        it('地点文件路径映射到 entity-changed', () => {
            const paths = [`${project}/01-世界架构/地点/青云宗.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('entity-changed');
            expect(changeSet.affectedSections).toContain('locations');
        });

        it('势力文件路径映射到 entity-changed', () => {
            const paths = [`${project}/01-世界架构/势力/魔门.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('entity-changed');
            expect(changeSet.affectedSections).toContain('factions');
        });

        it('物品文件路径映射到 entity-changed', () => {
            const paths = [`${project}/01-世界架构/物品功法/诛仙剑.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('entity-changed');
            expect(changeSet.affectedSections).toContain('items');
        });

        it('世界观总览文件路径映射到 worldview-changed', () => {
            const paths = [`${project}/01-世界架构/世界观总览.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('worldview-changed');
            expect(changeSet.affectedSections).toContain('world_view');
        });

        it('设定库文件路径映射到 worldview-changed', () => {
            const paths = [`${project}/01-世界架构/设定库.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('worldview-changed');
            expect(changeSet.affectedSections).toContain('setting_lib');
        });

        it('时间线看板文件路径映射到 timeline-changed', () => {
            const paths = [pjTimelineBoard(project)];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('timeline-changed');
            expect(changeSet.affectedSections).toContain('timeline');
        });

        it('伏笔库文件路径映射到 timeline-changed', () => {
            const paths = [pjForeshadowDB(project)];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('timeline-changed');
            expect(changeSet.affectedSections).toContain('foreshadows');
        });

        it('写作规则文件路径映射到 worldview-changed', () => {
            const paths = [pjWritingRulesTemplate()];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('worldview-changed');
            expect(changeSet.affectedSections).toContain('writing_rules');
        });

        it('章节正文文件路径映射到 chapter-changed', () => {
            const paths = [`${project}/03-大纲与章节/正文/第1卷/第1章_正文.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('chapter-changed');
            expect(changeSet.affectedSections).toContain('previous_chapter');
            expect(changeSet.affectedSections).toContain('outline');
        });

        it('步骤结果文件路径映射到 chapter-changed', () => {
            const paths = [`${project}/03-大纲与章节/步骤结果/第1卷/第1章/第1章-大纲摘要.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes[0].type).toBe('chapter-changed');
        });

        it('多个文件路径合并同类型变更', () => {
            const paths = [
                `${project}/01-世界架构/人物/主角.md`,
                `${project}/01-世界架构/人物/配角.md`,
            ];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes).toHaveLength(1);
            expect(changeSet.changes[0].affectedIds).toContain('主角');
            expect(changeSet.changes[0].affectedIds).toContain('配角');
            expect(changeSet.changes[0].affectedPaths).toHaveLength(2);
        });

        it('不同类型文件路径生成多个变更条目', () => {
            const paths = [
                `${project}/01-世界架构/人物/主角.md`,
                `${project}/01-世界架构/地点/青云宗.md`,
            ];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes).toHaveLength(2);
            const types = changeSet.changes.map(c => c.type);
            expect(types).toContain('character-changed');
            expect(types).toContain('entity-changed');
        });

        it('无关文件路径被忽略', () => {
            const paths = [`${project}/无关文件.md`];
            const changeSet = detector.createChangeSetFromPaths(paths, project);
            expect(changeSet.changes).toHaveLength(0);
            expect(changeSet.affectedSections).toHaveLength(0);
            expect(changeSet.changeScope).toBe(0);
        });

        it('空路径列表返回空变更集', () => {
            const changeSet = detector.createChangeSetFromPaths([], project);
            expect(changeSet.changes).toHaveLength(0);
            expect(changeSet.changeScope).toBe(0);
        });
    });

    // ============================================================
    // 回退阈值
    // ============================================================

    describe('回退阈值', () => {
        it('INCREMENTAL_FALLBACK_THRESHOLD 为 0.5（50%）', () => {
            expect(INCREMENTAL_FALLBACK_THRESHOLD).toBe(0.5);
        });

        it('变更范围低于阈值时不应回退', () => {
            const oldCtx = makeContext({
                character_state: [{ name: '主角' } as any],
            });
            const newCtx = makeContext({
                character_state: [{ name: '主角-改' } as any],
            });
            const changeSet = detector.detectChanges(oldCtx, newCtx);
            expect(changeSet.changeScope).toBeLessThanOrEqual(INCREMENTAL_FALLBACK_THRESHOLD);
        });
    });
});
