import { describe, expect, it } from 'vitest';
import {
    activeAtToken,
    buildMentionBlock,
    extractMentionPaths,
    filterVaultPaths,
    formatFileMention,
    parseMentions,
    stripMentionMarkers,
} from '../../../shared/file-mention';

describe('file-mention — @ 引用语法', () => {
    describe('activeAtToken', () => {
        it('行首 @ 后返回查询片段', () => {
            const token = activeAtToken('@设定', 3);
            expect(token).toEqual({ start: 0, end: 3, query: '设定', quoted: false });
        });

        it('空白之后的 @ 有效；词中间的 @ 无效（邮箱不触发）', () => {
            expect(activeAtToken('看看 @第1章', 7)?.query).toBe('第1章');
            expect(activeAtToken('a@b', 3)).toBeNull();
        });

        it('空格会结束未加引号的引用', () => {
            expect(activeAtToken('@项目 目录', 6)).toBeNull();
        });

        it('带引号的引用允许空格', () => {
            const token = activeAtToken('@"项目 名/第1章.md', 14);
            expect(token?.quoted).toBe(true);
            expect(token?.query).toBe('项目 名/第1章.md');
        });

        it('光标不在引用里时返回 null', () => {
            expect(activeAtToken('普通输入', 4)).toBeNull();
            expect(activeAtToken('', 0)).toBeNull();
        });

        it('查询片段过长视为普通文本', () => {
            expect(activeAtToken(`@${'甲'.repeat(200)}`, 201)).toBeNull();
        });
    });

    describe('formatFileMention', () => {
        it('普通路径不加引号', () => {
            expect(formatFileMention('项目/正文/第1章.md')).toBe('@项目/正文/第1章.md');
        });

        it('含空格或引号的路径加引号', () => {
            expect(formatFileMention('项目/带 空格.md')).toBe('@"项目/带 空格.md"');
            expect(formatFileMention('项目/"引号".md')).toBe('@"项目/"引号".md"');
        });

        it('去掉前导斜杠与空值', () => {
            expect(formatFileMention('/项目/a.md')).toBe('@项目/a.md');
            expect(formatFileMention('  ')).toBe('');
        });
    });

    describe('parseMentions / extractMentionPaths', () => {
        it('解析多个引用并保留位置', () => {
            const text = '参考 @项目/大纲.md 和 @"项目/带 空格.md"，谢谢';
            const mentions = parseMentions(text);
            expect(mentions.map(item => item.path)).toEqual(['项目/大纲.md', '项目/带 空格.md']);
            expect(text.slice(mentions[0].start, mentions[0].end)).toBe('@项目/大纲.md');
        });

        it('去掉中文标点尾巴', () => {
            expect(extractMentionPaths('看 @项目/第1章.md。')).toEqual(['项目/第1章.md']);
        });

        it('去重且保持首次出现顺序', () => {
            expect(extractMentionPaths('@a.md 再看 @a.md 和 @b.md')).toEqual(['a.md', 'b.md']);
        });

        it('邮箱/词中 @ 不算引用', () => {
            expect(extractMentionPaths('联系 me@example.com')).toEqual([]);
        });
    });

    describe('filterVaultPaths', () => {
        const paths = [
            '长篇/项目A/设定/武昭.md',
            '长篇/项目A/正文/第1章.md',
            '长篇/项目A/正文/第10章.md',
            '短篇/项目B/正文/武昭前传.md',
            '长篇/项目A/大纲.md',
        ];

        it('文件名前缀命中优先于路径包含', () => {
            expect(filterVaultPaths(paths, '武昭')[0]).toBe('长篇/项目A/设定/武昭.md');
            expect(filterVaultPaths(paths, '武昭')).toContain('短篇/项目B/正文/武昭前传.md');
        });

        it('空查询返回最短路径优先的一批', () => {
            const all = filterVaultPaths(paths, '', 3);
            expect(all).toHaveLength(3);
            expect(all[0].length).toBeLessThanOrEqual(all[2].length);
        });

        it('大小写不敏感且遵守上限', () => {
            expect(filterVaultPaths(['A/B.MD'], 'b.md')).toEqual(['A/B.MD']);
            expect(filterVaultPaths(paths, '正文', 1)).toHaveLength(1);
        });

        it('无命中返回空数组', () => {
            expect(filterVaultPaths(paths, '不存在')).toEqual([]);
        });
    });

    describe('buildMentionBlock / stripMentionMarkers', () => {
        it('只给路径与取用方式，不含正文', () => {
            const block = buildMentionBlock(['项目/正文/第1章.md', '项目/设定/武昭.md', '项目/正文/第1章.md']);
            expect(block).toContain('项目/正文/第1章.md');
            expect(block.match(/项目\/正文\/第1章\.md/g)).toHaveLength(1);
            expect(block).toContain('read_file');
        });

        it('没有引用时返回空串（不污染提示词）', () => {
            expect(buildMentionBlock([])).toBe('');
            expect(buildMentionBlock(['', '  '])).toBe('');
        });

        it('气泡展示用书名号替换 @', () => {
            expect(stripMentionMarkers('参考 @项目/大纲.md')).toBe('参考 《项目/大纲.md》');
            expect(stripMentionMarkers('参考 @"项目/带 空格.md"。')).toBe('参考 《项目/带 空格.md》。');
        });
    });
});