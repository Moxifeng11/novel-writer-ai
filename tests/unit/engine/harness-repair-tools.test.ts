/**
 * harness-repair-tools.test.ts — 阶段 E：agent 链路自愈（repair_flow）
 *
 * 诊断只回答「断在哪一环」，自愈要能就地修。修复是**写操作**，所以本文件重点锁
 * 三条安全线（对应任务验收）：
 * 1. fail-closed：没有审批回调 → 一律拒绝，连「回合层已批准」也不放行；
 * 2. 如实失败：宿主能力缺失/抛错/返回失败 → ok:false 带原因，绝不静默成功；
 * 3. 可观测：修完必须用同一套采集器复诊，把修复后的链路状态一起返回。
 */
import { describe, expect, it, vi } from 'vitest';
import {
    createRepairTools,
    REPAIR_ACTIONS,
    REPAIR_FLOW_TOOL,
    type FlowRepairDeps,
} from '../../../engine/agent/harness/repair-tools';
import type { FlowDiagnosisDeps } from '../../../engine/agent/harness/diagnose-tools';
import type { HarnessApprovalRequest, HarnessToolContext } from '../../../engine/agent/harness/harness-types';

type ExecCtx = HarnessToolContext;

/** 空上下文（未走回合审批通道） */
const CTX = { memory: { slots: {} } } as unknown as ExecCtx;
/** 回合层已批准（approvalGranted） */
const CTX_GRANTED = { memory: { slots: {} }, approvalGranted: true } as unknown as ExecCtx;

function makeDiagnose(overrides: Partial<FlowDiagnosisDeps> = {}): FlowDiagnosisDeps {
    return {
        collectKnowledge: vi.fn(async () => ({
            bookTotal: 1,
            breakdownCompleted: 1,
            vectorDone: 1,
            vectorFailed: 0,
            embeddingReady: true,
            storeLoadedBooks: 1,
            storeReady: true,
        })),
        collectStyle: vi.fn(async () => ({
            templateCount: 1,
            globalCount: 1,
            projectCount: 1,
            enabledCount: 2,
            intensityDisabledCount: 0,
            embeddingReady: true,
        })),
        collectConstraint: vi.fn(async () => ({
            sourceCount: 1,
            settingExists: true,
            reviewStatus: 'approved' as const,
            bound: true,
            rulesHasContent: true,
        })),
        ...overrides,
    };
}

function makeDeps(overrides: Partial<FlowRepairDeps> = {}): FlowRepairDeps {
    return {
        requestApproval: vi.fn(async () => true),
        revectorizeBook: vi.fn(async () => ({ ok: true, detail: '32 段已重建' })),
        reloadFingerprints: vi.fn(async () => ({ template: 1, global: 2, project: 3 })),
        cleanupOrphanVectors: vi.fn(async () => ({ orphanCount: 1, removed: ['kb_ghost'], skipped: [] })),
        fixZeroIntensity: vi.fn(async () => ({ fixed: ['fp_zero'], failed: [] })),
        diagnose: makeDiagnose(),
        ...overrides,
    };
}

function tool(deps: FlowRepairDeps) {
    const tools = createRepairTools(deps);
    expect(tools).toHaveLength(1);
    return tools[0];
}

const run = (deps: FlowRepairDeps, args: Record<string, unknown>, ctx: ExecCtx = CTX) =>
    tool(deps).execute(args, ctx);

