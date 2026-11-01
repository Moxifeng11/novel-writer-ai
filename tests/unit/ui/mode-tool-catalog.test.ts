import { describe, it, expect } from 'vitest';
import {
    getModeToolTitle,
    getToolGroupsForMode,
    SHORT_TOOL_GROUPS,
    SCRIPT_TOOL_GROUPS,
    TOOL_GROUPS,
} from '../../../ui/full-writer/tool-catalog';

const IDS = (groups: typeof TOOL_GROUPS): string[] =>
    groups.flatMap(group => group.buttons.map(button => button.commandId));

describe('按项目类型切换快捷工具目录', () => {
    it('长篇沿用完整长篇工具目录', () => {
        expect(getToolGroupsForMode('long')).toBe(TOOL_GROUPS);
        expect(getModeToolTitle('long')).toContain('快捷工具');
    });

    it('短篇目录只含短篇动作和通用写作动作', () => {
        const ids = IDS(SHORT_TOOL_GROUPS);
        expect(ids).toContain('novel-writer-create-short');
        expect(ids).toContain('novel-writer-short-research');
        expect(ids).toContain('novel-writer-batch-create');
        expect(ids).toContain('novel-writer-export-manuscript');
        expect(ids).not.toContain('novel-writer-plan-book');
        expect(ids).not.toContain('novel-writer-batch-chapters');
        expect(ids).not.toContain('novel-writer-chapter-settlement');
        expect(ids).not.toContain('novel-writer-cross-volume-state');
        expect(getModeToolTitle('short')).toContain('短篇');
    });

    it('剧本目录只含剧本动作和通用写作动作', () => {
        const ids = IDS(SCRIPT_TOOL_GROUPS);
        expect(ids).toContain('novel-writer-create-script');
        expect(ids).toContain('novel-writer-script-research');
        expect(ids).toContain('novel-writer-batch-create');
        expect(ids).toContain('novel-writer-export-manuscript');
        expect(ids).not.toContain('novel-writer-plan-book');
        expect(ids).not.toContain('novel-writer-batch-chapters');
        expect(ids).not.toContain('novel-writer-chapter-settlement');
        expect(getModeToolTitle('script')).toContain('剧本');
    });

    it('短篇/剧本不再把「新建项目」当成唯一创建入口', () => {
        expect(IDS(SHORT_TOOL_GROUPS)).toContain('novel-writer-create-short');
        expect(IDS(SCRIPT_TOOL_GROUPS)).toContain('novel-writer-create-script');
        expect(IDS(SHORT_TOOL_GROUPS)).not.toContain('novel-writer-create-project');
        expect(IDS(SCRIPT_TOOL_GROUPS)).not.toContain('novel-writer-create-project');
    });
});

describe('快捷工具与模式规则一致性（P1-7/8）', () => {
    it('短篇/剧本渲染出的按钮全部允许在当前模式执行', async () => {
        const { isCommandAllowedInMode } = await import('../../../shared/command-mode-rules');
        for (const mode of ['short', 'script'] as const) {
            const ids = IDS(getToolGroupsForMode(mode));
            const blocked = ids.filter((id) => isCommandAllowedInMode(id, mode) === false);
            expect(blocked).toEqual([]);
        }
    });

    it('批量建章在短篇/剧本可用（BatchCreateModal 已实现建节/建集）', async () => {
        const { isCommandAllowedInMode } = await import('../../../shared/command-mode-rules');
        expect(isCommandAllowedInMode('novel-writer-batch-create', 'short')).not.toBe(false);
        expect(isCommandAllowedInMode('novel-writer-batch-create', 'script')).not.toBe(false);
    });

    it('定向修订登记为长篇专属', async () => {
        const { isCommandAllowedInMode } = await import('../../../shared/command-mode-rules');
        expect(isCommandAllowedInMode('novel-writer-targeted-revision', 'long')).toBe(true);
        expect(isCommandAllowedInMode('novel-writer-targeted-revision', 'short')).toBe(false);
    });
});

describe('G3-3 短篇/剧本不再静默丢按钮', () => {
    it('实体/设定/标签/文笔命令在短篇与剧本下都允许执行', async () => {
        const { isCommandAllowedInMode } = await import('../../../shared/command-mode-rules');
        const generic = [
            'novel-writer-entity-manager',
            'novel-writer-character',
            'novel-writer-faction',
            'novel-writer-location',
            'novel-writer-item',
            'novel-writer-entity-generate',
            'novel-writer-add-fanfic',
            'novel-writer-tags',
            'novel-writer-style-distiller',
        ];
        for (const mode of ['short', 'script'] as const) {
            for (const id of generic) {
                expect(isCommandAllowedInMode(id, mode), `${mode}:${id}`).not.toBe(false);
            }
        }
    });

    it('短篇/剧本目录里这些按钮仍然存在（未被过滤成空组）', async () => {
        const { getToolGroupsForMode } = await import('../../../ui/full-writer/tool-catalog');
        for (const mode of ['short', 'script'] as const) {
            const ids = getToolGroupsForMode(mode).flatMap(group => group.buttons.map(button => button.commandId));
            expect(ids).toContain('novel-writer-entity-manager');
            expect(ids).toContain('novel-writer-character');
            expect(ids).toContain('novel-writer-style-distiller');
        }
    });

    it('仍有长篇专属按钮时能给出隐藏清单（用于提示而不是静默消失）', async () => {
        const { getHiddenToolLabels } = await import('../../../domains/kernel/tool-catalog-aggregator');
        const groups = [
            { label: '测试组', buttons: [
                { label: '章节结算', desc: '', icon: '', commandId: 'novel-writer-chapter-settlement' },
                { label: '实体管理', desc: '', icon: '', commandId: 'novel-writer-entity-manager' },
            ] },
        ];
        expect(getHiddenToolLabels(groups as never, 'short')).toEqual(['章节结算']);
        expect(getHiddenToolLabels(groups as never, 'long')).toEqual([]);
    });
});
