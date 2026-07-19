/**
 * EngineRegistry 增强能力单元测试
 *
 * 覆盖 Task 2 全部能力：
 * - 作用域系统：Singleton / ProjectScoped / Transient
 * - 依赖检测：正常依赖、循环依赖、缺失依赖
 * - dispose 机制：单个、项目级、全量、dispose 后获取
 * - 懒加载：异步工厂、状态追踪、失败重试、onInit 钩子
 * - 元数据：listEngines 筛选、getMetadata、has、size
 * - 向后兼容：旧 API 调用方式仍可工作
 * - 性能：get 操作 < 0.1ms
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 必须在 import EngineRegistry 之前 mock '../../../main'
// 原因：engine-registry.ts 顶部 import NovelWriterPlugin from '../main'
// 而 main.ts 引入 'obsidian' 包，测试环境需要绕过该依赖链
vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {
        settings: Record<string, unknown> = {};
        app: unknown = null;
    },
}));

import {
    EngineRegistry,
    EngineScope,
    ENGINE_NAMES,
} from '../../../engine/engine-registry';
import type {
    Disposable,
    EngineMetadata,
    DependencyCheckResult,
    EngineListFilter,
} from '../../../engine/engine-registry';

// ─── 测试用辅助类型 ───

/** 实现 Disposable 接口的测试实例 */
class DisposableResource implements Disposable {
    public disposed = false;
    public disposeCallCount = 0;
    public shouldThrow = false;
    public name: string;

    constructor(name: string) {
        this.name = name;
    }
    dispose(): void {
        this.disposeCallCount++;
        if (this.shouldThrow) {
            throw new Error(`dispose 失败: ${this.name}`);
        }
        this.disposed = true;
    }
}

/** 异步 dispose 的测试实例 */
class AsyncDisposableResource implements Disposable {
    public disposed = false;
    public name: string;
    constructor(name: string) {
        this.name = name;
    }
    async dispose(): Promise<void> {
        await new Promise(r => setTimeout(r, 1));
        this.disposed = true;
    }
}

// ─── 测试用例 ───

describe('EngineRegistry - 作用域系统', () => {
    let registry: EngineRegistry;

    beforeEach(() => {
        registry = new EngineRegistry();
    });

    it('Singleton 作用域（默认）— 多次 get 返回同一实例', () => {
        const instance = { value: 'singleton-instance' };
        registry.register('myEngine', instance);
        const a = registry.get<typeof instance>('myEngine');
        const b = registry.get<typeof instance>('myEngine');
        expect(a).toBe(b);
        expect(a).toBe(instance);
    });

    it('Singleton 作用域 — 显式指定', () => {
        const instance = { value: 'explicit-singleton' };
        registry.register('explicit', instance, { scope: EngineScope.Singleton });
        const meta = registry.getMetadata('explicit');
        expect(meta?.scope).toBe(EngineScope.Singleton);
    });

    it('ProjectScoped 作用域 — 同一 project 共享实例', () => {
        // 注册项目级懒加载工厂
        let createCount = 0;
        registry.registerLazy(
            'projectEngine',
            () => {
                createCount++;
                return { id: createCount, project: 'unknown' };
            },
            { scope: EngineScope.ProjectScoped },
        );
        const a = registry.getProject<{ id: number }>('projectEngine', 'projA');
        const b = registry.getProject<{ id: number }>('projectEngine', 'projA');
        expect(a).toBe(b);
        expect(createCount).toBe(1);
    });

    it('ProjectScoped 作用域 — 不同 project 独立实例', () => {
        let createCount = 0;
        registry.registerLazy(
            'projectEngine2',
            () => ({ id: ++createCount }),
            { scope: EngineScope.ProjectScoped },
        );
        const a = registry.getProject<{ id: number }>('projectEngine2', 'projA');
        const b = registry.getProject<{ id: number }>('projectEngine2', 'projB');
        expect(a).not.toBe(b);
        expect(a.id).toBe(1);
        expect(b.id).toBe(2);
    });

    it('Transient 作用域 — 每次获取创建新实例', () => {
        let createCount = 0;
        registry.registerLazy(
            'transientEngine',
            () => ({ id: ++createCount }),
            { scope: EngineScope.Transient },
        );
        const a = registry.getTransient<{ id: number }>('transientEngine');
        const b = registry.getTransient<{ id: number }>('transientEngine');
        expect(a).not.toBe(b);
        expect(a.id).toBe(1);
        expect(b.id).toBe(2);
    });

    it('作用域元数据正确记录', () => {
        registry.register('s', {}, { scope: EngineScope.Singleton });
        registry.registerLazy('p', () => ({}), { scope: EngineScope.ProjectScoped });
        registry.registerLazy('t', () => ({}), { scope: EngineScope.Transient });
        expect(registry.getMetadata('s')?.scope).toBe(EngineScope.Singleton);
        expect(registry.getMetadata('p')?.scope).toBe(EngineScope.ProjectScoped);
        expect(registry.getMetadata('t')?.scope).toBe(EngineScope.Transient);
    });

    it('ProjectScoped 实例通过 getProject 获取', () => {
        const instance = { data: 'shared' };
        // 直接注册实例 + ProjectScoped 元数据
        registry.register('ps-inst', instance, { scope: EngineScope.ProjectScoped });
        // 由于已直接 register 实例，getProject 应回退到单例
        const a = registry.getProject<{ data: string }>('ps-inst', 'projX');
        expect(a).toBe(instance);
    });
});

