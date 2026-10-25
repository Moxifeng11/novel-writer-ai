import { afterEach, describe, expect, it } from 'vitest';
import {
    clearBudgetSnapshots,
    getBudgetSnapshots,
    recordBudgetSnapshot,
} from '../../../shared/budget-telemetry';

afterEach(() => clearBudgetSnapshots());

describe('budget-telemetry', () => {
    it('只保留最近 20 条', () => {
        for (let i = 0; i < 25; i += 1) {
            recordBudgetSnapshot({ source: 'api', inputTokens: i, overBudget: false });
        }
        const snapshots = getBudgetSnapshots();
        expect(snapshots).toHaveLength(20);
        expect(snapshots[0].inputTokens).toBe(5);
        expect(snapshots[19].inputTokens).toBe(24);
    });

    it('返回副本，调用方修改不污染内部缓冲', () => {
        recordBudgetSnapshot({
            source: 'chapter',
            droppedSections: ['knowledge.injection'],
            overBudget: true,
        });
        const snapshots = getBudgetSnapshots();
        snapshots[0].droppedSections.push('tail');
        snapshots[0].overBudget = false;

        const again = getBudgetSnapshots();
        expect(again[0].droppedSections).toEqual(['knowledge.injection']);
        expect(again[0].overBudget).toBe(true);
    });

    it('记录预算指标与来源', () => {
        recordBudgetSnapshot({
            source: 'scene',
            model: 'qwen2.5:7b',
            inputTokens: 6000,
            availableTokens: 1200,
            contextWindow: 8192,
            maxInputTokens: 7000,
            droppedSections: [],
            trimmedSections: ['knowledge.onDemand'],
            overBudget: false,
        });

        const [snapshot] = getBudgetSnapshots();
        expect(snapshot.source).toBe('scene');
        expect(snapshot.model).toBe('qwen2.5:7b');
        expect(snapshot.inputTokens).toBe(6000);
        expect(snapshot.trimmedSections).toEqual(['knowledge.onDemand']);
        expect(snapshot.overBudget).toBe(false);
    });
});
