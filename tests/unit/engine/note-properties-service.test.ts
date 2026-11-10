import { describe, expect, it, vi } from 'vitest';
import { TFile } from '../../__mocks__/obsidian';
import {
    applyPropertyCompletion,
    applyTagMigration,
    planPropertyCompletionForFile,
    planTagMigrationForFile,
    writeProjectBases,
    type PropertyCompletionChange,
    type TagMigrationChange,
} from '../../../engine/note-properties-service';

describe('note-properties-service — 标签迁移计划', () => {
    it('旧标签缺层级标签时生成变更', () => {
        const plan = planTagMigrationForFile('长篇小说/甲/03-大纲与章节/正文/第1卷/第1章_正文.md', {
            tags: ['正文'],
        });
        expect(plan).not.toBeNull();
        expect(plan!.add).toEqual(['nw/正文']);
        expect(plan!.kind).toBe('body');
    });

    it('已含层级标签返回 null', () => {
        expect(planTagMigrationForFile('x.md', { tags: ['正文', 'nw/正文'] })).toBeNull();
    });

    it('无插件标签返回 null（不误改私人笔记）', () => {
        expect(planTagMigrationForFile('笔记/随便.md', { tags: ['我的标签'] })).toBeNull();
        expect(planTagMigrationForFile('x.md', {})).toBeNull();
    });

    it('实体/步骤文件分别映射', () => {
        const character = planTagMigrationForFile('p/01-世界架构/人物/武昭.md', { tags: ['人物'] });
        expect(character!.add).toEqual(['nw/实体/人物']);
        const step = planTagMigrationForFile('p/03-大纲与章节/步骤结果/第1卷/第1章/分析报告.md', { tags: ['分析报告'] });
        expect(step!.add).toEqual(['nw/步骤/分析报告']);
    });
});

describe('note-properties-service — 属性补齐计划', () => {
    it('正文缺 status/word_count 时给出默认值', () => {
        const plan = planPropertyCompletionForFile('长篇小说/甲/03-大纲与章节/正文/第1卷/第1章_正文.md', {
            tags: ['正文', 'nw/正文'],
            卷: '第1卷',
        });
        expect(plan).not.toBeNull();
        expect(plan!.fill).toEqual([
            { key: 'status', value: 'pending' },
            { key: 'word_count', value: 0 },
        ]);
    });

    it('必填齐全返回 null', () => {
        const plan = planPropertyCompletionForFile('长篇小说/甲/03-大纲与章节/正文/第1卷/第1章_正文.md', {
            tags: ['nw/正文'],
            status: 'written',
            word_count: 1200,
        });
        expect(plan).toBeNull();
    });

    it('人物文件缺姓名时补空串', () => {
        const plan = planPropertyCompletionForFile('p/01-世界架构/人物/武昭.md', { tags: ['人物'] });
        expect(plan!.fill).toEqual([{ key: '姓名', value: '' }]);
    });

    it('无法判定类型不处理', () => {
        expect(planPropertyCompletionForFile('普通笔记.md', {})).toBeNull();
    });
});

/**
 * C2-1（覆盖率审计二轮）：apply* / writeProjectBases 是真正改用户笔记的写路径，
 * 此前零覆盖。这里锁住「只补缺失、计数真实、失败不计数、Bases 幂等」。
 */
const PROJECT = '长篇小说/测试书';
const NOTE = `${PROJECT}/01-世界架构/人物/武昭.md`;

function makeApp(options: { fail?: boolean } = {}) {
    const file = new TFile();
    file.path = NOTE;
    const fm: Record<string, unknown> = { tags: ['人物'], 姓名: '武昭' };
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => (path === NOTE ? file : null),
            adapter: {
                exists: vi.fn(async () => false),
                mkdir: vi.fn(async () => undefined),
                write: vi.fn(async () => undefined),
            },
        },
        fileManager: {
            processFrontMatter: async (_file: TFile, mutate: (fm: Record<string, unknown>) => void) => {
                if (options.fail) throw new Error('frontmatter boom');
                mutate(fm);
            },
        },
    };
    return { app, fm };
}

function completion(fill: PropertyCompletionChange['fill']): PropertyCompletionChange {
    return { path: NOTE, kind: 'character', fill };
}

describe('note-properties-service — 用户笔记写路径（C2-1）', () => {
    it('属性补齐只补缺失键，filled 只统计真正写入的键', async () => {
        const { app, fm } = makeApp();

        const result = await applyPropertyCompletion(app as never, [
            completion([
                { key: '姓名', value: '错误值' },
                { key: 'status', value: 'pending' },
                { key: '当前状态', value: '正常' },
            ]),
            { ...completion([{ key: 'status', value: 'pending' }]), path: '不存在.md' },
        ]);

        expect(result).toEqual({ written: 1, filled: 2 });
        expect(fm['姓名']).toBe('武昭');
        expect(fm['status']).toBe('pending');
        expect(fm['当前状态']).toBe('正常');
    });

    it('frontmatter 写失败：不计 written/filled，不抛出', async () => {
        const { app } = makeApp({ fail: true });
        const result = await applyPropertyCompletion(app as never, [completion([{ key: 'status', value: 'pending' }])]);
        expect(result).toEqual({ written: 0, filled: 0 });
    });

    it('标签迁移只统计真正新增的标签，已有标签不虚报', async () => {
        const { app, fm } = makeApp();
        fm['tags'] = ['nw/人物'];
        const change: TagMigrationChange = {
            path: NOTE,
            kind: 'character',
            tags: ['nw/人物'],
            add: ['nw/人物', 'nw/设定'],
        };

        const result = await applyTagMigration(app as never, [change]);

        expect(result).toEqual({ written: 1, added: 1 });
        expect(fm['tags']).toEqual(['nw/人物', 'nw/设定']);
    });

    it('Bases 看板走 adapter 覆盖写，重复生成路径一致（幂等）', async () => {
        const { app } = makeApp();
        const first = await writeProjectBases(app as never, PROJECT);
        const second = await writeProjectBases(app as never, PROJECT);

        expect(first.length).toBeGreaterThan(0);
        expect(second).toEqual(first);
        for (const path of first) {
            expect(path.startsWith(`${PROJECT}/.看板/`)).toBe(true);
        }
        expect(app.vault.adapter.write).toHaveBeenCalledTimes(first.length * 2);
    });
});