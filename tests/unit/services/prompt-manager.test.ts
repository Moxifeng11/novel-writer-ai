import { describe, expect, it } from 'vitest';
import {
    PromptManager,
    normalizePromptManagerConfig,
    validatePromptManagerImport,
} from '../../../services/prompt-manager';
import type { PromptManagerConfig, PromptTemplate } from '../../../shared/prompt-manager-types';
import { BODY_GENERATION_SYSTEM_PROMPT_V2, BODY_GENERATION_USER_TEMPLATE_V2 } from '../../../shared/prompts/body-v2-prompts';

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

describe('PromptManager — 使用记录分页与清空（功能缺口 ④）', () => {
    function seededManager(count: number) {
        const usageHistory = Array.from({ length: count }, (_, i) => ({
            id: `u${i}`,
            templateId: i % 2 === 0 ? 'custom-1' : 'chapter',
            version: 'v1',
            timestamp: i + 1,
        }));
        return makeManager({ usageHistory });
    }

    it('分页返回本页记录与总数，最新在前', () => {
        const { manager } = seededManager(45);

        const first = manager.getUsageHistoryPage(0, 20);
        expect(first.total).toBe(45);
        expect(first.records).toHaveLength(20);
        expect(first.records[0].id).toBe('u44');
        expect(first.records[19].id).toBe('u25');

        const second = manager.getUsageHistoryPage(20, 20);
        expect(second.records).toHaveLength(20);
        expect(second.records[0].id).toBe('u24');
        expect(second.records[19].id).toBe('u5');

        const third = manager.getUsageHistoryPage(40, 20);
        expect(third.records.map(r => r.id)).toEqual(['u4', 'u3', 'u2', 'u1', 'u0']);
    });

    it('分页可按模板过滤，越界页返回空记录但总数仍正确', () => {
        const { manager } = seededManager(10);
        const filtered = manager.getUsageHistoryPage(0, 3, 'custom-1');
        expect(filtered.total).toBe(5);
        expect(filtered.records.map(r => r.id)).toEqual(['u8', 'u6', 'u4']);

        const beyond = manager.getUsageHistoryPage(999, 20);
        expect(beyond.total).toBe(10);
        expect(beyond.records).toEqual([]);
    });

    it('清空使用记录后落盘且列表为空', async () => {
        const { manager, saved } = seededManager(3);
        await manager.clearUsageHistory();
        await tick();
        expect(manager.getUsageHistoryPage(0, 20).total).toBe(0);
        expect(saved.length).toBeGreaterThan(0);
    });
});

describe('PromptManager — 导入 dry-run 与合并模式（功能缺口 ④）', () => {
    it('parseImportPayload 不改内存，坏 JSON 给出具体原因', () => {
        const { manager } = makeManager();
        const broken = manager.parseImportPayload('{broken');
        expect(broken.ok).toBe(false);
        if (!broken.ok) expect(broken.error).toBe('JSON 解析失败');

        const wrong = manager.parseImportPayload(JSON.stringify({ customTemplates: {} }));
        expect(wrong.ok).toBe(false);
        expect(manager.getAllTemplates().some(t => t.id === 'custom-1')).toBe(false);
    });

    it('merge 导入：同名模板覆盖版本，未提到的模板与使用记录保留', async () => {
        const { manager } = makeManager({
            customTemplates: [template('keep')],
            usageHistory: [{ id: 'u1', templateId: 'keep', version: 'v1', timestamp: 1 }],
            abTestingEnabled: false,
        });
        const payload = {
            customTemplates: [template('custom-2')],
            abTests: [],
            usageHistory: [{ id: 'u2', templateId: 'custom-2', version: 'v1', timestamp: 2 }],
            abTestingEnabled: true,
        };

        expect(manager.importConfig(JSON.stringify(payload), 'merge')).toBe(true);
        await tick();

        const ids = manager.getAllTemplates().map(t => t.id);
        expect(ids).toContain('keep');
        expect(ids).toContain('custom-2');
        expect(manager.getUsageHistory(undefined, 10).map(r => r.id).sort()).toEqual(['u1', 'u2']);
        expect(manager.isABTestingEnabled()).toBe(false);
    });

    it('replace 导入：整份替换，未提到的模板被移除', async () => {
        const { manager } = makeManager({ customTemplates: [template('keep')] });
        const payload = {
            customTemplates: [template('custom-2')],
            abTests: [],
            usageHistory: [],
            abTestingEnabled: false,
        };
        expect(manager.importConfig(JSON.stringify(payload), 'replace')).toBe(true);
        await tick();
        expect(manager.getAllTemplates().map(t => t.id)).not.toContain('keep');
        expect(manager.getAllTemplates().map(t => t.id)).toContain('custom-2');
    });
});

/**
 * 2026-11-28：body-generation-v2 默认文本此前是一份过期草稿（缺 humanVoice/
 * protocolLines/timeContext 等，用户一旦编辑就会把过期文本整体顶掉真模板）。
 * 现与 engine/prompts/body-v2-prompts.ts 同源。另锁 fillTemplate 的 $ 序列安全。
 */
describe('默认模板与 canonical 同源', () => {
    it('body-generation-v2 默认文本必须等于 canonical 常量', () => {
        const pm = new PromptManager({ getConfig: () => ({}), setConfig: async () => { /* test stub */ } });
        const tpl = pm.getTemplateById('body-generation-v2');
        expect(tpl).not.toBeNull();
        const ver = (tpl as PromptTemplate).versions[0];
        expect(ver.systemPrompt).toBe(BODY_GENERATION_SYSTEM_PROMPT_V2);
        expect(ver.userPrompt).toBe(BODY_GENERATION_USER_TEMPLATE_V2);
    });

    it('fillTemplate 不解释 $& / $` / $\' / $$ 序列', () => {
        const pm = new PromptManager({ getConfig: () => ({}), setConfig: async () => { /* test stub */ } });
        const rendered = (pm as unknown as {
            fillTemplate: (t: string, v: Record<string, string>) => string;
        }).fillTemplate('${a}', { a: '$&' });
        expect(rendered).toBe('$&');
    });
});
