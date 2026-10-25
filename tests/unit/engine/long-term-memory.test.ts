import { describe, expect, it } from 'vitest';
import {
    formatConfirmedFacts,
    loadLongTermMemory,
    loadVolumeSummaries,
    LONG_TERM_MEMORY_MAX_CHARS,
} from '../../../engine/long-term-memory';
import type { ConfirmedFact } from '../../../engine/fact-index-manager';
import type { FileSystemPort } from '../../../shared/file-system-port';

function fact(category: ConfirmedFact['category'], name: string, content = name): ConfirmedFact {
    return { id: `${category}:${name}`, category, name, content, source: 'test', confirmedAt: 1 };
}

function fakeFS(files: Record<string, string>): FileSystemPort {
    return {
        exists: async (path: string) => path in files,
        read: async (path: string) => {
            if (!(path in files)) throw new Error('missing');
            return files[path];
        },
        write: async (path: string, content: string) => { files[path] = content; },
        delete: async () => undefined,
        mkdir: async () => undefined,
        listFiles: async (dir: string) => Object.keys(files)
            .filter((path) => path.startsWith(`${dir}/`))
            .map((path) => ({ path, name: path.slice(dir.length + 1) }) as never),
        getFile: async () => null,
    } as unknown as FileSystemPort;
}

const INDEX_PATH = 'proj/04-项目总控/事实索引.json';

describe('formatConfirmedFacts', () => {
    it('按 人物/世界观/剧情 顺序分组输出', () => {
        const text = formatConfirmedFacts([
            fact('plot', '灵脉断裂', '第三章后灵气衰退'),
            fact('character', '林昭', '左臂有旧伤'),
            fact('world', '青云宗'),
        ]);
        const characterIdx = text.indexOf('### 人物');
        const worldIdx = text.indexOf('### 世界观');
        const plotIdx = text.indexOf('### 剧情');
        expect(characterIdx).toBeGreaterThan(-1);
        expect(characterIdx).toBeLessThan(worldIdx);
        expect(worldIdx).toBeLessThan(plotIdx);
        expect(text).toContain('- 林昭：左臂有旧伤');
    });

    it('无事实时返回空串', () => {
        expect(formatConfirmedFacts([])).toBe('');
    });

    it('每类按上限截断，但不影响其他类别', () => {
        const facts = [
            ...Array.from({ length: 5 }, (_, i) => fact('character', `角色${i}`)),
            fact('world', '唯一天地'),
        ];
        const text = formatConfirmedFacts(facts, 2);
        expect(text).toContain('角色0');
        expect(text).toContain('角色1');
        expect(text).not.toContain('角色2');
        expect(text).toContain('唯一天地');
    });

    it('超过整体上限时截断并标注', () => {
        const facts = Array.from({ length: 12 }, (_, i) => fact('plot', `节点${i}`, '细'.repeat(200)));
        const text = formatConfirmedFacts(facts);
        expect(text.length).toBeLessThanOrEqual(LONG_TERM_MEMORY_MAX_CHARS + 8);
        expect(text.endsWith('（已截断）')).toBe(true);
    });
});

describe('loadLongTermMemory', () => {
    it('读取已确认事实并格式化', async () => {
        const fs = fakeFS({
            [INDEX_PATH]: JSON.stringify({
                version: 1,
                pending: [],
                confirmed: [fact('character', '林昭', '左臂有旧伤')],
                updatedAt: 1,
            }),
        });
        const text = await loadLongTermMemory(fs, 'proj');
        expect(text).toContain('林昭');
    });

    it('索引缺失或损坏时降级为空串', async () => {
        expect(await loadLongTermMemory(fakeFS({}), 'proj')).toBe('');
        expect(await loadLongTermMemory(fakeFS({ [INDEX_PATH]: '{broken' }), 'proj')).toBe('');
    });

    it('传入 beforeVolume 时注入前序卷摘要，且不包含当前卷', async () => {
        const dir = 'proj/03-大纲与章节/分卷大纲';
        const fs = fakeFS({
            [`${dir}/第1卷_分卷大纲.md`]: [
                '## 人物弧光', '- 林昭失去左臂', '',
                '## 主要事件', '- 青云宗覆灭', '',
                '## 伏笔安排', '- 埋设：青铜钥匙', '',
                '## 结尾过渡', '众人前往北境', '',
            ].join('\n'),
            [`${dir}/第2卷_分卷大纲.md`]: [
                '## 主要事件', '- 北境称王', '',
            ].join('\n'),
        });

        const text = await loadLongTermMemory(fs, 'proj', { beforeVolume: 2 });
        expect(text).toContain('前 1 卷摘要');
        expect(text).toContain('青云宗覆灭');
        expect(text).not.toContain('北境称王');
    });

    it('第1卷或目录缺失时不产生前情提要', async () => {
        const dir = 'proj/03-大纲与章节/分卷大纲';
        const fs = fakeFS({
            [`${dir}/第1卷_分卷大纲.md`]: '## 主要事件\n- 开篇\n',
        });
        expect(await loadLongTermMemory(fs, 'proj', { beforeVolume: 1 })).toBe('');
        expect(await loadVolumeSummaries(fakeFS({}), 'proj', { beforeVolume: 3 })).toBe('');
    });

    it('只有 pending 事实时不注入（未确认事实绝不进 prompt）', async () => {
        const fs = fakeFS({
            [INDEX_PATH]: JSON.stringify({
                version: 1,
                pending: [{ ...fact('character', '未确认角色'), status: 'pending' }],
                confirmed: [],
                updatedAt: 1,
            }),
        });
        expect(await loadLongTermMemory(fs, 'proj')).toBe('');
    });
});
