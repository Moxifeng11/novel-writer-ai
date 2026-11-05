import { afterEach, describe, expect, it } from 'vitest';
import {
    createPlotDivergenceEngine,
    createWritingQualityEngine,
    getScopedPlotDivergenceEngine,
    getScopedWritingQualityEngine,
    resetQualityEngineScopes,
} from '../../../../engine/quality/quality-engine-factory';

/**
 * 工厂的两类语义必须严格区分：
 * 1) create* 每次返回新实例 —— 视图/面板各自持有历史，互不串；
 * 2) getScoped* 同 scope 复用、不同 scope 隔离 —— 只给长期消费者用。
 * 若把视图改走 scoped，两个面板会共享评分历史与告警冷却。
 */

afterEach(() => {
    resetQualityEngineScopes();
});

describe('quality-engine-factory — 写作质量引擎', () => {
    it('create 每次返回不同实例', () => {
        const a = createWritingQualityEngine();
        const b = createWritingQualityEngine();
        expect(a).not.toBe(b);
    });

    it('scoped 同键复用、异键隔离', () => {
        const first = getScopedWritingQualityEngine('heavy-task');
        const again = getScopedWritingQualityEngine('heavy-task');
        const other = getScopedWritingQualityEngine('quality-worker');
        expect(again).toBe(first);
        expect(other).not.toBe(first);
    });

    it('scoped 实例与 create 实例互不影响', () => {
        const scoped = getScopedWritingQualityEngine('heavy-task');
        const standalone = createWritingQualityEngine();
        expect(scoped).not.toBe(standalone);
    });

    it('reset 后 scoped 重新创建', () => {
        const before = getScopedWritingQualityEngine('heavy-task');
        resetQualityEngineScopes();
        const after = getScopedWritingQualityEngine('heavy-task');
        expect(after).not.toBe(before);
    });
});

describe('quality-engine-factory — 剧情偏离引擎', () => {
    it('create 每次返回不同实例', () => {
        const a = createPlotDivergenceEngine();
        const b = createPlotDivergenceEngine();
        expect(a).not.toBe(b);
    });

    it('scoped 同键复用、异键隔离', () => {
        const first = getScopedPlotDivergenceEngine('heavy-task');
        const again = getScopedPlotDivergenceEngine('heavy-task');
        const other = getScopedPlotDivergenceEngine('quality-worker');
        expect(again).toBe(first);
        expect(other).not.toBe(first);
    });

    it('两类引擎的作用域缓存互不串用', () => {
        const writing = getScopedWritingQualityEngine('heavy-task');
        const divergence = getScopedPlotDivergenceEngine('heavy-task');
        expect(writing).not.toBe(divergence);
    });

    it('reset 后 scoped 重新创建', () => {
        const before = getScopedPlotDivergenceEngine('heavy-task');
        resetQualityEngineScopes();
        const after = getScopedPlotDivergenceEngine('heavy-task');
        expect(after).not.toBe(before);
    });
});
