import { describe, expect, it } from 'vitest';
import {
    ensureProtagonistMemoryShards,
    formatMemoryShardFile,
    parseMemoryShardsFromModel,
} from '../../../engine/memory/memory-shard-writer';
import { pjMemoryShardsDir } from '../../../shared/paths';

const modelOutput = [
    '好的，以下是为角色生成的记忆碎片：',
    '## m001 檀香与灰烬',
    'trigger_smells: 檀香, 灰烬',
    'trigger_sounds: 钟声',
    'importance: 9',
    '七岁那年冬天，家祠走了水，父亲把我从火里拖出来。',
    '',
    '## m002 断掉的玉簪',
    'trigger_touches: 冰凉的玉, 断口',
    'trigger_keywords: 母亲, 遗物',
    'importance: 7',
    '母亲的玉簪断在我手里，她说碎碎平安。',
    '',
    '这段不是碎片（没有 ## 标题）',
].join('\n');

describe('memory-shard-writer — 记忆碎片自动生成', () => {
    it('解析 ## 段并重排 id', () => {
        const shards = parseMemoryShardsFromModel(modelOutput);
        expect(shards).toHaveLength(2);
        expect(shards[0]).toMatchObject({ id: 'm001', title: '檀香与灰烬' });
        expect(shards[1].id).toBe('m002');
        expect(shards[0].body).toContain('七岁那年冬天');
    });

    it('空段（无触发标签且正文过短）被丢弃', () => {
        const shards = parseMemoryShardsFromModel('## m001 空的\n正文太短。');
        expect(shards).toHaveLength(0);
    });

    it('空输出返回空数组', () => {
        expect(parseMemoryShardsFromModel('')).toEqual([]);
    });

    it('序列化结果含标题与正文（与读侧解析器同构）', () => {
        const shards = parseMemoryShardsFromModel(modelOutput);
        const content = formatMemoryShardFile(shards);
        expect(content).toContain('## m001 檀香与灰烬');
        expect(content).toContain('trigger_smells: 檀香, 灰烬');
        expect(content).toContain('## m002 断掉的玉簪');
    });

    it('角色名含穿越段时净化文件名，不写出记忆碎片目录（S-11）', async () => {
        const project = '长篇小说/测试书';
        const created: string[] = [];
        const app = {
            vault: {
                getAbstractFileByPath: () => null,
                createFolder: async () => undefined,
                create: async (path: string) => {
                    created.push(path);
                    return {};
                },
            },
        };
        const result = await ensureProtagonistMemoryShards(app as never, {
            project,
            characterName: '../../evil',
            soulDetail: '欲望：复仇',
            callAI: async () => [
                '## m001 火中的家祠',
                'importance: 9',
                'trigger_smells: 檀香',
                '七岁那年冬天，家祠走了水，父亲把我从火里拖出来。',
            ].join('\n'),
        });

        const dir = pjMemoryShardsDir(project);
        expect(result).toBeTruthy();
        expect(result!.startsWith(`${dir}/`)).toBe(true);
        expect(result).not.toContain('../');
        expect(created).toEqual([result]);
    });
});
