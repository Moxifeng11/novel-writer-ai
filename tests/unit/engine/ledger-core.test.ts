import { describe, expect, it } from 'vitest';
import { parseForeshadowLibrary, parseTimelineBoard } from '../../../engine/ledger/ledger-parse';
import { buildLedgerIndex, dueForeshadows, timelineWindow } from '../../../engine/ledger/ledger-index';
import {
    appendEventToContent,
    appendForeshadowToContent,
    moveForeshadowToRevealedInContent,
} from '../../../engine/ledger/ledger-write';
import { normalizeForeshadowStatus } from '../../../engine/ledger/ledger-model';

const TIMELINE_4COL = `# 时间线看板

### 背景纪元（故事开始前）

| 时间 | 对应章节 | 事件 | 影响 |
|------|---------|------|------|
| 三百年前 | 第1章 | 天门崩塌 | 灵气外泄 |

### 主线纪元（故事进行中）

| 时间 | 对应章节 | 事件 | 影响 |
|------|---------|------|------|
| 第一日 | 第1章 | 林惊鸿入门 | 拜入青云宗 |
| 第三日 | 第2章 | 试炼开始 | 结识同门 |
`;

const TIMELINE_7COL = `# 时间线看板

| # | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型 |
|---|---|---|---|---|---|---|
| 1 | 山门试炼 | 清晨 | 青云山 | 林惊鸿、苏雪 | 第3章 | 主线 |
| 2 | 夜谈 | 深夜 | 藏经阁 | 林惊鸿 | 第4章 | 支线 |
`;

const FORESHADOW_LIB = `# 伏笔库

## 未回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 相关人物 | 关联主线 | 当前状态 |
|---|---------|---------|---------|---------|---------|---------|---------|
| 1 | 断裂的玉佩 | 高 | 第2章 | 第8章 | 林惊鸿、苏雪 | 身世线 | 未揭示 |
| 2 | 神秘的来信 | 中 | 第3章 | 第6章 | 林惊鸿 | 师门线 | 待回收 |

## 已回收伏笔

| # | 伏笔名称 | 重要程度 | 埋设章节 | 相关人物 | 关联主线 | 回收章节 | 回收方式 |
|---|---------|---------|---------|---------|---------|---------|---------|
| 1 | 旧剑 | 低 | 第1章 | 林惊鸿 | 入门线 | 第3章 | 正文揭示 |

## 已废弃伏笔

| # | 伏笔名称 | 原因 | 废弃章节 |
|---|---------|------|---------|
| 1 | 废弃支线 | 与主线冲突 | 第5章 |
`;

describe('ledger-parse — 时间线', () => {
    it('4 列双纪元：解析纪元、章号与涉及人物', () => {
        const result = parseTimelineBoard(TIMELINE_4COL, '时间线看板.md');
        expect(result.records).toHaveLength(3);
        expect(result.eras).toEqual(['背景纪元（故事开始前）', '主线纪元（故事进行中）']);
        const first = result.records[0];
        expect(first.era).toBe('background');
        expect(first.name).toBe('天门崩塌');
        expect(first.chapterNum).toBe(1);
        const third = result.records[2];
        expect(third.era).toBe('main');
        expect(third.impact).toBe('结识同门');
    });

    it('7 列平表：按表头映射，不把 # 当时间', () => {
        const result = parseTimelineBoard(TIMELINE_7COL);
        expect(result.records).toHaveLength(2);
        expect(result.records[0]).toMatchObject({
            name: '山门试炼',
            time: '清晨',
            location: '青云山',
            chapterNum: 3,
        });
        expect(result.records[0].entityRefs.map((ref) => ref.name)).toEqual(['林惊鸿', '苏雪']);
    });

    it('忽略 NW-LINKAGE 自动块', () => {
        const content = `${TIMELINE_4COL}\n<!-- NW-LINKAGE:BEGIN 自动 -->\n| 时间 | 章节 | 事件 |\n|---|---|---|\n| 假事件 | 第99章 | 污染 |\n<!-- NW-LINKAGE:END -->\n`;
        const result = parseTimelineBoard(content);
        expect(result.records.map((record) => record.name)).not.toContain('污染');
    });

    it('章节倒序产出 issue', () => {
        const content = `| 时间 | 对应章节 | 事件 | 影响 |\n|---|---|---|---|\n| 一 | 第5章 | A | |\n| 二 | 第2章 | B | |\n`;
        const result = parseTimelineBoard(content);
        expect(result.issues.some((issue) => issue.type === 'out-of-order')).toBe(true);
    });
});

