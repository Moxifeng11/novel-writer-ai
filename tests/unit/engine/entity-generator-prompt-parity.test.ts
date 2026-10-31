import { describe, expect, it, vi } from 'vitest';
import { EntityGenerator } from '../../../engine/ai-entity-generator';
import { ENGINE_NAMES } from '../../../shared/engine-names';

interface Captured {
    system: string;
    user: string;
}

function makeGenerator() {
    const calls: Captured[] = [];
    const promptKeys: string[] = [];
    const templateService = {
        getCustomPrompt: vi.fn(async (key: string, def: Captured) => {
            promptKeys.push(key);
            return def;
        }),
    };
    const plugin = {
        settings: { proModel: 'pro', maxOutput: 4096 },
        engineRegistry: { get: vi.fn(() => templateService) },
    } as any;
    const apiClient = {
        callAI: vi.fn(async (system: string, user: string) => {
            calls.push({ system, user });
            return { content: '' };
        }),
    } as any;
    return { generator: new EntityGenerator(plugin, apiClient), calls, promptKeys, templateService };
}

describe('EntityGenerator prompt 契约（批次 4 收敛前后保持字节一致）', () => {
    it('势力：必填项 / 示例标题 / 角色称谓 / 用户 prompt 对象名', async () => {
        const { generator, calls, promptKeys } = makeGenerator();
        await generator.generateFaction('世界观', '青岚阁', '隐秘组织');
        expect(promptKeys).toEqual(['faction']);
        expect(calls[0].system).toContain('你必须为生成的势力严格按照以下模板字段输出完整档案');
        expect(calls[0].system).toContain('其中以下为【强制必填】：名称、类型、领袖');
        expect(calls[0].system).toContain('# 势力名');
        expect(calls[0].system).toContain('你是一位专业的势力设定师');
        expect(calls[0].user).toBe(`请生成一个名为「青岚阁」的势力设定。

【描述】隐秘组织

【世界观】世界观`);
    });

    it('地点：必填项不包含效果字段，示例标题为地点名', async () => {
        const { generator, calls, promptKeys } = makeGenerator();
        await generator.generateLocation('世界观', '云梦泽', '');
        expect(promptKeys).toEqual(['location']);
        expect(calls[0].system).toContain('你必须为生成的地点');
        expect(calls[0].system).toContain('其中以下为【强制必填】：名称、类型\n');
        expect(calls[0].system).not.toContain('名称、类型、效果');
        expect(calls[0].system).toContain('# 地点名');
        expect(calls[0].user).toContain('请生成一个名为「云梦泽」的地点设定。');
    });

    it('物品功法：必填项含效果，用户 prompt 用「物品/功法设定」', async () => {
        const { generator, calls, promptKeys } = makeGenerator();
        await generator.generateItem('世界观', '青锋剑', '');
        expect(promptKeys).toEqual(['item']);
        expect(calls[0].system).toContain('你必须为生成的物品功法');
        expect(calls[0].system).toContain('其中以下为【强制必填】：名称、类型、效果');
        expect(calls[0].system).toContain('# 物品/功法名');
        expect(calls[0].user).toContain('请生成一个名为「青锋剑」的物品/功法设定。');
    });

    it('自由创作分支：三类各自的基调提示与名称字段提示', async () => {
        const faction = makeGenerator();
        await faction.generator.generateFaction('世界观', '', '');
        expect(faction.calls[0].user).toContain('需契合该世界的语言/文化基调');
        expect(faction.calls[0].user).toContain('必须填写你新创造的势力名');

        const location = makeGenerator();
        await location.generator.generateLocation('世界观', '', '');
        expect(location.calls[0].user).toContain('需契合该世界的地理/文化基调');
        expect(location.calls[0].user).toContain('必须填写你新创造的地点名');

        const item = makeGenerator();
        await item.generator.generateItem('世界观', '', '');
        expect(item.calls[0].user).toContain('请基于世界观自由创造一个物品或功法设定');
        expect(item.calls[0].user).toContain('需契合该世界的力量体系/文化基调');
        expect(item.calls[0].user).toContain('必须填写你新创造的物品/功法名');
    });

    it('自定义模板：势力/地点注入，物品功法保持历史行为不注入', async () => {
        const faction = makeGenerator();
        await faction.generator.generateFaction('世界观', '青岚阁', '', '自定义势力模板内容');
        expect(faction.calls[0].user).toContain('【用户自定义势力模板，必须遵循此结构和字段】');
        expect(faction.calls[0].user).toContain('自定义势力模板内容');

        const item = makeGenerator();
        await item.generator.generateItem('世界观', '青锋剑', '', '自定义物品模板内容');
        expect(item.calls[0].user).not.toContain('物品功法模板');
        expect(item.calls[0].user).not.toContain('自定义物品模板内容');
    });

    it('设定库非空时注入参考约束，空白设定库不注入', async () => {
        const withLib = makeGenerator();
        await withLib.generator.generateFaction('世界观', '青岚阁', '', undefined, '| 势力 | 描述 |');
        expect(withLib.calls[0].system).toContain('参考以下设定库表格，确保生成的实体与设定库不矛盾');

        const blank = makeGenerator();
        await blank.generator.generateFaction('世界观', '青岚阁', '', undefined, '   ');
        expect(blank.calls[0].system).not.toContain('参考以下设定库表格');
    });

    it('参数透传：proModel / 温度 0.7 / maxOutput', async () => {
        const { generator } = makeGenerator();
        const callAI = (generator as any).apiClient.callAI as ReturnType<typeof vi.fn>;
        await generator.generateFaction('世界观', '青岚阁', '');
        expect(callAI).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'pro', 0.7, 4096);
    });
});
