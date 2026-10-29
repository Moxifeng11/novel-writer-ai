import { describe, expect, it } from 'vitest';
import { CommandIds } from '../../../shared/command-ids';
import {
    commandAllowedModes,
    isCommandAllowedInMode,
    COMMAND_MODE_LABELS,
} from '../../../shared/command-mode-rules';

describe('command-mode-rules — 命令模式守卫表', () => {
    it('长篇专属命令在短篇/剧本项目下不可用', () => {
        for (const id of [CommandIds.PLAN_BOOK, CommandIds.CHAPTER_SETTLEMENT, CommandIds.WORLDVIEW, CommandIds.CO_WRITING]) {
            expect(isCommandAllowedInMode(id, 'long')).toBe(true);
            expect(isCommandAllowedInMode(id, 'short')).toBe(false);
            expect(isCommandAllowedInMode(id, 'script')).toBe(false);
        }
    });

    it('短篇命令只在短篇项目可用，剧本命令只在剧本项目可用', () => {
        expect(isCommandAllowedInMode(CommandIds.SHORT_OUTLINE, 'short')).toBe(true);
        expect(isCommandAllowedInMode(CommandIds.SHORT_OUTLINE, 'script')).toBe(false);
        expect(isCommandAllowedInMode(CommandIds.SCRIPT_STORYBOARD, 'script')).toBe(true);
        expect(isCommandAllowedInMode(CommandIds.SCRIPT_STORYBOARD, 'short')).toBe(false);
    });

    it('未登记命令不限制（导出/知识库/创作流程等）', () => {
        expect(commandAllowedModes(CommandIds.EXPORT_MANUSCRIPT)).toBeNull();
        expect(commandAllowedModes(CommandIds.CREATION_FLOW)).toBeNull();
        expect(commandAllowedModes(CommandIds.OPEN_KNOWLEDGE_BASE)).toBeNull();
        expect(isCommandAllowedInMode(CommandIds.RENAME_PROJECT, 'script')).toBeNull();
    });

    it('所有被限制的命令都有可读中文名（提示语不会露出 ID）', () => {
        const missing = Object.keys(COMMAND_MODE_LABELS).filter(id => !commandAllowedModes(id));
        expect(missing).toEqual([]);
        for (const id of [CommandIds.PLAN_BOOK, CommandIds.BATCH_CREATE]) {
            expect(COMMAND_MODE_LABELS[id]).toBeTruthy();
        }
    });
});
