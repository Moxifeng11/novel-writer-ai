/**
 * repair-telemetry.test.ts — 修复遥测纯逻辑回归（阶段 E 深化③）
 *
 * 遥测要回答「本会话修过什么、成没成」，所以必须只统计真实修复动作：
 * 诊断等读操作不得污染、缺 data.action 的调用不记、超上限截断、动作名可读化。
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_REPAIR_ENTRIES,
    REPAIR_TOOL_NAME,
    recordRepairFromToolCall,
    resolveRepairActionLabel,
    summarizeRepairs,
    toRepairEntry,
    type RepairTelemetryEntry,
} from '../../../engine/agent/harness/repair-telemetry';

describe('toRepairEntry：只认真实修复调用', () => {
    it('repair_flow + data.action → 生成记录（ok 透传）', () => {
        const entry = toRepairEntry({
            tool: REPAIR_TOOL_NAME,
            ok: true,
            summary: '已清理 1 本孤儿向量（对账发现 1 本）。\n\n修复后链路状态：…',
            data: { action: 'cleanup_orphan_vectors' },
        }, 1000);
        expect(entry).toEqual({
            action: 'cleanup_orphan_vectors',
            ok: true,
            summary: '已清理 1 本孤儿向量（对账发现 1 本）。',
            at: 1000,
        });
    });

    it('非 repair_flow 工具（诊断/写文件）→ null（读操作不污染修复遥测）', () => {
        expect(toRepairEntry({ tool: 'diagnose_flow', ok: true, summary: '知识流：已通', data: { flow: 'knowledge' } })).toBeNull();
        expect(toRepairEntry({ tool: 'write_file', ok: true, summary: 'ok', data: {} })).toBeNull();
    });

    it('repair_flow 但缺 action / action 为空 → null（不记「不知道修了什么」的条目）', () => {
        expect(toRepairEntry({ tool: REPAIR_TOOL_NAME, ok: true, summary: 'x' })).toBeNull();
        expect(toRepairEntry({ tool: REPAIR_TOOL_NAME, ok: true, summary: 'x', data: {} })).toBeNull();
        expect(toRepairEntry({ tool: REPAIR_TOOL_NAME, ok: true, summary: 'x', data: { action: '   ' } })).toBeNull();
        expect(toRepairEntry({ tool: REPAIR_TOOL_NAME, ok: true, summary: 'x', data: { action: 42 } })).toBeNull();
    });

    it('失败修复也记（ok:false 原样保留，供面板区分）', () => {
        const entry = toRepairEntry({ tool: REPAIR_TOOL_NAME, ok: false, summary: '重向量化失败：模型 404', data: { action: 'revectorize_book' } }, 1);
        expect(entry).toMatchObject({ action: 'revectorize_book', ok: false, summary: '重向量化失败：模型 404' });
    });

    it('长摘要截断到 60 字并加省略号（面板不撑破）', () => {
        const long = 'x'.repeat(120);
        const entry = toRepairEntry({ tool: REPAIR_TOOL_NAME, ok: true, summary: long, data: { action: 'reload_fingerprints' } }, 1);
        expect(entry?.summary.length).toBe(61); // 60 + '…'
        expect(entry?.summary.endsWith('…')).toBe(true);
    });
});


describe('resultSummary 优先（记「改成了什么」而不是「参数是什么」）', () => {
    it('有 resultSummary 时用它做摘要', () => {
        const entry = toRepairEntry({
            tool: REPAIR_TOOL_NAME,
            ok: true,
            summary: 'reload_fingerprints',           // 参数摘要
            resultSummary: '已重载指纹库：模板 1 / 全局 2 / 项目 3。',
            data: { action: 'reload_fingerprints' },
        }, 1);
        expect(entry?.summary).toBe('已重载指纹库：模板 1 / 全局 2 / 项目 3。');
    });

    it('无 resultSummary 时退回参数摘要（不产生空摘要）', () => {
        const entry = toRepairEntry({
            tool: REPAIR_TOOL_NAME,
            ok: true,
            summary: 'revectorize_book kb_a',
            data: { action: 'revectorize_book' },
        }, 1);
        expect(entry?.summary).toBe('revectorize_book kb_a');
    });
});

describe('recordRepairFromToolCall：累积语义', () => {
    it('新记录插到队首（面板按新→旧展示）', () => {
        const repairs: RepairTelemetryEntry[] = [];
        recordFirst(repairs, 'revectorize_book', 1);
        recordRepairFromToolCall(repairs, { tool: REPAIR_TOOL_NAME, ok: true, summary: 'b', data: { action: 'reload_fingerprints' } }, 2);
        expect(repairs.map(r => r.action)).toEqual(['reload_fingerprints', 'revectorize_book']);
    });

    it('非修复调用不改变列表（返回 false）', () => {
        const repairs: RepairTelemetryEntry[] = [];
        const recorded = recordRepairFromToolCall(repairs, { tool: 'diagnose_flow', ok: true, summary: 'x', data: { flow: 'all' } }, 1);
        expect(recorded).toBe(false);
        expect(repairs).toEqual([]);
    });

    it(`超过 ${MAX_REPAIR_ENTRIES} 条时截断最旧记录`, () => {
        const repairs: RepairTelemetryEntry[] = [];
        for (let i = 0; i < MAX_REPAIR_ENTRIES + 3; i++) {
            recordRepairFromToolCall(repairs, { tool: REPAIR_TOOL_NAME, ok: true, summary: `s${i}`, data: { action: 'revectorize_book' } }, i);
        }
        expect(repairs).toHaveLength(MAX_REPAIR_ENTRIES);
        expect(repairs[0].at).toBe(MAX_REPAIR_ENTRIES + 2); // 最新在最前
    });
});

describe('summarizeRepairs / resolveRepairActionLabel', () => {
    const entries: RepairTelemetryEntry[] = [
        { action: 'cleanup_orphan_vectors', ok: true, summary: '', at: 3 },
        { action: 'revectorize_book', ok: false, summary: '', at: 2 },
        { action: 'reload_fingerprints', ok: true, summary: '', at: 1 },
    ];

    it('汇总：次数/成功/失败/最近一条可读描述', () => {
        expect(summarizeRepairs(entries)).toEqual({
            attempts: 3,
            ok: 2,
            failed: 1,
            latest: '清理孤儿向量·成功',
        });
    });

    it('最近一条失败时 latest 标「失败」', () => {
        const failedFirst: RepairTelemetryEntry[] = [
            { action: 'rerun_canon_research', ok: false, summary: '', at: 5 },
            ...entries,
        ];
        expect(summarizeRepairs(failedFirst).latest).toBe('重跑考据·失败');
    });

    it('空列表：attempts=0、latest=null（面板据此不渲染修复行）', () => {
        expect(summarizeRepairs([])).toEqual({ attempts: 0, ok: 0, failed: 0, latest: null });
    });

    it('六个动作都有中文短语；未知动作原样返回', () => {
        for (const action of ['revectorize_book', 'reload_fingerprints', 'cleanup_orphan_vectors', 'fix_zero_intensity', 'cleanup_disk_vectors', 'rerun_canon_research']) {
            expect(resolveRepairActionLabel(action)).not.toBe(action);
        }
        expect(resolveRepairActionLabel('some_future_action')).toBe('some_future_action');
    });
});

/** 测试辅助：记一条 revectorize 记录 */
function recordFirst(repairs: RepairTelemetryEntry[], action: string, at: number): void {
    recordRepairFromToolCall(repairs, { tool: REPAIR_TOOL_NAME, ok: true, summary: 'a', data: { action } }, at);
}
