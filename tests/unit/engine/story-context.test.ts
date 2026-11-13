import { describe, expect, it } from 'vitest';
import type { GatheredContext } from '../../../engine/context/context-types';
import {
    assembleStoryContextBundle,
    buildStoryContextGraph,
    formatStoryContextLegacyVars,
    parseStorySceneCards,
    resolveStoryContextProfile,
} from '../../../engine/context/story-context-graph';
import {
    applyStoryContextToVars,
    attachStoryContextToSnapshot,
    buildStoryContext,
    resolveStoryContextTier,
} from '../../../engine/context/story-context-service';
import type {
    StoryContextGraph,
    StoryContextKind,
    StoryContextNode,
} from '../../../engine/context/story-context-types';

function makeContext(): GatheredContext {
    return {
        project: '九霄逆脉行',
        gatheredAt: '2026-10-28T00:00:00.000Z',
        issues: [],
        data: {
            world_view: {
                raw: '题材：玄幻\n时代：架空\n\n## 世界规则\n灵气从地脉升起，砂峡常年刮着带砂的风。',
                sections: [],
            },
            setting_lib: {
                raw: [
                    '## 力量体系',
                    '顺脉者可以引气入体；逆脉者会被天阙标记。断魂桥是砂峡唯一的通道。',
                    '## 地理',
                    '尘霄砂峡横贯南北，断魂桥连接砂民聚居区与测脉碑。',
                ].join('\n'),
                sections: [],
            },
            character_state: [
                {
                    name: '沈砚',
                    角色定位: '主角',
                    身份: '砂民少年',
                    当前状态: '复测前，左腕戴着逆脉环',
                    当前情绪: '紧张',
                    所属势力: '沈家',
                    人物背景: '十岁测脉被判顺脉低劣，父亲当了亡妻的梳妆匣凑复测费。',
                    核心动机: '活下去，查出母亲留下的旧脉纹秘密。',
                },
                {
                    name: '沈铁山',
                    角色定位: '重要配角',
                    身份: '铁匠',
                    当前状态: '陪儿子复测',
                    所属势力: '沈家',
                    人物背景: '打铁三十年，掌心有旧烫疤。',
                },
                {
                    name: '录事',
                    角色定位: '配角',
                    身份: '天阙录事',
                    当前状态: '桥头值班',
                    人物背景: '负责登记复测名单，态度不冷不热。',
                },
            ],
            factions: [
                { name: '天阙', 类型: '王朝', 领袖: '复测使', 描述: '控制测脉与逆脉环的官方势力。' },
            ],
            locations: [
                {
                    name: '断魂桥',
                    类型: '关隘',
                    '所在世界/区域': '尘霄砂峡',
                    重要程度: '高',
                    描述: '砂峡唯一的通道，桥下是灰白砂雾。',
                },
            ],
            items: [
                { name: '霄晶', 类型: '资源', '品阶/等级': '低阶', 效果: '测脉与交易的硬通货。' },
            ],
            timeline: [
                {
                    time: '清晨',
                    chapter: '第1章',
                    event: '沈砚过断魂桥参加复测',
                    impact: '复测结果决定他是否被天阙标记',
                    involvedEntities: ['沈砚', '断魂桥'],
                },
            ],
            foreshadows: {
                unrevealed: [
                    {
                        id: 'F1',
                        name: '月牙疤',
                        importance: '高',
                        buryChapter: '第1章',
                        plannedReveal: '第1章',
                        relatedChars: '沈砚',
                        relatedMainline: '身世',
                        status: '未揭示',
                    },
                    {
                        id: 'F2',
                        name: '母亲的梳妆匣',
                        importance: '中',
                        buryChapter: '第1章',
                        plannedReveal: '第8章',
                        relatedChars: '沈铁山、沈砚',
                        relatedMainline: '身世',
                        status: '未揭示',
                    },
                ],
                revealed: [],
                abandoned: [],
            },
            scene_expansion: {
                raw: [
                    '## 场景1：断魂桥',
                    'POV: 沈砚',
                    '时间: 清晨',
                    '地点: 断魂桥',
                    '目标: 过桥参加复测',
                    '冲突: 差役盘问旧账，沈砚后颈的月牙疤被盯上',
                    '转折: 录事说上峰改了规矩',
                    '离场: 沈砚被押往测脉碑',
                    '出场人物: 沈砚、沈铁山、录事',
                    '',
                    '## 场景2：测脉碑',
                    'POV: 沈砚',
                    '时间: 上午',
                    '地点: 测脉碑',
                    '目标: 完成复测',
                    '冲突: 复测使亲自到场',
                    '出场人物: 沈砚、录事',
                ].join('\n'),
                sections: [],
            },
            emotion_plan: {
                raw: [
                    '### scene1: 断魂桥',
                    'emotion_start: 紧张(3/10)',
                    'emotion_end: 恐惧(6/10)',
                    'emotion_delta: +3',
                    'body_reaction: 手心出汗，舌尖咬出铁锈味',
                    'relationship_change: 沈砚对录事更警惕',
                    '',
                    '### scene2: 测脉碑',
                    'emotion_start: 恐惧(6/10)',
                    'emotion_end: 不甘(7/10)',
                    'emotion_delta: +1',
                    'body_reaction: 牙关发紧',
                    'relationship_change: 沈砚对天阙更敌视',
                ].join('\n'),
                sections: [],
            },
            story_linkage: null,
        },
    } as unknown as GatheredContext;
}

