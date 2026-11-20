import { describe, expect, it } from 'vitest';
import { pluginViewTabTitle, pluginViewTypes } from '../../../ui/view-tab-titles';

/**
 * 页签标题补写（DeferredView 修复）：
 * 重启后 Obsidian 会把未实例化视图的页签显示成视图类型 id，
 * main.ts 用本映射只改页签文字，因此这里锁住「类型 → 中文名」的对应关系。
 */
describe('view-tab-titles', () => {
    it('覆盖全部插件自有视图与两个监控面板', () => {
        const types = pluginViewTypes();
        expect(types).toContain('novel-writer-home');
        expect(types).toContain('novel-writer-full-writer');
        expect(types).toContain('novel-writer-co-writing');
        expect(types).toContain('novel-writer-knowledge-base');
        expect(types).toContain('novel-writer-agent-workbench');
        expect(types).toContain('novel-writer-writing-fingerprint');
        expect(types).toContain('novel-writer-project-side-panel');
        expect(types).toContain('novel-writer-planning-canvas');
        expect(types).toContain('novel-writer-memory-graph');
        expect(types).toContain('nw-float-monitor-a');
        expect(types).toContain('nw-float-monitor-b');
    });

    it('返回中文显示名，且不等于视图类型 id', () => {
        for (const type of pluginViewTypes()) {
            const title = pluginViewTabTitle(type);
            expect(title).toBeTruthy();
            expect(title).not.toBe(type);
            // 中文名必须含中文，避免漏配成英文 id
            expect(/[\u4e00-\u9fa5]/.test(title as string)).toBe(true);
        }
    });

    it('非插件视图返回 null', () => {
        expect(pluginViewTabTitle('markdown')).toBeNull();
        expect(pluginViewTabTitle('')).toBeNull();
    });

    it('与各视图 getDisplayText 使用同一份资源键', async () => {
        const planning = pluginViewTabTitle('novel-writer-planning-canvas');
        const memory = pluginViewTabTitle('novel-writer-memory-graph');
        expect(planning).toBe('规划画布');
        expect(memory).toBe('设定实体图');
        expect(pluginViewTabTitle('novel-writer-co-writing')).toContain('句级协同写作');
    });
});
