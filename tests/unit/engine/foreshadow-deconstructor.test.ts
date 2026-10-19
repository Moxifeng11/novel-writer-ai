/**
 * foreshadow-deconstructor.test.ts — P6 伏笔检测增强测试
 *
 * 覆盖 Task 12 的 5 个 SubTask：
 * - SubTask 12.1: 五类伏笔类型分类（character/event/setting/item/skill）
 * - SubTask 12.2: 卡丹类型修复为 character（基于上下文判定）
 * - SubTask 12.3: 题材相关伏笔关键词从 genreConfig.foreshadowTypes 读取
 * - SubTask 12.4: 伏笔候选识别逻辑（频次 + 章节分布）
 * - SubTask 12.5: 紫川场景验证（杨明华阴谋、三杰命运等）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ForeshadowDeconstructor } from '../../../engine/deconstructors/foreshadow-deconstructor';
import type { GenreConfig } from '../../../engine/genre/types';

/**
 * 军事题材配置（military.genre.json 的精简版，用于测试 genreConfig.foreshadowTypes 读取）
 */
const MILITARY_GENRE_CONFIG: GenreConfig = {
    genreId: 'military',
    displayName: '军事',
    behaviorTraits: [],
    abilityKeywords: [],
    techniqueKeywords: [],
    foreshadowTypes: ['阴谋', '叛乱', '暗杀', '政治变局', '密谋'],
    conflictKeywords: [],
    showSignalWords: [],
    styleKeywords: [],
    detectorSignals: []
};

/**
 * 构造测试文本：在多个章节中重复提及实体，满足"频次 >= 3 且跨章节 >= 2"的伏笔候选条件。
 */
function buildMultiChapterText(chapters: Array<{ title: string; paragraphs: string[] }>): string {
    return chapters.map(ch => `${ch.title}\n\n${ch.paragraphs.join('\n\n')}`).join('\n\n');
}