function buildGraph() {
    return buildStoryContextGraph({
        project: '九霄逆脉行',
        chapterName: '第1章',
        chapterNum: 1,
        volume: '第1卷',
        context: makeContext(),
    });
}

const scene1 = parseStorySceneCards(makeContext().data.scene_expansion?.raw || '')[0];

describe('story-context graph', () => {
    it('把六类核心信息标准化成节点', () => {
        const graph = buildGraph();
        expect(graph.byKind.worldview).toHaveLength(1);
        expect(graph.byKind.setting.length).toBeGreaterThanOrEqual(2);
        expect(graph.byKind.character.map(n => n.title)).toEqual(['沈砚', '沈铁山', '录事']);
        expect(graph.byKind.faction.map(n => n.title)).toEqual(['天阙']);
        expect(graph.byKind.location.map(n => n.title)).toEqual(['断魂桥']);
        expect(graph.byKind.item.map(n => n.title)).toEqual(['霄晶']);
        expect(graph.byKind.timeline).toHaveLength(1);
        expect(graph.byKind.foreshadow).toHaveLength(2);
        expect(graph.byKind.scene).toHaveLength(2);
        expect(graph.byKind.emotion).toHaveLength(2);
    });

    it('场景卡自动关联人物、地点、伏笔、情绪与时间线', () => {
        const graph = buildGraph();
        const scene = graph.nodes.get('scene:1');
        expect(scene).toBeTruthy();
        const linkedIds = new Set(scene!.links.map(link => link.targetId));
        expect(linkedIds.has('character:沈砚')).toBe(true);
        expect(linkedIds.has('character:沈铁山')).toBe(true);
        expect(linkedIds.has('location:断魂桥')).toBe(true);
        expect(linkedIds.has('foreshadow:F1:0')).toBe(true);
        expect(linkedIds.has('emotion:1')).toBe(true);

        const foreshadow = graph.nodes.get('foreshadow:F1:0');
        expect(foreshadow?.links.some(link => link.targetId === 'character:沈砚')).toBe(true);
    });

    it('解析场景卡与情绪场景', () => {
        const cards = parseStorySceneCards(makeContext().data.scene_expansion?.raw || '');
        expect(cards).toHaveLength(2);
        expect(cards[0].num).toBe(1);
        expect(cards[0].location).toBe('断魂桥');
        expect(cards[0].characters).toContain('沈砚');
    });

    it('时间线与同名伏笔自动去重，并记录警告', () => {
        const context = makeContext();
        context.data.timeline = [
            { time: '清晨', chapter: '第1章', event: '沈砚过桥', impact: '' },
            { time: '清晨', chapter: '第1章', event: '沈砚过桥', impact: '' },
            { time: '上午', chapter: '第1章', event: '沈砚测脉', impact: '' },
        ];
        const first = context.data.foreshadows!.unrevealed[0];
        context.data.foreshadows!.unrevealed = [
            first,
            { ...first, id: 'F1-dup' },
            context.data.foreshadows!.unrevealed[1],
        ];
        const graph = buildStoryContextGraph({
            project: '九霄逆脉行',
            chapterName: '第1章',
            chapterNum: 1,
            volume: '第1卷',
            context,
            sceneExpansionText: makeContext().data.scene_expansion?.raw || '',
            emotionPlanText: makeContext().data.emotion_plan?.raw || '',
        });
        expect(graph.byKind.timeline).toHaveLength(2);
        expect(graph.byKind.foreshadow).toHaveLength(2);
        expect(graph.warnings.join('\n')).toContain('时间线有 1 条重复事件');
        expect(graph.warnings.join('\n')).toContain('伏笔库有 1 条同名重复记录');
    });
});

