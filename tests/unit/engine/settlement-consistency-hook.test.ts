/**
 * 结算后一致性审核接入 · 契约测试
 *
 * 锁三件事（都关系到「结算不能被派生检查拖累」）：
 *  1. 结算流程里确实调用了 scheduleConsistencyAudit；
 *  2. 该方法是**不 await 的**（fire-and-forget），失败不冒泡；
 *  3. 取不到插件实例时静默跳过（单测环境即如此），不抛错。
 *
 * 说明：不在此处跑真实结算（成本高且与本次改动无关），只做静态契约 + 行为隔离断言。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SettlementEngine } from '../../../engine/settlement-engine';

const SOURCE_PATH = path.resolve(process.cwd(), 'engine/settlement-engine.ts');

describe('结算流程 · 一致性审核接入', () => {
    it('摘要步骤之后调用了 scheduleConsistencyAudit', () => {
        const source = fs.readFileSync(SOURCE_PATH, 'utf8');
        expect(source).toContain('scheduleConsistencyAudit?.(ctx.project)');
        // 必须在「剧情记忆摘要」之后（复用同一 hasPartialFailure 守卫）
        const digestIndex = source.indexOf('writeChapterDigestFromProject');
        const auditIndex = source.indexOf('scheduleConsistencyAudit?.(ctx.project)');
        expect(digestIndex).toBeGreaterThan(-1);
        expect(auditIndex).toBeGreaterThan(digestIndex);
    });

    it('先跑规则层（useLlm=false，零 token）', () => {
        const source = fs.readFileSync(SOURCE_PATH, 'utf8');
        expect(source).toContain('useLlm: false');
    });

    it('有疑似项时才启 AI 识别，且成本封顶（maxPairs）', () => {
        const source = fs.readFileSync(SOURCE_PATH, 'utf8');
        expect(source).toContain('useLlm: true');
        expect(source).toContain('CONSISTENCY_SETTLEMENT_MAX_PAIRS');
        expect(source).toMatch(/suspectedCount > 0/);
    });

    it('矛盾主动提示：结算后弹 Notice（不让用户去猜）', () => {
        const source = fs.readFileSync(SOURCE_PATH, 'utf8');
        const start = source.indexOf('private scheduleConsistencyAudit');
        const body = source.slice(start, start + 3200);
        expect(body).toContain('this.notifier.showNotice');
        expect(body).toContain('跨章矛盾');
    });

    it('该方法是 fire-and-forget（void 包裹，不 await）', () => {
        const source = fs.readFileSync(SOURCE_PATH, 'utf8');
        const start = source.indexOf('private scheduleConsistencyAudit');
        expect(start).toBeGreaterThan(-1);
        const body = source.slice(start, start + 3200);
        expect(body).toContain('void (async () =>');
        expect(body).not.toMatch(/await this\.scheduleConsistencyAudit/);
    });

    it('失败路径有显式豁免（silent-ok）——派生检查不得影响结算', () => {
        const source = fs.readFileSync(SOURCE_PATH, 'utf8');
        const start = source.indexOf('private scheduleConsistencyAudit');
        const body = source.slice(start, start + 3200);
        expect(body).toContain('silent-ok');
        expect(body).toContain('不影响结算');
    });
});

describe('scheduleConsistencyAudit · 无插件实例时静默跳过', () => {
    it('不抛错（单测环境的 app 没有 plugins 字段）', () => {
        const engine = new SettlementEngine({ vault: {} } as never);
        // 通过原型调用私有方法：这是本方法唯一的「无上下文」路径
        const call = (engine as unknown as { scheduleConsistencyAudit: (p: string) => void })
            .scheduleConsistencyAudit.bind(engine);
        expect(() => call('测试项目')).not.toThrow();
    });
});
