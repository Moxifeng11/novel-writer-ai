/**
 * kb-book-card.test.ts — 书籍卡片 DOM 构建回归（阶段 D2 / DSH-20261112-07）
 *
 * 这些分支此前只能打开知识库翻书确认：向量化失败警示与「重试」按钮、拆解进度条、
 * 分类预览、自定义标签过滤、质量分有无。判定函数（kb-card-logic）已有单测，
 * 这里锁的是「判定为真时 DOM 真的长出来、判定为假时真的不长」。
 *
 * 用最小假元素：只需要 Obsidian 的 createDiv/createSpan/createEl/addClass/
 * addEventListener/stopPropagation 语义，不引入 jsdom。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv } from './support/fake-dom';
import type { BookBasicInfo } from '../../../services/knowledge-base-manager';
import type { ClassificationResult } from '../../../shared/content-classifier';

function book(overrides: Partial<BookBasicInfo> = {}): BookBasicInfo {
    return {
        id: 'b1',
        name: '赤潮',
        author: '林三',
        wordCount: 12500,
        themeTags: [],
        techniqueTags: [],
        customTags: [],
        createdAt: Date.UTC(2026, 0, 2),
        updatedAt: Date.UTC(2026, 0, 3),
        breakdownStatus: 'completed',
        ...overrides,
    } as BookBasicInfo;
}

function classification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
    return {
        primary: '男频 · 玄幻',
        summary: '男频 · 玄幻 · 热血',
        tags: [
            { dimension: '题材', label: '男频', reason: '主角成长', confidence: 0.92 },
            { dimension: '题材', label: '玄幻', reason: '修炼体系', confidence: 0.81 },
        ],
        ...overrides,
    } as ClassificationResult;
}

type Host = Parameters<typeof import('../../../ui/views/kb-book-card').buildKbBookCard>[1];

function host(overrides: Partial<Host> = {}): Host {
    return {
        isSelectedBook: () => false,
        getStatusLabel: status => `状态:${status}`,
        formatWordCount: n => (n ? `${n} 字` : '未知'),
        classifyBookInfo: () => classification(),
        getGenreName: () => '玄幻',
        formatDate: () => '2026-01-02',
        openBookDetail: vi.fn(),
        ...overrides,
    };
}

let buildKbBookCard: typeof import('../../../ui/views/kb-book-card').buildKbBookCard;

beforeEach(async () => {
    stubCreateDiv();
    ({ buildKbBookCard } = await import('../../../ui/views/kb-book-card'));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('buildKbBookCard 基本结构', () => {
    it('未选中：卡片带基础类、含悬停类、无 is-selected', () => {
        const card = buildKbBookCard(book(), host()) as unknown as FakeEl;
        expect(card.className).toContain('nw-kb-book-card');
        expect(card.className).toContain('nw-hover-border');
        expect(card.className).not.toContain('is-selected');
        expect(card.getAttribute('style')).toContain('border:1px solid');
        expect(card.getAttribute('style')).not.toContain('interactive-accent');
    });

    it('选中：is-selected + 强调色边框', () => {
        const card = buildKbBookCard(book(), host({ isSelectedBook: () => true })) as unknown as FakeEl;
        expect(card.className).toContain('is-selected');
        expect(card.getAttribute('style')).toContain('border-color:var(--interactive-accent)');
    });

    it('书名、状态徽标、作者与字数都渲染', () => {
        const card = buildKbBookCard(book(), host()) as unknown as FakeEl;
        const text = card.allText();
        expect(text).toContain('赤潮');
        expect(text).toContain('状态:completed');
        expect(text).toContain('林三');
        expect(text).toContain('12500 字');
    });

    it('空作者回落「未知作者」，字数未知回落「未知」', () => {
        const card = buildKbBookCard(
            book({ author: '   ', wordCount: undefined }),
            host({ formatWordCount: n => (n ? `${n} 字` : '未知') }),
        ) as unknown as FakeEl;
        expect(card.allText()).toContain('未知作者');
        expect(card.allText()).toContain('未知');
    });

    it('点击卡片打开详情', () => {
        const open = vi.fn();
        const card = buildKbBookCard(book(), host({ openBookDetail: open })) as unknown as FakeEl;
        card.dispatch('click');
        expect(open).toHaveBeenCalledTimes(1);
        expect((open.mock.calls[0][0] as BookBasicInfo).id).toBe('b1');
    });
});

describe('向量化失败警示与重试', () => {
    it('未失败不出现警示', () => {
        const card = buildKbBookCard(book({ vectorStatus: 'done' }), host()) as unknown as FakeEl;
        expect(card.allText()).not.toContain('向量化失败');
    });

    it('失败且宿主提供 onRetryVectorize：出警示 + 重试按钮，点击不冒泡到卡片', () => {
        const retry = vi.fn();
        const open = vi.fn();
        const card = buildKbBookCard(
            book({ vectorStatus: 'failed', vectorError: '模型 404' }),
            host({ onRetryVectorize: retry, openBookDetail: open }),
        ) as unknown as FakeEl;

        const warning = card.findAll('nw-flex-shrink-0')[0];
        expect(card.allText()).toContain('⚠️ 向量化失败');
        const warningSpan = card.children[0].children.find(c => c.textContent.includes('⚠️ 向量化失败'));
        expect(warningSpan?.getAttribute('title')).toBe('模型 404');
        expect(warning).toBeTruthy();

        const button = card.children[0].children
            .flatMap(c => c.children)
            .find(c => c.tagName === 'button');
        expect(button).toBeTruthy();
        expect(button?.textContent).toBe('重试');

        const stopPropagation = vi.fn();
        button?.dispatch('click', { stopPropagation });
        expect(stopPropagation).toHaveBeenCalledTimes(1);
        expect(retry).toHaveBeenCalledTimes(1);
        expect(open).not.toHaveBeenCalled();
    });

    it('失败但宿主未提供 onRetryVectorize：只有警示、没有按钮', () => {
        const card = buildKbBookCard(book({ vectorStatus: 'failed' }), host()) as unknown as FakeEl;
        expect(card.allText()).toContain('⚠️ 向量化失败');
        expect(card.children[0].children.some(c => c.children.some(x => x.tagName === 'button'))).toBe(false);
    });
});

describe('拆解进度条', () => {
    it('拆解中且进度已知：进度条 + 文案', () => {
        const card = buildKbBookCard(
            book({ breakdownStatus: 'processing', breakdownProgress: 42 }),
            host(),
        ) as unknown as FakeEl;
        expect(card.allText()).toContain('拆解中 42%');
        const bar = card.children.find(c => c.className.includes('nw-u-marginbottom-8px') && c.children.some(x => x.className.includes('nw-u-h-4px')));
        const inner = bar?.children[0].children[0];
        expect(inner?.getAttribute('style')).toContain('width:42%');
    });

    it('拆解中但进度未知：不出现进度条', () => {
        const card = buildKbBookCard(book({ breakdownStatus: 'processing' }), host()) as unknown as FakeEl;
        expect(card.allText()).not.toContain('拆解中');
        expect(card.findAll('nw-u-h-4px')).toHaveLength(0);
    });
});

describe('分类与标签', () => {
    it('分类预览：主分类 + 每条标签，悬停给维度/理由/置信度', () => {
        const card = buildKbBookCard(book(), host()) as unknown as FakeEl;
        const row = card.findAll('nw-kb-class-row')[0];
        expect(row.children[0].textContent).toBe('🏷️ 男频 · 玄幻');
        expect(row.children[0].getAttribute('title')).toBe('男频 · 玄幻 · 热血');
        expect(row.children.slice(1).map(c => c.textContent)).toEqual(['男频', '玄幻']);
        expect(row.children[1].getAttribute('title')).toBe('题材 · 主角成长（置信度 92%）');
    });

    it('无分类标签：不渲染分类行', () => {
        const card = buildKbBookCard(
            book(),
            host({ classifyBookInfo: () => classification({ tags: [] }) }),
        ) as unknown as FakeEl;
        expect(card.findAll('nw-kb-class-row')).toHaveLength(0);
    });

    it('流派名解析为空时不渲染流派标签', () => {
        const card = buildKbBookCard(
            book({ primaryGenre: 'g1' }),
            host({
                getGenreName: () => '',
                classifyBookInfo: () => classification({
                    primary: '男频 · 都市',
                    summary: '男频 · 都市',
                    tags: [{ dimension: '题材', label: '男频', reason: '都市线', confidence: 0.9 }],
                }),
            }),
        ) as unknown as FakeEl;
        expect(card.allText()).not.toContain('玄幻');
    });

    it('流派名可解析时渲染流派标签', () => {
        const card = buildKbBookCard(book({ primaryGenre: 'g1' }), host()) as unknown as FakeEl;
        expect(card.allText()).toContain('玄幻');
    });

    it('自定义标签过滤掉自动分类标签', () => {
        const card = buildKbBookCard(
            book({ customTags: ['爽文', '分类:节奏', '群像', '分类:基调', '第三个'] }),
            host(),
        ) as unknown as FakeEl;
        const text = card.allText();
        expect(text).toContain('爽文');
        expect(text).toContain('群像');
        expect(text).not.toContain('分类:节奏');
        expect(text).not.toContain('第三个');
    });
});

describe('页脚：质量分与日期', () => {
    it('有质量分：展示「⭐ n分」', () => {
        const card = buildKbBookCard(
            book({ qualityScores: { overall: 82.4 } as BookBasicInfo['qualityScores'] }),
            host(),
        ) as unknown as FakeEl;
        expect(card.allText()).toContain('⭐ 82分');
    });

    it('无质量分：留空占位，不出现「⭐」', () => {
        const card = buildKbBookCard(book(), host()) as unknown as FakeEl;
        expect(card.allText()).not.toContain('⭐');
        expect(card.allText()).toContain('2026-01-02');
    });
});
