/**
 * listProjects 回归：模式库下的 `_versions` / `.hidden` / 空目录不是项目。
 *
 * 背景（2026-11-02）：`长篇小说/_versions` 是章节版本存储，旧实现把模式库下
 * 所有子目录都当项目，Agent 工作台因此显示「长篇小说 2」。
 */
import { describe, expect, it } from 'vitest';
import { TFolder } from 'obsidian';
import { listProjects } from '../../../ui/export-manuscript-modal';
import { detectProjects } from '../../../engine/context-manager';

function folder(path: string, children: TFolder[] = []): TFolder {
    return Object.assign(new TFolder(), {
        path,
        name: path.split('/').pop() || '',
        children,
    });
}

describe('listProjects', () => {
    const long = folder('长篇小说');
    const real = folder('长篇小说/九霄逆脉行');
    const versions = folder('长篇小说/_versions');
    const hidden = folder('长篇小说/.trash');
    const empty = folder('长篇小说/空目录');
    long.children.push(real, versions, hidden, empty);

    const short = folder('短篇小说');
    const shortReal = folder('短篇小说/短篇A');
    short.children.push(shortReal);

    const root = folder('');
    root.children.push(long, short);

    const markers = new Set([
        '长篇小说/九霄逆脉行/03-大纲与章节',
        '短篇小说/短篇A/短篇创作',
    ]);
    const app = {
        vault: {
            getRoot: () => root,
            getAbstractFileByPath: (path: string) => (markers.has(path) ? {} : null),
        },
    };

    it('只返回带项目标志的目录，排除 _versions / .hidden / 空目录', () => {
        expect(listProjects(app as never)).toEqual(['长篇小说/九霄逆脉行', '短篇小说/短篇A'].sort());
    });

    it('detectProjects 同样不会把 _versions 当项目', () => {
        const files = [
            { path: '长篇小说/九霄逆脉行/作品信息.md' },
            { path: '长篇小说/九霄逆脉行/03-大纲与章节/正文/第1卷/第1章_正文.md' },
            { path: '长篇小说/_versions/chapter/第1章/v_x.md' },
        ];
        const detectApp = { vault: { getFiles: () => files } };
        expect(detectProjects(detectApp as never)).toEqual(['长篇小说/九霄逆脉行']);
    });
});
