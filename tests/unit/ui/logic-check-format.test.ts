/**
 * 阶段 D1：人物逻辑检查的展示映射
 *
 * 从 `ui/co-write-floating-panel.ts` 抽出。抽出的核心价值：
 * **新增一个不一致类型却忘了加中文标签，界面会直接显示英文 key**
 * （如 `appearance` 变成英文），这类回归此前零测试覆盖。
 */

import { describe, expect, it } from 'vitest';
import {
    listLogicTypeKeys,
    resolveLogicScoreColor,
    resolveLogicTypeLabel,
    resolveSeverityMeta,
} from '../../../ui/co-write/logic-check-format';

describe('D1-16：逻辑检查得分颜色', () => {
    it('>=80 绿、>=60 橙、其余红', () => {
        expect(resolveLogicScoreColor(80)).toBe('#10b981');
        expect(resolveLogicScoreColor(79)).toBe('#f59e0b');
        expect(resolveLogicScoreColor(60)).toBe('#f59e0b');
        expect(resolveLogicScoreColor(59)).toBe('#ef4444');
    });

    it('边界值精确（80 / 60 是分界）', () => {
        expect(resolveLogicScoreColor(100)).toBe('#10b981');
        expect(resolveLogicScoreColor(0)).toBe('#ef4444');
    });

    it('非法值兜底为红色（不产生 undefined 颜色）', () => {
        expect(resolveLogicScoreColor(undefined)).toBe('#ef4444');
        expect(resolveLogicScoreColor(NaN)).toBe('#ef4444');
    });
});

describe('D1-17：严重度映射', () => {
    it('三档各有颜色/emoji/标签', () => {
        expect(resolveSeverityMeta('high')).toEqual({ color: '#ef4444', icon: '🔴', label: '高' });
        expect(resolveSeverityMeta('medium')).toEqual({ color: '#f59e0b', icon: '🟡', label: '中' });
        expect(resolveSeverityMeta('low')).toEqual({ color: '#3b82f6', icon: '🟢', label: '低' });
    });

    it('未知严重度按 low 处理（不产生空白颜色）', () => {
        expect(resolveSeverityMeta('critical')).toEqual(resolveSeverityMeta('low'));
        expect(resolveSeverityMeta(undefined).color).toBeTruthy();
    });
});

describe('D1-18：不一致类型中文标签', () => {
    it('四种已知类型都有中文标签', () => {
        expect(resolveLogicTypeLabel('personality')).toBe('性格语气');
        expect(resolveLogicTypeLabel('behavior')).toBe('行为逻辑');
        expect(resolveLogicTypeLabel('ability')).toBe('能力边界');
        expect(resolveLogicTypeLabel('appearance')).toBe('外貌描述');
    });

    it('已知类型列表与标签表一致（防止只加 key 忘加标签）', () => {
        const keys = listLogicTypeKeys();
        expect(keys.sort()).toEqual(['ability', 'appearance', 'behavior', 'personality']);
        // 每个 key 都必须有非空中文标签
        for (const key of keys) {
            const label = resolveLogicTypeLabel(key);
            expect(label).toBeTruthy();
            expect(label).not.toBe(key);  // 不应回落到英文 key
        }
    });

    it('未知类型回落到原 key（便于排查漏配，而不是显示空白）', () => {
        expect(resolveLogicTypeLabel('newType')).toBe('newType');
    });

    it('空类型显示「未知类型」而不是空串', () => {
        expect(resolveLogicTypeLabel('')).toBe('未知类型');
        expect(resolveLogicTypeLabel(undefined)).toBe('未知类型');
    });
});
