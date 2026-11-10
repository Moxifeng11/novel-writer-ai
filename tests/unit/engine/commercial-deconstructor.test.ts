import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CommercialDeconstructor } from '../../../engine/deconstructors/commercial-deconstructor';

/**
 * 真实样本只在开发者本机存在；缺失时必须显示 skipped，而不是 console.warn + return
 * 伪装成通过（覆盖率/契约审计 T-1）。
 */
function loadZiChuanSample(): string | null {
    const candidates = [
        join(process.cwd(), '../../../写作知识库/紫川/紫川.txt'),
        join(process.cwd(), '../../../../写作知识库/紫川/紫川.txt'),
        join(__dirname, '../../../../../../写作知识库/紫川/紫川.txt'),
    ];
    for (const candidate of candidates) {
        try {
            const buffer = readFileSync(candidate);
            return buffer.toString('utf-8', 0, Math.min(buffer.length, 60000));
        } catch {
            // 继续尝试下一个路径
        }
    }
    return null;
}

const ZI_CHUAN_SAMPLE = loadZiChuanSample();

/**
 * P1 章节分割修复测试
 *
 * 背景：拆解《紫川》时 firstChapter.wordCount=3（实际应 14000+）
 * 根因：splitChapters 正则 /第[一二三四五六七八九十百千零\d]+[章节部卷]/g
 *       1. 无 ^ 行锚定，会匹配正文中的"第N章"数字片段
 *       2. 同时匹配"章"和"节"，紫川使用"第一章+第一节"层级，
 *          导致"第一章"被"第一节"切断，内容只剩分隔符
 * 修复：加 ^ 行锚定；检测"章"存在时"节"不作为分章点
 */
describe('CommercialDeconstructor - P1 章节分割修复', () => {
    describe('单元测试：章节分割逻辑（通过 validateGoldenThreeChapters 间接验证）', () => {
        it('紫川格式（章+节层级）：第一章应包含所有子节内容，不被第一节切断', () => {
            // 模拟紫川的"第一章 + 第一节 + 第二节 + 第二章"层级结构
            const body1 = '紫川秀站在山冈上看着远方的战场。'.repeat(50);
            const body2 = '白川副旗本策马奔向后方营地。'.repeat(50);
            const body3 = '帝林在远处的营帐中谋划着下一步行动。'.repeat(50);

            const text = `第一章

------------
第一节 胜利

${body1}

------------
第二节 失败

${body2}

第二章

------------
第一节 新的开始

${body3}`;

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateGoldenThreeChapters(text);

            // 修复前：第一章被"第一节"切断，wordCount ≈ 3
            // 修复后：第一章包含所有子节内容，wordCount 应远大于 3
            expect(result.details.firstChapter.wordCount).toBeGreaterThan(100);
        });

        it('只有"节"格式：节作为顶级章节单位被正确识别', () => {
            const body1 = '这是第一节的内容。'.repeat(30);
            const body2 = '这是第二节的内容。'.repeat(30);
            const body3 = '这是第三节的内容。'.repeat(30);

            const text = `第一节 开始

${body1}

第二节 发展

${body2}

第三节 高潮

${body3}`;

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateGoldenThreeChapters(text);

            // 没有"章"时，"节"应作为分章点
            expect(result.details.firstChapter.wordCount).toBeGreaterThan(10);
        });

        it('只有"章"格式：正常分章，第二章起始位置正确', () => {
            // 注意：正文不能以"第N章"开头，否则会被误匹配为章节标题
            const body1 = '这是开端的正文内容，描述故事开始。'.repeat(50);
            const body2 = '这是发展的正文内容，故事正在推进。'.repeat(50);
            const body3 = '这是结局的正文内容，故事即将结束。'.repeat(50);

            const text = `第一章 开端

${body1}

第二章 发展

${body2}

第三章 结局

${body3}`;

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateGoldenThreeChapters(text);

            // 三章都应有合理的 wordCount
            expect(result.details.firstChapter.wordCount).toBeGreaterThan(10);
            expect(result.details.secondChapter.wordCount).toBeGreaterThan(10);
            expect(result.details.thirdChapter.wordCount).toBeGreaterThan(10);
        });

        it('无章节标记：返回空结果，不误匹配正文中的数字片段', () => {
            // 正文中有"第三者"、"第8连"等，但不是章节标题
            const text = '这是一段正文，其中提到第三者和第8连的战斗，但不是章节标题。这是一段很长的正文内容。';

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateGoldenThreeChapters(text);

            // 无章节标记应返回空结果（totalScore=0）
            expect(result.totalScore).toBe(0);
        });

        it('章节标题不在行首：不被误匹配为章节分割点', () => {
            // "第一章"出现在正文中而非行首，不应被识别为章节标题
            const text = `引子

这是引子的内容，其中提到第一章的主角已经开始行动。这段话很长，应该不被切分。

正文

这是正文内容，继续讲述故事。`;

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateGoldenThreeChapters(text);

            // 不应将"第一章"误识别为章节分割点
            // 由于没有行首的章节标题，应返回空结果或单章节
            expect(result.totalScore).toBe(0);
        });
    });

    describe('集成测试：紫川真实样本', () => {
        it.skipIf(ZI_CHUAN_SAMPLE === null)('紫川前 20000 字样本：第一章 wordCount > 5000（实际 14000+）', () => {
            const text = ZI_CHUAN_SAMPLE!;

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateGoldenThreeChapters(text);

            // 修复前：firstChapter.wordCount = 3
            // 修复后：firstChapter.wordCount > 5000（实际 14000+）
            expect(result.details.firstChapter.wordCount).toBeGreaterThan(5000);
        });

        it.skipIf(ZI_CHUAN_SAMPLE === null)('紫川前 20000 字样本：总章节数合理（至少 2 章）', () => {
            const text = ZI_CHUAN_SAMPLE!;

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateGoldenThreeChapters(text);

            // 紫川前 20000 字至少应包含 2 章（第一章 + 第二章在第 761 行）
            // 通过 secondChapter.wordCount > 0 判断第二章存在
            expect(result.details.secondChapter.wordCount).toBeGreaterThan(0);
        });
    });
});