describe('ledger-parse — 伏笔', () => {
    it('三节状态正确，待回收不再误判为已揭示', () => {
        const result = parseForeshadowLibrary(FORESHADOW_LIB, '伏笔库.md');
        expect(result.records).toHaveLength(4);
        const byName = new Map(result.records.map((record) => [record.name, record]));
        expect(byName.get('断裂的玉佩')!.status).toBe('unrevealed');
        expect(byName.get('神秘的来信')!.status).toBe('unrevealed');
        expect(byName.get('旧剑')!.status).toBe('revealed');
        expect(byName.get('旧剑')!.revealChapter).toBe('第3章');
        expect(byName.get('废弃支线')!.status).toBe('abandoned');
        expect(byName.get('废弃支线')!.reason).toBe('与主线冲突');
    });

    it('状态归一：待回收/未揭示/已揭示/废弃', () => {
        expect(normalizeForeshadowStatus('待回收', 'unrevealed')).toBe('unrevealed');
        expect(normalizeForeshadowStatus('已揭示', 'unknown')).toBe('revealed');
        expect(normalizeForeshadowStatus('废弃', 'unknown')).toBe('abandoned');
    });

    it('重复行合并并报 issue', () => {
        const content = FORESHADOW_LIB.replace(
            '| 2 | 神秘的来信 | 中 | 第3章 | 第6章 | 林惊鸿 | 师门线 | 待回收 |',
            '| 2 | 神秘的来信 | 中 | 第3章 | 第6章 | 林惊鸿 | 师门线 | 待回收 |\n| 9 | 神秘的来信 | 高 | 第3章 | 第7章 | 林惊鸿 | 师门线 | 未揭示 |',
        );
        const result = parseForeshadowLibrary(content);
        expect(result.records.filter((record) => record.name === '神秘的来信')).toHaveLength(1);
        expect(result.issues.some((issue) => issue.type === 'duplicate-row')).toBe(true);
    });
});

describe('ledger-index — 查询', () => {
    const ledger = buildLedgerIndex({ timelineContent: TIMELINE_4COL, foreshadowContent: FORESHADOW_LIB });

    it('到期伏笔按计划章筛选', () => {
        expect(dueForeshadows(ledger, 5).map((record) => record.name)).toEqual([]);
        expect(dueForeshadows(ledger, 7).map((record) => record.name)).toEqual(['神秘的来信']);
        expect(dueForeshadows(ledger, 9).map((record) => record.name)).toEqual(['神秘的来信', '断裂的玉佩']);
    });

    it('时间线窗口按当前章过滤并新→旧', () => {
        expect(timelineWindow(ledger, 2, 10).map((event) => event.name)).toEqual(['试炼开始', '林惊鸿入门', '天门崩塌']);
        expect(timelineWindow(ledger, 1, 10).map((event) => event.name)).toEqual(['林惊鸿入门', '天门崩塌']);
    });
});