describe('story-context bundle', () => {
    it('当前场景的必含项全部进入信息包', () => {
        const graph = buildGraph();
        const bundle = assembleStoryContextBundle(graph, {
            mode: 'co-write',
            tier: 'local',
            chapterNum: 1,
            scene: scene1,
            maxInputTokens: 8192,
            modelId: 'qwen2.5:7b',
        });

        const ids = new Set(bundle.items.map(node => node.id));
        expect(ids.has('scene:1')).toBe(true);
        expect(ids.has('emotion:1')).toBe(true);
        expect(ids.has('character:沈砚')).toBe(true);
        expect(ids.has('character:沈铁山')).toBe(true);
        expect(ids.has('location:断魂桥')).toBe(true);
        expect(ids.has('timeline:0')).toBe(true);
        expect(ids.has('foreshadow:F1:0')).toBe(true);
        expect(bundle.telemetry.missingRequired).toEqual([]);
        expect(bundle.telemetry.requiredIncluded).toBe(bundle.telemetry.requiredTotal);
    });

    it('本地档位优先压缩文本，云端档位保留完整文本', () => {
        const graph = buildGraph();
        const local = assembleStoryContextBundle(graph, {
            mode: 'co-write',
            tier: 'local',
            chapterNum: 1,
            scene: scene1,
            maxInputTokens: 8192,
            modelId: 'qwen2.5:7b',
        });
        const cloud = assembleStoryContextBundle(graph, {
            mode: 'co-write',
            tier: 'cloud',
            chapterNum: 1,
            scene: scene1,
            maxInputTokens: 100000,
            modelId: 'deepseek-flash',
        });

        const localChar = local.items.find(node => node.id === 'character:沈砚');
        const cloudChar = cloud.items.find(node => node.id === 'character:沈砚');
        expect(localChar?.text).not.toContain('人物背景');
        expect(localChar?.text).not.toContain('梳妆匣');
        expect(cloudChar?.text).toContain('梳妆匣');
        expect(cloud.telemetry.estimatedTokens).toBeGreaterThan(local.telemetry.estimatedTokens);

        const localLegacy = formatStoryContextLegacyVars(local);
        const cloudLegacy = formatStoryContextLegacyVars(cloud);
        expect(localLegacy.allChars).not.toContain('梳妆匣');
        expect(cloudLegacy.allChars).toContain('梳妆匣');
    });

    it('本地与云端共享同一组必含核心信息', () => {
        const graph = buildGraph();
        const local = assembleStoryContextBundle(graph, {
            mode: 'co-write',
            tier: 'local',
            chapterNum: 1,
            scene: scene1,
            maxInputTokens: 8192,
            modelId: 'qwen2.5:7b',
        });
        const cloud = assembleStoryContextBundle(graph, {
            mode: 'co-write',
            tier: 'cloud',
            chapterNum: 1,
            scene: scene1,
            maxInputTokens: 100000,
            modelId: 'deepseek-flash',
        });
        const coreIds = [
            'scene:1',
            'emotion:1',
            'character:沈砚',
            'character:沈铁山',
            'location:断魂桥',
            'timeline:0',
            'foreshadow:F1:0',
        ];
        const localIds = new Set(local.items.map(node => node.id));
        const cloudIds = new Set(cloud.items.map(node => node.id));
        for (const id of coreIds) {
            expect(localIds.has(id), `local missing ${id}`).toBe(true);
            expect(cloudIds.has(id), `cloud missing ${id}`).toBe(true);
        }
        expect(local.telemetry.missingRequired).toEqual([]);
        expect(cloud.telemetry.missingRequired).toEqual([]);
    });

    it('预算很紧时先保证必含项，再丢可选信息', () => {
        const graph = buildGraph();
        // 注入一批低优先级设定，模拟真实项目里大量未命中的设定条目
        for (let i = 0; i < 24; i++) {
            const text = `## 边缘设定${i}\n${'这是一条与当前场景无关的设定。'.repeat(6)}`;
            const node = {
                id: `setting:filler-${i}`,
                kind: 'setting' as const,
                title: `边缘设定${i}`,
                text,
                compactText: `边缘设定${i}：与当前场景无关。`,
                priority: 10,
                required: false,
                tokens: 120,
                compactTokens: 30,
                links: [],
                metadata: {},
            };
            graph.nodes.set(node.id, node);
            graph.byKind.setting.push(node);
        }
        const bundle = assembleStoryContextBundle(graph, {
            mode: 'co-write',
            tier: 'local',
            chapterNum: 1,
            scene: scene1,
            maxInputTokens: 2048,
            modelId: 'qwen2.5:7b',
        });

        const ids = new Set(bundle.items.map(node => node.id));
        expect(ids.has('character:沈砚')).toBe(true);
        expect(ids.has('location:断魂桥')).toBe(true);
        expect(ids.has('foreshadow:F1:0')).toBe(true);
        expect(bundle.telemetry.missingRequired).toEqual([]);
        expect(bundle.telemetry.dropped).toBeGreaterThan(0);
        expect(bundle.telemetry.estimatedTokens).toBeLessThanOrEqual(bundle.telemetry.budgetTokens + 200);
    });

    it('一键生成使用关联摘要，不重复完整实体文本', () => {
        const graph = buildGraph();
        const bundle = assembleStoryContextBundle(graph, {
            mode: 'one-click',
            tier: 'cloud',
            chapterNum: 1,
            maxInputTokens: 100000,
            modelId: 'deepseek-flash',
        });
        expect(bundle.formattedCrossLink).toContain('场景→人物/地点');
        expect(bundle.formattedCrossLink).toContain('伏笔→人物/主线');
        expect(bundle.formattedFull).toContain('■ 人物');
        expect(bundle.formattedFull).toContain('沈砚');
    });

    it('把信息包映射回既有模板变量', () => {
        const graph = buildGraph();
        const bundle = assembleStoryContextBundle(graph, {
            mode: 'one-click',
            tier: 'cloud',
            chapterNum: 1,
            maxInputTokens: 100000,
        });
        const legacy = formatStoryContextLegacyVars(bundle);
        expect(legacy.worldView).toContain('灵气');
        expect(legacy.settingLib).toContain('力量体系');
        expect(legacy.allChars).toContain('- 沈砚：');
        expect(legacy.allFactions).toContain('- 天阙：');
        expect(legacy.allLocs).toContain('- 断魂桥：');
        expect(legacy.allItems).toContain('- 霄晶：');
        expect(legacy.timelineEvents).toContain('清晨');
        expect(legacy.unrevealedForeshadow).toContain('月牙疤');
        expect(legacy.sceneCardDigest).toContain('【场景卡（硬约束）】');
    });
});