/**
 * P7 商业评分修复测试
 *
 * 背景：
 * - P7.2 openingConflict=0：原文开头有战斗场景（魔族溃退），但冲突词未区分题材
 *   根因：原 CONFLICT_WORDS 通用列表虽含"厮杀"等词，但未从 genreConfig.conflictKeywords 读取
 *   修复：constructor 接收 genreConfig，analyze 自动识别题材，mergeGenreConflictWords 合并题材冲突词
 * - P7.4 waveRhythm 全是 0：validateWaveRhythm 直接返回空对象，未实际计算
 *   修复：重写 validateWaveRhythm，按章统计三类关键词命中数，计算间隔与合规度
 *
 * 接入指引：
 *   import { GenreDetector, GenreConfigRegistry } from '../../genre';
 *   const config = GenreConfigRegistry.getInstance().getGenreConfig('military');
 *   new CommercialDeconstructor(undefined, config);
 *   // 或 new CommercialDeconstructor() 在 analyze 时自动识别题材
 */
describe('CommercialDeconstructor - P7 商业评分修复', () => {
    describe('SubTask 13.2: openingConflict 从 genreConfig.conflictKeywords 读取', () => {
        it('注入 military genreConfig：厮杀/溃退 等军事冲突词被纳入检测', () => {
            // 构造一段军事冲突场景，使用 military.conflictKeywords 中的词
            const text = `第一章 魔族溃退

魔族大军在远征军的厮杀下溃退，紫川秀站在山冈上看着战场的尸体。
围攻帝都的魔族军团被冲锋的骑兵冲散，战斗持续了三天三夜。
无数士兵倒在血泊中，杀声震天，攻守双方伤亡惨重。`;

            // 不传 genreConfig：使用通用 CONFLICT_WORDS（已含"厮杀/战斗/战/杀/攻/守"，但不含"溃退/围攻/冲锋"）
            const deconstructorNoGenre = new CommercialDeconstructor();
            const resultNoGenre = deconstructorNoGenre.validateGoldenThreeChapters(text);

            // 传入 military genreConfig：合并厮杀/溃退/围攻/冲锋/战斗/战/杀/攻/守
            const militaryConfig = {
                genreId: 'military',
                displayName: '军事',
                behaviorTraits: [],
                abilityKeywords: [],
                techniqueKeywords: [],
                foreshadowTypes: [],
                conflictKeywords: ['厮杀', '溃退', '围攻', '冲锋', '战斗', '战', '杀', '攻', '守'],
                showSignalWords: [],
                styleKeywords: [],
                detectorSignals: []
            };
            const deconstructorWithGenre = new CommercialDeconstructor(undefined, militaryConfig);
            const resultWithGenre = deconstructorWithGenre.validateGoldenThreeChapters(text);

            // 两端都应 > 0（通用 CONFLICT_WORDS 也含"厮杀/战斗"等）
            expect(resultNoGenre.subScores.openingConflict).toBeGreaterThan(0);
            expect(resultWithGenre.subScores.openingConflict).toBeGreaterThan(0);

            // 注入 military genreConfig 后冲突词更全，分数应 >= 不注入时的分数
            expect(resultWithGenre.subScores.openingConflict).toBeGreaterThanOrEqual(
                resultNoGenre.subScores.openingConflict
            );
        });

        it('注入 cultivation genreConfig：斗法/渡劫 等修仙冲突词被纳入检测', () => {
            // 构造一段修仙斗法场景，使用 cultivation.conflictKeywords 中的词
            const text = `第一章 渡劫失败

李长青在渡劫时遭到魔修斗法围攻，雷劫与法术交织在一起。
他咬牙厮杀出一条血路，灵力几乎耗尽。`;

            const cultivationConfig = {
                genreId: 'cultivation',
                displayName: '修仙',
                behaviorTraits: [],
                abilityKeywords: [],
                techniqueKeywords: [],
                foreshadowTypes: [],
                conflictKeywords: ['斗法', '渡劫', '厮杀', '围攻'],
                showSignalWords: [],
                styleKeywords: [],
                detectorSignals: []
            };
            const deconstructor = new CommercialDeconstructor(undefined, cultivationConfig);
            const result = deconstructor.validateGoldenThreeChapters(text);

            // 修仙冲突词"斗法/渡劫/厮杀/围攻"应被检测到
            expect(result.subScores.openingConflict).toBeGreaterThan(0);
        });

        it('未注入 genreConfig：通过 GenreDetector 自动识别题材并合并冲突词', async () => {
            // 构造一段明显的军事场景（含 detectorSignals 中的词）
            const body = '魔族军团溃退，统帅命令冲锋，将军率领骑兵厮杀。'.repeat(20);
            const text = `第一章 魔族溃退

${body}`;

            const deconstructor = new CommercialDeconstructor();
            await deconstructor.analyze(text);

            // 自动识别后应合并 military 冲突词（无需手动断言 genreId，只验证 openingConflict 行为）
            const result = deconstructor.validateGoldenThreeChapters(text);
            expect(result.subScores.openingConflict).toBeGreaterThan(0);
        });
    });

    describe('SubTask 13.3: waveRhythm 计算修复（不再全为 0）', () => {
        it('带章节的文本：complianceRate > 0 且各项间隔不全为 0', () => {
            // 构造 3 章，每章都包含小爽点/中型反转/大型高潮关键词
            const ch1 = '紫川秀大获全胜，敌人不料被反杀，全军覆没。'.repeat(20);
            const ch2 = '帝林反击成功，谁知陷阱埋伏，大决战血战到底。'.repeat(20);
            const ch3 = '斯特林突破重围，突然逆转，最终巅峰高潮。'.repeat(20);

            const text = `第一章 胜利

${ch1}

第二章 反转

${ch2}

第三章 高潮

${ch3}`;

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateWaveRhythm(text);

            // complianceRate > 0（修复前为 0）
            expect(result.complianceRate).toBeGreaterThan(0);
            // 至少一项间隔 > 0（修复前全为 0）
            const nonZeroIntervals = [
                result.smallCoolPointInterval,
                result.mediumReversalInterval,
                result.bigClimaxInterval
            ].filter(v => v > 0).length;
            expect(nonZeroIntervals).toBeGreaterThan(0);
        });

        it('空文本：返回全 0 的 waveRhythm', () => {
            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateWaveRhythm('');

            expect(result.complianceRate).toBe(0);
            expect(result.smallCoolPointInterval).toBe(0);
            expect(result.mediumReversalInterval).toBe(0);
            expect(result.bigClimaxInterval).toBe(0);
            expect(result.violations).toEqual([]);
        });

        it('无章节标记的文本：splitChapters 返回空，waveRhythm 全为 0', () => {
            const text = '这是一段没有章节标记的正文，虽然提到了胜利和反转，但无法分章。';
            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateWaveRhythm(text);

            // 无章节标记时 splitChapters 返回空数组，waveRhythm 应全为 0
            expect(result.complianceRate).toBe(0);
            expect(result.smallCoolPointInterval).toBe(0);
        });

        it('间隔计算：N 章中 M 章命中关键词，间隔 = N / M', () => {
            // 4 章，其中 2 章有小爽点词（"胜利"），间隔应为 4/2 = 2
            const ch1 = '紫川秀取得胜利，敌人溃退。'.repeat(20);
            const ch2 = '帝林按兵不动，没有冲突。'.repeat(20);
            const ch3 = '斯特林大获全胜，反击成功。'.repeat(20);
            const ch4 = '白川在营地休息，平静无事。'.repeat(20);

            const text = `第一章 胜

${ch1}

第二章 静

${ch2}

第三章 胜

${ch3}

第四章 静

${ch4}`;

            const deconstructor = new CommercialDeconstructor();
            const result = deconstructor.validateWaveRhythm(text);

            // 小爽点间隔：4 章 / 2 章命中 = 2
            expect(result.smallCoolPointInterval).toBe(2);
        });
    });

    describe('SubTask 13.4: 紫川商业价值集成验证', () => {
        it.skipIf(ZI_CHUAN_SAMPLE === null)('紫川前 20000 字：firstChapter.wordCount > 5000, openingConflict > 0, overallScore > 60（C 级或以上）', async () => {
            const text = ZI_CHUAN_SAMPLE!;

            const deconstructor = new CommercialDeconstructor();
            const result = await deconstructor.analyze(text);

            // P7.1: firstChapter.wordCount > 5000（Task 2 已修复）
            expect(result.goldenThreeChapters.details.firstChapter.wordCount).toBeGreaterThan(5000);

            // P7.2: openingConflict > 0（题材冲突词修复）
            expect(result.goldenThreeChapters.subScores.openingConflict).toBeGreaterThan(0);

            // P7.3: overallScore > 60（C 级或以上）
            expect(result.overallScore).toBeGreaterThan(60);
            expect(['S', 'A', 'B', 'C']).toContain(result.overallLevel);

            // P7.4: waveRhythm 各项不再全为 0
            expect(result.waveRhythm).toBeDefined();
            if (result.waveRhythm) {
                expect(result.waveRhythm.complianceRate).toBeGreaterThan(0);
                // 至少一项间隔 > 0
                const nonZeroIntervals = [
                    result.waveRhythm.smallCoolPointInterval,
                    result.waveRhythm.mediumReversalInterval,
                    result.waveRhythm.bigClimaxInterval
                ].filter(v => v > 0).length;
                expect(nonZeroIntervals).toBeGreaterThan(0);
            }
        });
    });
});
