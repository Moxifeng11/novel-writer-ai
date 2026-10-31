import { describe, expect, it, vi } from 'vitest';

// settings-service 反向引用 main.ts 的 DEFAULT_PROVIDERS；用最小桩替代，避免加载构建产物。
vi.mock('../../../main', () => ({
    DEFAULT_PROVIDERS: {
        volc: { id: 'volc', name: '火山引擎', endpoint: '', models: ['volc-model'], maxContext: 1, maxOutput: 1 },
    },
    default: class NovelWriterPlugin {},
}));

import { deepMergeSettings, getDefaultSettings } from '../../../core/settings-service';

describe('settings-service — 版本治理默认值（v4.23）', () => {
    it('新增的四项默认值符合"可测但不改变既有行为"的口径', () => {
        const settings = getDefaultSettings();
        // 规则版本留空 = 按 project > vault > builtin 自动选择
        expect(settings.activeRulesVersion).toBe('');
        // 正文模板 auto = 有灵魂层走 V2
        expect(settings.activeBodyTemplate).toBe('auto');
        // 人味默认样文版（v5 弱约束）
        expect(settings.humanVoiceMode).toBe('exemplar');
        // 规则去重默认开：不再把规则副本塞进「文笔风格」
        expect(settings.dedupeRulesInStyle).toBe(true);
        // 实验分组留空
        expect(settings.experimentGroup).toBe('');
        // 可数硬指标默认关（实验 C9 才开）
        expect(settings.countableHumanHints).toBe(false);
        // v4.25 用户决策：修订/复检默认自动（闸门+版本备份兜底，每章 +2 次调用）
        expect(settings.autoRevisionAfterQC).toBe(true);
        expect(settings.autoRecheckAfterRevision).toBe(true);
        // 上下文体检默认开（重复段自动清空，串章只告警）
        expect(settings.contextHygieneAutoFix).toBe(true);
    });

    it('deepMergeSettings 保留旧配置里的显式取值（不被默认值覆盖）', () => {
        const merged = deepMergeSettings(getDefaultSettings(), {
            humanVoiceMode: 'quota',
            activeRulesVersion: 'builtin:3.6.0-legacy',
            dedupeRulesInStyle: false,
            experimentGroup: 'R1-G0',
        });
        expect(merged.humanVoiceMode).toBe('quota');
        expect(merged.activeRulesVersion).toBe('builtin:3.6.0-legacy');
        expect(merged.dedupeRulesInStyle).toBe(false);
        expect(merged.experimentGroup).toBe('R1-G0');
        // 未提供的键仍取默认值
        expect(merged.activeBodyTemplate).toBe('auto');
    });
});
