import { describe, expect, it } from 'vitest';
import {
    BASE_DIR,
    baseFilePath,
    buildChapterProgressBase,
    buildCharacterBase,
    buildItemBase,
    buildLedgerBase,
    buildPlaceFactionBase,
    buildProjectBases,
} from '../../../engine/bases-generator';

const PROJECT = '长篇小说/九霄逆脉行';

describe('bases-generator — 章节进度', () => {
    const yaml = buildChapterProgressBase(PROJECT);

    it('按 nw/正文 与项目目录双筛选', () => {
        expect(yaml).toContain('file.hasTag("nw/正文")');
        expect(yaml).toContain(`file.inFolder("${PROJECT}")`);
    });

    it('表格列含状态/字数/涉及人物，并带字数汇总', () => {
        expect(yaml).toContain('- status');
        expect(yaml).toContain('- word_count');
        expect(yaml).toContain('- 涉及人物');
        expect(yaml).toContain('word_count: words_total');
        expect(yaml).toContain("words_total: 'values.sum()'");
    });

    it('有按状态分组卡片视图', () => {
        expect(yaml).toContain('type: cards');
        expect(yaml).toContain('property: status');
    });

    it('带生成标记，YAML 顶层键齐全', () => {
        expect(yaml.startsWith('# 由「小说工坊 AI」生成')).toBe(true);
        expect(yaml).toContain('filters:');
        expect(yaml).toContain('summaries:');
        expect(yaml).toContain('properties:');
        expect(yaml).toContain('views:');
    });
});

describe('bases-generator — 实体看板', () => {
    it('人物看板筛选 nw/实体/人物，含修为/势力/位置', () => {
        const yaml = buildCharacterBase(PROJECT);
        expect(yaml).toContain('file.hasTag("nw/实体/人物")');
        expect(yaml).toContain('- 修为等级');
        expect(yaml).toContain('- 所属势力');
        expect(yaml).toContain('- 当前位置');
        expect(yaml).toContain('property: 身份');
    });

    it('物品看板按持有者分组，含当前状态与效果', () => {
        const yaml = buildItemBase(PROJECT);
        expect(yaml).toContain('file.hasTag("nw/实体/物品")');
        expect(yaml).toContain('- 所属/归属');
        expect(yaml).toContain('- 当前状态');
        expect(yaml).toContain('- 效果');
        expect(yaml).not.toContain('- effect');
        expect(yaml).toContain('property: 所属/归属');
    });

    it('地点与势力是两个视图，各自带 tag 过滤', () => {
        const yaml = buildPlaceFactionBase(PROJECT);
        expect(yaml).toContain('name: "地点"');
        expect(yaml).toContain('filters: \'file.hasTag("nw/实体/地点")\'');
        expect(yaml).toContain('name: "势力"');
        expect(yaml).toContain('filters: \'file.hasTag("nw/实体/势力")\'');
        expect(yaml).toContain('- 领袖');
    });
});

describe('bases-generator — 项目看板全集', () => {
    it('五个看板文件路径在 .看板 目录下', () => {
        const bases = buildProjectBases(PROJECT);
        expect(bases).toHaveLength(5);
        expect(bases.every((spec) => spec.relativePath.startsWith(`${BASE_DIR}/`))).toBe(true);
        expect(bases.map((spec) => spec.relativePath)).toEqual([
            '.看板/章节进度.base',
            '.看板/人物状态.base',
            '.看板/物品归属.base',
            '.看板/地点与势力.base',
            '.看板/故事台账.base',
        ]);
    });

    it('故事台账看板按文件级摘要筛选四类台账', () => {
        const yaml = buildLedgerBase(PROJECT);
        expect(yaml).toContain('file.hasTag("nw/设定/时间线")');
        expect(yaml).toContain('file.hasTag("nw/设定/伏笔库")');
        expect(yaml).toContain('file.hasTag("nw/设定/关系状态")');
        expect(yaml).toContain('file.hasTag("nw/设定/剧情记忆")');
        expect(yaml).toContain('- 事件总数');
        expect(yaml).toContain('- 未回收数');
        expect(yaml).toContain('- 关系对数');
    });

    it('绝对路径拼接', () => {
        expect(baseFilePath(PROJECT, '.看板/章节进度.base')).toBe(`${PROJECT}/.看板/章节进度.base`);
    });

    it('所有看板的 tag 过滤器都指向写入端存在的层级标签', () => {
        const allowed = new Set([
            'nw/正文', 'nw/实体/人物', 'nw/实体/地点', 'nw/实体/势力', 'nw/实体/物品',
            'nw/设定/时间线', 'nw/设定/伏笔库', 'nw/设定/关系状态', 'nw/设定/剧情记忆',
        ]);
        for (const spec of buildProjectBases(PROJECT)) {
            for (const match of spec.content.matchAll(/hasTag\("([^"]+)"\)/g)) {
                expect(allowed.has(match[1]), `${spec.relativePath} → ${match[1]}`).toBe(true);
            }
        }
    });
});