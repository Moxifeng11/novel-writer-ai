import { describe, expect, it } from 'vitest';
import { EntityRecheckGate } from '../../../shared/entity-recheck-gate';
import { GUARD_INPUT_COOLDOWN_MS } from '../../../shared/thresholds';

/**
 * W-7（2026-11-10 审计）回归：正文修改触发的 AI 实体重检此前只有「内容哈希
 * 跳过」，连续写作时每 2s 内容都变，每次停顿仍发一次 AI。冷却闸门要求：
 * 同路径在冷却窗口内不重复放行，内容变化只更新哈希、冷却后再检最新内容。
 */

const COOLDOWN = GUARD_INPUT_COOLDOWN_MS; // 5 分钟

describe('EntityRecheckGate — 冷却闸门', () => {
    it('同内容重复触发不放行（镜像 P1-16）', () => {
        const gate = new EntityRecheckGate();
        const t0 = 1_000_000;
        expect(gate.shouldRun('正文A', '120:结尾', t0)).toBe(true);
        expect(gate.shouldRun('正文A', '120:结尾', t0 + 1_000)).toBe(false);
        expect(gate.shouldRun('正文A', '120:结尾', t0 + COOLDOWN * 2)).toBe(false);
    });

    it('冷却内被延迟的内容，冷却后即使不再变化也能补检一次', () => {
        const gate = new EntityRecheckGate();
        const t0 = 1_000_000;
        expect(gate.shouldRun('正文A', '100:一', t0)).toBe(true);
        expect(gate.shouldRun('正文A', '150:一尾', t0 + 2_000)).toBe(false);
        expect(gate.shouldRun('正文A', '200:二', t0 + 4_000)).toBe(false);
        // 停止编辑后不再有新事件；冷却结束后同一内容到达（如切回/保存）→ 必须补检
        expect(gate.shouldRun('正文A', '200:二', t0 + COOLDOWN + 1)).toBe(true);
        // 补检后同内容不再重复
        expect(gate.shouldRun('正文A', '200:二', t0 + COOLDOWN + 2_000)).toBe(false);
    });

    it('冷却结束后的新内容放行', () => {
        const gate = new EntityRecheckGate();
        const t0 = 1_000_000;
        expect(gate.shouldRun('正文A', '100:一', t0)).toBe(true);
        expect(gate.shouldRun('正文A', '180:二', t0 + COOLDOWN + 1)).toBe(true);
    });

    it('不同路径互相独立', () => {
        const gate = new EntityRecheckGate();
        const t0 = 1_000_000;
        expect(gate.shouldRun('正文A', '100:一', t0)).toBe(true);
        expect(gate.shouldRun('正文B', '100:一', t0 + 1_000)).toBe(true);
    });

    it('超上限淘汰最旧路径', () => {
        const gate = new EntityRecheckGate(COOLDOWN, 2);
        const t0 = 1_000_000;
        gate.shouldRun('A', 'a', t0);
        gate.shouldRun('B', 'b', t0);
        gate.shouldRun('C', 'c', t0); // A 被淘汰
        // A 重新触发 → 放行（登记已丢）；插入 A 使 B 成为最旧被淘汰 → C 仍在冷却
        expect(gate.shouldRun('A', 'a2', t0 + 1_000)).toBe(true);
        expect(gate.shouldRun('C', 'c2', t0 + 1_000)).toBe(false);
    });

    it('默认冷却取 thresholds 唯一来源（5 分钟）', () => {
        const gate = new EntityRecheckGate();
        const t0 = 1_000_000;
        expect(gate.shouldRun('正文A', '100:一', t0)).toBe(true);
        expect(gate.shouldRun('正文A', '200:二', t0 + COOLDOWN - 1)).toBe(false);
        expect(gate.shouldRun('正文A', '200:二', t0 + COOLDOWN)).toBe(true);
    });

    it('reset 可按路径清空', () => {
        const gate = new EntityRecheckGate();
        const t0 = 1_000_000;
        expect(gate.shouldRun('正文A', '100:一', t0)).toBe(true);
        gate.reset('正文A');
        expect(gate.shouldRun('正文A', '100:一', t0 + 1_000)).toBe(true);
    });
});
