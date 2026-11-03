/**
 * listProjects / detectProjects 回归：项目发现只有一个来源。
 *
 * 背景：
 * - 2026-11-02：`长篇小说/_versions` 是章节版本存储，旧实现把模式库下所有子目录都当项目。
 * - 2026-11-03：删除项目后残留的 `03-大纲与章节` 空骨架被当成项目，Agent 工作台继续显示
 *   已删除项目。项目身份必须来自 `作品信息.md` / `世界观总览.md` / `00-系统模板` 等标志，
 *   不能只看章节目录。
 */
import { describe, expect, it } from 'vitest';
import { TFolder } from 'obsidian';
import { listProjects } from '../../../ui/export-manuscript-modal';
import { detectProjects } from '../../../engine/context-manager';
import { listProjectIds } from '../../../shared/project-catalog';

function folder(path: string, children: TFolder[] = []): TFolder {
    return Object.assign(new TFolder(), {
        path,
        name: path.split('/').pop() || '',
        children,
    });
}

describe('项目发现唯一来源', () => {
    const long = folder('长篇小说');
    const real = folder('长篇小说/九霄逆脉行');
    const ghost = folder('长篇小说/已删项目');
    const versions = folder('长篇小说/_versions');
    const hidden = folder('长篇小说/.trash');
    const empty = folder('长篇小说/空目录');
    long.children.push(real, ghost, versions, hidden, empty);

    const short = folder('短篇小说');
    const shortReal = folder('短篇小说/短篇A');
    short.children.push(shortReal);

    const root = folder('');
    root.children.push(long, short);

    const markers = new Set([
        '长篇小说/九霄逆脉行/作品信息.md',
        '短篇小说/短篇A/短篇创作',
        // 已删除项目只剩章节骨架；它不能作为项目标志
        '长篇小说/已删项目/03-大纲与章节',
    ]);
    const app = {
        vault: {
            getRoot: () => root,
            getAbstractFileByPath: (path: string) => (markers.has(path) ? {} : null),
        },
    };

    it('只返回带项目身份标志的目录，排除 _versions / .hidden / 空目录', () => {
        expect(listProjects(app as never)).toEqual(['长篇小说/九霄逆脉行', '短篇小说/短篇A'].sort());
    });

    it('只有 03-大纲与章节 的删除残留不再算项目', () => {
        expect(listProjectIds(app as never)).not.toContain('长篇小说/已删项目');
    });

    it('detectProjects 与 listProjects 完全同源', () => {
        expect(detectProjects(app as never)).toEqual(listProjects(app as never));
    });

    it('legacy 根目录项目仍可识别', () => {
        const legacy = folder('旧项目');
        const legacyRoot = folder('');
        legacyRoot.children.push(legacy);
        const legacyApp = {
            vault: {
                getRoot: () => legacyRoot,
                getAbstractFileByPath: (path: string) => (path === '旧项目/作品信息.md' ? {} : null),
            },
        };
        expect(listProjects(legacyApp as never)).toEqual(['旧项目']);
    });
});