describe('story-context service adapters', () => {
    it('按端点/模型/显式设置解析档位', () => {
        expect(resolveStoryContextTier({ apiEndpoint: 'http://localhost:11434/v1' }, 'one-click')).toBe('local');
        expect(resolveStoryContextTier({ defaultModel: 'qwen2.5:7b' }, 'one-click')).toBe('local');
        expect(resolveStoryContextTier({ defaultModel: 'deepseek-flash' }, 'one-click')).toBe('cloud');
        // M-2：本地模式未选本地模型时生效模式为 cloud（自动切换），不再按 raw mode 给 local 档
        expect(resolveStoryContextTier({ coWriteModelMode: 'local' }, 'co-write')).toBe('cloud');
        expect(resolveStoryContextTier({
            coWriteModelMode: 'local',
            coWriteModel: 'qwen2.5:7b',
            customProviders: [{
                id: 'ollama', endpoint: 'http://localhost:11434/v1', sourceType: 'local', models: ['qwen2.5:7b'],
            }],
        }, 'co-write')).toBe('local');
        expect(resolveStoryContextTier({ coWriteModelMode: 'cloud' }, 'co-write')).toBe('cloud');
        expect(resolveStoryContextTier({ storyContextTier: 'local', defaultModel: 'deepseek-flash' }, 'one-click')).toBe('local');
    });

    it('applyStoryContextToVars 覆盖核心变量并写入遥测', () => {
        const graph = buildGraph();
        const bundle = assembleStoryContextBundle(graph, {
            mode: 'one-click',
            tier: 'cloud',
            chapterNum: 1,
            maxInputTokens: 100000,
        });
        const vars: Record<string, string> = {
            worldView: '旧世界观',
            settingLib: '旧设定库',
            allChars: '旧人物',
            storyContextPack: '',
        };
        applyStoryContextToVars(vars, bundle, { ...vars });
        expect(vars.worldView).toContain('灵气');
        expect(vars.settingLib).toContain('力量体系');
        expect(vars.allChars).toContain('沈砚');
        expect(vars.storyContextPack).toContain('场景→人物/地点');
        expect(JSON.parse(vars._storyContextTelemetry).tier).toBe('cloud');
    });

    it('attachStoryContextToSnapshot 写回协同快照', () => {
        const graph = buildGraph();
        const bundle = assembleStoryContextBundle(graph, {
            mode: 'co-write',
            tier: 'local',
            chapterNum: 1,
            scene: scene1,
            maxInputTokens: 8192,
        });
        const snapshot: Record<string, unknown> = {
            allChars: '旧人物',
            timeline: '旧时间线',
            settingLib: '旧设定库',
        };
        attachStoryContextToSnapshot(snapshot, { graph, bundle });
        expect(String(snapshot.allChars)).toContain('沈砚');
        expect(String(snapshot.timeline)).toContain('清晨');
        expect(String(snapshot.settingLib)).toContain('力量体系');
        expect(String(snapshot.storyContextPack)).toContain('故事上下文');
        expect(String(snapshot.storyContextPackCompact)).toContain('场景→人物/地点');
        expect(snapshot.storyContextTelemetry).toBeTruthy();
    });

    it('buildStoryContext 同时返回图与包', () => {
        const result = buildStoryContext({
            context: makeContext(),
            chapterName: '第1章',
            chapterNum: 1,
            volume: '第1卷',
            mode: 'one-click',
            tier: 'cloud',
            maxInputTokens: 100000,
        });
        expect(result.graph.nodes.size).toBeGreaterThan(10);
        expect(result.bundle.items.length).toBeGreaterThan(0);
        expect(result.bundle.telemetry.requiredIncluded).toBeGreaterThan(0);
    });

    it('档位 profile 在相同窗口下保持云端条目上限更高', () => {
        const local = resolveStoryContextProfile('local', 100000);
        const cloud = resolveStoryContextProfile('cloud', 100000);
        expect(cloud.maxPackTokens).toBeGreaterThan(local.maxPackTokens);
        expect(cloud.maxPerKind.character).toBeGreaterThan(local.maxPerKind.character ?? 0);
    });
});