describe('repair_flow 工具契约', () => {
    it('工具名、写副作用与必填参数', () => {
        const t = tool(makeDeps());
        expect(t.name).toBe(REPAIR_FLOW_TOOL);
        expect(t.sideEffect).toBe('write');
        expect(t.required).toEqual(['action']);
        expect(t.parameters.action.enum).toEqual([...REPAIR_ACTIONS]);
    });

    it('非法 action 被拒绝，且不触发审批', async () => {
        const deps = makeDeps();
        const result = await run(deps, { action: 'drop_database' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('action 必须是');
        expect(deps.requestApproval).not.toHaveBeenCalled();
    });

    it('缺 bookId 被拒绝', async () => {
        const deps = makeDeps();
        const result = await run(deps, { action: 'revectorize_book' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('需要 bookId');
        expect(deps.revectorizeBook).not.toHaveBeenCalled();
    });

    it('非法 bookId（路径穿越）被拒绝', async () => {
        const deps = makeDeps();
        const result = await run(deps, { action: 'revectorize_book', bookId: '../../etc/passwd' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('bookId 不合法');
        expect(deps.requestApproval).not.toHaveBeenCalled();
    });
});

describe('审批：fail-closed', () => {
    it('没有审批回调 → 拒绝执行，数据未被修改', async () => {
        const deps = makeDeps({ requestApproval: undefined });
        const result = await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('fail-closed');
        expect(deps.revectorizeBook).not.toHaveBeenCalled();
    });

    it('回合层已批准但宿主没有审批能力 → 仍然拒绝', async () => {
        const deps = makeDeps({ requestApproval: undefined });
        const result = await run(deps, { action: 'reload_fingerprints' }, CTX_GRANTED);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('fail-closed');
        expect(deps.reloadFingerprints).not.toHaveBeenCalled();
    });

    it('用户拒绝 → 不执行修复', async () => {
        const deps = makeDeps({ requestApproval: vi.fn(async () => false) });
        const result = await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('未批准');
        expect(deps.revectorizeBook).not.toHaveBeenCalled();
    });

    it('审批回调抛错 → 按未批准处理', async () => {
        const deps = makeDeps({ requestApproval: vi.fn(async () => { throw new Error('弹窗组件异常'); }) });
        const result = await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(result.ok).toBe(false);
        expect(deps.revectorizeBook).not.toHaveBeenCalled();
    });

    it('审批请求带动作、目标与写副作用（用户看得懂改什么）', async () => {
        const requestApproval = vi.fn(async (_request: HarnessApprovalRequest) => true);
        const deps = makeDeps({ requestApproval });
        await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(requestApproval).toHaveBeenCalledTimes(1);
        expect(requestApproval.mock.calls[0][0]).toMatchObject({
            tool: REPAIR_FLOW_TOOL,
            sideEffect: 'write',
            args: { action: 'revectorize_book', bookId: 'kb_a' },
        });
        expect(requestApproval.mock.calls[0][0].reason).toContain('kb_a');
    });

    it('回合层已批准且宿主有审批能力 → 不再二次弹窗，直接执行', async () => {
        const requestApproval = vi.fn(async () => true);
        const deps = makeDeps({ requestApproval });
        const result = await run(deps, { action: 'reload_fingerprints' }, CTX_GRANTED);
        expect(result.ok).toBe(true);
        expect(requestApproval).not.toHaveBeenCalled();
    });
});

describe('修复：成功路径与可观测性', () => {
    it('单本重向量化成功后复诊，返回修复后的知识流状态', async () => {
        const deps = makeDeps();
        const result = await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(result.ok).toBe(true);
        expect(deps.revectorizeBook).toHaveBeenCalledWith('kb_a');
        expect(deps.diagnose.collectKnowledge).toHaveBeenCalledTimes(1);
        expect(result.content).toContain('修复后链路状态');
        expect(result.content).toContain('知识流');
        expect((result.data?.status as { title: string }).title).toBe('知识流');
    });

    it('修复动作先于复诊（不是拿修复前的快照冒充结果）', async () => {
        const order: string[] = [];
        const deps = makeDeps({
            revectorizeBook: vi.fn(async () => { order.push('repair'); return { ok: true }; }),
            diagnose: makeDiagnose({
                collectKnowledge: vi.fn(async () => {
                    order.push('diagnose');
                    return {
                        bookTotal: 1, breakdownCompleted: 1, vectorDone: 1, vectorFailed: 0,
                        embeddingReady: true, storeLoadedBooks: 1, storeReady: true,
                    };
                }),
            }),
        });
        await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(order).toEqual(['repair', 'diagnose']);
    });

    it('指纹库重载成功：三层条数进 content 与 data，复诊走风格流', async () => {
        const deps = makeDeps();
        const result = await run(deps, { action: 'reload_fingerprints' });
        expect(result.ok).toBe(true);
        expect(deps.reloadFingerprints).toHaveBeenCalledTimes(1);
        expect(deps.diagnose.collectStyle).toHaveBeenCalledTimes(1);
        expect(result.content).toContain('模板 1 / 全局 2 / 项目 3');
        expect(result.data).toMatchObject({ action: 'reload_fingerprints', counts: { template: 1, global: 2, project: 3 } });
        expect((result.data?.status as { title: string }).title).toBe('风格流');
    });
});


describe('阶段 E 深化：cleanup_orphan_vectors', () => {
    it('宿主未提供能力 → ok:false 并说明', async () => {
        const deps = makeDeps({ cleanupOrphanVectors: undefined });
        const result = await run(deps, { action: 'cleanup_orphan_vectors' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('未提供孤儿清理能力');
        expect(deps.diagnose.collectKnowledge).not.toHaveBeenCalled();
    });

    it('有孤儿：审批通过后执行，removed/skipped 如实上报并复诊知识流', async () => {
        const cleanup = vi.fn(async () => ({ orphanCount: 2, removed: ['g1'], skipped: ['g2'] }));
        const deps = makeDeps({ cleanupOrphanVectors: cleanup });
        const result = await run(deps, { action: 'cleanup_orphan_vectors' });
        expect(result.ok).toBe(true);
        expect(result.content).toContain('已清理 1 本孤儿向量');
        expect(result.content).toContain('1 本未删除');
        expect(deps.diagnose.collectKnowledge).toHaveBeenCalledTimes(1);
        expect(result.data).toMatchObject({ action: 'cleanup_orphan_vectors', orphanCount: 2, removed: ['g1'], skipped: ['g2'] });
    });

    it('对账无孤儿：ok:true「无需清理」（不是失败），复诊确认检索健康', async () => {
        const deps = makeDeps({ cleanupOrphanVectors: vi.fn(async () => ({ orphanCount: 0, removed: [], skipped: [] })) });
        const result = await run(deps, { action: 'cleanup_orphan_vectors' });
        expect(result.ok).toBe(true);
        expect(result.content).toContain('没有孤儿向量');
        expect(deps.diagnose.collectKnowledge).toHaveBeenCalledTimes(1);
    });

    it('宿主返回非法结构（removed 非数组）→ ok:false（不把「不知道」当成功）', async () => {
        const deps = makeDeps({ cleanupOrphanVectors: vi.fn(async () => ({ orphanCount: 1 } as never)) });
        const result = await run(deps, { action: 'cleanup_orphan_vectors' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('无法确认结果');
    });
});

describe('阶段 E 深化：fix_zero_intensity', () => {
    it('宿主未提供能力 → ok:false 并说明', async () => {
        const deps = makeDeps({ fixZeroIntensity: undefined });
        const result = await run(deps, { action: 'fix_zero_intensity' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('未提供强度修复能力');
        expect(deps.diagnose.collectStyle).not.toHaveBeenCalled();
    });

    it('全部写入失败 → ok:false（不谎报修复成功）', async () => {
        const deps = makeDeps({ fixZeroIntensity: vi.fn(async () => ({ fixed: [], failed: ['fp1', 'fp2'] })) });
        const result = await run(deps, { action: 'fix_zero_intensity' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('2 枚指纹写入出错');
        expect(deps.diagnose.collectStyle).not.toHaveBeenCalled();
    });

    it('部分成功 → ok:true 如实带失败数，复诊风格流', async () => {
        const deps = makeDeps({ fixZeroIntensity: vi.fn(async () => ({ fixed: ['fp1'], failed: ['fp2'] })) });
        const result = await run(deps, { action: 'fix_zero_intensity' });
        expect(result.ok).toBe(true);
        expect(result.content).toContain('已恢复 1 枚指纹的强度');
        expect(result.content).toContain('1 枚写入失败');
        expect(deps.diagnose.collectStyle).toHaveBeenCalledTimes(1);
    });

    it('没有强度为 0 的指纹：ok:true「无需修复」', async () => {
        const deps = makeDeps({ fixZeroIntensity: vi.fn(async () => ({ fixed: [], failed: [] })) });
        const result = await run(deps, { action: 'fix_zero_intensity' });
        expect(result.ok).toBe(true);
        expect(result.content).toContain('没有强度为 0 的启用指纹');
    });
});

describe('修复：失败必须如实报错', () => {
    it('宿主未提供重向量化能力 → ok:false 并说明', async () => {
        const deps = makeDeps({ revectorizeBook: undefined });
        const result = await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('未提供单本重向量化能力');
    });

    it('宿主未提供指纹重载能力 → ok:false 并说明', async () => {
        const deps = makeDeps({ reloadFingerprints: undefined });
        const result = await run(deps, { action: 'reload_fingerprints' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('未提供指纹库重载能力');
        expect(deps.diagnose.collectStyle).not.toHaveBeenCalled();
    });

    it('重向量化返回 ok:false → 不谎报成功，也不复诊', async () => {
        const deps = makeDeps({ revectorizeBook: vi.fn(async () => ({ ok: false, detail: '模型 404' })) });
        const result = await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('模型 404');
        expect(deps.diagnose.collectKnowledge).not.toHaveBeenCalled();
    });

    it('修复抛异常 → ok:false 带异常信息，并提示需重新诊断', async () => {
        const deps = makeDeps({ revectorizeBook: vi.fn(async () => { throw new Error('磁盘只读'); }) });
        const result = await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('磁盘只读');
        expect(result.content).toContain('重新诊断');
    });

    it('指纹重载返回无法解析的条数 → ok:false（不把「不知道」当成功）', async () => {
        const deps = makeDeps({
            reloadFingerprints: vi.fn(async () => ({ template: Number.NaN, global: 0, project: 0 })),
        });
        const result = await run(deps, { action: 'reload_fingerprints' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('无法确认重载结果');
    });

    it('复诊本身失败 → ok:false（修复成功但无法确认效果，也要说清楚）', async () => {
        const deps = makeDeps({
            diagnose: makeDiagnose({
                collectKnowledge: vi.fn(async () => { throw new Error('知识库未初始化'); }),
            }),
        });
        const result = await run(deps, { action: 'revectorize_book', bookId: 'kb_a' });
        expect(result.ok).toBe(false);
        expect(result.content).toContain('知识库未初始化');
    });
});
