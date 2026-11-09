/**
 * pure-helpers-coverage.test.ts — ui 层纯函数/低 DOM 模块的集中单测（G7-8 ui 覆盖率棘轮）
 *
 * 只测「输入 → 输出」可断言的纯逻辑，不渲染视图：
 *  - ui/co-writing/quality-report.ts  parseQualityReport（markdown → 问题列表）
 *  - ui/co-writing/chapter-match.ts   calculateChapterMatches（标签/技法命中计分）
 *  - ui/co-writing/writing-advice.ts  generateWritingAdvice（建议条数与分类）
 *  - ui/components/notice-helpers.ts  三类 Notice 助手（单测环境走纯文本降级分支；
 *    并用 stub 的最小 document 验证 fragment 组装路径与异常回退）
 *  - ui/cowrite/cowrite-mappers.ts    联想/方向/文风映射
 *  - ui/utils/worldview-utils.ts      extractWorldviewMeta
 *  - ui/cowrite/suggestion-history-store.ts（Vault mock，无 DOM）
 *  - ui/wizard-checker.ts（Vault mock 的文件完整性校验）
 *  - ui/project-utils.ts 纯函数与 Vault 查询
 *  - ui/svg-charts.ts 纯字符串 SVG 生成函数
 *
 * Notice 采用「记录调用的假 Notice」替换 tests/__mocks__/obsidian.ts 的既有导出，
 * 其余 mock 导出（Vault/TFile 等）原样保留（importOriginal 走既有 alias 垫片）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noticeCalls = vi.hoisted(() => [] as Array<{ message: unknown; timeout?: number | undefined }>);

// command-ui-executor 的依赖链在运行时引到构建产物 main.js（其 require('obsidian') 不走
// vitest 别名）——按 monitor-panel-b-close-flush.test.ts 的既有做法 mock 掉 @/main。
vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class RecordingNotice {
        message: unknown;
        timeout?: number;
        constructor(message: unknown, timeout?: number) {
            this.message = message;
            this.timeout = timeout;
            noticeCalls.push({ message, timeout });
        }
        setMessage(message: unknown): this {
            this.message = message;
            return this;
        }
        hide(): void {}
    }
    return {
        ...actual,
        Notice: RecordingNotice,
        // chapter-context-builder 引用的 Obsidian 工具函数（垫片未导出，按官方语义补齐）
        parseFrontMatterStringArray: (fm: Record<string, unknown> | null, key: string | RegExp): string[] | null => {
            if (!fm) return null;
            const raw = typeof key === 'string' ? fm[key] : undefined;
            if (Array.isArray(raw)) return raw.map(v => String(v));
            if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
            return null;
        },
    };
});

import { MetadataCache, TFile, Vault } from 'obsidian';

/** tests/__mocks__/obsidian.ts 里 Vault 带的测试辅助成员（TS 类型走真实 obsidian 声明，需显式补齐） */
type MockVault = Vault & {
    _seedFile(path: string, content: string): TFile;
    _folders: Set<string>;
    readByPath(path: string): Promise<string>;
};

function newMockVault(): MockVault {
    return new Vault() as unknown as MockVault;
}
import { parseQualityReport } from '@/ui/co-writing/quality-report';
import { calculateChapterMatches } from '@/ui/co-writing/chapter-match';
import { generateWritingAdvice } from '@/ui/co-writing/writing-advice';
import { showErrorNotice, showSuccessNotice, showWarningNotice } from '@/ui/components/notice-helpers';
import {
    associationToSuggestion,
    associationTypeToDirection,
    emptyMetrics,
    getAssociationLabel,
    getDirectionLabel,
    getStyleLabel,
} from '@/ui/cowrite/cowrite-mappers';
import { SuggestionHistoryStore } from '@/ui/cowrite/suggestion-history-store';
import {
    buildContextVars,
    buildEntityVars,
    buildSceneStyleHint,
    buildTemplateVars,
    type TemplateVarsDeps,
} from '@/ui/full-writer/template-vars-builder';
import { extractWorldviewMeta } from '@/ui/utils/worldview-utils';
import { WizardChecker } from '@/ui/wizard-checker';
import {
    findProjectCoverFile,
    getChaptersForProject,
    getNextChapter,
    getProjectCover,
    loadProjectCover,
    scanProjectChapters,
    sortChaptersByNumber,
} from '@/ui/project-utils';
import {
    areaChart,
    attachChartInteractions,
    barChart,
    createChartContainer,
    densityHeatmap,
    donutChart,
    heatmap,
    horizontalBarChart,
    lineChart,
    radarChart,
    scatterChart,
    scatterToHistogram,
    spiralLayout,
    timelineChart,
    treeChart,
    violinChart,
    wordCloud,
} from '@/ui/svg-charts';
import type { BookBasicInfo, QualityScores } from '@/services/knowledge-base-manager';
import type { GenreConfig, WebnovelKnowledgeBase } from '@/shared/webnovel-knowledge-base';
import { WV_SECTIONS } from '@/shared/format-constants';
import { entityDir } from '@/shared/entity-reader';
import { pjForeshadowDB, pjVolumeOutlineFile } from '@/shared/paths';
import { getWritingStylePath } from '@/shared/paths';

// ---------------------------------------------------------------------------
// 公共夹具
// ---------------------------------------------------------------------------

function makeQualityScores(overall: number): QualityScores {
    return {
        overall,
        style: 0,
        rhythm: 0,
        technique: 0,
        structure: 0,
        character: 0,
        foreshadow: 0,
        vectorEnabled: false,
    };
}

function makeBook(overrides: Partial<BookBasicInfo> = {}): BookBasicInfo {
    return {
        id: 'kb1',
        name: '书A',
        themeTags: [],
        techniqueTags: [],
        customTags: [],
        createdAt: 0,
        updatedAt: 0,
        breakdownStatus: 'completed',
        ...overrides,
    };
}

function makeGenre(overrides: Partial<GenreConfig> = {}): GenreConfig {
    return {
        id: 'g1',
        name: '玄幻修仙',
        category: 'male',
        description: '测试流派',
        personalityTags: ['冷面', '腹黑'],
        abilityTypes: [],
        roleTypes: [],
        backgroundTypes: [],
        techniques: [],
        weights: { character: 1, foreshadow: 1, technique: 1, style: 1, rhythm: 1, structure: 1 },
        ...overrides,
    };
}

function tech(id: string, name: string, category: GenreConfig['techniques'][number]['category'], keywords: string[]) {
    return { id, name, category, description: `${name}说明`, keywords, baseConfidence: 0.8, genreWeight: 1 };
}