describe('故事上下文包 — 去重口径（G2-4）', () => {
    const KINDS: StoryContextKind[] = [
        'worldview', 'setting', 'character', 'faction', 'location', 'item',
        'timeline', 'foreshadow', 'scene', 'emotion',
    ];

    function makeNode(id: string, kind: StoryContextKind, text: string): StoryContextNode {
        return {
            id,
            kind,
            title: id,
            text,
            compactText: text,
            priority: 10,
            required: false,
            tokens: 12,
            compactTokens: 12,
            links: [],
            metadata: {},
        };
    }

    function makeGraph(nodes: StoryContextNode[]): StoryContextGraph {
        const byKind = Object.fromEntries(KINDS.map(kind => [kind, [] as StoryContextNode[]])) as Record<StoryContextKind, StoryContextNode[]>;
        for (const node of nodes) byKind[node.kind].push(node);
        return {
            project: '测试书',
            chapterName: '第1章',
            chapterNum: 1,
            volume: '',
            nodes: new Map(nodes.map(node => [node.id, node])),
            byKind,
            nameIndex: new Map(),
            sourceHash: '',
            warnings: [],
        };
    }

    it('同文重复节点只入包一次，并计入 deduped / dedupeRate', () => {
        const graph = makeGraph([
            makeNode('setting:a', 'setting', '灵气从地脉升起，逆脉者会被天阙标记。'),
            makeNode('setting:b', 'setting', '灵气从地脉升起，逆脉者会被天阙标记。'),
        ]);

        const bundle = assembleStoryContextBundle(graph, {
            mode: 'one-click',
            tier: 'cloud',
            chapterNum: 1,
        });

        expect(bundle.telemetry.included).toBe(1);
        expect(bundle.telemetry.deduped).toBe(1);
        // 1 项入包 + 1 项重复 → 50%
        expect(bundle.telemetry.dedupeRate).toBe(0.5);
        expect(bundle.telemetry.droppedItems.some(item => item.reason === '内容重复')).toBe(true);
    });

    it('内容不同则不去重，比率为 0', () => {
        const graph = makeGraph([
            makeNode('setting:a', 'setting', '灵气从地脉升起，逆脉者会被天阙标记。'),
            makeNode('setting:b', 'setting', '断魂桥是砂峡唯一的通道，桥下是灰白砂雾。'),
        ]);

        const bundle = assembleStoryContextBundle(graph, {
            mode: 'one-click',
            tier: 'cloud',
            chapterNum: 1,
        });

        expect(bundle.telemetry.included).toBe(2);
        expect(bundle.telemetry.deduped).toBe(0);
        expect(bundle.telemetry.dedupeRate).toBe(0);
    });

    it('去重口径不把「预算不足丢弃」算进比率', () => {
        // 小预算 + 大文本：后面的项会因为预算被丢，但 deduped 必须是 0
        const long = '长'.repeat(2000);
        const graph = makeGraph([
            makeNode('setting:a', 'setting', long),
            makeNode('setting:b', 'setting', `${long}不同结尾`),
        ]);

        const bundle = assembleStoryContextBundle(graph, {
            mode: 'one-click',
            tier: 'local',
            chapterNum: 1,
            maxInputTokens: 2000,
        });

        expect(bundle.telemetry.deduped).toBe(0);
        expect(bundle.telemetry.dedupeRate).toBe(0);
    });
});

