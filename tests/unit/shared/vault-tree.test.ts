/**
 * vault-tree：按目录取文件（G6-4 的基础件）
 *
 * 落盘/结算/统计原来用 vault.getFiles() 扫全库，本模块把「读哪棵树」变成显式参数。
 * 这里锁住目录遍历的边界行为：扩展名过滤、递归深度、隐藏目录、上限、路径归一化，
 * 以及「目录不存在就返回空」而不是抛错。
 */
import { describe, expect, it, vi } from 'vitest';
import {
    folderExists,
    listFolderFiles,
    normalizeFolderPath,
    type VaultTreeNode,
} from '../../../shared/vault-tree';
import { BODY_CONTENT_ROOTS, listChapterBodyFiles } from '../../../shared/body-path';

interface Node { path: string; name: string; extension?: string; children?: Node[] }

function folder(path: string, children: Node[]): Node {
    return { path, name: path.split('/').pop() || '', children };
}

function file(path: string): Node {
    const name = path.split('/').pop() || '';
    return { path, name, extension: name.split('.').pop() || '' };
}

/** 用 path → node 的 Map 模拟 getAbstractFileByPath（O(1) 索引） */
function makeVault(root: Node) {
    const index = new Map<string, Node>();
    const visit = (node: Node) => {
        if (node.children) {
            index.set(node.path, node);
            node.children.forEach(visit);
        }
    };
    visit(root);
    const getAbstractFileByPath = vi.fn((path: string) => index.get(path) ?? null);
    return { vault: { getAbstractFileByPath }, index, getAbstractFileByPath };
}

const TREE = folder('vault', [
    folder('小说', [
        folder('小说/书A', [
            folder('小说/书A/正文', [file('小说/书A/正文/第1章.md'), file('小说/书A/正文/第2章.md')]),
            file('小说/书A/设定.md'),
            file('小说/书A/封面.png'),
        ]),
        folder('小说/.trash', [file('小说/.trash/旧稿.md')]),
    ]),
    folder('其它', [file('其它/笔记.md')]),
]);

describe('normalizeFolderPath', () => {
    it('去掉首尾斜杠、合并重复斜杠、反斜杠转正斜杠', () => {
        expect(normalizeFolderPath('/a//b/')).toBe('a/b');
        expect(normalizeFolderPath('a\\b')).toBe('a/b');
        expect(normalizeFolderPath('')).toBe('');
        expect(normalizeFolderPath(undefined as unknown as string)).toBe('');
    });
});

describe('listFolderFiles', () => {
    it('默认只取当前目录的 md，不递归', () => {
        const { vault } = makeVault(TREE);
        expect(listFolderFiles(vault, '小说/书A').map((f: VaultTreeNode) => f.path))
            .toEqual(['小说/书A/设定.md']);
    });

    it('递归时按深度收集，并跳过隐藏目录', () => {
        const { vault } = makeVault(TREE);
        const paths = listFolderFiles(vault, '小说/书A', { recursive: true }).map((f: VaultTreeNode) => f.path);
        expect(paths).toEqual([
            '小说/书A/正文/第1章.md',
            '小说/书A/正文/第2章.md',
            '小说/书A/设定.md',
        ]);
        expect(paths.some(path => path.includes('.trash'))).toBe(false);
    });

    it('extensions: [] 表示不按扩展名过滤', () => {
        const { vault } = makeVault(TREE);
        const paths = listFolderFiles(vault, '小说/书A', { extensions: [] }).map((f: VaultTreeNode) => f.path);
        expect(paths).toEqual(['小说/书A/设定.md', '小说/书A/封面.png']);
    });

    it('目录不存在 / 路径是文件时返回空数组，不抛错', () => {
        const { vault } = makeVault(TREE);
        expect(listFolderFiles(vault, '不存在')).toEqual([]);
        expect(listFolderFiles(vault, '小说/书A/设定.md')).toEqual([]);
        expect(listFolderFiles(vault, '')).toEqual([]);
    });

    it('maxDepth 限制递归层数', () => {
        const { vault } = makeVault(TREE);
        // depth 0 = 书A 的直接子目录不进入 → 只剩 书A 下的 md
        expect(listFolderFiles(vault, '小说/书A', { recursive: true, maxDepth: 0 })
            .map((f: VaultTreeNode) => f.path)).toEqual(['小说/书A/设定.md']);
    });

    it('maxFiles 截断，避免超大目录撑爆内存', () => {
        const many = folder('big', Array.from({ length: 20 }, (_, i) => file(`big/${i}.md`)));
        const { vault } = makeVault(many);
        expect(listFolderFiles(vault, 'big', { maxFiles: 5 })).toHaveLength(5);
    });

    it('只做一次 O(1) 目录查询，不调用 getFiles', () => {
        const { vault, getAbstractFileByPath } = makeVault(TREE);
        listFolderFiles(vault, '小说/书A', { recursive: true });
        // 入口只查一次目录，剩下全靠 children 树
        expect(getAbstractFileByPath).toHaveBeenCalledTimes(1);
        expect(getAbstractFileByPath).toHaveBeenCalledWith('小说/书A');
    });
});

describe('folderExists', () => {
    it('目录存在为 true，文件/缺失为 false', () => {
        const { vault } = makeVault(TREE);
        expect(folderExists(vault, '小说/书A')).toBe(true);
        expect(folderExists(vault, '小说/书A/设定.md')).toBe(false);
        expect(folderExists(vault, '不存在')).toBe(false);
    });
});

describe('listChapterBodyFiles', () => {
    const root = folder('vault', [
        folder('长篇小说', [
            folder('长篇小说/书A', [
                folder('长篇小说/书A/03-大纲与章节', [
                    folder('长篇小说/书A/03-大纲与章节/正文', [
                        folder('长篇小说/书A/03-大纲与章节/正文/第1卷', [
                            file('长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_正文.md'),
                        ]),
                    ]),
                    folder('长篇小说/书A/03-大纲与章节/步骤结果', [
                        file('长篇小说/书A/03-大纲与章节/步骤结果/第1卷/第1章/第1章_大纲.md'),
                    ]),
                ]),
            ]),
        ]),
        folder('短篇小说', [
            folder('短篇小说/短篇A', [
                folder('短篇小说/短篇A/短篇创作', [
                    folder('短篇小说/短篇A/短篇创作/03-正文', [
                        file('短篇小说/短篇A/短篇创作/03-正文/第1节_开篇.md'),
                    ]),
                ]),
            ]),
        ]),
        folder('剧本', [
            folder('剧本/剧本A', [
                folder('剧本/剧本A/剧本创作', [
                    folder('剧本/剧本A/剧本创作/03-剧本', [
                        file('剧本/剧本A/剧本创作/03-剧本/第1集.md'),
                    ]),
                ]),
            ]),
        ]),
        folder('其它', [file('其它/第1章_正文.md')]),
    ]);

    it('只遍历三个内容根，且只认正文路径', () => {
        const { vault, getAbstractFileByPath } = makeVault(root);
        const paths = listChapterBodyFiles(vault).map(file => file.path);

        expect(paths).toEqual([
            '长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_正文.md',
            '短篇小说/短篇A/短篇创作/03-正文/第1节_开篇.md',
            '剧本/剧本A/剧本创作/03-剧本/第1集.md',
        ]);
        // 只查询三个内容根：不会碰「其它」或整库
        expect(getAbstractFileByPath.mock.calls.map(call => call[0])).toEqual([...BODY_CONTENT_ROOTS]);
    });
});