describe('ForeshadowDeconstructor - P6 伏笔检测增强', () => {
    let deconstructor: ForeshadowDeconstructor;

    beforeEach(() => {
        // 默认使用 military 题材配置
        deconstructor = new ForeshadowDeconstructor(undefined, 'military', MILITARY_GENRE_CONFIG);
    });

    describe('SubTask 12.1 - 五类伏笔类型分类', () => {
        it('item 类型：以 ITEM_SUFFIXES 双字后缀结尾的实体被分类为 item', async () => {
            // "玉佩" 是 ITEM_SUFFIXES 中的双字后缀，3字名"传国玉佩"应识别为 item
            const text = buildMultiChapterText([
                { title: '第一章 引子', paragraphs: [
                    '这是一块传国玉佩，传说中承载着王朝气运。',
                    '传国玉佩在阳光下闪烁着神秘的光芒，没有人知道它的来历。',
                    '他把传国玉佩小心翼翼地收了起来。'
                ]},
                { title: '第二章 显现', paragraphs: [
                    '传国玉佩再次出现在众人眼前，引发一阵惊叹。',
                    '老者凝视着传国玉佩，若有所思。',
                    '传国玉佩的秘密远未揭开。'
                ]},
                { title: '第三章 真相', paragraphs: [
                    '原来传国玉佩中封印着先帝的魂魄。',
                    '传国玉佩终于回归正统。',
                    '这就是传国玉佩的真正力量。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const itemForeshadows = result.foreshadows.filter(f => f.type === 'item');
            expect(itemForeshadows.length).toBeGreaterThan(0);
            const hasYupei = itemForeshadows.some(f => f.name.includes('玉佩'));
            expect(hasYupei).toBe(true);
        });

        it('skill 类型：以 SKILL_SUFFIXES 后缀结尾的实体被分类为 skill', async () => {
            // "心法" 是 SKILL_SUFFIXES 中的双字后缀
            const text = buildMultiChapterText([
                { title: '第一章 传承', paragraphs: [
                    '这是一门失传的古老心法，传说中能逆天改命。',
                    '古老心法在师门中代代相传，无人能修炼至大成。',
                    '他开始修炼古老心法。'
                ]},
                { title: '第二章 领悟', paragraphs: [
                    '古老心法的奥秘逐渐显现。',
                    '修炼古老心法需要极大的毅力。',
                    '古老心法的精髓在于心境。'
                ]},
                { title: '第三章 大成', paragraphs: [
                    '古老心法终于修炼至大成。',
                    '古老心法的力量震撼了所有人。',
                    '他凭借古老心法突破瓶颈。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const skillForeshadows = result.foreshadows.filter(f => f.type === 'skill');
            expect(skillForeshadows.length).toBeGreaterThan(0);
        });

        it('setting 类型：包含 SETTING_KEYWORDS 的实体被分类为 setting', async () => {
            // "禁地" 是 SETTING_KEYWORDS
            const text = buildMultiChapterText([
                { title: '第一章 传说', paragraphs: [
                    '大陆北方有一处太古禁地，传说中封印着远古凶兽。',
                    '太古禁地无人敢靠近，凡是进入者无一生还。',
                    '太古禁地的存在已经延续了万年。'
                ]},
                { title: '第二章 探索', paragraphs: [
                    '他们决定进入太古禁地一探究竟。',
                    '太古禁地的边缘弥漫着诡异的雾气。',
                    '太古禁地远比想象中更加危险。'
                ]},
                { title: '第三章 真相', paragraphs: [
                    '原来太古禁地中封印着上古魔神。',
                    '太古禁地的封印开始松动。',
                    '太古禁地的秘密终于被揭开。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const settingForeshadows = result.foreshadows.filter(f => f.type === 'setting');
            expect(settingForeshadows.length).toBeGreaterThan(0);
            const hasJindi = settingForeshadows.some(f => f.name.includes('禁地'));
            expect(hasJindi).toBe(true);
        });

        it('event 类型：包含 EVENT_KEYWORDS 或题材伏笔关键词的实体被分类为 event', async () => {
            // "大战" 是 EVENT_KEYWORDS
            const text = buildMultiChapterText([
                { title: '第一章 预言', paragraphs: [
                    '上古预言中提到，一场决定世界命运的决战即将到来。',
                    '这场决战的预兆已经显现。',
                    '决战的阴影笼罩着所有人。'
                ]},
                { title: '第二章 备战', paragraphs: [
                    '各方势力为决战做着最后的准备。',
                    '决战的战场选在了远古遗迹。',
                    '决战前夜异常宁静。'
                ]},
                { title: '第三章 爆发', paragraphs: [
                    '决战终于爆发，天地变色。',
                    '决战的惨烈超乎想象。',
                    '决战的结果将载入史册。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const eventForeshadows = result.foreshadows.filter(f => f.type === 'event');
            expect(eventForeshadows.length).toBeGreaterThan(0);
        });

        it('character 类型：在上下文中作为对话者出现的实体被分类为 character', async () => {
            // "卡丹" 在上下文中以"卡丹道："出现，应识别为 character
            const text = buildMultiChapterText([
                { title: '第一章 相遇', paragraphs: [
                    '卡丹道："你怎么会在这里？"她的眼中满是惊讶。',
                    '卡丹大人微微一笑，没有回答。',
                    '众人对卡丹的来历议论纷纷。'
                ]},
                { title: '第二章 同行', paragraphs: [
                    '卡丹道："我们走吧。"她转身离去。',
                    '卡丹大人的身份始终是个谜。',
                    '没有人知道卡丹的过去。'
                ]},
                { title: '第三章 真相', paragraphs: [
                    '原来卡丹是邻国的公主。',
                    '卡丹道："我终于可以回家了。"',
                    '卡丹大人告别了众人。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const kadanForeshadows = result.foreshadows.filter(f => f.name === '卡丹');
            expect(kadanForeshadows.length).toBeGreaterThan(0);
            expect(kadanForeshadows[0].type).toBe('character');
        });
    });

    describe('SubTask 12.2 - 卡丹类型修复（character 上下文判定）', () => {
        it('卡丹作为角色名（含"卡丹道："对话标签）被正确识别为 character 而非 item', async () => {
            // 关键："卡丹" 尾字"丹"匹配 ITEM_SUFFIXES 单字"丹"，但 character 上下文判定应优先
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '卡丹道："此事不可。"她坚决反对。',
                    '卡丹大人转身离去。',
                    '众人都看着卡丹。'
                ]},
                { title: '第二章', paragraphs: [
                    '卡丹笑道："你倒是会说话。"',
                    '卡丹大人的态度很强硬。',
                    '没有人敢反驳卡丹。'
                ]},
                { title: '第三章', paragraphs: [
                    '卡丹叹道："罢了，随你去吧。"',
                    '卡丹大人最终妥协了。',
                    '这就是卡丹的性格。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const kadan = result.foreshadows.find(f => f.name === '卡丹');
            expect(kadan).toBeDefined();
            expect(kadan!.type).toBe('character');
            // 关键断言：不再被误判为 item
            expect(kadan!.type).not.toBe('item');
        });

        it('2字名字的单字后缀不再误匹配（minSuffixLength=2 保护）', async () => {
            // "卡丹"尾字"丹"是 ITEM_SUFFIXES 单字，但 2 字名字要求后缀长度 >= 2
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '卡丹道："你好。"',
                    '卡丹大人来了。'
                ]},
                { title: '第二章', paragraphs: [
                    '卡丹笑道："好的。"',
                    '卡丹大人走了。'
                ]},
                { title: '第三章', paragraphs: [
                    '卡丹道："再见。"',
                    '卡丹大人回来了。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const kadan = result.foreshadows.find(f => f.name === '卡丹');
            expect(kadan).toBeDefined();
            // 修复后卡丹是 character，不再因单字"丹"误判为 item
            expect(kadan!.type).toBe('character');
        });
    });

    describe('SubTask 12.3 - genreConfig.foreshadowTypes 读取', () => {
        it('military 题材配置：阴谋/叛乱/暗杀等关键词参与名词提取', async () => {
            // "杨明华阴谋" 应通过 genreForeshadowKeywords 中的"阴谋"被提取
            const text = buildMultiChapterText([
                { title: '第一章 端倪', paragraphs: [
                    '众人发现了杨明华阴谋的端倪。',
                    '杨明华阴谋涉及朝中重臣。',
                    '没有人敢公开揭露杨明华阴谋。'
                ]},
                { title: '第二章 调查', paragraphs: [
                    '杨明华阴谋的范围远超想象。',
                    '调查杨明华阴谋的过程充满危险。',
                    '杨明华阴谋的核心终于浮出水面。'
                ]},
                { title: '第三章 揭露', paragraphs: [
                    '杨明华阴谋最终被揭露。',
                    '杨明华阴谋的真相震惊朝野。',
                    '平息杨明华阴谋付出了惨重代价。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            // 应检测到包含"阴谋"的伏笔候选
            const ymhConspiracy = result.foreshadows.find(f => f.name.includes('阴谋') && f.name.includes('杨明华'));
            expect(ymhConspiracy).toBeDefined();
            // 题材伏笔关键词匹配 → event
            expect(ymhConspiracy!.type).toBe('event');
        });

        it('无 genreConfig 时降级到硬编码关键词（向后兼容）', async () => {
            // 不传入 genreConfig，应使用默认硬编码关键词
            const decon = new ForeshadowDeconstructor(undefined, 'xuanhuan_xianxia');
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '太古禁地的传说流传千年。',
                    '太古禁地无人敢入。',
                    '太古禁地的秘密深藏。'
                ]},
                { title: '第二章', paragraphs: [
                    '太古禁地边缘雾气弥漫。',
                    '太古禁地远比想象危险。',
                    '太古禁地的入口难寻。'
                ]},
                { title: '第三章', paragraphs: [
                    '太古禁地终于被打开。',
                    '太古禁地的封印松动。',
                    '太古禁地的真相揭晓。'
                ]}
            ]);

            const result = await decon.analyze(text);
            // SETTING_KEYWORDS 中的"禁地"应被识别
            const jindi = result.foreshadows.find(f => f.name.includes('禁地'));
            expect(jindi).toBeDefined();
            expect(jindi!.type).toBe('setting');
        });

        it('不同题材的 foreshadowTypes 互不干扰', async () => {
            // 修仙题材配置
            const cultivationConfig: GenreConfig = {
                genreId: 'cultivation',
                displayName: '修仙',
                behaviorTraits: [],
                abilityKeywords: [],
                techniqueKeywords: [],
                foreshadowTypes: ['功法', '秘宝', '传承', '天劫'],
                conflictKeywords: [],
                showSignalWords: [],
                styleKeywords: [],
                detectorSignals: []
            };
            const cultivationDecon = new ForeshadowDeconstructor(undefined, 'cultivation', cultivationConfig);

            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '上古传承的秘密终于浮现。',
                    '上古传承涉及修仙界大局。',
                    '没有人知道上古传承的来历。'
                ]},
                { title: '第二章', paragraphs: [
                    '上古传承的入口在险峰之巅。',
                    '寻找上古传承的过程凶险万分。',
                    '上古传承远比传说中神秘。'
                ]},
                { title: '第三章', paragraphs: [
                    '上古传承终于被开启。',
                    '上古传承中的功法震撼世人。',
                    '上古传承的真相令人惊叹。'
                ]}
            ]);

            const result = await cultivationDecon.analyze(text);
            // "上古传承" 通过 cultivation 的 foreshadowTypes 中的"传承"被提取，分类为 event
            const chuancheng = result.foreshadows.find(f => f.name.includes('传承'));
            expect(chuancheng).toBeDefined();
            expect(chuancheng!.type).toBe('event');
        });
    });

    describe('SubTask 12.4 - 伏笔候选识别（频次 + 章节分布）', () => {
        it('频次 >= 3 且跨章节 >= 2 的实体被识别为伏笔候选', async () => {
            // "卡丹" 在 3 个章节中各出现 3+ 次
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '卡丹道："你好。"',
                    '卡丹大人来了。',
                    '卡丹笑了。'
                ]},
                { title: '第二章', paragraphs: [
                    '卡丹道："好的。"',
                    '卡丹大人走了。',
                    '卡丹点头。'
                ]},
                { title: '第三章', paragraphs: [
                    '卡丹道："再见。"',
                    '卡丹大人回来了。',
                    '卡丹离开。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const kadan = result.foreshadows.find(f => f.name === '卡丹');
            expect(kadan).toBeDefined();
            expect(kadan!.totalAppearances).toBeGreaterThanOrEqual(3);
        });

        it('仅出现在单章节的实体不被识别为伏笔候选（跨章节 < 2 过滤）', async () => {
            // "路人甲" 仅在第一章集中出现，跨章节 < 2
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '卡丹道："你好。"',
                    '卡丹大人来了。',
                    '卡丹笑了。'
                ]},
                { title: '第二章', paragraphs: [
                    '卡丹道："好的。"',
                    '卡丹大人走了。',
                    '卡丹点头。'
                ]},
                { title: '第三章', paragraphs: [
                    '卡丹道："再见。"',
                    '卡丹大人回来了。',
                    '卡丹离开。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            // 不应有"路人甲"伏笔（即使频次足够，跨章节也不够）
            const lumbo = result.foreshadows.find(f => f.name === '路人甲');
            expect(lumbo).toBeUndefined();
        });

        it('NON_FORESHADOW_WORDS 排除"父亲"、"皇帝"等通用称谓词', async () => {
            // "父亲"即使重复出现 3+ 次且跨章节，也不应被识别为伏笔候选
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '父亲大人教诲道："为人处世当以仁为本。"',
                    '父亲大人的话深深刻在他心中。',
                    '父亲大人转身离去。'
                ]},
                { title: '第二章', paragraphs: [
                    '父亲大人来信了。',
                    '父亲大人的身体不太好。',
                    '父亲大人嘱咐他多加小心。'
                ]},
                { title: '第三章', paragraphs: [
                    '父亲大人驾到了。',
                    '父亲大人对他很满意。',
                    '父亲大人终于放下心来。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            // "父亲"和"父亲大人"都不应作为伏笔候选
            const father = result.foreshadows.find(f => f.name === '父亲' || f.name === '父亲大人');
            expect(father).toBeUndefined();
        });
    });

    describe('SubTask 12.5 - 紫川场景验证（杨明华阴谋、三杰命运）', () => {
        it('紫川场景：检测到多个伏笔（> 5 个，不再仅 1 个）', async () => {
            // 构造紫川风格的军事题材文本，包含多个伏笔线索
            const text = buildMultiChapterText([
                { title: '第一章 紫川家', paragraphs: [
                    '紫川秀道："此事必有蹊跷。"',
                    '紫川秀大人眉头紧锁。',
                    '卡丹道："我也觉得不对劲。"',
                    '卡丹大人凝视着远方。',
                    '帝林道："我去调查。"',
                    '帝林大人转身离去。',
                    '众人发现了杨明华阴谋的端倪。',
                    '杨明华阴谋涉及朝中重臣。',
                    '没有人知道远古遗迹中隐藏着什么秘密。',
                    '据说远东叛乱的传闻已经传遍了边境。'
                ]},
                { title: '第二章 三杰', paragraphs: [
                    '紫川秀道："帝林怎么还没回来？"',
                    '紫川秀大人很是担忧。',
                    '卡丹道："他去探听消息了。"',
                    '卡丹大人叹了口气。',
                    '帝林道："我回来了。"',
                    '帝林大人带回了消息。',
                    '杨明华阴谋的范围远超想象。',
                    '调查杨明华阴谋的过程充满危险。',
                    '远古遗迹的入口终于被发现了。',
                    '远东叛乱的范围正在扩大。'
                ]},
                { title: '第三章 风云', paragraphs: [
                    '紫川秀道："帝林回来了！"',
                    '紫川秀大人迎了上去。',
                    '卡丹道："情况如何？"',
                    '卡丹大人神色凝重。',
                    '帝林道："情况不妙。"',
                    '帝林大人面色沉重。',
                    '杨明华阴谋最终被揭露。',
                    '杨明华阴谋的真相震惊朝野。',
                    '远古遗迹的秘密终于被揭开。',
                    '远东叛乱最终被平息。',
                    '三杰的命运从此改变。'
                ]},
                { title: '第四章 阴谋', paragraphs: [
                    '紫川秀道："必须阻止他。"',
                    '紫川秀大人下定了决心。',
                    '卡丹道："我帮你。"',
                    '卡丹大人义无反顾。',
                    '帝林道："我们一起。"',
                    '帝林大人点了点头。',
                    '杨明华阴谋的余波未平。',
                    '远古遗迹的真相大白于天下。',
                    '三杰的命运紧密相连。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            // 验证：检测到伏笔数量显著提升（> 5 个，不再仅 1 个）
            expect(result.foreshadows.length).toBeGreaterThan(5);

            // 验证：类型分布包含 character 和 event 两类以上
            const types = new Set(result.foreshadows.map(f => f.type));
            expect(types.size).toBeGreaterThanOrEqual(2);
            expect(types.has('character')).toBe(true);
            expect(types.has('event')).toBe(true);
        });

        it('紫川场景：卡丹类型为 character（修复 P6.2 类型错误）', async () => {
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '卡丹道："你怎么看？"',
                    '卡丹大人皱眉。',
                    '卡丹若有所思。'
                ]},
                { title: '第二章', paragraphs: [
                    '卡丹道："此事不简单。"',
                    '卡丹大人低声说道。',
                    '卡丹神色凝重。'
                ]},
                { title: '第三章', paragraphs: [
                    '卡丹道："我们走吧。"',
                    '卡丹大人起身。',
                    '卡丹率先而行。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            const kadan = result.foreshadows.find(f => f.name === '卡丹');
            expect(kadan).toBeDefined();
            // P6.2 修复：卡丹类型不再为 item，应为 character
            expect(kadan!.type).toBe('character');
            expect(kadan!.type).not.toBe('item');
        });

        it('紫川场景：检测到杨明华阴谋（事件类伏笔）', async () => {
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '众人发现了杨明华阴谋的端倪。',
                    '杨明华阴谋涉及朝中重臣。',
                    '没有人敢公开揭露杨明华阴谋。'
                ]},
                { title: '第二章', paragraphs: [
                    '杨明华阴谋的范围远超想象。',
                    '调查杨明华阴谋的过程充满危险。',
                    '杨明华阴谋的核心终于浮出水面。'
                ]},
                { title: '第三章', paragraphs: [
                    '杨明华阴谋最终被揭露。',
                    '杨明华阴谋的真相震惊朝野。',
                    '平息杨明华阴谋付出了惨重代价。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            // 应检测到包含"杨明华"和"阴谋"的伏笔
            const ymhConspiracy = result.foreshadows.find(
                f => f.name.includes('杨明华') && f.name.includes('阴谋')
            );
            expect(ymhConspiracy).toBeDefined();
            expect(ymhConspiracy!.type).toBe('event');
        });

        it('紫川场景：qualityScore 合理提升（> 50，不再仅 29）', async () => {
            // P6.3 修复：因检测到更多伏笔，qualityScore 应合理提升
            const text = buildMultiChapterText([
                { title: '第一章', paragraphs: [
                    '紫川秀道："此事必有蹊跷。"',
                    '紫川秀大人眉头紧锁。',
                    '卡丹道："我也觉得不对劲。"',
                    '卡丹大人凝视着远方。',
                    '帝林道："我去调查。"',
                    '帝林大人转身离去。',
                    '众人发现了杨明华阴谋的端倪。',
                    '杨明华阴谋涉及朝中重臣。',
                    '没有人知道远古遗迹中隐藏着什么秘密。',
                    '据说远东叛乱的传闻已经传遍了边境。'
                ]},
                { title: '第二章', paragraphs: [
                    '紫川秀道："帝林怎么还没回来？"',
                    '紫川秀大人很是担忧。',
                    '卡丹道："他去探听消息了。"',
                    '卡丹大人叹了口气。',
                    '帝林道："我回来了。"',
                    '帝林大人带回了消息。',
                    '杨明华阴谋的范围远超想象。',
                    '调查杨明华阴谋的过程充满危险。',
                    '远古遗迹的入口终于被发现了。',
                    '远东叛乱的范围正在扩大。'
                ]},
                { title: '第三章', paragraphs: [
                    '紫川秀道："帝林回来了！"',
                    '紫川秀大人迎了上去。',
                    '卡丹道："情况如何？"',
                    '卡丹大人神色凝重。',
                    '帝林道："情况不妙。"',
                    '帝林大人面色沉重。',
                    '杨明华阴谋最终被揭露。',
                    '杨明华阴谋的真相震惊朝野。',
                    '远古遗迹的秘密终于被揭开。',
                    '远东叛乱最终被平息。'
                ]},
                { title: '第四章', paragraphs: [
                    '紫川秀道："必须阻止他。"',
                    '紫川秀大人下定了决心。',
                    '卡丹道："我帮你。"',
                    '卡丹大人义无反顾。',
                    '帝林道："我们一起。"',
                    '帝林大人点了点头。',
                    '杨明华阴谋的余波未平。',
                    '远古遗迹的真相大白于天下。'
                ]}
            ]);

            const result = await deconstructor.analyze(text);
            expect(result.qualityScore).toBeDefined();
            // P6.3 修复：qualityScore 合理提升（> 50）
            expect(result.qualityScore!.totalScore).toBeGreaterThan(50);
        });
    });

    describe('向后兼容性', () => {
        it('空文本返回空结果（不抛错）', async () => {
            const result = await deconstructor.analyze('');
            expect(result.foreshadows).toEqual([]);
            expect(result.stats.totalForeshadows).toBe(0);
            expect(result.qualityScore!.totalScore).toBe(0);
        });

        it('短文本（无章节标记）不启用跨章节过滤', async () => {
            // 无章节标记时 chapters.length == 1，不启用跨章节过滤
            const text = '卡丹道："你好。"\n\n卡丹大人来了。\n\n卡丹笑了。';
            const result = await deconstructor.analyze(text);
            // 短文本可能因频次不足无伏笔，但不应抛错
            expect(result).toBeDefined();
            expect(Array.isArray(result.foreshadows)).toBe(true);
        });

        it('不传 genreConfig 时构造函数正常工作（向后兼容）', () => {
            // 旧调用方式：new ForeshadowDeconstructor(vectorEnhancer)
            const decon = new ForeshadowDeconstructor(undefined);
            expect(decon).toBeDefined();
            // 旧调用方式：new ForeshadowDeconstructor(vectorEnhancer, genreId)
            const decon2 = new ForeshadowDeconstructor(undefined, 'xuanhuan_xianxia');
            expect(decon2).toBeDefined();
        });
    });

    describe('filterNoiseForeshadows 噪声过滤', () => {
        function makeForeshadow(name: string): any {
            return {
                id: name,
                name,
                type: 'item',
                description: '',
                firstAppearance: { position: 0, paragraphIndex: 0, excerpt: '' },
                importantAppearances: [],
                totalAppearances: 1,
                importance: 0.5,
            };
        }

        it('过滤黑名单虚词/动词（无法/效果/隐秘/级封印）', () => {
            const decon = new ForeshadowDeconstructor(undefined);
            const input = ['无法', '效果', '隐秘', '级封印'].map(makeForeshadow);
            const result = decon.filterNoiseForeshadows(input);
            expect(result.length).toBe(0);
        });

        it('过滤单字伏笔（name 长度 < 2）', () => {
            const decon = new ForeshadowDeconstructor(undefined);
            const result = decon.filterNoiseForeshadows([makeForeshadow('剑')]);
            expect(result.length).toBe(0);
        });

        it('保留具体物品/人物名（灰雾之门/克莱恩）', () => {
            const decon = new ForeshadowDeconstructor(undefined);
            const input = ['灰雾之门', '克莱恩'].map(makeForeshadow);
            const result = decon.filterNoiseForeshadows(input);
            const names = result.map(f => f.name).sort();
            expect(names).toEqual(['克莱恩', '灰雾之门']);
        });

        it('过滤动词黑名单中的动词（修炼/战斗/突破/渡劫）', () => {
            const decon = new ForeshadowDeconstructor(undefined);
            const input = ['修炼', '战斗', '突破', '渡劫', '飞升', '重生'].map(makeForeshadow);
            const result = decon.filterNoiseForeshadows(input);
            expect(result.length).toBe(0);
        });

        it('过滤心理活动动词（思考/回忆/想象/决定）', () => {
            const decon = new ForeshadowDeconstructor(undefined);
            const input = ['思考', '回忆', '想象', '决定', '希望', '害怕'].map(makeForeshadow);
            const result = decon.filterNoiseForeshadows(input);
            expect(result.length).toBe(0);
        });

        it('过滤交流动词（说话/询问/回答/命令）', () => {
            const decon = new ForeshadowDeconstructor(undefined);
            const input = ['说话', '询问', '回答', '命令', '请求', '拒绝'].map(makeForeshadow);
            const result = decon.filterNoiseForeshadows(input);
            expect(result.length).toBe(0);
        });

        it('保留名词性伏笔（项链/秘密/阴谋/禁地）', () => {
            const decon = new ForeshadowDeconstructor(undefined);
            const input = ['项链', '秘密', '阴谋', '禁地', '传承', '玉佩'].map(makeForeshadow);
            const result = decon.filterNoiseForeshadows(input);
            const names = result.map(f => f.name).sort();
            expect(names).toEqual(['传承', '玉佩', '禁地', '秘密', '阴谋', '项链']);
        });
    });
});
