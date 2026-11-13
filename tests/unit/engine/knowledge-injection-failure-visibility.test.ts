/**
 * knowledge-injection-failure-visibility.test.ts — 知识注入空转可见化（DSH-20261114-03）
 *
 * audit §三-1：检索失败此前只 log.warn——风格/节奏/考据指引悄悄归零、模型照写、
 * 界面一切正常（假绿）；执行时间线里 chars=0 的注入行又被过滤吞掉。
 *
 * 本文件锁四件事：
 *   1. 检索失败 → degradation-notifier 收到 source=injection 事件（kb-view 链路状态可见）
 *   2. 失败轮 lastInjectionMeta.failed=true；空库（无命中/无书）failed=false、empty=true
 *      ——「失败归零」与「本来没有」两种语义分开（accept ③）
 *   3. 60s 去重：一轮 6 维同因失败只报首条，不刷屏
 *   4. 三个早退口（未启用/无向量库/零段）都走 formatInjection 留痕，
 *      不再拿上一轮 meta 冒充本轮
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeInjector } from '../../../engine/knowledge-injector';
import { getDegradationNotifier } from '../../../shared/degradation-notifier';
import type { KnowledgeVectorStore } from '../../../engine/knowledge-vector-store';

/** 让检索必然失败的假向量库 */
function brokenStore(): KnowledgeVectorStore {
    return {
        search: async () => {
            throw new Error('store broken');
        },
    } as unknown as KnowledgeVectorStore;
}

/** 永远返回空命中的假向量库（空库/零命中语义） */
function emptyStore(): KnowledgeVectorStore {
    return {
        search: async () => [],
    } as unknown as KnowledgeVectorStore;
}

function makeContext(): { projectPath: string; outline: string } {
    return { projectPath: '/test', outline: '林晚在东市与线人接头，追兵逼近。' };
}

function injectionEvents(): Array<{ source: string; reason: string }> {
    return getDegradationNotifier()
        .getEvents()
        .filter(e => e.source === 'injection') as unknown as Array<{ source: string; reason: string }>;
}

describe('KnowledgeInjector 注入失败可见化（DSH-20261114-03）', () => {
    beforeEach(() => {
        getDegradationNotifier().clear();
    });

    it('检索失败：notifier 收到 injection 事件 + meta.failed=true（不再假绿）', async () => {
        const injector = new KnowledgeInjector({} as never, { knowledgeVectorStore: brokenStore() });
        const result = await injector.injectKnowledgeBase(makeContext() as never, 0.7);

        expect(result).toBe('');
        const events = injectionEvents();
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0].reason).toContain('检索失败');
        // retrieve() 把底层异常收敛成「全部 N 条查询失败」——reason 里带收敛后的错误
        expect(events[0].reason).toContain('条查询失败');
        expect(injector.lastInjectionMeta?.failed).toBe(true);
        expect(injector.lastInjectionMeta?.empty).toBe(false);
        expect(injector.lastInjectionMeta?.retrieval?.errors).toBeGreaterThan(0);
    });

    it('空库/零命中：不发失败事件，meta.empty=true（两种语义分开，accept ③）', async () => {
        const injector = new KnowledgeInjector({} as never, { knowledgeVectorStore: emptyStore() });
        const result = await injector.injectKnowledgeBase(makeContext() as never, 0.7);

        expect(result).toBe('');
        expect(injectionEvents()).toHaveLength(0);
        expect(injector.lastInjectionMeta?.failed).toBe(false);
        expect(injector.lastInjectionMeta?.empty).toBe(true);
    });

    it('60s 去重：连续两轮同因失败只报首条（一轮 6 维不刷屏）', async () => {
        const injector = new KnowledgeInjector({} as never, { knowledgeVectorStore: brokenStore() });
        await injector.injectKnowledgeBase(makeContext() as never, 0.7);
        await injector.injectKnowledgeBase(makeContext() as never, 0.7);

        expect(injectionEvents()).toHaveLength(1);
        // 但 meta 每轮都如实标记失败（可见性与去重互不影响）
        expect(injector.lastInjectionMeta?.failed).toBe(true);
    });

    it('未启用/无向量库的早退口同样留痕：empty=true，不残留上一轮 meta', async () => {
        const injector = new KnowledgeInjector(null as never);
        injector.lastInjectionMeta = {
            sections: [{ title: '旧', chars: 999 }],
            totalChars: 999,
            failed: false,
            empty: false,
        };

        const result = await injector.injectKnowledgeBase(makeContext() as never, 0.7);
        expect(result).toBe('');
        expect(injector.lastInjectionMeta?.totalChars).toBe(0);
        expect(injector.lastInjectionMeta?.empty).toBe(true);
        expect(injector.lastInjectionMeta?.failed).toBe(false);
    });
});

describe('notifyMaxTokensClamp — 夹紧可见化（DSH-20261114-08③）', () => {
    it('夹紧时发 source=llm info 事件（60s 去重，不弹 Notice）', async () => {
        const { notifyMaxTokensClamp } = await import('../../../shared/degradation-notifier');
        getDegradationNotifier().clear();
        notifyMaxTokensClamp(32768, 8192, 'deepseek-flash');
        notifyMaxTokensClamp(32768, 8192, 'deepseek-flash'); // 60s 内去重

        const events = getDegradationNotifier().getEvents().filter(e => e.source === 'llm');
        expect(events).toHaveLength(1);
        expect(events[0].severity).toBe('info');
        expect(events[0].from).toBe('maxTokens:32768');
        expect(events[0].to).toBe('clamped:8192');
        expect(events[0].reason).toContain('产出可能偏短');
    });
});
