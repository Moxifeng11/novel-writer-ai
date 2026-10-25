import { describe, it, expect } from 'vitest';
import { CommandIds } from '../../../shared/command-ids';
import { TOOL_GROUPS, CHAPTER_QUICK_TOOL_IDS } from '../../../ui/full-writer/tool-catalog';

/**
 * 快捷工具目录契约：所有人看到的前端按钮，必须在命令 ID 常量表中有后端定义，
 * 否则点击后只能落到 fallback（或完全没有实现）。
 */
describe('快捷工具目录 — 命令 ID 契约', () => {
    const known = new Set<string>(Object.values(CommandIds));
    const catalogIds = TOOL_GROUPS.flatMap((g) => g.buttons.map((b) => b.commandId));

    it('目录中的每个 commandId 都有后端定义', () => {
        const missing = catalogIds.filter((id) => !known.has(id));
        expect(missing).toEqual([]);
    });

    it('章节页高频工具必须来自同一目录', () => {
        const missing = CHAPTER_QUICK_TOOL_IDS.filter((id) => !catalogIds.includes(id));
        expect(missing).toEqual([]);
    });

    it('commandId 在目录内唯一', () => {
        expect(new Set(catalogIds).size).toBe(catalogIds.length);
    });

    it('低频分组默认折叠，高频分组默认展开', () => {
        const collapsed = TOOL_GROUPS.filter((g) => g.defaultCollapsed).map((g) => g.label);
        expect(collapsed.length).toBeGreaterThan(0);
        expect(collapsed.length).toBeLessThan(TOOL_GROUPS.length);
        const core = TOOL_GROUPS.find((g) => g.label.includes('核心写作'));
        expect(core?.defaultCollapsed).toBeFalsy();
    });
});