describe('ledger-write — 时间线写入', () => {
    it('4 列项目追加主线事件：保持 4 列并写入主线纪元', () => {
        const result = appendEventToContent(TIMELINE_4COL, {
            name: '秘境开启', time: '第五日', chapterKey: '第3章', impact: '众人入秘境',
        });
        expect(result.changed).toBe(true);
        const lines = result.content.split('\n');
        const mainIdx = lines.findIndex((line) => line.includes('主线纪元'));
        const row = lines.slice(mainIdx).find((line) => line.includes('秘境开启'))!;
        expect(row.split('|').slice(1, -1)).toHaveLength(4);
        expect(result.content.indexOf('秘境开启')).toBeGreaterThan(result.content.indexOf('主线纪元'));
    });

    it('同事件重复写入幂等', () => {
        const first = appendEventToContent(TIMELINE_4COL, { name: '秘境开启', time: '第五日', chapterKey: '第3章' });
        const second = appendEventToContent(first.content, { name: '秘境开启', time: '第五日', chapterKey: '第3章' });
        expect(second.changed).toBe(false);
        expect(second.reason).toBe('duplicate');
    });

    it('7 列项目追加事件：保持 7 列，不插错表', () => {
        const result = appendEventToContent(TIMELINE_7COL, {
            name: '长老议事', time: '午后', chapterKey: '第5章', involved: ['林惊鸿'], location: '议事堂',
        });
        const row = result.content.split('\n').find((line) => line.includes('长老议事'))!;
        expect(row.split('|').slice(1, -1)).toHaveLength(7);
        expect(row).toContain('议事堂');
    });

    it('空内容创建双纪元模板', () => {
        const result = appendEventToContent('', { name: '开篇', time: '第一日', chapterKey: '第1章' });
        expect(result.content).toContain('背景纪元');
        expect(result.content).toContain('主线纪元');
        expect(result.content).toContain('开篇');
    });
});

describe('ledger-write — 伏笔写入', () => {
    it('追加未回收伏笔到 8 列表', () => {
        const result = appendForeshadowToContent(FORESHADOW_LIB, {
            name: '染血的战旗', importance: '高', buryChapter: '第4章', plannedReveal: '第9章',
            relatedChars: '林惊鸿', mainline: '战争线',
        });
        const row = result.content.split('\n').find((line) => line.includes('染血的战旗'))!;
        expect(row.split('|').slice(1, -1)).toHaveLength(8);
        expect(row).toContain('第9章');
        expect(row).toContain('战争线');
        expect(row).toContain('未揭示');
    });

    it('同名伏笔不重复追加', () => {
        const result = appendForeshadowToContent(FORESHADOW_LIB, { name: '断裂的玉佩' });
        expect(result.changed).toBe(false);
        expect(result.reason).toBe('duplicate');
    });

    it('移到已回收：相关人物/主线/回收章不串列', () => {
        const result = moveForeshadowToRevealedInContent(FORESHADOW_LIB, '断裂的玉佩', '第8章');
        expect(result.changed).toBe(true);
        const lines = result.content.split('\n');
        const revealedStart = lines.findIndex((line) => line.includes('## 已回收伏笔'));
        const row = lines.slice(revealedStart).find((line) => line.includes('断裂的玉佩'))!;
        const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
        expect(cells).toHaveLength(8);
        expect(cells[1]).toBe('断裂的玉佩');
        expect(cells[4]).toBe('林惊鸿、苏雪');
        expect(cells[5]).toBe('身世线');
        expect(cells[6]).toBe('第8章');
        expect(cells[7]).toBe('正文揭示');
        // 未回收表不再包含
        const unrevealedStart = lines.findIndex((line) => line.includes('## 未回收伏笔'));
        const unrevealedEnd = revealedStart;
        expect(lines.slice(unrevealedStart, unrevealedEnd).some((line) => line.includes('断裂的玉佩'))).toBe(false);
    });

    it('找不到伏笔时原样返回', () => {
        const result = moveForeshadowToRevealedInContent(FORESHADOW_LIB, '不存在', '第8章');
        expect(result.changed).toBe(false);
        expect(result.content).toBe(FORESHADOW_LIB);
    });
});
