import { describe, expect, it } from 'vitest';
import {
    parseForeshadowLibrary, parseMarkdownTable, parseTimelineBoard,
    renderForeshadowLibrary, renderTimelineBoard,
} from '@/shared/ledger-card-model';

const TIMELINE = `# 时间线看板

| 时间 | 事件 | 章节 | 地点 | 涉及人物 | 类型 |
|---|---|---|---|---|---|
| 0012-03-05 | 入门大典 | 第3章 | 青云宗 | 林玄、苏婉 | 剧情 |
| 0012-03-06 | 断剑异动 | 第4章 | 后山 | 林玄 | 伏笔 |
`;

const FORESHADOW = `# 伏笔库

## 未回收

| 伏笔 | 埋设章节 | 计划回收 | 重要程度 |
|---|---|---|---|
| 断剑来历 | 第4章 | 第20章 | 高 |
| 神秘玉佩 | 第6章 | 第30章 | 中 |

## 已回收

| 伏笔 | 埋设章节 | 回收章节 |
|---|---|---|
| 守门弟子身份 | 第1章 | 第5章 |
`;

describe('parseMarkdownTable', () => {
    it('解析表头与行', () => {
        const rows = parseMarkdownTable(TIMELINE, '时间');
        expect(rows).toHaveLength(2);
        expect(rows[0]['事件']).toBe('入门大典');
    });

    it('无表返回空', () => {
        expect(parseMarkdownTable('普通文本', '时间')).toEqual([]);
    });
});

describe('时间线卡片化', () => {
    it('解析为事件卡', () => {
        const cards = parseTimelineBoard(TIMELINE);
        expect(cards).toHaveLength(2);
        expect(cards[0].time).toBe('0012-03-05');
        expect(cards[0].characters).toEqual(['林玄', '苏婉']);
        expect(cards[1].event).toBe('断剑异动');
    });

    it('渲染派生看板（往返一致）', () => {
        const cards = parseTimelineBoard(TIMELINE);
        const rendered = renderTimelineBoard(cards);
        expect(rendered).toContain('| 0012-03-05 | 入门大典 |');
        expect(rendered).toContain('请勿手改');
        expect(parseTimelineBoard(rendered)).toHaveLength(2);
    });
});

describe('伏笔卡片化', () => {
    it('解析并推断状态', () => {
        const cards = parseForeshadowLibrary(FORESHADOW);
        expect(cards).toHaveLength(3);
        expect(cards[0].name).toBe('断剑来历');
        expect(cards[0].status).toBe('planted');
        expect(cards[2].status).toBe('resolved');
    });

    it('渲染派生库按状态分节', () => {
        const rendered = renderForeshadowLibrary(parseForeshadowLibrary(FORESHADOW));
        expect(rendered).toContain('## 未回收');
        expect(rendered).toContain('## 已回收');
        expect(rendered).toContain('断剑来历');
        expect(rendered).toContain('守门弟子身份');
    });

    it('渲染后仍可解析（往返）', () => {
        const cards = parseForeshadowLibrary(FORESHADOW);
        expect(parseForeshadowLibrary(renderForeshadowLibrary(cards))).toHaveLength(3);
    });
});