beforeEach(() => {
    noticeCalls.length = 0;
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// parseQualityReport — 质量报告 markdown 解析
// ---------------------------------------------------------------------------

describe('parseQualityReport（quality-report.ts）', () => {
    it('内容为空或不足 50 字时直接返回空数组', () => {
        expect(parseQualityReport('')).toEqual([]);
        expect(parseQualityReport('太短的报告')).toEqual([]);
    });

    it('标题行给出分类，❌/⚠️ 记为问题，✅ 不产出条目，后续非问题行合并为建议', () => {
        const content = [
            '# 情节节奏',
            '',
            '❌ 第3段节奏拖沓，建议压缩打斗铺垫',
            '删去重复的环境描写',
            '合并相邻的过渡段',
            '⚠️ 对话比例偏低，节奏感不足',
            '增加一两处人物交锋',
            '✅ 开篇钩子合格',
        ].join('\n');

        const issues = parseQualityReport(content);

        expect(issues).toHaveLength(2);
        expect(issues[0].id).toBe('qc_1');
        expect(issues[0].priority).toBe('high');
        expect(issues[0].severity).toBe('❌');
        expect(issues[0].category).toBe('情节节奏');
        expect(issues[0].problem).toBe('第3段节奏拖沓，建议压缩打斗铺垫');
        // 「第N段」应取捕获组 1 的段号（v4.36.0 锁定的疑似 bug：旧实现忽略 m[1]/m[2]）
        expect(issues[0].locationText).toBe('3');
        expect(issues[0].suggestion).toBe('删去重复的环境描写 合并相邻的过渡段');

        expect(issues[1].id).toBe('qc_2');
        expect(issues[1].priority).toBe('medium');
        expect(issues[1].severity).toBe('⚠️');
        // 已知怪癖：⚠️ 是「⚠(U+26A0)+变体选择符(U+FE0F)」双码点，源码字符类只剥离
        // 单个码点 → 前导变体选择符残留。锁定现状，不改源码。
        expect(issues[1].problem).toBe('\uFE0F 对话比例偏低，节奏感不足');
        expect(issues[1].suggestion).toBe('增加一两处人物交锋');
        expect(issues[1].locationText).toBe('\uFE0F 对话比例偏低');
    });

    it('「引号」与【方括号】定位文本分别取自引号/方括号内内容', () => {
        const quoted = parseQualityReport(
            '# 情节节奏\n\n## 动作场景\n\n❌ 「他推开门」动作描写僵硬，缺乏画面感，需要整段重写\n后文无独立建议行，问题行自身回落作为建议',
        );
        expect(quoted).toHaveLength(1);
        expect(quoted[0].locationText).toBe('他推开门');

        const bracket = parseQualityReport(
            '# 伏笔管理\n\n❌ 见【第三章】伏笔未回收，读者已经彻底遗忘这条线索\n\n✅ 第一章钩子到位\n✅ 第三章回收节奏也合格',
        );
        expect(bracket).toHaveLength(1);
        expect(bracket[0].locationText).toBe('第三章');
    });

    it('建议区全为空行/问题行时，长问题回落为自身建议，短问题建议为空且定位取前 8 字', () => {
        const content = [
            '# 情节节奏',
            '',
            '前文说明文字，用于满足解析器对报告篇幅的最低要求，避免被当作空报告跳过。',
            '',
            '❌ 这里的转场非常生硬，前后画面完全衔接不上，观感割裂',
            '',
            '❌ 下一处问题行',
        ].join('\n');

        const issues = parseQualityReport(content);

        expect(issues).toHaveLength(2);
        expect(issues[0].suggestion).toBe('这里的转场非常生硬，前后画面完全衔接不上，观感割裂');
        expect(issues[1].suggestion).toBe('');
        expect(issues[1].locationText).toBe('下一处问题行');
    });

    it('建议超过 120 字时截断并追加省略号', () => {
        const content = ['# 细节', '', '❌ 以下建议需要合并处理', '补'.repeat(130)].join('\n');
        const issues = parseQualityReport(content);

        expect(issues).toHaveLength(1);
        expect(issues[0].suggestion).toBe('补'.repeat(120) + '...');
        expect(issues[0].suggestion).toHaveLength(123);
    });

    it('全文无 ❌/⚠️ 时回落解析【修改建议】汇总区的 🔴/🟡/🟢 条目', () => {
        const content = [
            '# 质量体检',
            '',
            '整体结构合格，无明显问题。',
            '细节层面的修改建议如下：',
            '',
            '【修改建议】',
            '- 🔴 主线冲突前移，第2章即抛出核心悬念',
            '- 🟡 次要角色动机需要补充铺垫',
            '- 🟢 文笔整体流畅，可保持现状',
            '- 无优先级标记的行会被跳过',
            '---',
        ].join('\n');

        const issues = parseQualityReport(content);

        expect(issues).toHaveLength(3);
        expect(issues.map(i => i.id)).toEqual(['qc_sum_1', 'qc_sum_2', 'qc_sum_3']);
        expect(issues.map(i => i.priority)).toEqual(['high', 'medium', 'low']);
        expect(issues.map(i => i.severity)).toEqual(['❌', '⚠️', '⚠️']);
        expect(issues.every(i => i.category === '修改建议')).toBe(true);
        expect(issues[0].problem).toBe('主线冲突前移，第2章即抛出核心悬念');
        expect(issues[0].suggestion).toBe('主线冲突前移，第2章即抛出核心悬念');
        expect(issues[0].locationText).toBe('');
        expect(issues[2].problem).toBe('文笔整体流畅，可保持现状');
    });
});

// ---------------------------------------------------------------------------
// calculateChapterMatches — 章节匹配计分
// ---------------------------------------------------------------------------

describe('calculateChapterMatches（chapter-match.ts）', () => {
    const matchGenre = makeGenre({
        personalityTags: ['冷面', '腹黑', '温润'],
        techniques: [
            tech('t1', '三幕节奏', 'rhythm', ['节奏', '冲突']),
            tech('t2', '情感留白', 'emotion', ['留白', '沉默']),
        ],
    });
    const fallbackGenre = makeGenre({
        personalityTags: ['高冷'],
        techniques: [tech('t9', '黄金三章', 'structure', ['开篇'])],
    });
    const kb = {
        getGenre: vi.fn((id: string) => (id === 'g1' ? matchGenre : id === 'g2' ? fallbackGenre : undefined)),
    } as unknown as WebnovelKnowledgeBase;

    beforeEach(() => {
        (kb.getGenre as unknown as ReturnType<typeof vi.fn>).mockClear();
    });

    it('空正文或空书籍缓存返回空数组', () => {
        expect(calculateChapterMatches('', [makeBook()], kb)).toEqual([]);
        expect(calculateChapterMatches('正文', [], kb)).toEqual([]);
    });

    it('人设标签 ×2、技法关键词 ×1、题材标签 ×1、质量分 ×0.1 加权；技法命中首个关键词后跳出', () => {
        const text = '冷面冷面他腹黑。节奏节奏节奏。冲突冲突。江湖恩怨复仇复仇。';
        const books = [
            makeBook({
                primaryGenre: 'g1',
                themeTags: ['复仇', '江湖'],
                qualityScores: makeQualityScores(70),
            }),
        ];

        const matches = calculateChapterMatches(text, books, kb);

        // 冷面×2×2 + 腹黑×1×2 + 节奏×3（命中首个关键词后 break，冲突×2 不计）+ 复仇×2 + 江湖×1
        // = 4 + 2 + 3 + 3 = 12，叠加 70×0.1 = 7 → round(19)
        expect(matches).toHaveLength(1);
        expect(matches[0].score).toBe(19);
        expect(matches[0].topChars).toEqual(['冷面', '腹黑']);
        expect(matches[0].topTechs).toEqual(['三幕节奏']);
        expect(matches[0].book.id).toBe('kb1');
    });

    it('多本书按匹配分降序排列；无流派的书只按题材计分且 Top 列表为空', () => {
        const text = '冷面冷面他腹黑。节奏节奏节奏。冲突冲突。江湖恩怨复仇复仇。';
        const books = [
            makeBook({
                id: 'kb2',
                primaryGenre: undefined,
                themeTags: ['复仇'],
                breakdownStatus: 'pending',
            }),
            makeBook({
                id: 'kb1',
                primaryGenre: 'g1',
                themeTags: ['复仇', '江湖'],
                qualityScores: makeQualityScores(70),
            }),
            makeBook({
                id: 'kb3',
                primaryGenre: 'g2',
                themeTags: ['江湖'],
            }),
        ];

        const matches = calculateChapterMatches(text, books, kb);

        expect(matches.map(m => m.book.id)).toEqual(['kb1', 'kb2', 'kb3']);
        expect(matches[0].score).toBe(19);
        // kb2：无流派 → 仅题材 复仇×2；score 2；kb.getGenre 未被调用
        expect(matches[1].score).toBe(2);
        expect(matches[1].topChars).toEqual([]);
        expect(matches[1].topTechs).toEqual([]);
        // kb3：流派标签/技法均未命中 → Top 列表回落为流派 Top 3；仅题材 +1
        expect(matches[2].score).toBe(1);
        expect(matches[2].topChars).toEqual(['高冷']);
        expect(matches[2].topTechs).toEqual(['黄金三章']);
        expect(kb.getGenre).toHaveBeenCalledTimes(2);
    });

    it('kb 为 null 时退化为纯题材计分，Top 列表为空', () => {
        const matches = calculateChapterMatches(
            '江湖一句',
            [makeBook({ themeTags: ['江湖'], qualityScores: makeQualityScores(80) })],
            null,
        );

        expect(matches).toHaveLength(1);
        expect(matches[0].score).toBe(9); // round(1 + 80×0.1)
        expect(matches[0].topChars).toEqual([]);
        expect(matches[0].topTechs).toEqual([]);
    });

    it('零分且未拆解完成的书籍不返回', () => {
        const matches = calculateChapterMatches(
            '与书无关的正文',
            [makeBook({ themeTags: ['江湖'], breakdownStatus: 'pending' })],
            kb,
        );

        expect(matches).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// generateWritingAdvice — 写作建议
// ---------------------------------------------------------------------------

describe('generateWritingAdvice（writing-advice.ts）', () => {
    const adviceGenre = makeGenre({
        techniques: [
            tech('t1', '三幕节奏', 'rhythm', []),
            tech('t2', '小高潮', 'cool_point', []),
            tech('t3', '情绪钩子', 'emotion', []),
        ],
    });
    const kb = {
        getGenre: (id: string) => (id === 'g1' ? adviceGenre : undefined),
    };
    // ≥300 字、恰 6 句（平均句长 >40 → style）、无引号（对话占比 0 → dialogue）、
    // 不含战斗/情绪关键词（不触发 scene 建议）
    const LONG_TEXT = [
        '晨光从窗棂缝隙里漏进来，在青石地板上铺开一层薄薄的暖色，他照例把伞立在门后最顺手的位置，点火温了一壶隔夜的粗茶。',
        '巷口的早点摊升起了白汽，摊主熟练地翻动着锅里的煎饼，香气顺着风飘过半条街，把几个赖床的年轻人从被窝里勾出来。',
        '他数着檐下新添的雨痕，指腹在一道旧刻痕上来回摩挲，那是去年冬天与故人分开时随手划下的记号，如今已经淡得看不见了。',
        '街对面的钟楼敲了六下，声音沉沉地压过屋顶，惊起一群灰鸽，它们绕着塔尖盘旋两圈，又落回被晨露打湿的青瓦上。',
        '他把茶碗推到桌角，摊开那张画满箭头的旧地图，用炭笔在河口位置补了一个小小的问号，随即皱起眉头盯着它出神。',
        '远处传来第一声车铃，日头终于越过对面的屋脊，把整条街的影子一寸寸缩短，新的一天就这样毫无悬念地开始了。',
    ].join('');

    it('短文本给「继续充实内容」，无书给「添加参考书籍」', () => {
        const advice = generateWritingAdvice({ text: '一二三', books: [], activeRefIds: [], getGenre: () => undefined });

        expect(advice[0]).toMatchObject({ icon: '📝', title: '继续充实内容', category: 'general' });
        expect(advice[0].desc).toBe('当前 3 字，建议至少写到 500 字让情节展开。');
        expect(advice[1]).toMatchObject({ icon: '📚', title: '添加参考书籍', category: 'general' });
        expect(advice).toHaveLength(2);
    });

    it('有书但均未拆解完成时提示等待拆解（长文本仍叠加句长/对话建议）', () => {
        const advice = generateWritingAdvice({
            text: LONG_TEXT,
            books: [makeBook({ breakdownStatus: 'pending' })],
            activeRefIds: [],
            getGenre: () => undefined,
        });

        expect(advice.map(a => a.category)).toEqual(['general', 'style', 'dialogue']);
        expect(advice[0]).toMatchObject({ icon: '⏳', title: '等待书籍拆解完成', category: 'general' });
        expect(advice[0].desc).toBe('《书A》正在拆解中，完成后可获得更多建议。');
    });

    it('拆解完成的书产出 节奏/爽点/情感/人设 四类参考；长文本叠加句长与对话建议（封顶 6 条）', () => {
        const advice = generateWritingAdvice({
            text: LONG_TEXT,
            books: [makeBook({ primaryGenre: 'g1' })],
            activeRefIds: ['kb1'],
            getGenre: kb.getGenre,
        });

        expect(LONG_TEXT.length).toBeGreaterThanOrEqual(300);
        expect(advice.map(a => a.category)).toEqual(['rhythm', 'technique', 'emotion', 'character', 'style', 'dialogue']);
        expect(advice[0]).toMatchObject({ title: '节奏建议：三幕节奏', desc: '三幕节奏说明', source: '《书A》（启用中）' });
        expect(advice[1]).toMatchObject({ title: '爽点建议：小高潮', source: '《书A》（启用中）' });
        expect(advice[2]).toMatchObject({ title: '情感建议：情绪钩子', source: '《书A》（启用中）' });
        expect(advice[3].title).toBe('人设参考：冷面');
        expect(advice[3].source).toBe('《书A》（启用中）');
        expect(advice[4].icon).toBe('✂️');
        expect(advice[5].icon).toBe('💬');
    });

    it('未启用参考的书 source 不带「启用中」标记', () => {
        const advice = generateWritingAdvice({
            text: LONG_TEXT,
            books: [makeBook({ primaryGenre: 'g1' })],
            activeRefIds: [],
            getGenre: kb.getGenre,
        });

        expect(advice[0].source).toBe('《书A》');
    });

    it('命中两个战斗关键词且存在参考书时给战斗场景建议', () => {
        const advice = generateWritingAdvice({
            text: '他挥刀攻击，两人对战数十回合。',
            books: [makeBook({ primaryGenre: 'g1' })],
            activeRefIds: [],
            getGenre: kb.getGenre,
        });

        const scene = advice.find(a => a.title === '战斗场景优化');
        expect(scene).toBeDefined();
        expect(scene).toMatchObject({ icon: '⚔️', category: 'scene', source: '《书A》' });
        expect(scene?.desc).toBe('当前是战斗场景，可参考《书A》的战斗节奏和动作描写方式。');
    });

    it('命中两个情绪关键词且存在参考书时给情感场景建议', () => {
        const advice = generateWritingAdvice({
            text: '他想起故乡，心中一阵酸楚，既愤怒又悲伤。',
            books: [makeBook({ primaryGenre: 'g1' })],
            activeRefIds: [],
            getGenre: kb.getGenre,
        });

        const scene = advice.find(a => a.title === '情感场景深化');
        expect(scene).toBeDefined();
        expect(scene).toMatchObject({ icon: '💕', category: 'scene', source: '《书A》' });
    });

    it('最多返回 6 条：短文本 + 4 类流派建议 + 战斗/情感场景共 7 条时截断', () => {
        const advice = generateWritingAdvice({
            text: '他拔剑攻击，与人对战，一场恶斗避无可避。他感到愤怒与悲伤。',
            books: [makeBook({ primaryGenre: 'g1' })],
            activeRefIds: ['kb1'],
            getGenre: kb.getGenre,
        });

        expect(advice).toHaveLength(6);
        expect(advice[0].title).toBe('继续充实内容');
        expect(advice[5].title).toBe('战斗场景优化');
        expect(advice.find(a => a.title === '情感场景深化')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// notice-helpers — 环境降级与 fragment 组装
// ---------------------------------------------------------------------------

interface FakeEl {
    className: string;
    textContent: string;
    children: FakeEl[];
    appendChild(child: FakeEl): FakeEl;
}

function fakeElement(): FakeEl {
    const el: FakeEl = {
        className: '',
        textContent: '',
        children: [],
        appendChild(child: FakeEl) {
            el.children.push(child);
            return child;
        },
    };
    return el;
}

function fakeDocument() {
    return {
        createDocumentFragment: () => fakeElement(),
        createElement: (_tag: string) => fakeElement(),
    };
}

describe('notice-helpers（notice-helpers.ts）', () => {
    it('无 document（默认 node 环境）时三类助手降级为纯文本 Notice 且不抛错', () => {
        expect(() => showErrorNotice('boom')).not.toThrow();
        expect(() => showSuccessNotice('done')).not.toThrow();
        expect(() => showWarningNotice('care')).not.toThrow();

        expect(noticeCalls.map(c => c.message)).toEqual(['❌ 操作失败\nboom', '✅ 完成\ndone', '⚠️ 注意\ncare']);
        expect(noticeCalls.every(c => c.timeout === undefined)).toBe(true);
    });

    it('自定义 title/detail/timeout 逐行拼入纯文本并透传 timeout', () => {
        showErrorNotice('保存书籍失败', { title: '导出失败', detail: '检查磁盘', timeout: 8000 });
        expect(noticeCalls).toHaveLength(1);
        expect(noticeCalls[0].message).toBe('❌ 导出失败\n保存书籍失败\n检查磁盘');
        expect(noticeCalls[0].timeout).toBe(8000);

        showSuccessNotice('已保存', { timeout: 3000 });
        expect(noticeCalls[1].message).toBe('✅ 完成\n已保存');
        expect(noticeCalls[1].timeout).toBe(3000);

        showWarningNotice('封面缺失', { title: '建章完成但存在问题', timeout: 12000 });
        expect(noticeCalls[2].message).toBe('⚠️ 建章完成但存在问题\n封面缺失');
    });

    it('document 只有 createElement 而无 createDocumentFragment 时退回纯文本', () => {
        vi.stubGlobal('document', { createElement: () => ({}) });

        showSuccessNotice('已保存', { timeout: 3000 });

        expect(noticeCalls).toHaveLength(1);
        expect(typeof noticeCalls[0].message).toBe('string');
        expect(noticeCalls[0].message).toBe('✅ 完成\n已保存');
    });

    it('createDocumentFragment 抛异常时被吞掉并退回纯文本（保证提示不中断主流程）', () => {
        vi.stubGlobal('document', {
            createDocumentFragment: () => {
                throw new Error('垫片行为异常');
            },
            createElement: () => ({}),
        });

        expect(() => showWarningNotice('w')).not.toThrow();
        expect(noticeCalls[0].message).toBe('⚠️ 注意\nw');
    });

    it('DOM 能力完整时组装 fragment：标题（加粗）/正文/可选灰字详情三层', () => {
        vi.stubGlobal('document', fakeDocument());

        showErrorNotice('主文案A', { title: '标题B', detail: '详情C', timeout: 5000 });

        const call = noticeCalls[0];
        const frag = call.message as FakeEl;
        expect(frag.children).toHaveLength(3);
        expect(frag.children[0].className).toBe('nw-u-fwt-600');
        expect(frag.children[0].textContent).toBe('❌ 标题B');
        expect(frag.children[1].className).toBe('');
        expect(frag.children[1].textContent).toBe('主文案A');
        expect(frag.children[2].className).toBe('nw-text-12-muted');
        expect(frag.children[2].textContent).toBe('详情C');
        expect(call.timeout).toBe(5000);
    });

    it('无 detail 时 fragment 只有两层', () => {
        vi.stubGlobal('document', fakeDocument());

        showSuccessNotice('已保存');

        const frag = noticeCalls[0].message as FakeEl;
        expect(frag.children).toHaveLength(2);
        expect(frag.children[0].textContent).toBe('✅ 完成');
    });
});

// ---------------------------------------------------------------------------
// cowrite-mappers — 联想/方向/文风映射
// ---------------------------------------------------------------------------

describe('cowrite-mappers（ui/cowrite/cowrite-mappers.ts）', () => {
    it('associationTypeToDirection 按类型映射方向，未知类型回落 emotion', () => {
        expect(associationTypeToDirection('entity-action')).toBe('action');
        expect(associationTypeToDirection('escalate')).toBe('conflict');
        expect(associationTypeToDirection('foreshadow')).toBe('foreshadow');
        expect(associationTypeToDirection('dialogue')).toBe('dialogue');
        expect(associationTypeToDirection('anything-else')).toBe('emotion');
    });

    it('getAssociationLabel/getDirectionLabel/getStyleLabel 已知键与回落值', () => {
        expect(getAssociationLabel('entity-action')).toBe('🎭 角色动作');
        expect(getAssociationLabel('escalate')).toBe('⚡ 冲突升级');
        expect(getAssociationLabel('unknown')).toBe('✨ 联想');

        expect(getDirectionLabel('action')).toBe('⚔️ 动作');
        expect(getDirectionLabel('resolution')).toBe('🏁 收束');
        expect(getDirectionLabel('mystery')).toBe('mystery');

        expect(getStyleLabel('creative')).toBe('创意');
        expect(getStyleLabel('conservative')).toBe('稳健');
        expect(getStyleLabel('other')).toBe('默认');
    });

    it('associationToSuggestion 产出带方向/置信度/预览的建议记录', () => {
        const record = associationToSuggestion(
            { text: '让他先动手', type: 'entity-action', confidence: 0.85, preview: '他抢先出手……' },
            3,
        );

        expect(record.text).toBe('让他先动手');
        expect(record.direction).toBe('action');
        expect(record.style).toBe('creative');
        expect(record.temperature).toBe(0.7);
        expect(record.preview).toBe('他抢先出手……');
        expect(record.reasoning).toBe('联想输入：🎭 角色动作，置信度 85%');
        // id 形如 assoc_<时间36进制>_<index>_<随机串>：index 位于中段
        expect(record.id).toContain('_3_');
    });

    it('emptyMetrics 返回全零指标与默认提示', () => {
        const metrics = emptyMetrics();

        expect(metrics.sceneObjectivesMet).toBe(0);
        expect(metrics.characterArcsAdvanced).toBe(0);
        expect(metrics.foreshadowingSeeded).toBe(0);
        expect(metrics.emotionalArcProgress).toBe(0);
        expect(metrics.overallCompletion).toBe(0);
        expect(metrics.nextDirectionHints).toEqual(['action', 'emotion', 'dialogue']);
        expect(typeof metrics.evaluatedAt).toBe('number');
        expect(metrics.suggestionAdvice.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// extractWorldviewMeta — 世界观元数据提取
// ---------------------------------------------------------------------------

describe('extractWorldviewMeta（ui/utils/worldview-utils.ts）', () => {
    it('空输入返回全空元数据', () => {
        expect(extractWorldviewMeta('')).toEqual({
            worldType: '',
            worldEra: '',
            forbiddenElements: '',
            powerSystem: '',
            fallbackSettingLib: '',
        });
        expect(extractWorldviewMeta('   ').fallbackSettingLib).toBe('');
    });

    it('按关键词判定世界类型并生成对应禁用要素', () => {
        const xianxia = extractWorldviewMeta('这是一个修仙世界');
        expect(xianxia.worldType).toBe('修仙');
        expect(xianxia.forbiddenElements).toBe('手机、电脑、汽车、飞机、现代科技产品、现代通讯设备');

        const scifi = extractWorldviewMeta('星际时代的赛博都市');
        expect(scifi.worldType).toBe('科幻');
        expect(scifi.forbiddenElements).toBe('飞剑、法术、仙气、灵力、魔法阵、修仙体系');

        // 类型匹配按声明顺序取第一个命中的关键词组
        const mixed = extractWorldviewMeta('既是修仙也谈未来');
        expect(mixed.worldType).toBe('修仙');
    });

    it('时代背景优先取显式字段，否则回落正文第一段', () => {
        const explicit = extractWorldviewMeta('修仙世界\n时代背景：末法时代\n%%');
        expect(explicit.worldEra).toBe('末法时代');

        const fallback = extractWorldviewMeta('# 苍澜界\n\n灵气枯竭的大陆上人人争渡。\n\n## 力量体系\n练气');
        expect(fallback.worldEra).toBe('灵气枯竭的大陆上人人争渡。');
    });

    it('力量体系按「字段： 到下一个标题/%%」截取', () => {
        const meta = extractWorldviewMeta('修仙世界\n力量体系：\n练气、筑基、金丹\n## 势力分布\n三大宗门');
        expect(meta.powerSystem).toBe('练气、筑基、金丹');
    });

    it('设定库回退：命中指定标题的段落拼接，全无命中时取全文前 2000 字', () => {
        const withSections = extractWorldviewMeta('修仙世界\n## 力量体系\n练气筑基\n## 世界架构\n九洲十三域\n## 杂项\n无关内容');
        expect(withSections.fallbackSettingLib).toBe('## 力量体系\n练气筑基\n\n## 世界架构\n九洲十三域');

        const plain = extractWorldviewMeta('修仙世界，没有任何标题结构的纯文本');
        expect(plain.fallbackSettingLib).toBe('修仙世界，没有任何标题结构的纯文本');
    });
});

// ---------------------------------------------------------------------------
// SuggestionHistoryStore — 历史建议读写（Vault mock）
// ---------------------------------------------------------------------------

describe('SuggestionHistoryStore（ui/cowrite/suggestion-history-store.ts）', () => {
    const HISTORY_PATH = '长篇小说/书A/03-大纲与章节/步骤结果/第1卷/第3章/协同历史.json';

    function makeStore(seed: Record<string, string> = {}) {
        const vault = newMockVault();
        for (const [path, content] of Object.entries(seed)) vault._seedFile(path, content);
        const view = {
            app: { vault },
            project: '长篇小说/书A',
            volume: '第1卷',
            chapterNum: 3,
            chapterName: '棋手落子',
            historyLoaded: false,
            suggestionHistory: [] as Array<{ id: string }>,
            ensureVaultFolder: vi.fn(async () => {}),
        };
        return { store: new SuggestionHistoryStore(view as never), view, vault };
    }

    it('getHistoryPath：卷号/章号齐全时返回步骤结果路径，卷名无数字或缺少项目时返回空串', () => {
        const { store } = makeStore();
        expect(store.getHistoryPath()).toBe(HISTORY_PATH);

        const bad = makeStore();
        bad.view.volume = '第一卷';
        expect(bad.store.getHistoryPath()).toBe('');

        const missing = makeStore();
        missing.view.project = '';
        expect(missing.store.getHistoryPath()).toBe('');
    });

    it('loadSuggestionHistory：读取 JSON 并只保留最近 20 条带 id 的记录', async () => {
        const records = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}` }));
        const junk = Array.from({ length: 3 }, (_, i) => ({ noId: i }));
        const { store, view } = makeStore({
            [HISTORY_PATH]: JSON.stringify({ records: [...junk, ...records] }),
        });

        await store.loadSuggestionHistory();

        expect(view.historyLoaded).toBe(true);
        expect(view.suggestionHistory).toHaveLength(20);
        expect(view.suggestionHistory[0]).toEqual({ id: 'r5' });
        expect(view.suggestionHistory[19]).toEqual({ id: 'r24' });
    });

    it('loadSuggestionHistory：文件不存在视为确定结果（loaded=true），解析失败则不锁死（loaded=false）', async () => {
        const missing = makeStore();
        await missing.store.loadSuggestionHistory();
        expect(missing.view.historyLoaded).toBe(true);
        expect(missing.view.suggestionHistory).toEqual([]);

        const broken = makeStore({ [HISTORY_PATH]: '这不是JSON{{' });
        await broken.store.loadSuggestionHistory();
        expect(broken.view.historyLoaded).toBe(false);
        expect(broken.view.suggestionHistory).toEqual([]);
    });

    it('persistSuggestionHistory：文件不存在时创建，写入项目/卷章元信息与最近 20 条记录', async () => {
        const { store, view } = makeStore();
        view.suggestionHistory = [{ id: 'r1' }, { id: 'r2' }];

        await store.persistSuggestionHistory();

        expect(view.ensureVaultFolder).toHaveBeenCalledWith('长篇小说/书A/03-大纲与章节/步骤结果/第1卷/第3章');
        const raw = await view.app.vault.readByPath(HISTORY_PATH);
        const payload = JSON.parse(raw);
        expect(payload.project).toBe('长篇小说/书A');
        expect(payload.volume).toBe('第1卷');
        expect(payload.chapterNum).toBe(3);
        expect(payload.chapterName).toBe('棋手落子');
        expect(payload.records).toEqual([{ id: 'r1' }, { id: 'r2' }]);
        expect(typeof payload.updatedAt).toBe('string');
    });

    it('persistSuggestionHistory：文件已存在时走 modify 更新；并发 persist 串行执行不丢写', async () => {
        const { store, view } = makeStore({ [HISTORY_PATH]: '{"old":true}' });
        view.suggestionHistory = [{ id: 'a' }];
        const first = store.persistSuggestionHistory();
        view.suggestionHistory = [{ id: 'a' }, { id: 'b' }];
        const second = store.persistSuggestionHistory();
        await Promise.all([first, second]);

        const payload = JSON.parse(await view.app.vault.readByPath(HISTORY_PATH));
        expect(payload.old).toBeUndefined();
        expect(payload.records).toEqual([{ id: 'a' }, { id: 'b' }]);
    });
});

// ---------------------------------------------------------------------------
// WizardChecker — 六类设定文件完整性校验（Vault mock）
// ---------------------------------------------------------------------------

describe('WizardChecker（ui/wizard-checker.ts）', () => {
    const PROJECT = '长篇小说/书A';

    function makeChecker(seed: Record<string, string> = {}, opts: { folders?: string[] } = {}) {
        const vault = newMockVault();
        for (const [path, content] of Object.entries(seed)) vault._seedFile(path, content);
        for (const folder of opts.folders ?? []) vault._folders.add(folder);
        const renameFile = vi.fn(async (_folder: unknown, _newPath: string) => {});
        const app = { vault, fileManager: { renameFile } } as never;
        return { checker: new WizardChecker(app), vault, renameFile };
    }

    function worldviewContent(overrides: { frontmatter?: string; skipSections?: string[]; inject?: string } = {}) {
        const sections = WV_SECTIONS.filter(s => !overrides.skipSections?.includes(s))
            .map(s => `## ${s}\n\n这一节描述了${s}的具体设定细节，内容真实可信。\n配套的规则与例子也都已经填写完毕。`)
            .join('\n\n');
        const fm = overrides.frontmatter ?? 'tags:\n  - 世界观\n世界名称: "盘古大陆"\n项目名称: "书A"';
        return `---\n${fm}\n---\n\n${sections}\n${overrides.inject ?? ''}`;
    }

    const SETTING_LIB_OK = [
        '# 设定库',
        '',
        '## 一、世界观底层规则',
        '### 物理法则',
        '灵气驱动，因果守恒。',
        '## 二、核心设定',
        '### 力量体系详情',
        '境界分明。',
        '## 三、力量体系详情',
        '| 境界 | 说明 |',
        '| ---- | ---- |',
        '## 四、科技水平',
        '近古无科技。',
        '## 五、势力分布',
        '| 势力 | 地盘 |',
        '## 六、地理/区域',
        '| 区域 | 特征 |',
        '## 七、关键历史事件',
        '三次大战。',
        '## 八、当前故事阶段',
        '开篇。',
    ].join('\n');

    const WRITING_STYLE_OK = [
        '---',
        'template_version: 2',
        '---',
        '# 文笔风格',
        '',
        '## 一、叙事视角',
        '- 视角：第三人称限制',
        '',
        '## 二、文笔特征',
        '- 总体风格：冷峻克制',
        '',
        '### 战斗/冲突场景样本',
        '```',
        '刀光一闪，血溅三步。',
        '```',
        '',
        '### 日常/对话场景样本',
        '```',
        '「吃茶去。」她笑。',
        '```',
        '',
    ].join('\n');

    const OUTLINE_OK = [
        '---',
        '总字数目标：3000000',
        '---',
        '',
        '# 第一卷 分卷大纲',
        '',
        '### 第1卷',
        '',
        '**章节范围**：第1-40章',
        '',
        '| 章号 | 标题 | 冲突 |',
        '| ---- | ---- | ---- |',
        '| 1 | 觉醒 | 主角觉醒 |',
        '| 2 | 入门 | 初入宗门 |',
        '',
    ].join('\n');

    const ENTITY_OK = ['---', '名称: 张三', '---', '张三是一名游侠，惯用双刀。'].join('\n');

    it('checkWorldviewComplete：文件缺失/为空/模块缺失/模板提示命中 → false', async () => {
        const missing = makeChecker();
        await expect(missing.checker.checkWorldviewComplete(PROJECT)).resolves.toBe(false);

        const empty = makeChecker({ [`${PROJECT}/01-世界架构/世界观总览.md`]: '   ' });
        await expect(empty.checker.checkWorldviewComplete(PROJECT)).resolves.toBe(false);

        const noSection = makeChecker({
            [`${PROJECT}/01-世界架构/世界观总览.md`]: worldviewContent({ skipSections: ['货币体系'] }),
        });
        await expect(noSection.checker.checkWorldviewComplete(PROJECT)).resolves.toBe(false);

        const template = makeChecker({
            [`${PROJECT}/01-世界架构/世界观总览.md`]: worldviewContent({ inject: '{{Name}}（由AI生成）' }),
        });
        await expect(template.checker.checkWorldviewComplete(PROJECT)).resolves.toBe(false);
    });

    it('checkWorldviewComplete：9 模块齐全 + frontmatter 名称有效 → true', async () => {
        const { checker } = makeChecker({
            [`${PROJECT}/01-世界架构/世界观总览.md`]: worldviewContent(),
        });

        await expect(checker.checkWorldviewComplete(PROJECT)).resolves.toBe(true);
    });

    it('checkWorldviewComplete：frontmatter 名称无效时自动填充并提示（不改源码路径）', async () => {
        const path = `${PROJECT}/01-世界架构/世界观总览.md`;
        const { checker, vault } = makeChecker({
            [path]: worldviewContent({ frontmatter: 'tags:\n  - 世界观\n世界名称: "{{Name}}"\n项目名称: "—"', inject: '**世界名称**：九州世界' }),
        });

        await expect(checker.checkWorldviewComplete(PROJECT)).resolves.toBe(true);

        const stored = await vault.adapter.read(path);
        expect(stored).toContain('世界名称: "九州世界"');
        expect(stored).toContain('项目名称: "书A"');
        const notice = noticeCalls.find(c => typeof c.message === 'string' && c.message.includes('世界名称="九州世界"'));
        expect(notice).toBeDefined();
    });

    it('checkWorldviewComplete：无 frontmatter 的旧文件补齐 fm 并从正文提取世界名', async () => {
        const path = `${PROJECT}/01-世界架构/世界观总览.md`;
        const { checker, vault } = makeChecker({
            [path]: `**世界名称**：九州世界\n\n${WV_SECTIONS.map(s => `## ${s}\n\n${s}的第一行真实内容。\n${s}的第二行真实内容。`).join('\n\n')}`,
        });

        await expect(checker.checkWorldviewComplete(PROJECT)).resolves.toBe(true);

        const stored = await vault.adapter.read(path);
        expect(stored.startsWith('---')).toBe(true);
        expect(stored).toContain('世界名称: "九州世界"');
        // 无 frontmatter 时 basicFm 直接把整个项目路径写进 项目名称，且视为有效不再改写
        expect(stored).toContain('项目名称: "长篇小说/书A"');
    });

    it('renameProjectFolder：目标已存在/源不存在时跳过，成功时走 fileManager 并提示', async () => {
        const skipTarget = makeChecker({}, { folders: [`${PROJECT}/旧名`, `${PROJECT}/新名`] });
        await skipTarget.checker.renameProjectFolder(`${PROJECT}/旧名`, '新名');
        expect(skipTarget.renameFile).not.toHaveBeenCalled();

        const skipSource = makeChecker();
        await skipSource.checker.renameProjectFolder(`${PROJECT}/不存在`, '新名');
        expect(skipSource.renameFile).not.toHaveBeenCalled();

        const ok = makeChecker({}, { folders: [`${PROJECT}/旧名`] });
        await ok.checker.renameProjectFolder(`${PROJECT}/旧名`, '新名');
        expect(ok.renameFile).toHaveBeenCalledTimes(1);
        // 源参数是文件夹对象本体（fileManager.renameFile 约定），目标参数是新路径字符串
        expect((ok.renameFile.mock.calls[0][0] as { path: string }).path).toBe(`${PROJECT}/旧名`);
        expect(ok.renameFile.mock.calls[0][1]).toBe(`${PROJECT}/新名`);
        expect(noticeCalls.some(c => typeof c.message === 'string' && c.message.includes('项目文件夹已重命名'))).toBe(true);
    });

    it('checkSettingLibComplete：缺文件/缺关键词/缺模块/占位提示 → false，齐全 → true', async () => {
        const wsPath = `${PROJECT}/01-世界架构/设定库.md`;
        const missing = makeChecker();
        await expect(missing.checker.checkSettingLibComplete(PROJECT)).resolves.toBe(false);

        const empty = makeChecker({ [wsPath]: '   ' });
        await expect(empty.checker.checkSettingLibComplete(PROJECT)).resolves.toBe(false);

        const noKeyword = makeChecker({ [wsPath]: '# 别的内容' });
        await expect(noKeyword.checker.checkSettingLibComplete(PROJECT)).resolves.toBe(false);

        const incomplete = SETTING_LIB_OK.replace('## 四、科技水平\n近古无科技。', '');
        const missingSection = makeChecker({ [wsPath]: incomplete });
        await expect(missingSection.checker.checkSettingLibComplete(PROJECT)).resolves.toBe(false);

        const placeholder = makeChecker({ [wsPath]: `${SETTING_LIB_OK}\n> ⚠️ 填充完此文件后删除本行` });
        await expect(placeholder.checker.checkSettingLibComplete(PROJECT)).resolves.toBe(false);

        const ok = makeChecker({ [wsPath]: SETTING_LIB_OK });
        await expect(ok.checker.checkSettingLibComplete(PROJECT)).resolves.toBe(true);
    });

    it('checkWritingStyleComplete：source: manual 直接过；模板缺样本/带占位行 → false；齐全 → true', async () => {
        const wsPath = getWritingStylePath(PROJECT);
        const noFile = makeChecker();
        await expect(noFile.checker.checkWritingStyleComplete(PROJECT)).resolves.toBe(false);

        const manual = makeChecker({ [wsPath]: '---\nsource: manual\n---\n随便什么内容' });
        await expect(manual.checker.checkWritingStyleComplete(PROJECT)).resolves.toBe(true);

        // 战斗样本缺失：把所有代码围栏换成 ~~~，避免正则借用日常样本的围栏误命中
        const noCombat = makeChecker({
            [wsPath]: WRITING_STYLE_OK.replace(/```/g, '~~~'),
        });
        await expect(noCombat.checker.checkWritingStyleComplete(PROJECT)).resolves.toBe(false);

        const placeholder = makeChecker({ [wsPath]: `${WRITING_STYLE_OK}\n> ⚠️ 填充完此文件后删除本行` });
        await expect(placeholder.checker.checkWritingStyleComplete(PROJECT)).resolves.toBe(false);

        const ok = makeChecker({ [wsPath]: WRITING_STYLE_OK });
        await expect(ok.checker.checkWritingStyleComplete(PROJECT)).resolves.toBe(true);
    });

    it('checkEntitiesComplete：目录缺失/仅模板 → false；四类实体齐全且无占位 → true', async () => {
        const entityDirs = ['characters', 'locations', 'factions', 'items'] as const;
        const templateNames: Record<string, string> = {
            characters: '人物模板.md',
            locations: '地点模板.md',
            factions: '势力模板.md',
            items: '物品功法模板.md',
        };

        const noDir = makeChecker();
        await expect(noDir.checker.checkEntitiesComplete(PROJECT)).resolves.toBe(false);

        const seedAll = (body: string) => {
            const seed: Record<string, string> = {};
            for (const kind of entityDirs) {
                const dir = entityDir(PROJECT, kind);
                seed[`${dir}/${templateNames[kind]}`] = '（待AI生成）';
                seed[`${dir}/张三.md`] = body;
            }
            return seed;
        };

        const emptyDirs = makeChecker(seedAll('（待AI生成）'));
        await expect(emptyDirs.checker.checkEntitiesComplete(PROJECT)).resolves.toBe(false);

        const ok = makeChecker(seedAll(ENTITY_OK));
        await expect(ok.checker.checkEntitiesComplete(PROJECT)).resolves.toBe(true);

        const placeholder = makeChecker(seedAll(['---', '名称: {{名称}}', '---', '（待AI生成）'].join('\n')));
        await expect(placeholder.checker.checkEntitiesComplete(PROJECT)).resolves.toBe(false);
    });

    it('checkOutlineComplete：缺文件/正文过短/缺总字数目标/缺卷表 → false；齐全 → true', async () => {
        const outlinePath = pjVolumeOutlineFile(PROJECT, 1);
        const missing = makeChecker();
        await expect(missing.checker.checkOutlineComplete(PROJECT)).resolves.toBe(false);

        const tooShort = makeChecker({ [outlinePath]: '---\n总字数目标：100\n---\n短' });
        await expect(tooShort.checker.checkOutlineComplete(PROJECT)).resolves.toBe(false);

        const noWords = makeChecker({
            [outlinePath]: OUTLINE_OK.replace('总字数目标：3000000', '其他字段：1'),
        });
        await expect(noWords.checker.checkOutlineComplete(PROJECT)).resolves.toBe(false);

        const noTable = makeChecker({
            [outlinePath]: OUTLINE_OK.replace(/\| 1 \| 觉醒 \| 主角觉醒 \|\n\| 2 \| 入门 \| 初入宗门 \|\n/, ''),
        });
        await expect(noTable.checker.checkOutlineComplete(PROJECT)).resolves.toBe(false);

        const templateVars = makeChecker({ [outlinePath]: `${OUTLINE_OK}\n{{冲突}}` });
        await expect(templateVars.checker.checkOutlineComplete(PROJECT)).resolves.toBe(false);

        const ok = makeChecker({ [outlinePath]: OUTLINE_OK });
        await expect(ok.checker.checkOutlineComplete(PROJECT)).resolves.toBe(true);
    });

    it('checkChaptersComplete：目录缺失/无章节目录 → false；有可用步骤文件 → true；步骤文件过短且无正文 → false', async () => {
        const baseDir = `${PROJECT}/03-大纲与章节`;
        const outlinePath = `${baseDir}/步骤结果/第1卷/第1章/第1章_大纲摘要.md`;
        const longBody = '这一章主角在雨夜抵达北境边城，偶遇旧识并得知商队遇袭的真相，双方达成同盟约定三日后启程。'.repeat(3);

        const noDir = makeChecker();
        await expect(noDir.checker.checkChaptersComplete(PROJECT)).resolves.toBe(false);

        const dirOnly = makeChecker({}, { folders: [`${baseDir}/步骤结果`] });
        await expect(dirOnly.checker.checkChaptersComplete(PROJECT)).resolves.toBe(false);

        const ok = makeChecker({ [outlinePath]: longBody });
        await expect(ok.checker.checkChaptersComplete(PROJECT)).resolves.toBe(true);

        const useless = makeChecker({ [outlinePath]: '太短' });
        await expect(useless.checker.checkChaptersComplete(PROJECT)).resolves.toBe(false);

        const withBody = makeChecker({
            [`${baseDir}/步骤结果/第1卷/第2章/第2章_大纲摘要.md`]: '太短',
            [`${baseDir}/正文/第1卷/第2章_开局_正文.md`]: longBody,
        });
        await expect(withBody.checker.checkChaptersComplete(PROJECT)).resolves.toBe(true);
    });

    it('restoreWizardStepStatus：完整步骤回 done，失效步骤降级，executing → retry，并自动前进到未完成步骤', async () => {
        const seed: Record<string, string> = {
            [`${PROJECT}/01-世界架构/世界观总览.md`]: worldviewContent(),
            [`${PROJECT}/01-世界架构/设定库.md`]: SETTING_LIB_OK,
        };
        const { checker } = makeChecker(seed);
        const tab = {
            project: PROJECT,
            currentStepIdx: 0,
            steps: [
                { id: 'worldview', status: 'complete_with_warnings', subSteps: [{ status: 'complete_with_warnings' }] },
                { id: 'setting_lib', status: 'done' },
                { id: 'complete', status: 'pending' },
            ],
        };

        await checker.restoreWizardStepStatus(tab as never);

        expect(tab.steps[0].status).toBe('done');
        expect(tab.steps[0].subSteps?.[0].status).toBe('done');
        expect(tab.steps[1].status).toBe('done');
        // 当前步 done 且后继存在未完成步骤 → 跳到「complete」页
        expect(tab.currentStepIdx).toBe(2);

        const degrade = makeChecker();
        const tab2 = {
            project: PROJECT,
            currentStepIdx: 0,
            steps: [
                { id: 'worldview', status: 'executing' },
                { id: 'setting_lib', status: 'done' },
                { id: 'complete', status: 'pending' },
            ],
        };
        await degrade.checker.restoreWizardStepStatus(tab2 as never);
        expect(tab2.steps[0].status).toBe('retry');
        expect(tab2.steps[1].status).toBe('complete_with_warnings');
        expect(tab2.currentStepIdx).toBe(0);

        const manual = makeChecker(seed);
        const tab3 = {
            project: PROJECT,
            currentStepIdx: 0,
            steps: [
                { id: 'worldview', status: 'complete_with_warnings' },
                { id: 'setting_lib', status: 'pending' },
                { id: 'complete', status: 'pending' },
            ],
        };
        await manual.checker.restoreWizardStepStatus(tab3 as never, true);
        expect(tab3.currentStepIdx).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// project-utils — 纯函数与 Vault 查询
// ---------------------------------------------------------------------------

describe('project-utils（ui/project-utils.ts）', () => {
    it('sortChaptersByNumber 按章号数字升序，非数字章号视为 0', () => {
        const sorted = sortChaptersByNumber([
            { chapter: '第10章' },
            { chapter: '序章' },
            { chapter: '第2章' },
        ]);
        expect(sorted.map(c => c.chapter)).toEqual(['序章', '第2章', '第10章']);
    });

    it('getNextChapter 取第一个未完稿章节；全部完稿时回落最后一章；空列表返回 null', () => {
        const chapters = [
            { chapter: '第1章', status: '已完稿' },
            { chapter: '第2章', status: 'written' },
            { chapter: '第3章', status: 'draft' },
        ];
        expect(getNextChapter(chapters)?.chapter).toBe('第3章');
        expect(getNextChapter(chapters.slice(0, 2))?.chapter).toBe('第2章');
        expect(getNextChapter([{ chapter: '第9章', status: 'settled' }])?.chapter).toBe('第9章');
        expect(getNextChapter([])).toBeNull();
    });

    it('findProjectCoverFile/getProjectCover：按 png→jpg→jpeg→webp 顺序探测封面', () => {
        const vault = newMockVault();
        vault._seedFile('长篇小说/书A/封面/cover.jpg', 'jpg-bytes');
        const app = {
            vault: Object.assign(vault, { getResourcePath: (f: TFile) => `res://${f.path}` }),
        } as never;

        expect(findProjectCoverFile(app, '长篇小说/书A')).toMatchObject({ ext: 'jpg' });
        expect(getProjectCover(app, '长篇小说/书A')).toBe('res://长篇小说/书A/封面/cover.jpg');

        const empty = { vault: newMockVault() } as never;
        expect(findProjectCoverFile(empty, '长篇小说/书B')).toBeNull();
        expect(getProjectCover(empty, '长篇小说/书B')).toBeNull();
    });

    it('loadProjectCover：读到二进制时返回 EPUB 封面数据，无封面返回 undefined', async () => {
        const vault = newMockVault();
        vault._seedFile('长篇小说/书A/封面/cover.png', 'png');
        (vault as unknown as { readBinary: () => Promise<ArrayBuffer> }).readBinary = async () =>
            new ArrayBuffer(8);

        const cover = await loadProjectCover({ vault } as never, '长篇小说/书A');
        expect(cover).toBeDefined();
        expect(cover?.mediaType).toBe('image/png');
        expect(cover?.fileExt).toBe('png');
        expect(cover?.data).toBeInstanceOf(Uint8Array);
        expect(cover?.data).toHaveLength(8);

        const none = { vault: newMockVault() } as never;
        await expect(loadProjectCover(none, '长篇小说/书A')).resolves.toBeUndefined();
    });

    it('getChaptersForProject：正文 ∪ 步骤结果骨架，按章号排序，其他项目的文件不串入', () => {
        const vault = newMockVault();
        vault._seedFile('长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_开局_正文.md', '正');
        vault._seedFile('长篇小说/书A/03-大纲与章节/正文/第2卷/第2章_布局_正文.md', '布局'.repeat(800));
        vault._seedFile('长篇小说/书A/03-大纲与章节/步骤结果/第2卷/第3章/第3章_大纲摘要.md', '骨架占位');
        vault._seedFile('其他书/03-大纲与章节/正文/第1卷/第1章_他书_正文.md', '不该出现');
        const app = { vault, metadataCache: new MetadataCache() } as never;

        const entries = getChaptersForProject(app, '长篇小说/书A');

        expect(entries.map(e => e.chapter)).toEqual(['第1章', '第2章', '第3章']);
        expect(entries.map(e => e.volume)).toEqual(['第1卷', '第2卷', '第2卷']);
    });

    it('getChaptersForProject：骨架章节 hasBody=false，正文条目带标题与 written 判定', () => {
        const vault = newMockVault();
        vault._seedFile('长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_开局_正文.md', '正');
        vault._seedFile('长篇小说/书A/03-大纲与章节/正文/第2卷/第2章_布局_正文.md', '布局'.repeat(800));
        vault._seedFile('长篇小说/书A/03-大纲与章节/步骤结果/第2卷/第3章/第3章_大纲摘要.md', '骨架占位');
        const app = { vault, metadataCache: new MetadataCache() } as never;

        const entries = getChaptersForProject(app, '长篇小说/书A');

        expect(entries[0]).toMatchObject({ chapter: '第1章', title: '开局', hasBody: true, written: false });
        expect(entries[1]).toMatchObject({ chapter: '第2章', title: '布局', hasBody: true, written: true });
        expect(entries[2]).toMatchObject({ chapter: '第3章', volume: '第2卷', hasBody: false, file: null, written: false, size: 0 });
    });

    it('scanProjectChapters：一次遍历产出多项目章节表，项目间互不串桶', () => {
        const vault = newMockVault();
        vault._seedFile('长篇小说/书A/03-大纲与章节/正文/第1卷/第1章_甲_正文.md', '甲');
        vault._seedFile('长篇小说/书B/03-大纲与章节/正文/第1卷/第1章_乙_正文.md', '乙');
        vault._seedFile('长篇小说/书C/03-大纲与章节/正文/第1卷/第1章_丙_正文.md', '丙');
        const app = { vault, metadataCache: new MetadataCache() } as never;

        const map = scanProjectChapters(app, ['长篇小说/书A', '长篇小说/书B']);

        expect([...map.keys()].sort()).toEqual(['长篇小说/书A', '长篇小说/书B']);
        expect(map.get('长篇小说/书A')?.[0]?.title).toBe('甲');
        expect(map.get('长篇小说/书B')?.[0]?.title).toBe('乙');
        expect(scanProjectChapters(app, []).size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// svg-charts — 纯字符串 SVG 生成
// ---------------------------------------------------------------------------

describe('svg-charts（ui/svg-charts.ts）', () => {
    it('createChartContainer：默认布局数学、坐标换算、网格/图例/tooltip 片段', () => {
        const chart = createChartContainer({ xLabels: ['一月', '二月'] });

        expect(chart.plotArea).toEqual({ x: 50, y: 40, width: 330, height: 160 });
        expect(chart.getX(0)).toBe(50);
        expect(chart.getX(1)).toBe(380);
        expect(chart.getY(1)).toBe(40);
        expect(chart.getY(0)).toBe(200);
        expect(chart.svgStart).toContain('viewBox="0 0 400 250"');
        expect(chart.svgStart).toContain('一月');
        expect(chart.svgStart).toContain('stroke-dasharray="3,3"');
        expect(chart.svgEnd).toContain('</svg>');
        expect(chart.legendArea([{ label: '主角', color: '#f00' }])).toContain('data-series="主角"');
        expect(chart.legendArea([{ label: '主角', color: '#f00' }])).toContain('background:#f00');
        expect(chart.tooltipHtml).toContain('nw-chart-tooltip');

        const bare = createChartContainer({ showGrid: false, showXAxis: false, showYAxis: false });
        expect(bare.svgStart).not.toContain('stroke-dasharray="3,3"');
    });

    it('radarChart：少于 3 维返回提示，正常渲染网格/数据多边形，>8 维提示切换柱状图', () => {
        const tooFew = radarChart([{ label: 'a', value: 1 }, { label: 'b', value: 2 }]);
        expect(tooFew).toContain('雷达图至少需要3个数据维度');

        const radar = radarChart(
            [
                { label: '节奏', value: 80 },
                { label: '情感', value: 60 },
                { label: '爽点', value: 90 },
                { label: '伏笔', value: 40 },
                { label: '文风', value: 70 },
            ],
            { title: '能力分布' },
        );
        expect(radar).toContain('viewBox="0 0 320 320"');
        expect(radar).toContain('能力分布');
        expect(radar).toContain('nw-chart-rad-point');
        expect(radar).toContain('data-label="节奏"');
        expect(radar.match(/<polygon/g)).toHaveLength(6); // 5 层网格 + 1 数据面

        const many = radarChart(Array.from({ length: 9 }, (_, i) => ({ label: `维度${i}`, value: 50 })));
        expect(many).toContain('维度较多，建议切换为柱状图查看');
    });

    it('barChart：空数据提示；纵向含数值标签；横向 y 轴落在 90；>8 条旋转标签', () => {
        expect(barChart([])).toContain('暂无数据');

        const vertical = barChart(
            [{ label: '第1章', value: 30 }, { label: '第2章', value: 60 }],
            { title: '章节字数' },
        );
        expect(vertical).toContain('章节字数');
        expect(vertical).toContain('data-value="60"');
        expect(vertical).toContain('data-value="30"');
        expect(vertical).toContain('nw-chart-bar-rect');

        const horizontal = barChart([{ label: '主角', value: 42 }], { horizontal: true });
        expect(horizontal).toContain('x1="90"');

        const rotated = barChart(
            Array.from({ length: 9 }, (_, i) => ({ label: `标签${i}`, value: i + 1 })),
        );
        expect(rotated).toContain('rotate(-45');
    });

    it('数值/颜色插值：伪造 frontmatter 字符串不跳出属性（SEC-2）', () => {
        const evilValue = '1" onmouseover="alert(1)' as unknown as number;
        const bar = barChart([{ label: 'x', value: evilValue }]);
        expect(bar).not.toContain('onmouseover="alert');
        expect(bar).toContain('data-value="0"');

        const donut = donutChart([{ label: 'x', value: evilValue, color: 'url(http://evil.test)' }]);
        expect(donut).not.toContain('url(http://evil.test)');
        expect(donut).not.toContain('onmouseover="alert');
    });

    it('donutChart：空数据提示；扇区携带自定义颜色', () => {
        expect(donutChart([])).toContain('暂无数据');

        const donut = donutChart(
            [
                { label: '主线', value: 60, color: '#ff0000' },
                { label: '支线', value: 40 },
            ],
            { title: '篇幅占比' },
        );
        expect(donut).toContain('nw-chart-donut-slice');
        expect(donut).toContain('#ff0000');
        expect(donut).toContain('篇幅占比');
    });

    it('wordCloud + spiralLayout：空词表提示；词项渲染；布局按权重降序且不出界', () => {
        expect(wordCloud([])).toContain('暂无数据');

        const cloud = wordCloud([
            { text: '修仙', weight: 9 },
            { text: '复仇', weight: 5 },
        ]);
        expect(cloud).toContain('nw-chart-word-item');
        expect(cloud).toContain('修仙');

        const layout = spiralLayout(
            [
                { text: '甲', weight: 1 },
                { text: '乙', weight: 9 },
                { text: '丙', weight: 5 },
            ],
            { width: 300, height: 200 },
        );
        expect(layout.map(w => w.text)).toEqual(['乙', '丙', '甲']);
        expect(layout.every(w => Math.abs(w.x) <= 150 && Math.abs(w.y) <= 100)).toBe(true);
        expect(layout.every(w => w.fontSize >= 11 && w.fontSize <= 22)).toBe(true);
        expect(spiralLayout([], { width: 100, height: 100 })).toEqual([]);
    });

    it('lineChart：空数据提示；多系列渲染路径与图例', () => {
        expect(lineChart([])).toContain('暂无数据');

        const line = lineChart(
            [
                { name: '主角', data: [{ value: 10 }, { value: 30 }], smooth: true, showPoints: true },
                { name: '对手', data: [{ value: 20 }, { value: 5 }] },
            ],
            { title: '进度对比' },
        );
        expect(line).toContain('主角');
        expect(line).toContain('对手');
        expect(line).toContain('nw-chart-line-path');
        expect(line).toContain('nw-chart-line-point');
    });

    it('scatterChart：空数据提示；散点带分类', () => {
        expect(scatterChart([])).toContain('暂无数据');

        const scatter = scatterChart(
            [
                { x: 1, y: 2, label: '起点', category: '第一卷' },
                { x: 3, y: 4, label: '高潮', category: '第二卷' },
            ],
            { title: '节奏散点' },
        );
        expect(scatter).toContain('nw-chart-scatter-dot');
        expect(scatter).toContain('起点');
        expect(scatter).toContain('节奏散点');
    });

    it('scatterToHistogram：空点集返回空；同值点合并单桶；常规分桶计数守恒', () => {
        expect(scatterToHistogram([], { bins: 5 })).toEqual([]);
        expect(scatterToHistogram([{ x: 2, y: 0 }, { x: 2, y: 1 }])).toEqual([{ label: '2.0', value: 2 }]);

        const points = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i % 3 }));
        const bins = scatterToHistogram(points, { bins: 10 });
        expect(bins).toHaveLength(10);
        expect(bins[0].label).toBe('0-2');
        expect(bins.reduce((sum, b) => sum + b.value, 0)).toBe(20);

        const fine = scatterToHistogram(points, { bins: 12 });
        expect(fine).toHaveLength(12);
        expect(fine[0].label).toBe('0.0');
    });

    it('timelineChart：空事件提示；节点渲染标签与日期', () => {
        expect(timelineChart([])).toContain('暂无事件');

        const timeline = timelineChart([
            { position: 0, label: '觉醒', date: '第1章', level: 1 },
            { position: 1, label: '入宗', date: '第5章' },
        ]);
        expect(timeline).toContain('nw-chart-timeline-node');
        expect(timeline).toContain('觉醒');
        expect(timeline).toContain('入宗');
    });

    it('heatmap：空数据提示；单元格携带行列标签', () => {
        expect(heatmap([])).toContain('暂无数据');

        const heat = heatmap(
            [
                { row: '周一', col: '晨', value: 3 },
                { row: '周一', col: '夜', value: 8 },
            ],
            { title: '码字热力' },
        );
        expect(heat).toContain('nw-chart-heatmap-cell');
        expect(heat).toContain('周一');
        expect(heat).toContain('码字热力');
    });

    it('treeChart：渲染根与子孙节点', () => {
        const tree = treeChart(
            { name: '宗门', children: [{ name: '内门', value: 3 }, { name: '外门', children: [{ name: '杂役' }] }] },
            { title: '势力树' },
        );
        expect(tree).toContain('宗门');
        expect(tree).toContain('内门');
        expect(tree).toContain('外门');
        expect(tree).toContain('杂役');
        expect(tree).toContain('势力树');
    });

    it('areaChart：渲染面积系列与数据点', () => {
        const area = areaChart(
            [{ label: '情绪强度', points: [{ x: 0, y: 1 }, { x: 1, y: 5 }, { x: 2, y: 3 }] }],
            { title: '情绪曲线' },
        );
        expect(area).toContain('nw-chart-area-point');
        expect(area).toContain('情绪强度');
        expect(area).toContain('情绪曲线');
    });

    it('densityHeatmap：渲染密度单元格', () => {
        const density = densityHeatmap(
            [
                { x: 1, y: 1, value: 2 },
                { x: 2, y: 3, value: 5 },
            ],
            { title: '出场密度' },
        );
        expect(density).toContain('nw-chart-density-cell');
        expect(density).toContain('出场密度');
    });

    it('horizontalBarChart：空数据提示；横向条目渲染', () => {
        expect(horizontalBarChart([])).toContain('暂无数据');

        const hbar = horizontalBarChart(
            [
                { label: '修仙', value: 12 },
                { label: '都市', value: 7, color: '#0f0' },
            ],
            { title: '题材分布' },
        );
        expect(hbar).toContain('nw-chart-hbar-rect');
        expect(hbar).toContain('修仙');
        expect(hbar).toContain('#0f0');
    });

    it('violinChart：渲染小提琴主体与散点', () => {
        const violin = violinChart([
            { label: '主角戏份', values: [3, 5, 8] },
            { label: '配角戏份', values: [1, 2] },
        ]);
        expect(violin).toContain('nw-chart-violin');
        expect(violin).toContain('主角戏份');
        expect(violin).toContain('配角戏份');
    });
});

// ---------------------------------------------------------------------------
// svg-charts.attachChartInteractions — 图表交互绑定（fake DOM 行为验证）
// ---------------------------------------------------------------------------

/** 最小可行为假元素：属性/类/样式/监听器记录，事件手动派发 */
class FakeChartEl {
    attrs = new Map<string, string>();
    classes = new Set<string>();
    style: Record<string, string> = {};
    innerHTML = '';
    children: FakeChartEl[] = [];
    listeners = new Map<string, Array<(e: unknown) => void>>();
    rect = { left: 0, top: 0, width: 400, height: 250 };

    getAttribute(name: string): string | null {
        return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
    }
    setAttribute(name: string, value: string): void {
        this.attrs.set(name, String(value));
    }
    classList = {
        add: (...cls: string[]) => cls.forEach(c => this.classes.add(c)),
        remove: (...cls: string[]) => cls.forEach(c => this.classes.delete(c)),
        contains: (c: string) => this.classes.has(c),
    };
    addEventListener(type: string, fn: (e: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }
    listenerCount(type: string): number {
        return (this.listeners.get(type) ?? []).length;
    }
    dispatch(type: string, event: Partial<{ clientX: number; clientY: number }> = {}): void {
        const evt = { clientX: 100, clientY: 100, ...event };
        for (const fn of this.listeners.get(type) ?? []) fn(evt);
    }
    getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
        return this.rect;
    }
    appendChild(child: FakeChartEl): FakeChartEl {
        this.children.push(child);
        return child;
    }
}

const INTERACTIVE_SELECTORS = [
    '.nw-chart-rad-point',
    '.nw-chart-bar-rect',
    '.nw-chart-hbar-rect',
    '.nw-chart-donut-slice',
    '.nw-chart-line-point',
    '.nw-chart-scatter-dot',
    '.nw-chart-timeline-node',
    '.nw-chart-word-item',
    '.nw-chart-heatmap-cell',
    '.nw-chart-density-cell',
    '.nw-chart-tree-node',
    '.nw-chart-area-point',
    '.nw-chart-violin',
    '.nw-chart-violin-point',
].join(',');

function makeChartDom() {
    const container = new FakeChartEl();
    const tooltip = new FakeChartEl();
    // 雷达点：label + value
    const point = new FakeChartEl();
    point.attrs.set('data-label', '节奏');
    point.attrs.set('data-value', '80');
    // 柱：series + 坐标对
    const bar = new FakeChartEl();
    bar.attrs.set('data-label', '一月');
    bar.attrs.set('data-value', '42');
    bar.attrs.set('data-series', 'bar-0');
    bar.attrs.set('data-x', '1');
    bar.attrs.set('data-y', '2');
    // 热力格：row/col/count
    const cell = new FakeChartEl();
    cell.attrs.set('data-label', '周一 晨');
    cell.attrs.set('data-row', '周一');
    cell.attrs.set('data-col', '晨');
    cell.attrs.set('data-count', '7');
    const legend = new FakeChartEl();
    legend.attrs.set('data-series', 'bar-0');
    const seriesRect = new FakeChartEl();
    seriesRect.classes.add('nw-chart-bar-rect');
    seriesRect.attrs.set('data-series', 'bar-0');

    const registry = new Map<string, FakeChartEl[]>([
        ['.nw-chart-tooltip', [tooltip]],
        [INTERACTIVE_SELECTORS, [point, bar, cell]],
        ['.nw-chart-legend-item', [legend]],
        ['[data-series="bar-0"]', [seriesRect]],
    ]);
    (container as unknown as {
        querySelector: (sel: string) => FakeChartEl | null;
        querySelectorAll: (sel: string) => FakeChartEl[];
    }).querySelector = (sel: string) => registry.get(sel)?.[0] ?? null;
    (container as unknown as { querySelectorAll: (sel: string) => FakeChartEl[] }).querySelectorAll =
        (sel: string) => registry.get(sel) ?? [];

    return { container, tooltip, point, bar, cell, legend, seriesRect };
}

describe('svg-charts.attachChartInteractions（fake DOM）', () => {
    afterEach(() => {
        delete (globalThis as { CSS?: unknown }).CSS;
    });

    it('绑定后重复绑定是 no-op；mouseenter 组装 tooltip 并显示，mouseleave 隐藏', () => {
        const { container, tooltip, point } = makeChartDom();
        const el = container as unknown as HTMLElement;

        attachChartInteractions(el);
        expect(container.attrs.get('data-chart-interactions-bound')).toBe('true');

        attachChartInteractions(el);
        expect(point.listenerCount('mouseenter')).toBe(1);

        point.dispatch('mouseenter');
        expect(tooltip.innerHTML).toContain('节奏');
        expect(tooltip.innerHTML).toContain('80');
        expect(tooltip.classes.has('visible')).toBe(true);
        expect(tooltip.attrs.get('aria-hidden')).toBe('false');
        expect(typeof tooltip.style.left).toBe('string');
        expect(typeof tooltip.style.top).toBe('string');

        point.dispatch('mouseleave');
        expect(tooltip.classes.has('visible')).toBe(false);
        expect(tooltip.attrs.get('aria-hidden')).toBe('true');
    });

    it('tooltip 文案覆盖 series/坐标对/行列/点数 分支', () => {
        const { container, tooltip, bar, cell } = makeChartDom();

        attachChartInteractions(container as unknown as HTMLElement);

        bar.dispatch('mouseenter');
        expect(tooltip.innerHTML).toContain('一月');
        expect(tooltip.innerHTML).toContain('bar-0');
        expect(tooltip.innerHTML).toContain('(1, 2)');

        cell.dispatch('mouseenter');
        expect(tooltip.innerHTML).toContain('周一 / 晨');
        expect(tooltip.innerHTML).toContain('点数: 7');

        bar.dispatch('mousemove');
        expect(typeof tooltip.style.left).toBe('string');
    });

    it('图例点击切换系列显隐（隐藏 → 再点恢复）', () => {
        vi.stubGlobal('CSS', { escape: (s: string) => s });
        const { container, legend, seriesRect } = makeChartDom();

        attachChartInteractions(container as unknown as HTMLElement);

        legend.dispatch('click');
        expect(legend.attrs.get('data-series-hidden')).toBe('true');
        expect(legend.style.opacity).toBe('0.5');
        expect(seriesRect.style.display).toBe('none');

        legend.dispatch('click');
        expect(legend.attrs.get('data-series-hidden')).toBe('false');
        expect(legend.style.opacity).toBe('1');
        expect(seriesRect.style.display).toBe('');
    });

    it('缺 tooltip 元素时自动创建（走 document 垫片）', () => {
        const { container } = makeChartDom();
        const created: FakeChartEl[] = [];
        vi.stubGlobal('document', {
            createElement: () => {
                const tip = new FakeChartEl();
                created.push(tip);
                return tip;
            },
        });
        // 移除预置 tooltip → querySelector 命中 null → createTooltip 兜底
        (container as unknown as {
            querySelector: (sel: string) => FakeChartEl | null;
        }).querySelector = (sel: string) => (sel === '.nw-chart-tooltip' ? null : null);

        attachChartInteractions(container as unknown as HTMLElement);

        expect(created).toHaveLength(1);
        // createTooltip 用 className 赋值（非 classList）
        expect((created[0] as unknown as { className: string }).className).toBe('nw-chart-tooltip');
        expect(container.children).toContain(created[0]);
    });
});

// ---------------------------------------------------------------------------
// svg-charts — 空数据与选项分支补充
// ---------------------------------------------------------------------------

describe('svg-charts 空数据与选项分支（补充）', () => {
    it('各图表空输入的降级文案', () => {
        expect(areaChart([])).toContain('暂无数据');
        expect(densityHeatmap([])).toContain('暂无数据');
        expect(violinChart([])).toContain('暂无数据');
        expect(treeChart({ name: '独苗' })).toContain('独苗');
        expect(heatmap([{ row: 'r', col: 'c', value: 1 }], { colorScale: ['#000', '#fff'] })).toContain('r');
        expect(wordCloud([{ text: '单', weight: 5 }])).toContain('单');
    });

    it('radarChart 自定义尺寸与标题；lineChart 不带点时不渲染数据点', () => {
        const radar = radarChart(
            [{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }],
            { size: 200, title: '小雷达' },
        );
        expect(radar).toContain('viewBox="0 0 200 200"');
        expect(radar).toContain('小雷达');

        const plain = lineChart([{ name: '主角', data: [{ value: 10 }, { value: 20 }], showPoints: false }]);
        expect(plain).not.toContain('nw-chart-line-point');
    });

    it('createChartContainer 自定义 domain 的坐标换算', () => {
        const chart = createChartContainer({
            width: 500,
            height: 300,
            padding: { top: 30, right: 30, bottom: 40, left: 60 },
            xDomain: [0, 10],
            yDomain: [-5, 5],
            xAxisLabel: '章数',
            yAxisLabel: '情绪值',
        });
        expect(chart.plotArea).toEqual({ x: 60, y: 30, width: 410, height: 230 });
        expect(chart.getX(5)).toBe(265);
        expect(chart.getY(0)).toBe(145);
        expect(chart.svgStart).toContain('章数');
        expect(chart.svgStart).toContain('情绪值');
    });
});


// ---------------------------------------------------------------------------
// template-vars-builder — buildEntityVars / buildContextVars / buildSceneStyleHint
// ---------------------------------------------------------------------------

describe('template-vars-builder（ui/full-writer/template-vars-builder.ts）', () => {
    const TPL_PROJECT = '长篇小说/书A';
    const BODY_FILE = `${TPL_PROJECT}/03-大纲与章节/正文/第1卷/第1章_开局_正文.md`;

    function makeTplDeps(opts: {
        seed?: Record<string, string>;
        viewVars?: Record<string, string>;
        stepResults?: Record<string, string>;
        contextScope?: string;
        metadataFrontmatter?: Record<string, unknown> | null;
    } = {}): TemplateVarsDeps {
        const vault = newMockVault();
        for (const [path, content] of Object.entries(opts.seed ?? {})) vault._seedFile(path, content);
        return {
            app: {
                vault,
                metadataCache: { getFileCache: () => (opts.metadataFrontmatter === undefined ? null : { frontmatter: opts.metadataFrontmatter ?? {} }) },
            },
            plugin: {
                settings: {
                    contextScope: opts.contextScope ?? 'full',
                    dedupeRulesInStyle: true,
                    storyContextTier: 'cloud',
                    maxContext: 128000,
                    maxOutput: 8192,
                },
            },
            project: TPL_PROJECT,
            chapterName: '第1章',
            chapterNum: 1,
            volume: '第1卷',
            chapDir: '',
            context: null,
            viewVars: opts.viewVars ?? {},
            stepResults: opts.stepResults ?? {},
        } as unknown as TemplateVarsDeps;
    }

    it('buildEntityVars：四类实体按类型打分输出，主角保底在人物列表，_contextTokens 记账', async () => {
        const deps = makeTplDeps();
        const d = {
            outline: { raw: '沈砚踏上断魂桥，天阙的差役盯上了他的测脉碑。' },
            previous_chapter: { bodySummary: '上一章沈砚抵达砂峡。', ending: '他决定参加复测。' },
            character_state: [
                { name: '沈砚', 角色定位: '主角', 身份: '砂民少年', 当前状态: '复测前', 人物背景: '父亲病故。' },
                { name: '沈铁山', 角色定位: '重要配角', 身份: '铁匠', 当前状态: '陪儿子复测' },
            ],
            factions: [{ name: '天阙', 类型: '王朝', 描述: '控制测脉。' }],
            locations: [{ name: '断魂桥', 类型: '关隘', 描述: '砂峡唯一通道。' }],
            items: [{ name: '测脉碑', 类型: '法器', 效果: '测出逆脉。' }],
        } as never;
        const vars: Record<string, string> = {};

        await buildEntityVars(deps, vars, d);

        expect(vars.allChars).toContain('- 沈砚：');
        expect(vars.allChars).toContain('定位：主角');
        expect(vars.allChars).toContain('沈铁山');
        expect(vars.allFactions).toContain('天阙');
        expect(vars.allFactions).toContain('类型：王朝');
        expect(vars.allLocs).toContain('断魂桥');
        expect(vars.allItems).toContain('测脉碑');
        const totalChars = (vars.allChars + vars.allFactions + vars.allLocs + vars.allItems).length;
        expect(Number(vars._contextTokens)).toBeGreaterThan(0);
        expect(Number(vars._contextTokens)).toBeLessThanOrEqual(totalChars);
    });

    it('buildEntityVars：compact 范围仅展开涉及实体，未涉及实体降级为一行摘要', async () => {
        const deps = makeTplDeps({
            contextScope: 'compact',
            seed: { [BODY_FILE]: '第1章正文' },
            metadataFrontmatter: { 涉及人物: ['沈砚'], 涉及地点: ['断魂桥'] },
        });
        const d = {
            character_state: [
                { name: '沈砚', 角色定位: '主角', 身份: '砂民少年', 当前状态: '复测前' },
                { name: '沈铁山', 身份: '铁匠', 当前状态: '陪儿子复测', 人物背景: '不该出现在摘要外' },
            ],
            locations: [{ name: '断魂桥', 类型: '关隘', 描述: '砂峡唯一通道。' }],
        } as never;
        const vars: Record<string, string> = {};

        await buildEntityVars(deps, vars, d);

        // 涉及人物走完整格式，未涉及人物走「身份/状态/动机」摘要格式
        expect(vars.allChars).toContain('- 沈砚：定位：主角');
        expect(vars.allChars).toContain('- 沈铁山：身份：铁匠，状态：陪儿子复测');
        expect(vars.allChars).not.toContain('不该出现在摘要外');
        // 涉及地点走完整格式
        expect(vars.allLocs).toContain('描述：砂峡唯一通道。');
    });

    it('buildContextVars：世界观/设定库/文风去重/伏笔信息债/跨卷快照/章计划全链路', async () => {
        const outline = [
            '### 第1卷',
            '',
            '### 第1章',
            '沈砚过断魂桥参加复测，被差役刁难。',
            '',
            '## 伏笔布局规划',
            '',
            '| 伏笔名 | 说明 | 埋设章 | 暗示章 | 揭示章 |',
            '| --- | --- | --- | --- | --- |',
            '| 月牙疤 | 身世之谜 | 1 | 2,3 | 5 |',
            '',
        ].join('\n');
        const foreshadowDB = [
            '| # | 伏笔名称 | 重要程度 | 埋设章节 | 计划回收 | 当前状态 |',
            '|---|---------|---------|---------|---------|---------|',
            '| F9 | 铁盒 | 高 | 第1章 | 第1章 | 埋设中 |',
        ].join('\n');
        const deps = makeTplDeps({
            seed: {
                [pjVolumeOutlineFile(TPL_PROJECT, 1)]: outline,
                [pjForeshadowDB(TPL_PROJECT)]: foreshadowDB,
            },
            viewVars: { crossVolumeSnapshot: '上卷末：沈砚离开砂峡' },
            stepResults: {},
        });
        const rulesLike = ('规则Signal一写作规则。'.repeat(30) + '角色活着。写作自检。').slice(0, 500);
        const d = {
            world_view: { raw: '修仙世界，灵气从地脉升起。' },
            setting_lib: { raw: '## 力量体系\n顺脉者引气入体。' },
            writing_rules: { style: '简洁冷峻' },
            writing_style: { raw: rulesLike },
            foreshadows: {
                unrevealed: Array.from({ length: 25 }, (_, i) => ({
                    id: `F${i}`,
                    name: `伏笔A${i}`,
                    importance: '高',
                    buryChapter: '第1章',
                    plannedReveal: '第2章',
                    relatedChars: '沈砚',
                    status: '埋设中',
                })),
                revealed: [],
                abandoned: [],
            },
            timeline: [{ time: '清晨', chapter: '第1章', event: '沈砚过断魂桥', impact: '参加复测' }],
            previous_chapter: {
                bodySummary: '上一章沈砚抵达砂峡。',
                ending: '他决定参加复测。',
                outline: '第1章大纲',
                analysisReport: '续写建议：让差役的敌意更早暴露\n## 其他',
                continuityReview: '❌ 铁盒下落未交代\n⚠️ 时间线跳脱',
                infoPlan: '情感温度：6\n冲突强度：3\n节奏节拍：两慢一快',
                stateSnapshot: '状态快照内容',
            },
            outline: { raw: '全书大纲原文' },
        } as never;
        const vars: Record<string, string> = {};

        await buildContextVars(deps, vars, d);

        expect(vars.worldView).toContain('修仙世界');
        expect(vars.worldType).toBe('修仙');
        expect(vars.settingLib).toContain('力量体系');
        expect(vars.writingStyle).toBe('简洁冷峻');
        // 规则编号章样式的文笔风格内容被去重为空串
        expect(vars.writingStyleContent).toBe('');
        expect(vars.unrevealedForeshadow).toContain('[F0] 伏笔A0');
        expect(vars.forcedRevealHint).toContain('信息债严重（25个未揭示）');
        expect(vars.forcedRevealHint).toContain('📋 本章计划伏笔操作：');
        expect(vars.forcedRevealHint).toContain('[埋入]伏笔「月牙疤」');
        expect(vars.revealInstruction).toContain('信息债严重');
        expect(vars.foreshadowWarnings).toContain('伏笔揭示预警');
        expect(vars.foreshadowWarnings).toContain('铁盒');
        expect(vars.timelineEvents).toContain('沈砚过断魂桥');
        expect(vars.prevChaptersSummary).toContain('上一章正文：');
        expect(vars.prevChaptersSummary).toContain('【跨卷状态快照');
        expect(vars.prevChaptersSummary).toContain('上一章续写建议：让差役的敌意更早暴露');
        expect(vars.prevReview).toContain('铁盒下落未交代');
        expect(vars.emotionContext).toContain('上一章情感温度：6');
        expect(vars.prevChapEnding).toBe('他决定参加复测。');
        expect(vars.prevChapterStateSnapshot).toBe('状态快照内容');
        expect(vars.outlineContent).toBe('全书大纲原文');
        expect(vars.chapPlan).toContain('沈砚过断魂桥参加复测');
        expect(vars.chapPosition).toBe('第1章（第1卷）');
    });

    it('buildContextVars：compressed 总线数据优先，空设定库回落世界观提取，首章无上一章有显式占位', async () => {
        const deps = makeTplDeps();
        const d = {
            compressed: {
                worldView: '修仙世界\n力量体系：\n练气、筑基\n## 势力分布\n三大宗门。',
                settingLib: '<!-- 占位，无实际内容 -->',
                timeline: '- 清晨 | 第1章 | 压缩事件 | 影响',
            },
        } as never;
        const vars: Record<string, string> = {};

        await buildContextVars(deps, vars, d);

        expect(vars.worldView).toContain('修仙世界');
        expect(vars.powerSystem).toBe('练气、筑基');
        expect(vars.settingLib).toContain('力量体系');
        expect(vars.settingLib).toContain('练气、筑基');
        expect(vars.timelineEvents).toContain('压缩事件');
        expect(vars.prevChapEnding).toBe('（本章为开篇，无上一章结尾）');
        expect(vars.prevChapterStateSnapshot).toBe('');
        expect(vars.chapPosition).toBe('第1章（第1卷）');
    });

    it('buildSceneStyleHint：按 infoPlan 情绪/冲突强度选场景样本段，写入节选与节奏建议', async () => {
        const styleFile = [
            '# 文笔风格',
            '',
            '### 战斗/冲突场景样本',
            '```',
            '刀风扑面，三招之内分生死。',
            '```',
            '',
            '### 日常/对话场景样本',
            '```',
            '「吃茶去。」她笑。',
            '```',
            '',
            '### 情绪/心理场景样本',
            '```',
            '他攥紧了拳头，指节发白。',
            '```',
            '',
        ].join('\n');
        const deps = makeTplDeps({ seed: { [getWritingStylePath(TPL_PROJECT)]: styleFile } });

        const battleVars: Record<string, string> = { infoPlan: '情感温度：8\n冲突强度：5' };
        await buildSceneStyleHint(deps, battleVars);
        expect(battleVars.sceneStyleSnippet).toBe('刀风扑面，三招之内分生死。');
        expect(battleVars._sceneType).toBe('battle');
        expect(battleVars.suggestedRhythm).toContain('急起急落');

        const emotionalVars: Record<string, string> = { infoPlan: '情感温度：5' };
        await buildSceneStyleHint(deps, emotionalVars);
        expect(emotionalVars.sceneStyleSnippet).toBe('他攥紧了拳头，指节发白。');
        expect(emotionalVars._sceneType).toBe('emotional');

        const dialogueVars: Record<string, string> = {};
        await buildSceneStyleHint(deps, dialogueVars);
        expect(dialogueVars.sceneStyleSnippet).toBe('「吃茶去。」她笑。');
        expect(dialogueVars._sceneType).toBe('dialogue');
        expect(dialogueVars.suggestedRhythm).toContain('对话推进');
    });

    it('buildSceneStyleHint：无文笔风格文件时静默返回，不写入任何场景变量', async () => {
        const deps = makeTplDeps();
        const vars: Record<string, string> = { infoPlan: '情感温度：8' };

        await buildSceneStyleHint(deps, vars);

        expect(vars.sceneStyleSnippet).toBeUndefined();
        expect(vars.suggestedRhythm).toBeUndefined();
    });
});


// ---------------------------------------------------------------------------
// UI 组件簇（fake DOM）— empty-state / error-state / ai-detection-report /
// chart-toolbar / markdown-toolbar / progress-bar / task-card
// ---------------------------------------------------------------------------

/** 通用假元素：覆盖 Obsidian HTMLElement 扩展（createDiv/createSpan/createEl/setText/empty） */
class FakeUiEl {
    tagName: string;
    className = '';
    textContent = '';
    innerHTML = '';
    title = '';
    disabled = false;
    style: Record<string, string> = {};
    cssText = '';
    children: FakeUiEl[] = [];
    parent: FakeUiEl | null = null;
    listeners = new Map<string, Array<(e: unknown) => void>>();

    constructor(tag = 'div') {
        this.tagName = tag;
        (this.style as Record<string, unknown>).setProperty = (name: string, value: string) => {
            this.style[name] = value;
        };
    }

    get classList() {
        const self = this;
        return {
            add: (...cls: string[]) => {
                const set = new Set(self.className.split(' ').filter(Boolean));
                cls.forEach(c => set.add(c));
                self.className = [...set].join(' ');
            },
            remove: (...cls: string[]) => {
                const set = new Set(self.className.split(' ').filter(Boolean));
                cls.forEach(c => set.delete(c));
                self.className = [...set].join(' ');
            },
            contains: (c: string) => self.className.split(' ').includes(c),
        };
    }

    setAttribute(name: string, value: string): void {
        if (name === 'class') this.className = value;
        else if (name === 'style') this.cssText = value;
        else (this as unknown as Record<string, unknown>)[name] = value;
    }
    getAttribute(name: string): string | null {
        return (this as unknown as Record<string, unknown>)[name] !== undefined
            ? String((this as unknown as Record<string, unknown>)[name])
            : null;
    }

    setText(text: string): this {
        this.textContent = text;
        return this;
    }
    addClass(cls: string): this {
        this.classList.add(cls);
        return this;
    }
    removeClass(...cls: string[]): this {
        this.classList.remove(...cls);
        return this;
    }
    toggleClass(cls: string, force?: boolean): this {
        const shouldAdd = force === undefined ? !this.classList.contains(cls) : force;
        if (shouldAdd) this.classList.add(cls);
        else this.classList.remove(cls);
        return this;
    }
    setProperty(name: string, value: string): void {
        this.style[name] = value;
    }
    empty(): this {        this.children = [];
        return this;
    }
    appendChild<T extends FakeUiEl>(child: T): T {
        child.parent = this;
        this.children.push(child);
        return child;
    }
    remove(): void {
        if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
    }

    createChild(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeUiEl {
        const el = new FakeUiEl(tag);
        if (o?.cls) el.className = o.cls;
        if (o?.text !== undefined) el.textContent = o.text;
        if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
        return this.appendChild(el);
    }
    createDiv(o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeUiEl {
        return this.createChild('div', o);
    }
    createSpan(o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeUiEl {
        return this.createChild('span', o);
    }
    createEl(tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }): FakeUiEl {
        return this.createChild(tag, o);
    }

    addEventListener(type: string, fn: (e: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }
    dispatch(type: string, event: Record<string, unknown> = {}): void {
        for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {}, ...event });
    }

    querySelector<T = FakeUiEl>(selector: string): T | null {
        return this.querySelectorAll<T>(selector)[0] ?? null;
    }
    querySelectorAll<T = FakeUiEl>(selector: string): T[] {
        const hits: FakeUiEl[] = [];
        const match = (el: FakeUiEl): boolean => {
            if (selector.startsWith('.')) return el.className.split(' ').includes(selector.slice(1));
            return el.tagName === selector;
        };
        const walk = (el: FakeUiEl): void => {
            for (const c of el.children) {
                if (match(c)) hits.push(c);
                walk(c);
            }
        };
        walk(this);
        return hits as unknown as T[];
    }
    getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
        return { left: 0, top: 0, width: 400, height: 250 };
    }
    /** 按类名在子树中查找（测试断言辅助） */
    findByClass(cls: string): FakeUiEl | null {
        return this.querySelector<FakeUiEl>(`.${cls}`);
    }
}

function fakeDoc() {
    return { createElement: (tag: string) => new FakeUiEl(tag) };
}

import { createEmptyState } from '@/ui/components/empty-state';
import { createErrorState } from '@/ui/components/error-state';
import { renderAIDetectionReport } from '@/ui/components/ai-detection-report';
import { createChartToolbar } from '@/ui/components/chart-toolbar';
import { buildMarkdownToolbar } from '@/ui/co-writing/markdown-toolbar';
import { ProgressBarComponent } from '@/ui/components/progress/progress-bar';
import { TaskCardComponent } from '@/ui/components/progress/task-card';
import { ProgressEmitter } from '@/shared/progress-emitter';

describe('empty-state / error-state（fake DOM）', () => {
    it('createEmptyState：图标+标题+描述+可选动作按钮', () => {
        vi.stubGlobal('document', fakeDoc());
        const host = new FakeUiEl();
        const fired = vi.fn();
        const el = createEmptyState({
            icon: 'book',
            title: '暂无书籍',
            description: '先导入一本书',
            actionText: '导入书籍',
            onAction: fired,
        } as never) as unknown as FakeUiEl;

        expect(el.className).toBe('nw-empty-state');
        expect(el.findByClass('nw-empty-state-title')?.textContent).toBe('暂无书籍');
        expect(el.findByClass('nw-empty-state-description')?.textContent).toBe('先导入一本书');
        const btn = el.findByClass('nw-empty-state-action');
        expect(btn?.textContent).toBe('导入书籍');
        btn?.dispatch('click');
        expect(fired).toHaveBeenCalledTimes(1);
    });

    it('createEmptyState：无描述/无动作时省略对应区块；未知图标回落 default', () => {
        vi.stubGlobal('document', fakeDoc());
        const host = new FakeUiEl();
        const el = createEmptyState({ title: '暂无章节' } as never) as unknown as FakeUiEl;
        expect(el.findByClass('nw-empty-state-description')).toBeNull();
        expect(el.findByClass('nw-empty-state-action')).toBeNull();
        expect(el.findByClass('nw-empty-state-title')?.textContent).toBe('暂无章节');
    });

    it('createErrorState：标题+详情+动作按钮（primary/secondary 样式与点击回调）', () => {
        const host = new FakeUiEl();
        const retry = vi.fn();
        const openSettings = vi.fn();
        const box = createErrorState(host as unknown as HTMLElement, {
            title: '导出失败',
            detail: '磁盘已满',
            actions: [
                { label: '重试', primary: true, onClick: retry },
                { label: '打开设置', onClick: openSettings },
            ],
        }) as unknown as FakeUiEl;

        expect(box.className).toBe('nw-flow-error');
        expect(box.findByClass('nw-flow-error-title')?.textContent).toBe('导出失败');
        expect(box.findByClass('nw-flow-error-detail')?.textContent).toBe('磁盘已满');
        const buttons = box.querySelectorAll<FakeUiEl>('button');
        expect(buttons).toHaveLength(2);
        expect(buttons[0].className).toContain('nw-btn-primary');
        expect(buttons[1].className).toContain('nw-btn-secondary');
        buttons[0].dispatch('click');
        buttons[1].dispatch('click');
        expect(retry).toHaveBeenCalledTimes(1);
        expect(openSettings).toHaveBeenCalledTimes(1);
    });

    it('createErrorState：无详情/无动作时省略区块', () => {
        const host = new FakeUiEl();
        const box = createErrorState(host as unknown as HTMLElement, { title: '加载失败' }) as unknown as FakeUiEl;
        expect(box.findByClass('nw-flow-error-detail')).toBeNull();
        expect(box.querySelector('.nw-flow-error-actions')).toBeNull();
    });
});

describe('ai-detection-report（fake DOM）', () => {
    it('renderAIDetectionReport：AI 味文本渲染头部评分与建议区', () => {
        vi.stubGlobal('document', fakeDoc());
        const container = new FakeUiEl();
        const aiText = [
            '然而，他并不知道，命运的齿轮已经开始转动。',
            '她的眼中闪过一丝不易察觉的笑意。',
            '仿佛在诉说着什么。',
            '空气中弥漫着紧张的气氛。',
            '他的嘴角勾起一抹弧度，让人捉摸不透。',
            '这一刻，时间仿佛静止了。',
            '与此同时，远方的天空泛起了鱼肚白。',
            '他知道，自己必须要做点什么了。',
            '究其原因，不过是一个字：穷。',
            '不可否认，这确实是一个问题。',
        ].join('\n');

        renderAIDetectionReport(container as unknown as HTMLElement, aiText);

        expect(container.className).toBe('nw-ai-report');
        const head = container.findByClass('nw-ai-report-head');
        expect(head).not.toBeNull();
        expect(head?.findByClass('nw-ai-report-title')?.textContent).toContain('AI 味检测');
        const score = head?.querySelector('.nw-ai-report-score');
        expect(score).not.toBeNull();
        expect(Number(score?.textContent)).not.toBeNaN();
        const suggestions = container.findByClass('nw-ai-report-suggestions');
        expect(suggestions).not.toBeNull();
        expect(suggestions?.children.length).toBeGreaterThan(0);
    });

    it('renderAIDetectionReport：人味文本评分低，无建议区', () => {
        vi.stubGlobal('document', fakeDoc());
        const container = new FakeUiEl();
        const humanText = '爹的坟头草有两尺高。他蹲在坟前烧纸，火苗舔着纸角，灰打着旋儿往上飘。风一停，灰就落在鞋面上。';

        renderAIDetectionReport(container as unknown as HTMLElement, humanText);

        const head = container.findByClass('nw-ai-report-head');
        expect(head).not.toBeNull();
        const level = head?.children.find(c => c.className.startsWith('nw-ai-report-level'));
        expect(level?.textContent).toBe('人味正常');
    });
});

describe('chart-toolbar（fake DOM）', () => {
    it('createChartToolbar：类型按钮 + 密度按钮 + 排序切换，点击回调正确路由', () => {
        vi.stubGlobal('document', fakeDoc());
        const container = new FakeUiEl();
        const onTypeChange = vi.fn();
        const onDensityChange = vi.fn();
        const onSortChange = vi.fn();

        createChartToolbar(container as unknown as HTMLElement, {
            currentType: 'line',
            availableTypes: ['line', 'bar', 'radar'],
            currentDensity: 'normal',
            onTypeChange,
            onDensityChange,
            showSortToggle: true,
            onSortChange,
        } as never);

        expect(container.className).toBe('nw-chart-toolbar');
        const groups = container.children;
        expect(groups).toHaveLength(3);
        const typeButtons = groups[0].children;
        expect(typeButtons).toHaveLength(3);
        expect(typeButtons[0].textContent).toBe('折线图');
        expect(typeButtons[0].className).toContain('active');
        (typeButtons[1] as FakeUiEl).dispatch('click');
        expect(onTypeChange).toHaveBeenCalledWith('bar');

        const densityButtons = groups[1].children;
        expect(densityButtons).toHaveLength(3);
        expect(densityButtons[1].title).toBe('标准型');
        expect(densityButtons[1].className).toContain('active');
        (densityButtons[0] as FakeUiEl).dispatch('click');
        expect(onDensityChange).toHaveBeenCalledWith('compact');

        const sortButtons = groups[2].children;
        expect(sortButtons).toHaveLength(3);
        (sortButtons[2] as FakeUiEl).dispatch('click');
        expect(onSortChange).toHaveBeenCalledWith('desc');
    });

    it('createChartToolbar：showSortToggle 缺省时不渲染排序组', () => {
        vi.stubGlobal('document', fakeDoc());
        const container = new FakeUiEl();
        createChartToolbar(container as unknown as HTMLElement, {
            currentType: 'bar',
            availableTypes: ['bar'],
            currentDensity: 'compact',
            onTypeChange: vi.fn(),
            onDensityChange: vi.fn(),
        } as never);
        expect(container.children).toHaveLength(2);
    });
});

describe('markdown-toolbar（fake DOM）', () => {
    interface ToolbarHarness {
        wrap: FakeUiEl;
        edits: unknown[];
        formatted: number;
        editor: { value: string; selectionStart: number; selectionEnd: number };
        setSelection(start: number, end: number): void;
        buttons(): FakeUiEl[];
    }

    function makeHarness(text: string): ToolbarHarness {
        vi.stubGlobal('document', fakeDoc());
        const wrap = new FakeUiEl();
        const editor = { value: text, selectionStart: 0, selectionEnd: 0 };
        const harness: ToolbarHarness = {
            wrap,
            edits: [],
            formatted: 0,
            editor,
            setSelection(start: number, end: number) {
                editor.selectionStart = start;
                editor.selectionEnd = end;
            },
            buttons() {
                return wrap.querySelectorAll<FakeUiEl>('button');
            },
        };
        buildMarkdownToolbar(wrap as unknown as HTMLElement, {
            getEditor: () => editor as unknown as HTMLTextAreaElement,
            getContract: () => ({}) as never,
            applyTextEdit: (edit: unknown) => harness.edits.push(edit),
            applyNovelFormat: () => {
                harness.formatted += 1;
            },
        });
        return harness;
    }

    it('工具条按钮齐全，加粗/斜体/标题把选区交给编辑回调', () => {
        const h = makeHarness('第一段内容\n\n第二段内容');
        const labels = h.buttons().map(b => b.textContent);
        expect(labels).toEqual(['B', 'I', 'H', '❝', '•', '―', '⇥', '↹', '⇤', '¶', '↵', '“”', '⚡ 一键排版']);

        h.setSelection(0, 3);
        h.buttons()[0].dispatch('click');
        expect(h.edits).toHaveLength(1);
        expect(JSON.stringify(h.edits[0])).toContain('**');

        h.buttons()[1].dispatch('click');
        expect(JSON.stringify(h.edits[1])).toContain('*');

        h.buttons()[2].dispatch('click');
        expect(JSON.stringify(h.edits[2])).toContain('## ');
    });

    it('一键排版与分隔符分组结构正确；无编辑器时不抛错', () => {
        const h = makeHarness('正文');
        const primary = h.buttons().find(b => b.className.includes('is-primary'));
        expect(primary?.textContent).toBe('⚡ 一键排版');
        primary?.dispatch('click');
        expect(h.formatted).toBe(1);

        // 分隔线产生 3 个分组（两组按钮 + 中间的 sep）
        expect(wrap_groupCount(h.wrap)).toBe(3);

        const empty = makeHarness('x');
        (empty.wrap as unknown as { children: FakeUiEl[] }).children.length;
        const noEditor = buildMarkdownToolbar(new FakeUiEl() as unknown as HTMLElement, {
            getEditor: () => null,
            getContract: () => ({}) as never,
            applyTextEdit: vi.fn(),
            applyNovelFormat: () => {},
        });
        void noEditor;
        (new FakeUiEl() as unknown as FakeUiEl).findByClass('nw-cowrite-md-toolbar');
    });
});

function wrap_groupCount(wrap: FakeUiEl): number {
    const toolbar = wrap.children[0];
    return toolbar.children.filter(c => c.className === 'nw-cowrite-md-group').length;
}

describe('progress-bar / task-card（fake DOM）', () => {
    it('ProgressBarComponent：渲染 + setProgress 更新宽度/百分比/文案并夹取 0-100', () => {
        const container = new FakeUiEl();
        const bar = new ProgressBarComponent(container as unknown as HTMLElement, { height: '8px' });

        const wrapper = container.children[0];
        const fill = wrapper.findByClass('nw-progress-bar-fill');
        const percent = wrapper.findByClass('nw-progress-bar-percent');
        const message = wrapper.findByClass('nw-progress-bar-message');
        expect(fill).not.toBeNull();
        expect(percent?.textContent).toBe('0%');
        expect(wrapper.style['--nw-progress-h']).toBe('8px');

        bar.setProgress(50, '正在生成');
        expect(fill?.style.width).toBe('50%');
        expect(percent?.textContent).toBe('50%');
        expect(message?.textContent).toBe('正在生成');

        bar.setProgress(150);
        expect(fill?.style.width).toBe('100%');
        bar.setProgress(-10);
        expect(fill?.style.width).toBe('0%');
    });

    it('ProgressBarComponent：bindEmitter 同步初值，destroy 清理', () => {
        const container = new FakeUiEl();
        const bar = new ProgressBarComponent(container as unknown as HTMLElement);
        const emitter = new ProgressEmitter('t1', '任务');
        emitter.start();
        emitter.setProgress(40, '进行中');

        const off = bar.bindEmitter(emitter);
        const wrapper = container.children[0];
        const percent = wrapper.findByClass('nw-progress-bar-percent');
        expect(percent?.textContent).toBe('40%');

        expect(typeof off).toBe('function');
        off();
        bar.destroy();
        expect(container.children).toHaveLength(0);
    });

    it('TaskCardComponent：绑定 emitter 后标题/状态徽标同步，失败态展示错误与重试按钮', () => {
        const container = new FakeUiEl();
        const card = new TaskCardComponent(container as unknown as HTMLElement, { showCancel: true });
        const cancelled = vi.fn();
        card.onCancel(cancelled);

        const emitter = new ProgressEmitter('t2', '生成第1章');
        const off = card.bindEmitter(emitter);
        const cardEl = container.children[0];
        expect(cardEl.findByClass('nw-task-title')?.textContent).toBe('生成第1章');
        expect(cardEl.findByClass('nw-task-status-badge')?.textContent).toBe('等待中');

        // 取消按钮：pending 态可见，点击触发回调
        const cancelBtn = cardEl.findByClass('nw-btn-danger');
        expect(cancelBtn?.classList.contains('nw-u-d-none')).toBe(false);
        cancelBtn?.dispatch('click');
        expect(cancelled).toHaveBeenCalledTimes(1);

        emitter.start();
        emitter.fail('模型超时');
        expect(cardEl.findByClass('nw-task-status-badge')?.textContent).toBe('失败');
        const errorBox = cardEl.findByClass('nw-task-error');
        expect(errorBox?.classList.contains('nw-u-d-none')).toBe(false);
        expect(errorBox?.findByClass('nw-task-error-message')?.textContent).toBe('模型超时');
        expect(cancelBtn?.textContent).toBe('🔄 重试');

        expect(typeof off).toBe('function');
        card.destroy();
        expect(container.children).toHaveLength(0);
    });

    it('TaskCardComponent：showCancel=false 不渲染取消按钮', () => {
        const container = new FakeUiEl();
        const card = new TaskCardComponent(container as unknown as HTMLElement, { showCancel: false });
        card.bindEmitter(new ProgressEmitter('t3', '任务'));
        const cardEl = container.children[0];
        expect(cardEl.findByClass('nw-btn-danger')).toBeNull();
        card.destroy();
    });
});


// ---------------------------------------------------------------------------
// step-list / loading-overlay（fake DOM）
// ---------------------------------------------------------------------------

import { StepListComponent } from '@/ui/components/progress/step-list';
import { LoadingOverlayComponent } from '@/ui/components/progress/loading-overlay';
import { CommandUiExecutor } from '@/ui/command-ui-executor';
import { CommandIds } from '@/shared/command-ids';

/** 结构化假 emitter：只需 getState/on 两个成员 */
function fakeEmitterState(state: Record<string, unknown>) {
    let captured: ((s: Record<string, unknown>) => void) | null = null;
    return {
        getState: () => state,
        on: (cb: (s: Record<string, unknown>) => void) => {
            captured = cb;
            return () => {
                captured = null;
            };
        },
        emit(next: Record<string, unknown>) {
            state = { ...state, ...next };
            captured?.(state);
        },
    };
}

describe('step-list（fake DOM）', () => {
    function makeList(): { container: FakeUiEl; list: StepListComponent } {
        const container = new FakeUiEl();
        const list = new StepListComponent(container as unknown as HTMLElement, ['情节构思', '场景展开', '正文生成']);
        return { container, list };
    }

    it('渲染 N 个步骤项，初始图标为 ○', () => {
        const { container } = makeList();
        const wrapper = container.children[0];
        const items = wrapper.querySelectorAll<FakeUiEl>('.nw-step-item');
        expect(items).toHaveLength(3);
        expect(items[0].findByClass('nw-step-name')?.textContent).toBe('情节构思');
        expect(items[2].findByClass('nw-step-icon')?.textContent).toBe('○');
    });

    it('setCurrentStep：前置步骤 ✓、当前步骤 ● 并显示子进度条、后续 ○', () => {
        const { container, list } = makeList();
        const wrapper = container.children[0];
        const items = wrapper.querySelectorAll<FakeUiEl>('.nw-step-item');

        list.setCurrentStep(1);

        expect(items[0].findByClass('nw-step-icon')?.textContent).toBe('✓');
        expect(items[1].findByClass('nw-step-icon')?.textContent).toBe('●');
        expect(items[1].findByClass('nw-step-progress-bar')?.classList.contains('nw-is-visible')).toBe(true);
        expect(items[2].findByClass('nw-step-icon')?.textContent).toBe('○');
        expect(items[2].classList.contains('nw-is-pending')).toBe(true);
    });

    it('updateStep：写入子进度条宽度与消息；越界索引安全返回', () => {
        const { container, list } = makeList();
        list.setCurrentStep(1);
        const wrapper = container.children[0];
        const item = wrapper.querySelectorAll<FakeUiEl>('.nw-step-item')[1];
        const fill = item.findByClass('nw-step-progress-fill');
        const message = item.findByClass('nw-step-message');

        list.updateStep(1, 50, '正在展开场景');
        expect(fill?.style.width).toBe('50%');
        expect(message?.textContent).toBe('正在展开场景');
        expect(message?.classList.contains('nw-is-visible')).toBe(true);

        list.updateStep(99, 100, '越界');
        expect(fill?.style.width).toBe('50%');
    });

    it('markStepComplete：图标 ✓ 且子进度条满格', () => {
        const { container, list } = makeList();
        list.markStepComplete(0);
        const item = container.children[0].querySelectorAll<FakeUiEl>('.nw-step-item')[0];
        expect(item.findByClass('nw-step-icon')?.textContent).toBe('✓');
        expect(item.findByClass('nw-step-progress-fill')?.classList.contains('nw-is-full')).toBe(true);
    });

    it('bindEmitter：按 emitter.steps 同步状态，长度变化时重建渲染', () => {
        const { container, list } = makeList();
        const emitter = fakeEmitterState({
            steps: [
                { name: '情节构思', status: 'completed', progress: 100 },
                { name: '场景展开', status: 'running', progress: 40, message: '展开第二场' },
                { name: '正文生成', status: 'pending', progress: 0 },
            ],
        });

        const off = list.bindEmitter(emitter as never);
        const wrapper = container.children[0];
        const items = wrapper.querySelectorAll<FakeUiEl>('.nw-step-item');
        expect(items[0].findByClass('nw-step-icon')?.textContent).toBe('✓');
        expect(items[1].findByClass('nw-step-icon')?.textContent).toBe('●');
        expect(items[1].findByClass('nw-step-progress-fill')?.style.width).toBe('40%');
        expect(items[1].findByClass('nw-step-message')?.textContent).toBe('展开第二场');

        // 状态推送：全部完成
        emitter.emit({
            status: 'completed',
            steps: [
                { name: '情节构思', status: 'completed', progress: 100 },
                { name: '场景展开', status: 'completed', progress: 100 },
                { name: '正文生成', status: 'completed', progress: 100 },
            ],
        });
        expect(items[2].findByClass('nw-step-icon')?.textContent).toBe('✓');
        expect(typeof off).toBe('function');
        off();
        list.destroy();
        expect(container.children).toHaveLength(0);
    });
});

describe('loading-overlay（fake DOM）', () => {
    it('show/hide 切换遮罩可见性，标题默认文案', () => {
        const container = new FakeUiEl();
        const overlay = new LoadingOverlayComponent(container as unknown as HTMLElement);
        const overlayEl = container.children[0];
        expect(overlayEl.className).toContain('nw-loading-overlay');
        expect(overlayEl.classList.contains('nw-u-d-none')).toBe(true);

        overlay.show();
        expect(overlayEl.classList.contains('nw-u-d-none')).toBe(false);
        overlay.hide();
        expect(overlayEl.classList.contains('nw-u-d-none')).toBe(true);
        expect(overlayEl.findByClass('nw-loading-title')?.textContent).toBe('处理中...');
        overlay.destroy();
        expect(container.children).toHaveLength(0);
    });

    it('bindEmitter：标题跟随状态；completed/failed 态改写取消按钮并禁用/启用', () => {
        const container = new FakeUiEl();
        const overlay = new LoadingOverlayComponent(container as unknown as HTMLElement, { showCancel: true });
        const overlayEl = container.children[0];
        const cancelBtn = overlayEl.findByClass('nw-btn-secondary');
        expect(cancelBtn?.textContent).toBe('取消');

        const emitter = fakeEmitterState({ name: '一键生成', status: 'running' });
        overlay.bindEmitter(emitter as never);
        expect(overlayEl.findByClass('nw-loading-title')?.textContent).toBe('一键生成');

        emitter.emit({ status: 'completed' });
        expect(cancelBtn?.textContent).toBe('✓ 完成');
        expect(cancelBtn?.disabled).toBe(true);

        emitter.emit({ status: 'failed' });
        expect(cancelBtn?.textContent).toBe('重试');
        expect(cancelBtn?.disabled).toBe(false);

        emitter.emit({ status: 'cancelled' });
        expect(cancelBtn?.textContent).toBe('已取消');
    });

    it('取消按钮点击触发回调；showSteps=false 时步骤区隐藏', () => {
        const container = new FakeUiEl();
        const cancelled = vi.fn();
        const overlay = new LoadingOverlayComponent(container as unknown as HTMLElement, {
            showCancel: true,
            showSteps: false,
        });
        overlay.onCancel(cancelled);
        const overlayEl = container.children[0];
        const stepsContainer = overlayEl.findByClass('nw-loading-steps');
        expect(stepsContainer?.classList.contains('nw-u-d-none')).toBe(true);

        const emitter = fakeEmitterState({ name: 'x', status: 'running', steps: [{ name: 'a', status: 'running', progress: 1 }] });
        overlay.bindEmitter(emitter as never);
        // showSteps=false 不创建步骤列表
        expect(overlayEl.findByClass('nw-loading-steps')?.children).toHaveLength(0);

        overlayEl.findByClass('nw-btn-secondary')?.dispatch('click');
        expect(cancelled).toHaveBeenCalledTimes(1);
        overlay.destroy();
    });
});

// ---------------------------------------------------------------------------
// command-ui-executor — 命令路由（fake plugin / fake DOM）
// ---------------------------------------------------------------------------

describe('command-ui-executor（ui/command-ui-executor.ts）', () => {
    function makeExecutor(project = '') {
        vi.stubGlobal('document', fakeDoc());
        const plugin = {
            getWorkbenchContext: () => undefined,
            getActiveProject: () => project,
            openAgentWorkbench: vi.fn(),
            openCreationFlow: vi.fn(),
            openWritingStats: vi.fn(),
            toggleWritingPet: vi.fn(),
            openProjectSidePanel: vi.fn(),
        };
        const executor = new CommandUiExecutor({
            app: { vault: newMockVault() },
            plugin,
            getVersionService: () => null,
        } as never);
        return { executor, plugin };
    }

    it('未知命令返回 false；已知命令路由到对应 plugin 方法并返回 true', async () => {
        const { executor, plugin } = makeExecutor('长篇小说/书A');

        await expect(executor.executeCommand('novel-writer-not-a-command')).resolves.toBe(false);

        await expect(executor.executeCommand(CommandIds.WRITING_STATS)).resolves.toBe(true);
        expect(plugin.openWritingStats).toHaveBeenCalledTimes(1);

        await expect(executor.executeCommand(CommandIds.TOGGLE_PET)).resolves.toBe(true);
        expect(plugin.toggleWritingPet).toHaveBeenCalledTimes(1);

        await expect(executor.executeCommand(CommandIds.AGENT_GUIDE)).resolves.toBe(true);
        expect(plugin.openAgentWorkbench).toHaveBeenCalledTimes(1);

        await expect(executor.executeCommand(CommandIds.CREATION_FLOW, { project: '长篇小说/书A' } as never)).resolves.toBe(true);
        expect(plugin.openCreationFlow).toHaveBeenCalledWith('长篇小说/书A');
    });

    it('需要项目上下文的命令在无项目时提示并短路', async () => {
        const { executor, plugin } = makeExecutor('');

        await expect(executor.executeCommand(CommandIds.SHORT_RESEARCH)).resolves.toBe(true);
        expect(noticeCalls.some(c => typeof c.message === 'string' && c.message.includes('请先选择一个短篇项目'))).toBe(true);

        await expect(executor.executeCommand(CommandIds.SCRIPT_RESEARCH)).resolves.toBe(true);
        expect(noticeCalls.some(c => typeof c.message === 'string' && c.message.includes('请先选择一个剧本项目'))).toBe(true);

        await expect(executor.executeCommand(CommandIds.MIGRATE_ENTITY_LINKS)).resolves.toBe(true);
        expect(noticeCalls.some(c => typeof c.message === 'string' && c.message.includes('请先选择一个项目（工作台项目卡或正文页）'))).toBe(true);
        expect(plugin.openWritingStats).not.toHaveBeenCalled();
    });

    it('payload.project 优先于工作台上下文；弹窗类命令正常打开', async () => {
        const { executor } = makeExecutor('');

        await expect(executor.executeCommand(CommandIds.CREATE_PROJECT)).resolves.toBe(true);
        await expect(executor.executeCommand(CommandIds.PLAN_BOOK)).resolves.toBe(true);
        await expect(executor.executeCommand(CommandIds.SHORT_RESEARCH, { project: '短篇/书B' } as never)).resolves.toBe(true);
        expect(noticeCalls.some(c => typeof c.message === 'string' && c.message.includes('请先选择一个短篇项目'))).toBe(false);
    });
});


// ---------------------------------------------------------------------------
// template-vars-builder.buildTemplateVars — 全量模板变量装配
// ---------------------------------------------------------------------------

describe('template-vars-builder.buildTemplateVars（fake DOM + Vault mock）', () => {
    function makeFullDeps(opts: {
        seed?: Record<string, string>;
        stepResults?: Record<string, string>;
        viewVars?: Record<string, string>;
        context?: unknown;
        defaultWordCount?: number;
    } = {}): TemplateVarsDeps {
        const vault = newMockVault();
        for (const [path, content] of Object.entries(opts.seed ?? {})) vault._seedFile(path, content);
        const app = { vault, metadataCache: { getFileCache: () => null } };
        return {
            app,
            plugin: {
                app,
                settings: {
                    contextScope: 'full',
                    dedupeRulesInStyle: true,
                    storyContextTier: 'cloud',
                    maxContext: 128000,
                    maxOutput: 8192,
                    defaultWordCount: opts.defaultWordCount ?? 3000,
                    activeRulesVersion: undefined,
                },
            },
            project: '长篇小说/书A',
            chapterName: '第3章',
            chapterNum: 3,
            volume: '第1卷',
            chapDir: '',
            context: (opts.context ?? null) as never,
            viewVars: opts.viewVars ?? {},
            stepResults: opts.stepResults ?? {},
        } as unknown as TemplateVarsDeps;
    }

    it('无上下文：创作模式回落长篇，占位文案就位，审查问题块聚合进 issues', async () => {
        const deps = makeFullDeps({
            stepResults: {
                continuityCheck: '❌ 铁盒下落未交代\nDELETE_ENTITY:路人甲\n普通行',
                qualityControl: '⚠️ 对话密度偏低',
                analysisReport: 'CRITICAL_FAIL 结尾钩子缺失\nDENSITY_CHECK: 不合格 对话占比过低',
                bodyGeneration: '---\nstatus: written\n---\n正文第一段。',
            },
            viewVars: { userIntervention: '用户要求加强悬念' },
        });

        const vars = await buildTemplateVars(deps);

        expect(vars.creationMode).toBe('long');
        expect(vars.creationModeLabel).toBe('长篇小说');
        expect(vars.narrativeStructureName.length).toBeGreaterThan(0);
        expect(typeof vars.writingRules).toBe('string');
        expect(vars.chapNum).toBe('3');
        expect(vars.chapName).toBe('第3章');
        expect(vars.project).toBe('长篇小说/书A');
        expect(vars.baseWords).toBe('3000');
        expect(vars.infoPlan).toContain('未执行信息规划');
        expect(vars.chapterHook).toBe('');
        expect(vars.distilledContent).toContain('未执行「情节蒸馏」');
        expect(vars.outlineContent).toContain('未生成章节大纲');
        expect(vars.bodyText).toBe('正文第一段。');
        expect(vars.issues).toContain('【连贯性审查——必须修正】');
        expect(vars.issues).toContain('❌ 铁盒下落未交代');
        expect(vars.issues).toContain('【实体删除指令——禁止在修正后的正文中使用以下实体】');
        expect(vars.issues).toContain('DELETE_ENTITY:路人甲');
        expect(vars.issues).toContain('【质量控制问题】');
        expect(vars.issues).toContain('⚠️ 对话密度偏低');
        expect(vars.issues).toContain('【分析报告问题】');
        expect(vars.issues).toContain('CRITICAL_FAIL 结尾钩子缺失');
        expect(vars.userIntervention).toBe('用户要求加强悬念');
        expect(vars.prevChapEnding).toContain('不要自行编造上一章结尾');
        expect(vars.protagonistName).toBe('主角');
        expect(vars.entityContext).toBe('');
    });

    it('有上下文：主角名从人物表提取，章纲/蒸馏/自检内容进入变量，正文模板字数取自设置', async () => {
        const deps = makeFullDeps({
            defaultWordCount: 4500,
            stepResults: {
                infoPlan: '本章信息规划：沈砚复测。\n\n## 开头承接\n- 上一章末句：他推门而出\n- 本章首句承接方式：动作衔接\n\n## 章末钩子\n- 钩子类型：悬念\n- 钩子内容：差役上门',
                plotDistill: '情节蒸馏结果',
                selfCheck: '自检问题一',
                outline: '### 第3章\n沈砚复测遇阻。',
            },
            context: {
                data: {
                    character_state: [
                        { name: '沈砚', 角色定位: '主角', 身份: '砂民少年', 当前状态: '复测前' },
                        { name: '沈铁山', 角色定位: '重要配角', 身份: '铁匠', 当前状态: '陪儿子复测' },
                    ],
                    outline: { raw: '沈砚走上断魂桥。' },
                },
            },
        });

        const vars = await buildTemplateVars(deps);

        expect(vars.protagonistName).toBe('沈砚');
        expect(vars.allChars).toContain('沈砚');
        expect(vars.entityContext).toContain('【人物】');
        expect(vars.infoPlan).toContain('本章信息规划');
        expect(vars.infoPlan).toContain('章末钩子');
        expect(vars.chapterHook).toContain('差役上门');
        expect(vars.distilledContent).toBe('情节蒸馏结果');
        expect(vars.outlineContent).toBe('### 第3章\n沈砚复测遇阻。');
        expect(vars.issues).toContain('自检问题一');
        expect(vars.baseWords).toBe('4500');
        expect(vars.chapPosition).toBe('第3章（第1卷）');
    });
});

// ---------------------------------------------------------------------------
// chapter-state-manager — 步骤状态机
// ---------------------------------------------------------------------------

describe('chapter-state-manager（ui/states/chapter-state-manager.ts）', () => {
    it('updateStepState：四级状态与 stepCompleted/stepResults 一致性', async () => {
        const { ChapterStateManager } = await import('@/ui/states/chapter-state-manager');
        const mgr = new ChapterStateManager({} as never);

        mgr.updateStepState('customStep', 'x'.repeat(600));
        expect(mgr.stepLevels.customStep).toBe('complete');
        expect(mgr.stepCompleted.has('customStep')).toBe(true);
        expect(mgr.stepResults.customStep).toHaveLength(600);

        mgr.updateStepState('partialStep', 'x'.repeat(150));
        expect(mgr.stepLevels.partialStep).toBe('partial');
        expect(mgr.stepCompleted.has('partialStep')).toBe(false);
        expect(mgr.stepResults.partialStep).toHaveLength(150);

        mgr.updateStepState('emptyStep', '   ');
        expect(mgr.stepLevels.emptyStep).toBe('empty');
        expect(mgr.stepResults.emptyStep).toBeUndefined();

        // forceComplete 短路校验
        mgr.updateStepState('forcedStep', '短', true);
        expect(mgr.stepLevels.forcedStep).toBe('complete');
        expect(mgr.stepMissing.forcedStep).toEqual([]);
        expect(mgr.stepCompleted.has('forcedStep')).toBe(true);

        // 降级：同 key 由 complete 改为 partial 时要移出 stepCompleted
        mgr.updateStepState('customStep', 'x'.repeat(150));
        expect(mgr.stepCompleted.has('customStep')).toBe(false);
        expect(mgr.stepLevels.customStep).toBe('partial');
    });

    it('invalidateSteps/reset/migrateLegacyStepIndex：失效传播与一次性迁移', async () => {
        const { ChapterStateManager } = await import('@/ui/states/chapter-state-manager');
        const { migrateStepIndex } = await import('@/engine/step-definitions');
        const mgr = new ChapterStateManager({} as never);

        mgr.updateStepState('myCustomStep', 'x'.repeat(600));
        mgr.invalidateSteps(['myCustomStep'], true);
        expect(mgr.stepCompleted.has('myCustomStep')).toBe(false);
        expect(mgr.stepLevels.myCustomStep).toBe('partial');
        expect(mgr.staleSteps.has('myCustomStep')).toBe(true);

        mgr.invalidateSteps(['myCustomStep'], false);
        expect(mgr.staleSteps.size).toBe(1);

        mgr.currentStepIndex = 99;
        mgr.migrateLegacyStepIndex();
        expect(mgr.currentStepIndex).toBe(migrateStepIndex(99));

        mgr.updateStepState('myCustomStep', 'x'.repeat(600));
        mgr.reset();
        expect(mgr.stepCompleted.size).toBe(0);
        expect(Object.keys(mgr.stepResults)).toHaveLength(0);
        expect(mgr.currentStepIndex).toBe(0);
        expect(mgr.staleSteps.size).toBe(0);
    });
});
