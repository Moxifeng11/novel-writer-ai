import { describe, expect, it } from 'vitest';
import { App } from 'obsidian';
import { executeObsidianCommand, listObsidianCommands, openPluginSettingsTab } from '@/shared/obsidian-internal-bridge';

const appWith = (extra: Record<string, unknown>): App => Object.assign(new App(), extra) as App;

describe('obsidian-internal-bridge', () => {
    it('能力缺失时安全降级', () => {
        const app = new App();
        expect(listObsidianCommands(app)).toEqual([]);
        expect(executeObsidianCommand(app, 'x:y')).toBe(false);
        expect(openPluginSettingsTab(app, 'id')).toBe(false);
    });

    it('列出命令 id 与派发命令', () => {
        const app = appWith({
            commands: {
                listCommands: () => [{ id: 'a:1' }, { id: 'b:2' }],
                executeCommandById: (id: string) => id === 'a:1',
            },
        });
        expect(listObsidianCommands(app)).toEqual([{ id: 'a:1', name: '' }, { id: 'b:2', name: '' }]);
        expect(executeObsidianCommand(app, 'a:1')).toBe(true);
        expect(executeObsidianCommand(app, 'b:2')).toBe(false);
    });

    it('打开设置页', () => {
        const opened: string[] = [];
        const app = appWith({ setting: { openTabById: (id: string) => opened.push(id) } });
        expect(openPluginSettingsTab(app, 'novel-writer-ai')).toBe(true);
        expect(opened).toEqual(['novel-writer-ai']);
    });

    it('私有 API 抛错不冒泡', () => {
        const app = appWith({
            commands: { listCommands: () => { throw new Error('boom'); }, executeCommandById: () => { throw new Error('boom'); } },
            setting: { openTabById: () => { throw new Error('boom'); } },
        });
        expect(listObsidianCommands(app)).toEqual([]);
        expect(executeObsidianCommand(app, 'x')).toBe(false);
        expect(openPluginSettingsTab(app, 'x')).toBe(false);
    });
});