describe('人物卡连续性三字段（DSH-20261114-02，audit §四-2）', () => {
    function contextWithContinuity(fields: Record<string, string>): GatheredContext {
        const ctx = makeContext();
        ctx.data.character_state = [
            { name: '沈砚', 角色定位: '主角', 身份: '砂民少年', 当前状态: '养伤中', ...fields },
        ] as GatheredContext['data']['character_state'];
        return ctx;
    }

    it('伤势/持有/已知 非空时进 allChars（用户手工更新人物卡后一键可见）', () => {
        const graph = buildStoryContextGraph({
            project: '九霄逆脉行',
            chapterName: '第2章',
            chapterNum: 2,
            volume: '第1卷',
            context: contextWithContinuity({ 伤势: '左肋骨裂', 持有物品: '月牙匕', 已知信息: '知晓天阙密令' }),
        });
        const bundle = assembleStoryContextBundle(graph, {
            mode: 'one-click',
            tier: 'cloud',
            chapterNum: 2,
            maxInputTokens: 100000,
        });
        const legacy = formatStoryContextLegacyVars(bundle);
        expect(legacy.allChars).toContain('伤势：左肋骨裂');
        expect(legacy.allChars).toContain('持有：月牙匕');
        expect(legacy.allChars).toContain('已知：知晓天阙密令');
    });

    it('三字段缺省不出空标签；compact（local 档）伤势仍保留', () => {
        const empty = assembleStoryContextBundle(
            buildStoryContextGraph({
                project: '九霄逆脉行',
                chapterName: '第2章',
                chapterNum: 2,
                volume: '第1卷',
                context: contextWithContinuity({}),
            }),
            { mode: 'one-click', tier: 'local', chapterNum: 2, maxInputTokens: 4000 },
        );
        const emptyLegacy = formatStoryContextLegacyVars(empty);
        expect(emptyLegacy.allChars).not.toContain('伤势：');
        expect(emptyLegacy.allChars).not.toContain('持有：');
        expect(emptyLegacy.allChars).not.toContain('已知：');

        const injured = assembleStoryContextBundle(
            buildStoryContextGraph({
                project: '九霄逆脉行',
                chapterName: '第2章',
                chapterNum: 2,
                volume: '第1卷',
                context: contextWithContinuity({ 伤势: '左肋骨裂' }),
            }),
            { mode: 'one-click', tier: 'local', chapterNum: 2, maxInputTokens: 4000 },
        );
        // 伤势是状态连续性核心，compact 档（主角 required）也保留
        expect(formatStoryContextLegacyVars(injured).allChars).toContain('伤势：左肋骨裂');
    });
});

