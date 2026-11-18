/**
 * tool-catalog-i18n.test.ts — 工具目录展示映射双语（缺口⑦ 跨层数据①，ZC-20261120-01）
 *
 * 目录表里的 `label/desc` 是 zh 兜底值，`labelKey/descKey` 是渲染来源。
 * 这里锁三件事：
 * 1. zh 下 getter 与目录原值逐字一致（零回归）；
 * 2. en 下全英文、无键名回退，且同 commandId 在不同 mode 下各自取到本模式的措辞
 *    （「批量建章 / 批量建节 / 批量建集」）；
 * 3. 工具 id 与 commandId 不受影响（目录本身仍是同一份数据）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../../i18n';
import {
    getHiddenToolLabels,
    getModeToolTitle,
    getToolCatalogForMode,
    getToolGroupsForMode,
    toolDesc,
    toolGroupLabel,
    toolLabel,
} from '../../../domains/kernel/tool-catalog-aggregator';
import { TOOL_GROUPS } from '../../../domains/long/tool-catalog';
import { SHORT_TOOL_GROUPS } from '../../../domains/short/tool-catalog';
import { SCRIPT_TOOL_GROUPS } from '../../../domains/script/tool-catalog';

afterEach(() => {
    setLocale('zh-CN');
});

/** 取某 mode 目录里指定 commandId 的按钮 */
function findButton(groups: typeof TOOL_GROUPS, commandId: string) {
    for (const group of groups) {
        const found = group.buttons.find(button => button.commandId === commandId);
        if (found) return found;
    }
    return undefined;
}

describe('工具目录双语（缺口⑦ 跨层数据①）', () => {
    it('zh：getter 与目录原值逐字一致（零回归）', () => {
        setLocale('zh-CN');
        for (const groups of [TOOL_GROUPS, SHORT_TOOL_GROUPS, SCRIPT_TOOL_GROUPS]) {
            for (const group of groups) {
                expect(toolGroupLabel(group)).toBe(group.label);
                for (const button of group.buttons) {
                    expect(toolLabel(button)).toBe(button.label);
                    expect(toolDesc(button)).toBe(button.desc);
                }
            }
        }
        expect(getModeToolTitle('long')).toBe('⚡ 快捷工具');
        expect(getModeToolTitle('short')).toBe('⚡ 短篇快捷工具');
        expect(getModeToolTitle('script')).toBe('⚡ 剧本快捷工具');
    });

    it('en：分组名、按钮名、描述全英文且无键名回退', () => {
        setLocale('en-US');
        for (const groups of [TOOL_GROUPS, SHORT_TOOL_GROUPS, SCRIPT_TOOL_GROUPS]) {
            for (const group of groups) {
                const name = toolGroupLabel(group);
                expect(name, group.label).not.toMatch(/[\u4e00-\u9fff]/);
                expect(name).not.toMatch(/toolCatalog\./);
                for (const button of group.buttons) {
                    const label = toolLabel(button);
                    const desc = toolDesc(button);
                    expect(label, button.commandId).not.toMatch(/[\u4e00-\u9fff]/);
                    expect(desc, button.commandId).not.toMatch(/[\u4e00-\u9fff]/);
                    expect(label).not.toMatch(/toolCatalog\./);
                }
            }
        }
        expect(getModeToolTitle('long')).toBe('⚡ Quick tools');
        expect(getModeToolTitle('short')).toBe('⚡ Short-story tools');
        expect(getModeToolTitle('script')).toBe('⚡ Script tools');
    });

    it('en：同一 commandId 在不同模式下取到本模式措辞', () => {
        setLocale('en-US');
        const longBtn = findButton(TOOL_GROUPS, 'novel-writer-batch-create');
        const shortBtn = findButton(SHORT_TOOL_GROUPS, 'novel-writer-batch-create');
        const scriptBtn = findButton(SCRIPT_TOOL_GROUPS, 'novel-writer-batch-create');
        expect(toolLabel(longBtn!)).toBe('Batch chapter creation');
        expect(toolLabel(shortBtn!)).toBe('Batch section creation');
        expect(toolLabel(scriptBtn!)).toBe('Batch episode creation');

        setLocale('zh-CN');
        expect(toolLabel(longBtn!)).toBe('批量建章');
        expect(toolLabel(shortBtn!)).toBe('批量建节');
        expect(toolLabel(scriptBtn!)).toBe('批量建集');
    });

    it('en：隐藏项提示与目录过滤口径不变', () => {
        setLocale('en-US');
        const hidden = getHiddenToolLabels(TOOL_GROUPS, 'short');
        for (const label of hidden) {
            expect(label).not.toMatch(/[\u4e00-\u9fff]/);
        }
        // 过滤结果仍以 commandId 为准，与语言无关
        const zhIds = getToolGroupsForMode('short').flatMap(g => g.buttons.map(b => b.commandId));
        setLocale('zh-CN');
        const zhIdsAgain = getToolGroupsForMode('short').flatMap(g => g.buttons.map(b => b.commandId));
        expect(zhIds).toEqual(zhIdsAgain);
        expect(getToolCatalogForMode('script').groups.length).toBeGreaterThan(0);
    });
});
