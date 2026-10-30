import { describe, expect, it } from 'vitest';
import {
    BODY_INJECTION_SEGMENTS,
    buildInjectionLedger,
    formatInjectionLedger,
} from '../../../shared/injection-ledger';

describe('injection-ledger — 影响矩阵', () => {
    it('V2 模板的全部注入段都有定义', () => {
        const keys = BODY_INJECTION_SEGMENTS.map((segment) => segment.key);
        // 上轮新增与长期关键段必须在矩阵里
        for (const key of ['entityRelations', 'infoPlan', 'longTermMemory', 'writingStyleContent', 'worldView', 'settingLib', 'allChars']) {
            expect(keys, key).toContain(key);
        }
        // 段 key 不重复
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('影响面分类：文风/指纹是风格指引，长篇记忆是事实记忆', () => {
        const byKey = new Map(BODY_INJECTION_SEGMENTS.map((segment) => [segment.key, segment]));
        expect(byKey.get('writingStyleContent')?.influence).toBe('风格指引');
        expect(byKey.get('sceneStyleSnippet')?.influence).toBe('风格指引');
        expect(byKey.get('humanVoice')?.influence).toBe('风格指引');
        expect(byKey.get('longTermMemory')?.influence).toBe('事实记忆');
        expect(byKey.get('entityRelations')?.influence).toBe('事实记忆');
        expect(byKey.get('timelineEvents')?.influence).toBe('事实记忆');
    });
});

describe('injection-ledger — 账本生成', () => {
    it('统计各段字符数与估算 token，空段记 0', () => {
        const vars = {
            worldView: '这是一个修行世界。',
            settingLib: '',
            infoPlan: '本章核心冲突：X',
        };
        const ledger = buildInjectionLedger(vars);
        const world = ledger.entries.find((entry) => entry.key === 'worldView')!;
        const setting = ledger.entries.find((entry) => entry.key === 'settingLib')!;
        expect(world.chars).toBe('这是一个修行世界。'.length);
        expect(world.estTokens).toBe(Math.ceil(world.chars / 1.5));
        expect(setting.chars).toBe(0);
        expect(ledger.entries.length).toBe(BODY_INJECTION_SEGMENTS.length);
    });

    it('预算与截断标记透传，汇总计数正确', () => {
        const vars = { worldView: 'A'.repeat(9000), settingLib: 'B'.repeat(200) };
        const ledger = buildInjectionLedger(vars, {
            budgets: { worldView: { budget: 8000, truncated: true, strength: '总线覆盖' } },
        });
        expect(ledger.truncatedCount).toBe(1);
        const world = ledger.entries.find((entry) => entry.key === 'worldView')!;
        expect(world.budget).toBe(8000);
        expect(world.truncated).toBe(true);
        expect(world.strength).toBe('总线覆盖');
        const setting = ledger.entries.find((entry) => entry.key === 'settingLib')!;
        expect(setting.budget).toBeUndefined();
    });

    it('extra 追加指纹分层等运行时段', () => {
        const ledger = buildInjectionLedger({}, {
            extra: [{
                key: 'fingerprintTiers',
                label: '写作指纹分层',
                category: '写作指纹',
                influence: '风格指引',
                source: 'TieredInjectionBuilder',
                chars: 1800,
                estTokens: 1200,
                placement: 'system',
                budget: 2000,
                truncated: false,
                strength: '强度 0.5',
            }],
        });
        expect(ledger.entries.some((entry) => entry.key === 'fingerprintTiers')).toBe(true);
        expect(ledger.totalChars).toBe(1800);
    });
});

describe('injection-ledger — 渲染', () => {
    it('formatInjectionLedger 输出影响面与截断警告', () => {
        const ledger = buildInjectionLedger({ worldView: '世界' }, {
            budgets: { worldView: { budget: 8000, truncated: true } },
            extra: [{
                key: 'fingerprintTiers',
                label: '写作指纹分层',
                category: '写作指纹',
                influence: '风格指引',
                source: '分层注入',
                chars: 1500,
                estTokens: 1000,
                placement: 'system',
            }],
        });
        const text = formatInjectionLedger(ledger);
        expect(text).toContain('【注入溯源】');
        expect(text).toContain('⚠ 1 段被截断');
        expect(text).toContain('[风格指引] 写作指纹分层：1500 字');
        expect(text).toContain('[事实记忆] 世界观：');
        // 空段不渲染
        expect(text).not.toContain('设定库：');
    });
});
