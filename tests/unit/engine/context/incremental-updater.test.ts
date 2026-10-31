/**
 * incremental-updater.test.ts — 增量更新器单元测试
 *
 * 覆盖：
 * - updateContext: 增量更新后结果与全量一致
 * - isIncrementalUpdateFaster: 回退策略判断
 * - 版本号机制: 版本递增、历史记录
 * - MultiLayerCache 集成: 分区缓存命中与未命中
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IncrementalUpdater } from '../../../../engine/context/incremental-updater';
import type { SectionRefetcher, IncrementalUpdaterDeps } from '../../../../engine/context/incremental-updater';
import { ContextDiffDetector, INCREMENTAL_FALLBACK_THRESHOLD } from '../../../../engine/context/context-diff-detector';
import type { ContextChangeSet } from '../../../../engine/context/context-diff-detector';
import { MultiLayerCache } from '../../../../shared/multi-layer-cache';
import type { GatheredContext, ContextData } from '../../../../engine/context/context-types';

describe('IncrementalUpdater', () => {
    let updater: IncrementalUpdater;
    let refetcher: SectionRefetcher;
    let refetchCalls: { section: string; project: string; currentChapter?: string }[];
    let diffDetector: ContextDiffDetector;

    beforeEach(() => {
        refetchCalls = [];
        refetcher = {
            refetchSection: async (project, section, currentChapter) => {
                refetchCalls.push({ section, project, currentChapter });
                // 返回模拟数据
                const data: Partial<ContextData> = {};
                (data as any)[section] = `refetched-${section}-${Date.now()}`;
                return data;
            },
        };
        const deps: IncrementalUpdaterDeps = { refetcher };
        updater = new IncrementalUpdater(deps);
        diffDetector = new ContextDiffDetector();
    });

    function makeContext(data: Partial<ContextData> = {}): GatheredContext {
        return {
            project: '测试项目',
            gatheredAt: new Date().toISOString(),
            data: { ...data },
            issues: [],
        };
    }

    function makeChangeSet(sections: string[]): ContextChangeSet {
        return {
            changes: sections.map(s => ({
                type: 'character-changed' as const,
                affectedIds: [],
                affectedPaths: [],
                timestamp: Date.now(),
            })),
            affectedSections: sections,
            changeScope: sections.length / 18, // 18 = ALL_TRACKED_SECTIONS.length
            detectedAt: Date.now(),
        };
    }

    // ============================================================
    // updateContext - 增量更新
    // ============================================================

    describe('updateContext - 增量更新', () => {
        it('仅重新获取受影响分区', async () => {
            const oldContext = makeContext({
                character_state: [{ name: '主角' } as any],
                world_view: { raw: '世界观', sections: [] },
            });
            const changeSet = makeChangeSet(['character_state']);

            await updater.updateContext(oldContext, changeSet, '测试项目');

            expect(refetchCalls).toHaveLength(1);
            expect(refetchCalls[0].section).toBe('character_state');
        });

        it('未受影响分区保留原数据', async () => {
            const oldContext = makeContext({
                character_state: [{ name: '主角' } as any],
                world_view: { raw: '原始世界观', sections: [] },
            });
            const changeSet = makeChangeSet(['character_state']);

            const result = await updater.updateContext(oldContext, changeSet, '测试项目');

            // world_view 不在受影响列表中，应保留原数据
            expect(result.data.world_view).toEqual({ raw: '原始世界观', sections: [] });
        });

        it('受影响分区被重新获取的数据替换', async () => {
            const oldContext = makeContext({
                character_state: [{ name: '旧主角' } as any],
            });
            const changeSet = makeChangeSet(['character_state']);

            const mockRefetcher: SectionRefetcher = {
                refetchSection: async () => ({
                    character_state: [{ name: '新主角' } as any],
                }),
            };
            const localUpdater = new IncrementalUpdater({ refetcher: mockRefetcher });

            const result = await localUpdater.updateContext(oldContext, changeSet, '测试项目');

            expect((result.data.character_state as any[])[0].name).toBe('新主角');
        });

        it('多个受影响分区都被重新获取', async () => {
            const oldContext = makeContext({
                character_state: [{ name: '主角' } as any],
                world_view: { raw: '旧', sections: [] },
            });
            const changeSet = makeChangeSet(['character_state', 'world_view']);

            await updater.updateContext(oldContext, changeSet, '测试项目');

            expect(refetchCalls).toHaveLength(2);
            const sections = refetchCalls.map(c => c.section);
            expect(sections).toContain('character_state');
            expect(sections).toContain('world_view');
        });

        it('空变更集不触发任何重新获取', async () => {
            const oldContext = makeContext({ world_view: { raw: '不变', sections: [] } });
            const changeSet = makeChangeSet([]);

            const result = await updater.updateContext(oldContext, changeSet, '测试项目');

            expect(refetchCalls).toHaveLength(0);
            expect(result.data.world_view).toEqual({ raw: '不变', sections: [] });
        });

        it('重新获取失败时保留旧数据', async () => {
            const oldContext = makeContext({
                character_state: [{ name: '旧主角' } as any],
            });
            const failingRefetcher: SectionRefetcher = {
                refetchSection: async () => {
                    throw new Error('获取失败');
                },
            };
            const localUpdater = new IncrementalUpdater({ refetcher: failingRefetcher });
            const changeSet = makeChangeSet(['character_state']);

            const result = await localUpdater.updateContext(oldContext, changeSet, '测试项目');

            // 失败时应保留旧数据
            expect((result.data.character_state as any[])[0].name).toBe('旧主角');
        });

        it('currentChapter 传递给 refetcher', async () => {
            const oldContext = makeContext({});
            const changeSet = makeChangeSet(['outline']);

            await updater.updateContext(oldContext, changeSet, '测试项目', '第5章');

            expect(refetchCalls[0].currentChapter).toBe('第5章');
        });
    });

    // ============================================================
    // isIncrementalUpdateFaster - 回退策略
    // ============================================================

    describe('isIncrementalUpdateFaster - 回退策略', () => {
        it('变更范围低于阈值返回 true', () => {
            const changeSet = makeChangeSet(['character_state']);
            expect(updater.isIncrementalUpdateFaster(changeSet)).toBe(true);
        });

        it('变更范围超过阈值返回 false', () => {
            // 创建一个变更范围 > 50% 的变更集
            const manySections = [
                'character_state', 'character_cores', 'triggered_memories',
                'previous_chapter', 'outline', 'emotion_plan', 'scene_expansion',
                'locations', 'factions', 'items',
            ];
            const changeSet: ContextChangeSet = {
                changes: [],
                affectedSections: manySections,
                changeScope: 1.0, // 100%
                detectedAt: Date.now(),
            };
            expect(updater.isIncrementalUpdateFaster(changeSet)).toBe(false);
        });

        it('变更范围等于阈值返回 true', () => {
            const changeSet: ContextChangeSet = {
                changes: [],
                affectedSections: [],
                changeScope: INCREMENTAL_FALLBACK_THRESHOLD,
                detectedAt: Date.now(),
            };
            expect(updater.isIncrementalUpdateFaster(changeSet)).toBe(true);
        });

        it('空变更集返回 true', () => {
            const changeSet = makeChangeSet([]);
            expect(updater.isIncrementalUpdateFaster(changeSet)).toBe(true);
        });
    });

    // ============================================================
    // 版本号机制
    // ============================================================

    describe('版本号机制', () => {
        it('初始版本为 null', () => {
            expect(updater.getCurrentVersion()).toBeNull();
        });

        it('recordVersion 返回递增版本号', () => {
            const v1 = updater.recordVersion(undefined, 'full');
            expect(v1.version).toBe(1);

            const v2 = updater.recordVersion(undefined, 'full');
            expect(v2.version).toBe(2);

            const v3 = updater.recordVersion(undefined, 'full');
            expect(v3.version).toBe(3);
        });

        it('getVersionHistory 返回所有版本', () => {
            updater.recordVersion(undefined, 'full');
            updater.recordVersion(undefined, 'full');
            updater.recordVersion(undefined, 'full');

            const history = updater.getVersionHistory();
            expect(history).toHaveLength(3);
            expect(history[0].version).toBe(1);
            expect(history[2].version).toBe(3);
        });

        it('版本历史最多保留 20 条（默认）', () => {
            for (let i = 0; i < 25; i++) {
                updater.recordVersion(undefined, 'full');
            }
            const history = updater.getVersionHistory();
            expect(history).toHaveLength(20);
            // 最早的被淘汰，保留最近的 20 条
            expect(history[0].version).toBe(6);
            expect(history[19].version).toBe(25);
        });

        it('自定义历史最大保留数', () => {
            const customUpdater = new IncrementalUpdater({
                refetcher,
                maxHistorySize: 5,
            });
            for (let i = 0; i < 10; i++) {
                customUpdater.recordVersion(undefined, 'full');
            }
            expect(customUpdater.getVersionHistory()).toHaveLength(5);
        });

        it('版本记录策略类型', () => {
            updater.recordVersion(undefined, 'full');
            updater.recordVersion(undefined, 'incremental');

            const history = updater.getVersionHistory();
            expect(history[0].strategy).toBe('full');
            expect(history[1].strategy).toBe('incremental');
        });

        it('版本记录变更集', () => {
            const changeSet = makeChangeSet(['character_state']);
            updater.recordVersion(changeSet, 'incremental');

            const version = updater.getCurrentVersion();
            expect(version?.changeSet).toBeDefined();
            expect(version?.changeSet?.affectedSections).toContain('character_state');
        });

        it('resetVersion 清除版本历史', () => {
            updater.recordVersion(undefined, 'full');
            updater.recordVersion(undefined, 'full');

            updater.resetVersion();
            expect(updater.getCurrentVersion()).toBeNull();
            expect(updater.getVersionHistory()).toHaveLength(0);
        });

        it('updateContext 后版本号递增', async () => {
            const oldContext = makeContext({});
            const changeSet = makeChangeSet(['character_state']);

            await updater.updateContext(oldContext, changeSet, '测试项目');

            const version = updater.getCurrentVersion();
            expect(version).not.toBeNull();
            expect(version?.version).toBe(1);
            expect(version?.strategy).toBe('incremental');
        });

        it('markFullFallback 记录全量版本', () => {
            updater.markFullFallback();
            const version = updater.getCurrentVersion();
            expect(version).not.toBeNull();
            expect(version?.strategy).toBe('full');
            expect(version?.changeSet).toBeUndefined();
        });
    });

    // ============================================================
    // 统计
    // ============================================================

    describe('统计', () => {
        it('初始统计全为 0', () => {
            const stats = updater.getStats();
            expect(stats.incrementalUpdates).toBe(0);
            expect(stats.fullFallbacks).toBe(0);
            expect(stats.sectionCacheHits).toBe(0);
            expect(stats.sectionRefetches).toBe(0);
        });

        it('updateContext 后增量计数增加', async () => {
            const oldContext = makeContext({});
            const changeSet = makeChangeSet(['character_state']);

            await updater.updateContext(oldContext, changeSet, '测试项目');

            const stats = updater.getStats();
            expect(stats.incrementalUpdates).toBe(1);
            expect(stats.sectionRefetches).toBe(1);
        });

        it('markFullFallback 后全量计数增加', () => {
            updater.markFullFallback();
            expect(updater.getStats().fullFallbacks).toBe(1);
        });

        it('resetStats 清零统计', async () => {
            const oldContext = makeContext({});
            const changeSet = makeChangeSet(['character_state']);
            await updater.updateContext(oldContext, changeSet, '测试项目');

            updater.resetStats();
            const stats = updater.getStats();
            expect(stats.incrementalUpdates).toBe(0);
            expect(stats.sectionRefetches).toBe(0);
        });
    });

    // ============================================================
    // MultiLayerCache 集成
    // ============================================================

    describe('MultiLayerCache 集成', () => {
        it('有缓存时从缓存读取分区数据', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });
            const project = '缓存测试项目';
            const section = 'character_state';
            const cacheKey = `context:section:${project}:${section}`;

            // 预填充缓存
            const cachedData: Partial<ContextData> = {
                character_state: [{ name: '缓存主角' } as any],
            };
            await cache.set(cacheKey, cachedData);

            let refetchCalled = false;
            const localRefetcher: SectionRefetcher = {
                refetchSection: async () => {
                    refetchCalled = true;
                    return {};
                },
            };
            const localUpdater = new IncrementalUpdater({
                refetcher: localRefetcher,
                multiLayerCache: cache,
            });

            const oldContext = makeContext({});
            const changeSet = makeChangeSet([section]);

            await localUpdater.updateContext(oldContext, changeSet, project);

            // 应该从缓存读取，不调用 refetcher
            expect(refetchCalled).toBe(false);
            expect(localUpdater.getStats().sectionCacheHits).toBe(1);
            expect(localUpdater.getStats().sectionRefetches).toBe(0);
        });

        it('无缓存时从 refetcher 获取并写入缓存', async () => {
            const cache = new MultiLayerCache({ autoAdapt: false });
            const project = '无缓存测试项目';
            const section = 'world_view';

            const localRefetcher: SectionRefetcher = {
                refetchSection: async () => ({
                    world_view: { raw: '新世界观', sections: [] },
                }),
            };
            const localUpdater = new IncrementalUpdater({
                refetcher: localRefetcher,
                multiLayerCache: cache,
            });

            const oldContext = makeContext({});
            const changeSet = makeChangeSet([section]);

            const result = await localUpdater.updateContext(oldContext, changeSet, project);

            expect(localUpdater.getStats().sectionRefetches).toBe(1);

            // 验证已写入缓存
            const cacheKey = `context:section:${project}:${section}`;
            const cached = await cache.get<Partial<ContextData>>(cacheKey);
            expect(cached).not.toBeNull();
            expect((cached!.world_view as any).raw).toBe('新世界观');
        });
    });

    // ============================================================
    // 一致性验证
    // ============================================================

    describe('一致性验证', () => {
        it('增量更新结果与全量更新一致（模拟）', async () => {
            // 模拟全量数据源
            const fullData: ContextData = {
                character_state: [{ name: '主角' } as any, { name: '配角' } as any],
                world_view: { raw: '世界观', sections: [] },
                locations: [{ name: '青云宗' } as any],
            };

            // 模拟全量更新
            const fullRefetcher: SectionRefetcher = {
                refetchSection: async (_project, section) => {
                    const result: Partial<ContextData> = {};
                    (result as any)[section] = (fullData as any)[section];
                    return result;
                },
            };

            // 1. 全量更新（模拟 gatherAll）
            const fullUpdater = new IncrementalUpdater({ refetcher: fullRefetcher });
            const allSections = ['character_state', 'world_view', 'locations'];
            const fullChangeSet = makeChangeSet(allSections);
            const fullResult = await fullUpdater.updateContext(
                makeContext({}),
                fullChangeSet,
                '项目',
            );

            // 2. 增量更新（仅 character_state 变更）
            const oldContext = makeContext({
                world_view: fullData.world_view,
                locations: fullData.locations,
            });
            const incrementalChangeSet = makeChangeSet(['character_state']);
            const incrementalResult = await fullUpdater.updateContext(
                oldContext,
                incrementalChangeSet,
                '项目',
            );

            // 3. 验证一致性：character_state 来自 refetcher，world_view 和 locations 来自旧上下文
            expect(incrementalResult.data.character_state).toEqual(fullData.character_state);
            expect(incrementalResult.data.world_view).toEqual(fullData.world_view);
            expect(incrementalResult.data.locations).toEqual(fullData.locations);
        });
    });
});