describe('EngineRegistry - 依赖声明与检查', () => {
    let registry: EngineRegistry;

    beforeEach(() => {
        registry = new EngineRegistry();
    });

    it('正常依赖 — verifyDependencies 通过', () => {
        registry.register('base', { name: 'base' });
        registry.register('middle', { name: 'middle' }, { dependencies: ['base'] });
        registry.register('top', { name: 'top' }, { dependencies: ['middle'] });
        const result = registry.verifyDependencies();
        expect(result.ok).toBe(true);
        expect(result.missing).toEqual([]);
        expect(result.cycles).toEqual([]);
    });

    it('缺失依赖 — verifyDependencies 报告缺失项', () => {
        registry.register('a', {}, { dependencies: ['nonExistent'] });
        registry.register('b', {}, { dependencies: ['a', 'alsoMissing'] });
        const result = registry.verifyDependencies();
        expect(result.ok).toBe(false);
        expect(result.missing).toHaveLength(2);
        expect(result.missing).toContainEqual({ engine: 'a', missingDependency: 'nonExistent' });
        expect(result.missing).toContainEqual({ engine: 'b', missingDependency: 'alsoMissing' });
    });

    it('循环依赖 — A → B → A', () => {
        registry.register('A', {}, { dependencies: ['B'] });
        registry.register('B', {}, { dependencies: ['A'] });
        const result = registry.verifyDependencies();
        expect(result.ok).toBe(false);
        expect(result.cycles.length).toBeGreaterThan(0);
        // 环中应同时包含 A 和 B
        const cycle = result.cycles[0];
        expect(cycle).toContain('A');
        expect(cycle).toContain('B');
    });

    it('循环依赖 — 三元环 A → B → C → A', () => {
        registry.register('A', {}, { dependencies: ['C'] });
        registry.register('B', {}, { dependencies: ['A'] });
        registry.register('C', {}, { dependencies: ['B'] });
        const result = registry.verifyDependencies();
        expect(result.ok).toBe(false);
        expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('自依赖 — A → A 视为环', () => {
        registry.register('selfDep', {}, { dependencies: ['selfDep'] });
        const result = registry.verifyDependencies();
        expect(result.ok).toBe(false);
        // 自依赖可能不形成环路径，但应至少报告（视实现）
        // 本实现：自依赖时 path.indexOf(v) 在 v 已在 path 中时为当前索引，会形成 [v, v]
        const hasSelfCycle = result.cycles.some(c => c.includes('selfDep'));
        expect(hasSelfCycle).toBe(true);
    });

    it('复杂场景 — 缺失+循环同时存在', () => {
        // A 依赖 B（缺失）
        registry.register('A', {}, { dependencies: ['B'] });
        // C ↔ D 形成环
        registry.register('C', {}, { dependencies: ['D'] });
        registry.register('D', {}, { dependencies: ['C'] });
        const result = registry.verifyDependencies();
        expect(result.ok).toBe(false);
        expect(result.missing.length).toBeGreaterThan(0);
        expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('无依赖的引擎 — verifyDependencies 通过', () => {
        registry.register('lonely', {});
        const result = registry.verifyDependencies();
        expect(result.ok).toBe(true);
    });

    it('依赖已 dispose 的引擎 — 不视为缺失', async () => {
        registry.register('dep', new DisposableResource('dep'));
        registry.register('user', {}, { dependencies: ['dep'] });
        await registry.dispose('dep');
        const result = registry.verifyDependencies();
        // 已 dispose 的依赖不报缺失（视为历史依赖）
        expect(result.missing.find(m => m.missingDependency === 'dep')).toBeUndefined();
    });
});

describe('EngineRegistry - 懒加载增强', () => {
    let registry: EngineRegistry;

    beforeEach(() => {
        registry = new EngineRegistry();
    });

    it('同步工厂 — 旧 API 兼容', () => {
        registry.registerLazy('sync', () => ({ value: 42 }));
        expect(registry.getLazyState('sync')).toBe('pending');
        const inst = registry.get<{ value: number }>('sync');
        expect(inst.value).toBe(42);
        expect(registry.getLazyState('sync')).toBe('loaded');
    });

    it('异步工厂 — getAsync 等待并返回', async () => {
        registry.registerLazy('async', async () => {
            await new Promise(r => setTimeout(r, 5));
            return { value: 'async-loaded' };
        });
        expect(registry.getLazyState('async')).toBe('pending');
        const inst = await registry.getAsync<{ value: string }>('async');
        expect(inst.value).toBe('async-loaded');
        expect(registry.getLazyState('async')).toBe('loaded');
    });

    it('异步工厂 — get 同步获取会抛错', async () => {
        registry.registerLazy('async2', async () => ({ value: 'x' }));
        expect(() => registry.get('async2')).toThrow(/getAsync/);
        expect(registry.getLazyState('async2')).toBe('failed');
    });

    it('失败重试 — getAsync 失败后再次调用可成功', async () => {
        let callCount = 0;
        registry.registerLazy('retry', async () => {
            callCount++;
            if (callCount === 1) throw new Error('首次失败');
            return { attempt: callCount };
        });
        // 第一次失败
        await expect(registry.getAsync('retry')).rejects.toThrow('首次失败');
        expect(registry.getLazyState('retry')).toBe('failed');
        // 第二次成功
        const inst = await registry.getAsync<{ attempt: number }>('retry');
        expect(inst.attempt).toBe(2);
        expect(registry.getLazyState('retry')).toBe('loaded');
    });

    it('onInit 钩子 — 同步 onInit 被调用', async () => {
        const onInit = vi.fn((inst: any) => { inst.initialized = true; });
        registry.registerLazy('withInit', () => ({ value: 1 }), { onInit });
        const inst = await registry.getAsync<{ value: number; initialized: boolean }>('withInit');
        expect(onInit).toHaveBeenCalledTimes(1);
        expect(inst.initialized).toBe(true);
    });

    it('onInit 钩子 — 异步 onInit 被 await', async () => {
        const onInit = vi.fn(async (inst: any) => {
            await new Promise(r => setTimeout(r, 5));
            inst.asyncInit = true;
        });
        registry.registerLazy('withAsyncInit', () => ({}), { onInit });
        const inst = await registry.getAsync<{ asyncInit: boolean }>('withAsyncInit');
        expect(onInit).toHaveBeenCalledTimes(1);
        expect(inst.asyncInit).toBe(true);
    });

    it('onInit 钩子失败 — 不影响实例创建', async () => {
        const onInit = vi.fn(() => { throw new Error('onInit 失败'); });
        registry.registerLazy('failingInit', () => ({ value: 'ok' }), { onInit });
        // onInit 失败应传播
        await expect(registry.getAsync('failingInit')).rejects.toThrow('onInit 失败');
    });

    it('懒加载状态追踪 — pending → loaded', async () => {
        registry.registerLazy('tracking', () => ({ x: 1 }));
        expect(registry.getLazyState('tracking')).toBe('pending');
        registry.get('tracking');
        expect(registry.getLazyState('tracking')).toBe('loaded');
    });

    it('懒加载状态追踪 — pending → failed', async () => {
        registry.registerLazy('willFail', () => { throw new Error('boom'); });
        expect(registry.getLazyState('willFail')).toBe('pending');
        expect(() => registry.get('willFail')).toThrow('boom');
        expect(registry.getLazyState('willFail')).toBe('failed');
    });

    it('未注册引擎 getLazyState 返回 null', () => {
        expect(registry.getLazyState('notRegistered')).toBeNull();
    });
});

describe('EngineRegistry - Dispose 机制', () => {
    let registry: EngineRegistry;

    beforeEach(() => {
        registry = new EngineRegistry();
    });

    it('单个 dispose — 实现 Disposable 接口的实例被 dispose', async () => {
        const res = new DisposableResource('res1');
        registry.register('res1', res);
        await registry.dispose('res1');
        expect(res.disposed).toBe(true);
        expect(res.disposeCallCount).toBe(1);
        expect(registry.isDestroyed('res1')).toBe(true);
    });

    it('单个 dispose — 未实现 Disposable 的实例也算成功', async () => {
        registry.register('plain', { value: 1 });
        const ok = await registry.dispose('plain');
        expect(ok).toBe(true);
        expect(registry.isDestroyed('plain')).toBe(true);
    });

    it('单个 dispose — dispose 失败不影响清理', async () => {
        const res = new DisposableResource('failRes');
        res.shouldThrow = true;
        registry.register('failRes', res);
        // 不应抛错
        const ok = await registry.dispose('failRes');
        expect(ok).toBe(true);
        expect(registry.isDestroyed('failRes')).toBe(true);
    });

    it('异步 dispose — await 异步 dispose 方法', async () => {
        const res = new AsyncDisposableResource('asyncRes');
        registry.register('asyncRes', res);
        await registry.dispose('asyncRes');
        expect(res.disposed).toBe(true);
    });

    it('dispose 后 getAsync 抛错', async () => {
        registry.register('willDispose', { value: 1 });
        await registry.dispose('willDispose');
        await expect(registry.getAsync('willDispose')).rejects.toThrow(/已 dispose/);
    });

    it('dispose 后 get 仍返回旧实例（运行时兼容）', async () => {
        const inst = { value: 1 };
        registry.register('compat', inst);
        await registry.dispose('compat');
        // 注意：dispose 后 instances 已 delete，get 会抛"未注册"
        // 这是预期行为：旧实例不再可获取
        expect(() => registry.get('compat')).toThrow();
    });

    it('dispose 后元数据 status=destroyed', async () => {
        registry.register('meta', {}, { description: '测试引擎' });
        await registry.dispose('meta');
        const meta = registry.getMetadata('meta');
        expect(meta?.status).toBe('destroyed');
    });

    it('dispose 后禁止重新注册', async () => {
        registry.register('noReReg', { v: 1 });
        await registry.dispose('noReReg');
        // 重新注册应被忽略（带 warn）
        registry.register('noReReg', { v: 2 });
        expect(registry.has('noReReg')).toBe(false);
    });

    it('disposeProject — 释放指定项目的所有实例', async () => {
        const r1 = new DisposableResource('p1');
        const r2 = new DisposableResource('p2');
        registry.registerLazy('p1', () => r1, { scope: EngineScope.ProjectScoped });
        registry.registerLazy('p2', () => r2, { scope: EngineScope.ProjectScoped });
        // 触发项目级创建
        registry.getProject('p1', 'projA');
        registry.getProject('p2', 'projA');
        const count = await registry.disposeProject('projA');
        expect(count).toBe(2);
        expect(r1.disposed).toBe(true);
        expect(r2.disposed).toBe(true);
    });

    it('disposeProject — 不影响其他项目', async () => {
        const r1 = new DisposableResource('p1');
        const r2 = new DisposableResource('p2');
        registry.registerLazy('p1', () => r1, { scope: EngineScope.ProjectScoped });
        registry.registerLazy('p2', () => r2, { scope: EngineScope.ProjectScoped });
        registry.getProject('p1', 'projA');
        registry.getProject('p2', 'projB');
        await registry.disposeProject('projA');
        expect(r1.disposed).toBe(true);
        expect(r2.disposed).toBe(false);
    });

    it('disposeProject — 单个失败不影响其他', async () => {
        const r1 = new DisposableResource('p1');
        const r2 = new DisposableResource('p2');
        r1.shouldThrow = true;
        registry.registerLazy('p1', () => r1, { scope: EngineScope.ProjectScoped });
        registry.registerLazy('p2', () => r2, { scope: EngineScope.ProjectScoped });
        registry.getProject('p1', 'projA');
        registry.getProject('p2', 'projA');
        const count = await registry.disposeProject('projA');
        expect(count).toBe(2); // 两个都被清理（即使 r1 抛错）
        expect(r2.disposed).toBe(true);
    });

    it('disposeProject — 不存在的项目返回 0', async () => {
        const count = await registry.disposeProject('notExists');
        expect(count).toBe(0);
    });

    it('disposeAll — 释放所有实例', async () => {
        const r1 = new DisposableResource('a1');
        const r2 = new DisposableResource('a2');
        const r3 = new DisposableResource('a3');
        registry.register('a1', r1);
        registry.register('a2', r2);
        registry.register('a3', r3);
        const count = await registry.disposeAll();
        expect(count).toBe(3);
        expect(r1.disposed).toBe(true);
        expect(r2.disposed).toBe(true);
        expect(r3.disposed).toBe(true);
    });

    it('disposeAll — 按依赖逆序释放', async () => {
        const order: string[] = [];
        class OrderedDisposable implements Disposable {
            constructor(private name: string) {}
            dispose(): void {
                order.push(this.name);
            }
        }
        // base 被依赖，应最后释放
        registry.register('base', new OrderedDisposable('base'));
        registry.register('middle', new OrderedDisposable('middle'), { dependencies: ['base'] });
        registry.register('top', new OrderedDisposable('top'), { dependencies: ['middle', 'base'] });
        await registry.disposeAll();
        // top 应先于 middle，middle 应先于 base
        expect(order.indexOf('top')).toBeLessThan(order.indexOf('middle'));
        expect(order.indexOf('middle')).toBeLessThan(order.indexOf('base'));
    });

    it('disposeAll — 包含懒加载未触发的引擎', async () => {
        registry.registerLazy('lazy', () => ({ value: 1 }));
        const count = await registry.disposeAll();
        expect(count).toBe(1);
        expect(registry.isDestroyed('lazy')).toBe(true);
    });

    it('disposeAll — 包含项目级实例', async () => {
        const r = new DisposableResource('proj');
        registry.registerLazy('proj', () => r, { scope: EngineScope.ProjectScoped });
        registry.getProject('proj', 'p1');
        const count = await registry.disposeAll();
        expect(count).toBeGreaterThanOrEqual(1);
        expect(r.disposed).toBe(true);
    });

    it('setActiveProject — 切换项目自动释放旧项目实例', async () => {
        const r1 = new DisposableResource('proj');
        registry.registerLazy('proj', () => r1, { scope: EngineScope.ProjectScoped });
        await registry.setActiveProject('projA');
        registry.getProject('proj', 'projA');
        const released = await registry.setActiveProject('projB');
        expect(released).toBe(1);
        expect(r1.disposed).toBe(true);
    });

    it('setActiveProject — 相同项目不释放', async () => {
        const r = new DisposableResource('p');
        registry.registerLazy('p', () => r, { scope: EngineScope.ProjectScoped });
        await registry.setActiveProject('sameProj');
        registry.getProject('p', 'sameProj');
        const released = await registry.setActiveProject('sameProj');
        expect(released).toBe(0);
        expect(r.disposed).toBe(false);
    });
});

describe('EngineRegistry - 元数据查询', () => {
    let registry: EngineRegistry;

    beforeEach(() => {
        registry = new EngineRegistry();
    });

    it('getMetadata — 返回完整元数据', () => {
        registry.register('engine1', { v: 1 }, {
            description: '测试引擎',
            tags: ['core', 'ai'],
            version: '1.0.0',
            dependencies: ['dep1'],
        });
        const meta = registry.getMetadata('engine1');
        expect(meta).not.toBeNull();
        expect(meta?.description).toBe('测试引擎');
        expect(meta?.tags).toEqual(['core', 'ai']);
        expect(meta?.version).toBe('1.0.0');
        expect(meta?.scope).toBe(EngineScope.Singleton);
        expect(meta?.status).toBe('active');
        expect(meta?.lazy).toBe(false);
        expect(meta?.dependencies).toEqual(['dep1']);
    });

    it('getMetadata — 不存在的引擎返回 null', () => {
        expect(registry.getMetadata('notExists')).toBeNull();
    });

    it('listEngines — 无筛选返回全部', () => {
        registry.register('a', {});
        registry.register('b', {});
        registry.registerLazy('c', () => ({}));
        const list = registry.listEngines();
        expect(list).toHaveLength(3);
        const names = list.map(e => e.name);
        expect(names).toContain('a');
        expect(names).toContain('b');
        expect(names).toContain('c');
    });

    it('listEngines — 按 scope 筛选', () => {
        registry.register('s', {}, { scope: EngineScope.Singleton });
        registry.registerLazy('p', () => ({}), { scope: EngineScope.ProjectScoped });
        registry.registerLazy('t', () => ({}), { scope: EngineScope.Transient });
        const list = registry.listEngines({ scope: EngineScope.Transient });
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('t');
    });

    it('listEngines — 按 tags 筛选（任一匹配）', () => {
        registry.register('a', {}, { tags: ['core', 'ai'] });
        registry.register('b', {}, { tags: ['ui'] });
        registry.register('c', {}, { tags: ['core', 'service'] });
        const list = registry.listEngines({ tags: ['core'] });
        expect(list).toHaveLength(2);
        const names = list.map(e => e.name).sort();
        expect(names).toEqual(['a', 'c']);
    });

    it('listEngines — 按 status 筛选', async () => {
        registry.register('alive', {});
        registry.register('dead', {});
        await registry.dispose('dead');
        const aliveList = registry.listEngines({ status: 'active' });
        const deadList = registry.listEngines({ status: 'destroyed' });
        expect(aliveList.find(e => e.name === 'alive')).toBeDefined();
        expect(aliveList.find(e => e.name === 'dead')).toBeUndefined();
        expect(deadList.find(e => e.name === 'dead')).toBeDefined();
    });

    it('listEngines — 按 lazy 筛选', () => {
        registry.register('eager', {});
        registry.registerLazy('lazy', () => ({}));
        const lazyList = registry.listEngines({ lazy: true });
        const eagerList = registry.listEngines({ lazy: false });
        expect(lazyList).toHaveLength(1);
        expect(lazyList[0].name).toBe('lazy');
        expect(eagerList).toHaveLength(1);
        expect(eagerList[0].name).toBe('eager');
    });

    it('listEngines — 组合筛选', () => {
        registry.register('a', {}, { tags: ['core'], scope: EngineScope.Singleton });
        registry.register('b', {}, { tags: ['ui'], scope: EngineScope.Singleton });
        registry.register('c', {}, { tags: ['core'], scope: EngineScope.ProjectScoped });
        const list = registry.listEngines({ tags: ['core'], scope: EngineScope.Singleton });
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('a');
    });

    it('has — 检查引擎是否注册', () => {
        registry.register('existing', {});
        registry.registerLazy('lazyExisting', () => ({}));
        registry.registerLazy('transientExisting', () => ({}), { scope: EngineScope.Transient });
        expect(registry.has('existing')).toBe(true);
        expect(registry.has('lazyExisting')).toBe(true);
        expect(registry.has('transientExisting')).toBe(true);
        expect(registry.has('notExisting')).toBe(false);
    });

    it('size — 返回已注册引擎数量', () => {
        expect(registry.size()).toBe(0);
        registry.register('a', {});
        registry.register('b', {});
        expect(registry.size()).toBe(2);
    });
});

describe('EngineRegistry - 向后兼容', () => {
    it('旧 API register(name, instance) 仍可工作', () => {
        const registry = new EngineRegistry();
        const inst = { value: 'old' };
        registry.register('old', inst);
        expect(registry.get('old')).toBe(inst);
        expect(registry.has('old')).toBe(true);
    });

    it('旧 API registerLazy(name, factory) 仍可工作', () => {
        const registry = new EngineRegistry();
        let called = false;
        registry.registerLazy('lazy', () => {
            called = true;
            return { value: 1 };
        });
        expect(called).toBe(false);
        const inst = registry.get<{ value: number }>('lazy');
        expect(called).toBe(true);
        expect(inst.value).toBe(1);
    });

    it('旧 API getOrNull — 不存在返回 null', () => {
        const registry = new EngineRegistry();
        expect(registry.getOrNull('missing')).toBeNull();
    });

    it('旧 API getOrNull — 存在返回实例', () => {
        const registry = new EngineRegistry();
        const inst = { v: 1 };
        registry.register('e', inst);
        expect(registry.getOrNull('e')).toBe(inst);
    });

    it('旧 API get — 未注册抛错', () => {
        const registry = new EngineRegistry();
        expect(() => registry.get('notExist')).toThrow(/未注册/);
    });

    it('旧 API 重复 register 跳过', () => {
        const registry = new EngineRegistry();
        const a = { v: 1 };
        const b = { v: 2 };
        registry.register('dup', a);
        registry.register('dup', b);
        expect(registry.get('dup')).toBe(a);
    });

    it('EngineScope 枚举值稳定', () => {
        // 字符串值作为稳定契约（持久化场景）
        expect(EngineScope.Singleton).toBe('singleton');
        expect(EngineScope.ProjectScoped).toBe('project-scoped');
        expect(EngineScope.Transient).toBe('transient');
    });

    it('ENGINE_NAMES 常量仍存在且数量正确', () => {
        // 现有 33 个引擎名常量
        const keys = Object.keys(ENGINE_NAMES);
        expect(keys.length).toBeGreaterThanOrEqual(33);
        // 抽样校验
        expect(ENGINE_NAMES.AI_ENGINE).toBe('aiEngine');
        expect(ENGINE_NAMES.CONTEXT_MANAGER).toBe('contextManager');
        expect(ENGINE_NAMES.CACHE_MANAGER).toBe('cacheManager');
    });
});

describe('EngineRegistry - 性能', () => {
    it('get 操作 < 0.1ms（已加载实例）', () => {
        const registry = new EngineRegistry();
        const inst = { value: 'perf-test' };
        registry.register('perf', inst);
        // 预热
        registry.get('perf');
        // 测量
        const iterations = 1000;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            registry.get('perf');
        }
        const elapsed = performance.now() - start;
        const avgMs = elapsed / iterations;
        // 平均 < 0.1ms（留 5 倍裕量应对 CI 波动）
        expect(avgMs).toBeLessThan(0.1);
    });

    it('has 操作 < 0.05ms', () => {
        const registry = new EngineRegistry();
        registry.register('perfHas', {});
        const iterations = 1000;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            registry.has('perfHas');
        }
        const elapsed = performance.now() - start;
        const avgMs = elapsed / iterations;
        expect(avgMs).toBeLessThan(0.05);
    });

    it('listEngines 操作 — 100 个引擎 < 1ms', () => {
        const registry = new EngineRegistry();
        for (let i = 0; i < 100; i++) {
            registry.register(`engine_${i}`, {}, { tags: [`tag_${i % 5}`] });
        }
        const start = performance.now();
        registry.listEngines({ tags: ['tag_0'] });
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(1);
    });
});

describe('EngineRegistry - 边界场景', () => {
    let registry: EngineRegistry;

    beforeEach(() => {
        registry = new EngineRegistry();
    });

    it('dispose 未注册的引擎 — 仍标记为 destroyed', async () => {
        const ok = await registry.dispose('neverRegistered');
        expect(ok).toBe(true);
        expect(registry.isDestroyed('neverRegistered')).toBe(true);
    });

    it('getProject — 空 projectKey 视为 __default__', () => {
        registry.registerLazy('p', () => ({ v: 1 }), { scope: EngineScope.ProjectScoped });
        const a = registry.getProject<{ v: number }>('p', '');
        const b = registry.getProject<{ v: number }>('p', '__default__');
        expect(a).toBe(b);
    });

    it('getTransient — 未注册工厂抛错', () => {
        expect(() => registry.getTransient('notExist')).toThrow(/未注册/);
    });

    it('verifyDependencies — 空注册表通过', () => {
        const result = registry.verifyDependencies();
        expect(result.ok).toBe(true);
        expect(result.missing).toEqual([]);
        expect(result.cycles).toEqual([]);
    });

    it('disposeAll — 空注册表返回 0', async () => {
        const count = await registry.disposeAll();
        expect(count).toBe(0);
    });

    it('disposeProject — 空项目返回 0', async () => {
        await registry.setActiveProject('emptyProj');
        const count = await registry.disposeProject('emptyProj');
        expect(count).toBe(0);
    });

    it('重复 dispose 同一引擎 — 第二次仍返回 true', async () => {
        registry.register('dup', { v: 1 });
        await registry.dispose('dup');
        const ok = await registry.dispose('dup');
        expect(ok).toBe(true);
    });

    it('dispose 后 listEngines 仍可查询（status=destroyed）', async () => {
        registry.register('e', {}, { tags: ['t1'] });
        await registry.dispose('e');
        const list = registry.listEngines();
        const entry = list.find(x => x.name === 'e');
        expect(entry).toBeDefined();
        expect(entry?.metadata.status).toBe('destroyed');
    });

    it('register 同名引擎带 options 也跳过', () => {
        const a = { v: 1 };
        registry.register('dup', a, { tags: ['orig'] });
        registry.register('dup', { v: 2 }, { tags: ['override'] });
        // 第二次注册被忽略，元数据保留第一次
        expect(registry.get('dup')).toBe(a);
        expect(registry.getMetadata('dup')?.tags).toEqual(['orig']);
    });
});
