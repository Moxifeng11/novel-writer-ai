import { describe, expect, it } from 'vitest';
import {
    getControlSectionTitles,
    getRightTabSpecs,
    getSceneHintText,
    getToolButtonSpecs,
    getToolsToggleLabel,
    getToolsToggleState,
    resolveModelToggleLabel,
} from '@/ui/co-writing/control-panel';

describe('getRightTabSpecs', () => {
    it('概览在前且默认激活，知识库带说明', () => {
        const [overview, knowledge] = getRightTabSpecs();
        expect(overview.id).toBe('overview');
        expect(overview.active).toBe(true);
        expect(knowledge.id).toBe('knowledge');
        expect(knowledge.active).toBeUndefined();
        expect(knowledge.title).toContain('知识库');
    });
});

describe('getToolButtonSpecs', () => {
    it('九个工具的文案与动作顺序固定', () => {
        const specs = getToolButtonSpecs();
        expect(specs).toHaveLength(9);
        expect(specs[0]).toEqual({ text: '🕘 历史', action: 'history' });
        expect(specs[specs.length - 1]).toEqual({ text: '✅ 标记完稿', action: 'written' });
    });

    it('动作标识不重复，避免分发歧义', () => {
        const actions = getToolButtonSpecs().map((spec) => spec.action);
        expect(new Set(actions).size).toBe(actions.length);
    });
});

describe('getControlSectionTitles', () => {
    it('三组标题覆盖核心创作 / 辅助润色 / 更多工具', () => {
        const titles = getControlSectionTitles();
        expect(titles.core).toContain('核心创作');
        expect(titles.assist).toContain('辅助润色');
        expect(titles.tools).toContain('更多工具');
    });
});

describe('getToolsToggleLabel', () => {
    it('展开态显示收起文案', () => {
        expect(getToolsToggleLabel(true)).toBe('⚙ 收起工具');
    });

    it('收起态显示更多工具文案', () => {
        expect(getToolsToggleLabel(false)).toBe('⚙ 更多工具');
    });
});

describe('getToolsToggleState', () => {
    it('点击后状态反转且文案同步', () => {
        expect(getToolsToggleState(false)).toEqual({ open: true, label: '⚙ 收起工具' });
        expect(getToolsToggleState(true)).toEqual({ open: false, label: '⚙ 更多工具' });
    });
});

describe('getSceneHintText', () => {
    it('锁定场景卡字段并禁止推进剧情/对白/新地点', () => {
        const hint = getSceneHintText();
        expect(hint).toContain('sensory_hook');
        expect(hint).toContain('body_reaction');
        expect(hint).toContain('不推进剧情');
        expect(hint).toContain('不写对白');
        expect(hint).toContain('不引入新地点');
    });
});

describe('resolveModelToggleLabel', () => {
    it('本地模式显示固定文案', () => {
        expect(resolveModelToggleLabel({ coWriteModelMode: 'local' })).toBe('🖥 本地');
        expect(resolveModelToggleLabel({})).toBe('🖥 本地');
    });

    it('云端模式优先显示自定义 provider 名称', () => {
        const settings = {
            coWriteModelMode: 'cloud',
            coWriteCloudProvider: 'p1',
            customProviders: [{ id: 'p1', name: '我的中转' }],
        };
        expect(resolveModelToggleLabel(settings)).toBe('☁ 我的中转');
    });

    it('云端未配置或 provider 名称缺失时回落标识', () => {
        expect(resolveModelToggleLabel({ coWriteModelMode: 'cloud' })).toBe('☁ 未配置');
        expect(resolveModelToggleLabel({
            coWriteModelMode: 'cloud',
            coWriteCloudProvider: 'p2',
            customProviders: [{ id: 'p2' }],
        })).toBe('☁ p2');
    });
});
