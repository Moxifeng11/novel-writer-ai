import { describe, it, expect, vi } from 'vitest';
import {
    revealLeafCompat,
    type RevealLeaf,
    type RevealWorkspace,
} from '../../../shared/workspace-reveal';

/**
 * 兼容 Obsidian 1.4.4 的 leaf 前台化（4.81.0）。
 *
 * `Workspace.revealLeaf` 直到 1.7.2 才定型，插件声明 1.4.4 时必须走
 * `setActiveLeaf(leaf, { focus })`；右栏折叠时还要先 `expand()`，否则
 * 面板被激活但用户看不到。这里钉住三件事：不调用 revealLeaf、按 side 展开、
 * 侧栏探测/展开失败不阻止 leaf 激活。
 */

function makeWorkspace() {
    const rightExpand = vi.fn();
    const leftExpand = vi.fn();
    const workspace = {
        setActiveLeaf: vi.fn(),
        rightSplit: { expand: rightExpand },
        leftSplit: { expand: leftExpand },
    } as unknown as RevealWorkspace;
    return { workspace, rightExpand, leftExpand };
}

describe('revealLeafCompat', () => {
    it('使用 setActiveLeaf（0.16.3+）而非 revealLeaf（1.7.2+）', () => {
        const { workspace } = makeWorkspace();
        const leaf: RevealLeaf = {};

        revealLeafCompat(workspace, leaf);

        expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
        expect((workspace as unknown as { revealLeaf?: unknown }).revealLeaf).toBeUndefined();
    });

    it('side:right 先展开右栏，再激活 leaf', () => {
        const { workspace, rightExpand, leftExpand } = makeWorkspace();
        const leaf: RevealLeaf = {};

        revealLeafCompat(workspace, leaf, { side: 'right' });

        expect(rightExpand).toHaveBeenCalledTimes(1);
        expect(leftExpand).not.toHaveBeenCalled();
        expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
    });

    it('side:left 只展开左栏', () => {
        const { workspace, rightExpand, leftExpand } = makeWorkspace();
        revealLeafCompat(workspace, {}, { side: 'left' });

        expect(leftExpand).toHaveBeenCalledTimes(1);
        expect(rightExpand).not.toHaveBeenCalled();
    });

    it('auto 模式用 getRoot 与左右 split 比对', () => {
        const { workspace, rightExpand } = makeWorkspace();
        const leaf: RevealLeaf = { getRoot: () => workspace.rightSplit };

        revealLeafCompat(workspace, leaf);

        expect(rightExpand).toHaveBeenCalledTimes(1);
    });

    it('auto 模式遇到无 getRoot 的旧 leaf 不展开侧栏，也不抛错', () => {
        const { workspace, rightExpand, leftExpand } = makeWorkspace();
        expect(() => revealLeafCompat(workspace, {})).not.toThrow();
        expect(rightExpand).not.toHaveBeenCalled();
        expect(leftExpand).not.toHaveBeenCalled();
    });

    it('focus:false 透传给 setActiveLeaf', () => {
        const { workspace } = makeWorkspace();
        const leaf: RevealLeaf = {};

        revealLeafCompat(workspace, leaf, { focus: false });

        expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: false });
    });

    it('侧栏 expand 抛错时仍激活 leaf', () => {
        const { workspace } = makeWorkspace();
        const leaf: RevealLeaf = {};
        (workspace.rightSplit as { expand: () => void }).expand = () => {
            throw new Error('split gone');
        };

        expect(() => revealLeafCompat(workspace, leaf, { side: 'right' })).not.toThrow();
        expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
    });

    it('1.4.4 形状的 workspace 缺少 left/rightSplit 时也能工作', () => {
        const workspace = { setActiveLeaf: vi.fn() } as unknown as RevealWorkspace;

        expect(() => revealLeafCompat(workspace, {}, { side: 'right' })).not.toThrow();
        expect(workspace.setActiveLeaf).toHaveBeenCalledTimes(1);
    });
});