describe('台账稳定 ID 关联边（DSH-20261114-04，audit §四-3）', () => {
    it('稳定边连出的事件出现在伏笔交叉摘要行（人物名零重叠也可见）', () => {
        const ctx = makeContext();
        ctx.data.timeline = [{
            id: 'EV-test1',
            time: '清晨',
            chapter: '第1章',
            event: '外门考核',
            impact: '暴露体质',
            involvedEntities: ['路人甲'], // 与伏笔 relatedChars（苏婉）零重叠
        }] as unknown as GatheredContext['data']['timeline'];
        ctx.data.foreshadows = {
            unrevealed: [{
                id: 'FS-test1',
                name: '令牌的来历',
                importance: '高',
                buryChapter: '第1章',
                plannedReveal: '第3章',
                relatedChars: '苏婉',
                status: '未揭示',
            }],
            revealed: [],
            abandoned: [],
        } as GatheredContext['data']['foreshadows'];
        ctx.data.ledger_links = [{
            id: 'LNK-1', from: 'FS-test1', to: 'EV-test1', kind: 'sets-up', weight: 2, chapterNum: 1, source: 'derived',
        }];

        // 走 service（同时覆盖 data.ledger_links → source.ledgerLinks 透传与连边）
        const { graph, bundle } = buildStoryContext({
            context: ctx,
            chapterName: '第1章',
            chapterNum: 1,
            volume: '第1卷',
            mode: 'one-click',
            tier: 'cloud',
            maxInputTokens: 100000,
        });

        // 图上确有稳定边（伏笔节点 → 时间线节点，reason=ledger-stable）
        const fsNode = [...graph.nodes.values()].find(n => n.metadata?.stableId === 'FS-test1');
        expect(fsNode?.links.some(l => l.reason === 'ledger-stable' && l.targetId.startsWith('timeline:'))).toBe(true);
        // 交叉摘要：伏笔行含事件标题（名称子串匹配连不出来——苏婉不在事件 involved 里）
        expect(bundle.formattedCrossLink).toContain('外门考核');
    });

    it('无 ledger_links 时行为与原来一致（零回归）', () => {
        const graph = buildGraph();
        const bundle = assembleStoryContextBundle(graph, {
            mode: 'one-click',
            tier: 'cloud',
            chapterNum: 1,
            maxInputTokens: 100000,
        });
        // 既有图不崩、摘要照常产出（ledgerLinks 缺省 = 空）
        expect(bundle.formattedCrossLink.length).toBeGreaterThan(0);
        expect([...graph.nodes.values()].every(n =>
            !(n.links.some(l => l.reason === 'ledger-stable')),
        )).toBe(true);
    });
});
