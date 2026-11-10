import { describe, expect, it } from 'vitest';
import {
    PromptManager,
    normalizePromptManagerConfig,
    validatePromptManagerImport,
} from '../../../services/prompt-manager';
import type { PromptManagerConfig, PromptTemplate } from '../../../shared/prompt-manager-types';

/**
 * C2-4（覆盖率审计二轮）：PromptManager 整类此前零覆盖，`importConfig` 直接
 * `{...DEFAULT, ...JSON.parse}` 后异步落盘——任意形状都会“导入成功”并持久化。
 * 这里锁住：合法导入只写一次、非法 JSON/错误形状/未知字段整份拒绝且不写盘、
 * 磁盘坏配置按条目过滤而不是让整类崩掉。
 */
function template(id: string): PromptTemplate {
    return {
        id,
        name: `模板-${id}`,
        category: 'chapter',
        description: '',
        versions: [{ version: 'v1', createdAt: 1, systemPrompt: 'sys', userPrompt: 'user', isActive: true }],
        variables: [],
        createdAt: 1,
        updatedAt: 1,
    };
}

function makeManager(initial: Record<string, unknown> = {}) {
    const saved: Array<Partial<PromptManagerConfig>> = [];
    const manager = new PromptManager({
        getConfig: () => initial,
        setConfig: async (config) => { saved.push(config); },
    });
    return { manager, saved };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('PromptManager — 导入配置校验（C2-4）', () => {
    it('合法配置只写一次，模板立即生效', async () => {
        const { manager, saved } = makeManager();
        const valid = {
            customTemplates: [template('custom-1')],
            abTests: [],
            usageHistory: [],
            abTestingEnabled: true,
        };

        expect(manager.importConfig(JSON.stringify(valid))).toBe(true);
        await tick();

        expect(saved).toHaveLength(1);
        expect(manager.isABTestingEnabled()).toBe(true);
        expect(manager.getAllTemplates().some(t => t.id === 'custom-1')).toBe(true);
    });

    it('非法 JSON / 错误形状 / 未知字段：拒绝且不写盘', async () => {
        const { manager, saved } = makeManager();
        const badCases = [
            '{broken',
            JSON.stringify({ customTemplates: {} }),
            JSON.stringify({ customTemplates: [], abTests: [], usageHistory: [] }),
            JSON.stringify({ customTemplates: [], abTests: [], usageHistory: [], abTestingEnabled: 'yes' }),
            JSON.stringify({ customTemplates: [{ id: 'x' }], abTests: [], usageHistory: [], abTestingEnabled: false }),
            JSON.stringify({ customTemplates: [], abTests: [], usageHistory: [], abTestingEnabled: false, evil: 1 }),
        ];

        for (const json of badCases) {
            expect(manager.importConfig(json), json).toBe(false);
        }
        await tick();
        expect(saved).toHaveLength(0);
        expect(manager.isABTestingEnabled()).toBe(false);
    });

    it('拒绝导入不会破坏已有内存配置', async () => {
        const { manager } = makeManager({ customTemplates: [template('keep')], abTestingEnabled: true });
        expect(manager.importConfig(JSON.stringify({ customTemplates: {} }))).toBe(false);
        expect(manager.getAllTemplates().some(t => t.id === 'keep')).toBe(true);
        expect(manager.isABTestingEnabled()).toBe(true);
    });

    it('磁盘配置损坏时按条目过滤：坏数组回退空、坏条目丢弃，不崩溃', () => {
        const normalized = normalizePromptManagerConfig({
            customTemplates: [template('good'), { id: 'bad' }],
            abTests: 'oops',
            usageHistory: [null, { id: 'u1', templateId: 't1', version: 'v1', timestamp: 1 }],
            abTestingEnabled: 'yes',
        });

        expect(normalized.customTemplates.map(t => t.id)).toEqual(['good']);
        expect(normalized.abTests).toEqual([]);
        expect(normalized.usageHistory.map(u => u.id)).toEqual(['u1']);
        expect(normalized.abTestingEnabled).toBe(false);
    });

    it('validatePromptManagerImport 返回具体错误原因', () => {
        const rejected = validatePromptManagerImport({ customTemplates: [], abTests: [], usageHistory: [], abTestingEnabled: false, extra: true });
        expect(rejected.ok).toBe(false);
        if (!rejected.ok) expect(rejected.error).toContain('未知配置字段');
    });
});
