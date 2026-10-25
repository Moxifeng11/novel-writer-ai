import { describe, it, expect, vi } from 'vitest';

// engine-registry 等会反向引用 main.ts；先 mock 掉，避免加载构建产物 main.js。
vi.mock('../../../main', () => ({
    default: class NovelWriterPlugin {},
}));

import { PolishAIPolishModal } from '../../../ui/polish-editor';

/**
 * D6 — 润色弹窗的项目必须由调用方显式传入。
 * 协同写作/工作台视图没有 activeFile，弹窗内部用 getActiveProject() 回落时
 * 会取到 null 或别的书，把错误书的指纹风格套到本章正文上。
 */

// obsidian mock 的 Modal 在实例化时用 document.createElement（node 环境无 DOM）
const fakeEl = {
    style: {},
    classList: { add: () => {}, remove: () => {} },
    appendChild: () => {},
    setText: () => {},
    empty: () => {},
};
(globalThis as unknown as { document: unknown }).document = {
    createElement: () => fakeEl,
    createTextNode: () => fakeEl,
};

function makePlugin() {
    return {
        getActiveProject: vi.fn(() => '另一本书'),
    };
}

describe('D6 PolishAIPolishModal — 项目显式传递', () => {
    it('使用调用方传入的项目，不回落 activeFile', () => {
        const plugin = makePlugin();
        const modal = new PolishAIPolishModal(
            {} as never,
            plugin as never,
            '正文',
            '',
            () => {},
            '当前书',
        );

        expect((modal as unknown as { projectPath: string }).projectPath).toBe('当前书');
        expect(plugin.getActiveProject).not.toHaveBeenCalled();
    });

    it('传入空项目时保持为空，不借用 activeFile', () => {
        const plugin = makePlugin();
        const modal = new PolishAIPolishModal(
            {} as never,
            plugin as never,
            '正文',
            '',
            () => {},
            '',
        );

        expect((modal as unknown as { projectPath: string }).projectPath).toBe('');
        expect(plugin.getActiveProject).not.toHaveBeenCalled();
    });
});
