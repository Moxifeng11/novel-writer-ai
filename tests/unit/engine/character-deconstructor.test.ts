import { describe, it, expect } from 'vitest';
import {
    CharacterDeconstructor,
    CharacterAnalysisResult
} from '../../../engine/deconstructors/character-deconstructor';
import { GenreConfigRegistry } from '../../../engine/genre';
import type { GenreConfig as AdaptiveGenreConfig } from '../../../engine/genre';

describe('CharacterDeconstructor - 网络中心性扩展', () => {
    const deconstructor = new CharacterDeconstructor();

    describe('analyzeNetworkCentrality', () => {
        it('角色不足时返回空结果', async () => {
            const result = await deconstructor.analyzeNetworkCentrality('文本', [], []);
            expect(result.centrality).toEqual([]);
            expect(result.networkDensity).toBe(0);
        });

        it('度中心性在 0-1 之间', async () => {
            const text = `李逸风道："今日天气不错。"\n\n王婉儿说："是啊。"\n\n张云飞笑道："一起去吧。"\n\n李逸风对王婉儿说："走吧。"\n\n张云飞道："我也去。"`;
            const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeNetworkCentrality(
                text,
                paragraphs,
                analyzeResult.characters
            );
            for (const c of result.centrality) {
                expect(c.degreeCentrality).toBeGreaterThanOrEqual(0);
                expect(c.degreeCentrality).toBeLessThanOrEqual(1);
            }
        });

        it('PageRank 总和约等于 1', async () => {
            const text = buildNetworkTestText();
            const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeNetworkCentrality(
                text,
                paragraphs,
                analyzeResult.characters
            );
            const sum = result.centrality.reduce((s, c) => s + c.pagerank, 0);
            expect(sum).toBeCloseTo(1, 2);
        });

        it('网络密度在 0-1 之间', async () => {
            const text = buildNetworkTestText();
            const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeNetworkCentrality(
                text,
                paragraphs,
                analyzeResult.characters
            );
            expect(result.networkDensity).toBeGreaterThanOrEqual(0);
            expect(result.networkDensity).toBeLessThanOrEqual(1);
        });

        it('接近中心性和介数中心性在 0-1 之间', async () => {
            const text = buildNetworkTestText();
            const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeNetworkCentrality(
                text,
                paragraphs,
                analyzeResult.characters
            );
            for (const c of result.centrality) {
                expect(c.closenessCentrality).toBeGreaterThanOrEqual(0);
                expect(c.closenessCentrality).toBeLessThanOrEqual(1);
                expect(c.betweennessCentrality).toBeGreaterThanOrEqual(0);
                expect(c.betweennessCentrality).toBeLessThanOrEqual(1);
            }
        });

        it('角色定位包含四种类型之一', async () => {
            const text = buildNetworkTestText();
            const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeNetworkCentrality(
                text,
                paragraphs,
                analyzeResult.characters
            );
            const validRoles = ['protagonist', 'major', 'supporting', 'minor'];
            for (const c of result.centrality) {
                expect(validRoles).toContain(c.role);
            }
            const hasProtagonist = result.centrality.some(c => c.role === 'protagonist');
            expect(hasProtagonist).toBe(true);
        });

        it('社区划分覆盖所有节点', async () => {
            const text = buildNetworkTestText();
            const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeNetworkCentrality(
                text,
                paragraphs,
                analyzeResult.characters
            );
            const allMembers = result.communities.flatMap(c => c.members);
            for (const node of result.nodes) {
                expect(allMembers).toContain(node);
            }
        });

        it('边权重为正整数（共现次数）', async () => {
            const text = buildNetworkTestText();
            const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 0);
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeNetworkCentrality(
                text,
                paragraphs,
                analyzeResult.characters
            );
            for (const e of result.edges) {
                expect(e.weight).toBeGreaterThan(0);
                expect(Number.isInteger(e.weight)).toBe(true);
            }
        });
    });

    describe('analyzeVoiceFingerprint', () => {
        it('无角色时返回空结果', async () => {
            const result = await deconstructor.analyzeVoiceFingerprint('text', []);
            expect(result.characters).toEqual([]);
            expect(result.distinctness).toBe(0);
        });

        it('personalityMarkers 各项在 0-1 之间', async () => {
            const text = buildVoiceTestText();
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeVoiceFingerprint(text, analyzeResult.characters);
            for (const f of result.characters) {
                expect(f.personalityMarkers.formality).toBeGreaterThanOrEqual(0);
                expect(f.personalityMarkers.formality).toBeLessThanOrEqual(1);
                expect(f.personalityMarkers.emotionality).toBeGreaterThanOrEqual(0);
                expect(f.personalityMarkers.emotionality).toBeLessThanOrEqual(1);
                expect(f.personalityMarkers.directness).toBeGreaterThanOrEqual(0);
                expect(f.personalityMarkers.directness).toBeLessThanOrEqual(1);
            }
        });

        it('句式分布各项在 0-1 之间且总和约为 1', async () => {
            const text = buildVoiceTestText();
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeVoiceFingerprint(text, analyzeResult.characters);
            for (const f of result.characters) {
                if (f.dialogueCount === 0) continue;
                expect(f.sentencePattern.short).toBeGreaterThanOrEqual(0);
                expect(f.sentencePattern.short).toBeLessThanOrEqual(1);
                expect(f.sentencePattern.medium).toBeGreaterThanOrEqual(0);
                expect(f.sentencePattern.medium).toBeLessThanOrEqual(1);
                expect(f.sentencePattern.long).toBeGreaterThanOrEqual(0);
                expect(f.sentencePattern.long).toBeLessThanOrEqual(1);
                const sum = f.sentencePattern.short + f.sentencePattern.medium + f.sentencePattern.long;
                expect(sum).toBeCloseTo(1, 2);
            }
        });

        it('词汇丰富度 TTR 在 0-1 之间', async () => {
            const text = buildVoiceTestText();
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeVoiceFingerprint(text, analyzeResult.characters);
            for (const f of result.characters) {
                expect(f.vocabularyRichness).toBeGreaterThanOrEqual(0);
                expect(f.vocabularyRichness).toBeLessThanOrEqual(1);
            }
        });

        it('区分度在 0-100 之间', async () => {
            const text = buildVoiceTestText();
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeVoiceFingerprint(text, analyzeResult.characters);
            expect(result.distinctness).toBeGreaterThanOrEqual(0);
            expect(result.distinctness).toBeLessThanOrEqual(100);
        });

        it('指纹字符串非空', async () => {
            const text = buildVoiceTestText();
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeVoiceFingerprint(text, analyzeResult.characters);
            for (const f of result.characters) {
                expect(f.fingerprint.length).toBeGreaterThan(0);
            }
        });

        it('语气词检测能识别常见语气词', async () => {
            const text = `李逸风道："啊，怎么会这样呢？"\n\n李逸风说："嗯，我知道了。"\n\n李逸风笑道："哎呀，没事的。"\n\n李逸风道："好吧，就这样吧。"`;
            const analyzeResult = await deconstructor.analyze(text);
            const result = await deconstructor.analyzeVoiceFingerprint(text, analyzeResult.characters);
            const liFingerprint = result.characters.find(f => f.characterName === '李逸风');
            if (liFingerprint && liFingerprint.dialogueCount > 0) {
                expect(liFingerprint.toneWords.length).toBeGreaterThan(0);
            }
        });
    });

    describe('analyze 集成', () => {
        it('analyze 返回包含 networkCentrality 和 voiceFingerprint', async () => {
            const text = buildNetworkTestText();
            const result = await deconstructor.analyze(text);
            expect(result.networkCentrality).toBeDefined();
            expect(result.voiceFingerprint).toBeDefined();
        });

        it('空文本返回结果字段为 undefined（向后兼容）', async () => {
            const result = await deconstructor.analyze('');
            expect(result.characters).toEqual([]);
            expect(result.networkCentrality).toBeUndefined();
            expect(result.voiceFingerprint).toBeUndefined();
        });

        it('不破坏现有人物分析功能', async () => {
            const text = buildNetworkTestText();
            const result: CharacterAnalysisResult = await deconstructor.analyze(text);
            expect(result.characters.length).toBeGreaterThan(0);
            expect(result.relations).toBeDefined();
            expect(result.stats).toBeDefined();
            expect(result.stats.totalCharacters).toBeGreaterThan(0);
        });

        it('Markdown 输出包含新增分析部分', async () => {
            const text = buildNetworkTestText();
            const result = await deconstructor.analyze(text);
            const markdown = captureMarkdownOutput(deconstructor, result, '测试书');
            expect(markdown).toContain('## 角色网络分析');
            expect(markdown).toContain('## 角色声音指纹');
        });
    });
});

function buildNetworkTestText(): string {
    return [
        '李逸风道："王婉儿，今日天气不错。"',
        '王婉儿说："是啊，李逸风。张云飞也来了。"',
        '张云飞笑道："李逸风，王婉儿，一起去吧。"',
        '李逸风对王婉儿说："走吧，张云飞在等。"',
        '张云飞道："李逸风，我也去。"',
        '陈思远叹道："李逸风，此话当真？"',
        '李逸风道："陈思远，自然当真。"',
        '王婉儿对陈思远说："你别多虑。"',
        '张云飞道："陈思远，一起来吧。"',
        '李逸风心想："王婉儿真好看。"',
        '陈思远暗道："张云飞似乎不简单。"',
        '王婉儿笑道："李逸风，走吧。"'
    ].join('\n\n');
}

function buildVoiceTestText(): string {
    return [
        '李逸风道："你好啊，在下李逸风，敢问阁下尊姓大名？"',
        '李逸风说："承蒙赐教，幸会幸会。"',
        '李逸风笑道："在下不才，叨扰了。"',
        '王婉儿道："哎呀，你这人咋这样呢？搞啥名堂？"',
        '王婉儿喊："别说了！废话少说，快点过来！"',
        '王婉儿冷笑："哼，胡说八道！咋回事啊？"',
        '张云飞道："嗯，此事说来话长，待我慢慢道来。"',
        '张云飞叹道："唉，真是让人感慨万千。"',
        '张云飞说："切，这有什么大不了的。"'
    ].join('\n\n');
}

function captureMarkdownOutput(
    deconstructor: CharacterDeconstructor,
    result: CharacterAnalysisResult,
    bookName: string
): string {
    type FrontmatterAccessor = { buildFrontmatter: (r: CharacterAnalysisResult) => string };
    type MarkdownAccessor = { buildMarkdownBody: (r: CharacterAnalysisResult, b: string) => string };
    const anyDec = deconstructor as unknown as FrontmatterAccessor & MarkdownAccessor;
    const frontmatter = anyDec.buildFrontmatter(result);
    const body = anyDec.buildMarkdownBody(result, bookName);
    return `---\n${frontmatter}\n---\n\n${body}`;
}

// ============================================================
// P2 人设提取修复测试（Task 3-7）
// ============================================================

describe('CharacterDeconstructor - P2 人设提取修复', () => {
    // 军事题材配置（与 military.genre.json 一致）
    const militaryConfig: AdaptiveGenreConfig = GenreConfigRegistry.getInstance().getGenreConfig('military');

    describe('Task 3: personality 提取（从 behaviorTraits 读取）', () => {
        it('军事题材样本能提取到有意义性格标签', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const protagonist = result.mainCharacter;
            expect(protagonist).toBeDefined();
            if (protagonist) {
                expect(protagonist.personality.length).toBeGreaterThan(0);
                // 性格标签应为有意义标签（如"幽默"/"勇敢"/"智谋"等），而非碎片
                for (const trait of protagonist.personality) {
                    expect(trait.length).toBeGreaterThanOrEqual(2);
                    // 不应包含旧的碎片词
                    expect(['知的一面', '知了', '和镇定万', '那才是']).not.toContain(trait);
                }
            }
        });

        it('性格标签不超过 8 个', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            for (const char of result.characters) {
                expect(char.personality.length).toBeLessThanOrEqual(8);
            }
        });

        it('无行为特征的角色 personality 为空数组', async () => {
            // 简短文本，无任何 behaviorTrait 关键词
            const text = '李逸风走在路上。李逸风看着天空。李逸风回家了。';
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const li = result.characters.find(c => c.name === '李逸风');
            expect(li).toBeDefined();
            if (li) {
                expect(li.personality.length).toBe(0);
            }
        });

        it('未传入 adaptiveGenreConfig 时使用 generic 兜底', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor();
            const result = await deconstructor.analyze(text);
            // generic 兜底也能提取到 personality（基于 generic.behaviorTraits）
            const protagonist = result.mainCharacter;
            if (protagonist) {
                for (const trait of protagonist.personality) {
                    expect(trait.length).toBeGreaterThanOrEqual(2);
                }
            }
        });
    });

    describe('Task 4: abilities 提取（从 abilityKeywords 读取）', () => {
        it('军事题材样本能提取到有意义能力标签', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            // 帝林应有能力标签
            const diLin = result.characters.find(c => c.name === '帝林');
            if (diLin) {
                expect(diLin.abilities.length).toBeGreaterThan(0);
                // 能力标签应为有意义标签（如"谋略"/"军事才能"），而非关键词本身
                for (const ability of diLin.abilities) {
                    expect(ability.length).toBeGreaterThanOrEqual(2);
                    // 不应包含旧的无意义碎片
                    expect(['能力', '掌', '哗啦', '经', '功']).not.toContain(ability);
                }
            }
        });

        it('支持"XX才能"模式匹配', async () => {
            const text = '帝林展现出了卓越的军事才能。帝林的谋略无人能及。';
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const diLin = result.characters.find(c => c.name === '帝林');
            if (diLin) {
                // 应提取到"军事才能"
                const hasMilitaryTalent = diLin.abilities.some(a => a.includes('军事才能') || a.includes('谋略'));
                expect(hasMilitaryTalent).toBe(true);
            }
        });

        it('无匹配时返回空数组', async () => {
            // 文本中无任何 abilityKeyword
            const text = '李逸风走在路上。李逸风看着天空。';
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const li = result.characters.find(c => c.name === '李逸风');
            if (li) {
                expect(li.abilities.length).toBe(0);
            }
        });

        it('不再返回模式词本身（能力/擅长/精通）作为能力标签', async () => {
            const text = '李逸风擅长剑法。李逸风精通武艺。李逸风能力很强。';
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const li = result.characters.find(c => c.name === '李逸风');
            if (li) {
                for (const ability of li.abilities) {
                    // military.abilityKeywords 不包含"擅长"/"精通"/"能力"，所以这些词不会作为 keyword
                    // 但即使作为模式词，也不应返回模式词本身
                    expect(['能力', '擅长', '精通', '掌握']).not.toContain(ability);
                }
            }
        });

        it('结构性过滤：时间/副词前缀的"才能"碎片不被误提取为能力', async () => {
            // "晚上才能"是"晚上 + 才能(副词)"，非名词性天赋，不应作为能力
            const text = '帝林晚上才能休息。帝林展现出卓越的军事才能。';
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const diLin = result.characters.find(c => c.name === '帝林');
            if (diLin) {
                expect(diLin.abilities).not.toContain('晚上才能');
                expect(diLin.abilities).not.toContain('上才能');
            }
        });
    });

    describe('Task 5: role 判定（盟友前置检查 + 提高 antagonist 阈值）', () => {
        it('盟友关系（兄弟/战友）不被误判为 antagonist', async () => {
            // 帝林和紫川秀是兄弟/战友，有少量冲突词但关系是盟友
            const text = [
                '紫川秀大笑道："帝林，你这个兄弟真有意思。"',
                '帝林冷笑道："紫川秀，你太天真了。"',
                '紫川秀和帝林是结拜兄弟，并肩作战多年。',
                '帝林说："紫川秀，我们一起冲锋。"',
                '紫川秀和帝林携手对抗敌人。',
                '帝林分析战局，紫川秀沉思。',
                '紫川秀道："帝林，你是我的战友。"',
                '帝林说："紫川秀，我们共同面对。"'
            ].join('\n\n');
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const diLin = result.characters.find(c => c.name === '帝林');
            if (diLin) {
                // 帝林不应为 antagonist（应为 deuteragonist 或 supporting）
                expect(diLin.role).not.toBe('antagonist');
            }
        });

        it('真正的敌对关系仍判为 antagonist', async () => {
            // 杨明华是紫川秀的敌人，多次出现负面关系词
            // 紫川秀有明显的主角特征（内心独白 + 更高 mentionCount）
            const text = [
                '紫川秀心想："杨明华这个仇人，我一定要杀了你。"',
                '紫川秀暗道："杨明华害死了我的家人，此仇必报。"',
                '紫川秀发誓要杀了杨明华。杨明华是紫川秀的仇人。',
                '杨明华害死了紫川秀的家人。紫川秀仇恨杨明华。',
                '紫川秀决心复仇，杨明华必须死。',
                '紫川秀心想："杨明华敌对我和家族，必须消灭他。"',
                '紫川秀和杨明华不共戴天，血海深仇。',
                '紫川秀暗道："杨明华派人暗杀我，我差点被杀死。"',
                '紫川秀痛恨杨明华，誓要消灭杨明华。',
                '紫川秀心中愤怒，杨明华的所作所为不可饶恕。'
            ].join('\n\n');
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const yangMinghua = result.characters.find(c => c.name === '杨明华');
            if (yangMinghua) {
                // 杨明华应为 antagonist
                expect(yangMinghua.role).toBe('antagonist');
            }
        });
    });

    describe('Task 6: importance tier（protagonist 强制 + 权重调整）', () => {
        it('protagonist 角色 tier 强制为 "protagonist"', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            const protagonist = result.mainCharacter;
            expect(protagonist).toBeDefined();
            if (protagonist) {
                expect(protagonist.role).toBe('protagonist');
                expect(protagonist.importance?.tier).toBe('protagonist');
            }
        });

        it('totalScore 在合理范围（0-100）', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            for (const char of result.characters) {
                if (char.importance) {
                    expect(char.importance.totalScore).toBeGreaterThanOrEqual(0);
                    expect(char.importance.totalScore).toBeLessThanOrEqual(100);
                }
            }
        });
    });

    describe('Task 7: characterArc 提炼（简短化）', () => {
        it('goals 每个 < 30 字（含省略号）', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            for (const char of result.characters) {
                if (char.characterArc?.initialState?.goals) {
                    for (const goal of char.characterArc.initialState.goals) {
                        // 含省略号最多 33 字（30 字 + "..."）
                        expect(goal.length).toBeLessThanOrEqual(33);
                    }
                }
            }
        });

        it('description 为简短概述（< 65 字）', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            for (const char of result.characters) {
                if (char.characterArc?.initialState?.description) {
                    const desc = char.characterArc.initialState.description;
                    // description 为第一句话，最多 60 字 + "..."
                    expect(desc.length).toBeLessThanOrEqual(63);
                }
            }
        });

        it('growthNodes.event < 30 字（含省略号）', async () => {
            const text = buildMilitaryTestText();
            const deconstructor = new CharacterDeconstructor(undefined, undefined, militaryConfig);
            const result = await deconstructor.analyze(text);
            for (const char of result.characters) {
                if (char.characterArc?.growthNodes) {
                    for (const node of char.characterArc.growthNodes) {
                        // 含省略号最多 33 字（30 字 + "..."）
                        expect(node.event.length).toBeLessThanOrEqual(33);
                    }
                }
            }
        });
    });
});

function buildMilitaryTestText(): string {
    return [
        '紫川秀大笑道："帝林，你这个兄弟真有意思。"',
        '帝林冷笑道："紫川秀，你太天真了，但你的谋略确实不错。"',
        '紫川秀和帝林是结拜兄弟，并肩作战多年，共同指挥军团。',
        '斯特林沉思道："紫川秀，战局需要分析，你的统帅才能无人能及。"',
        '紫川秀道："斯特林，你的军事才能和谋略都是一流的。"',
        '帝林说："紫川秀想要统一大陆，必须战胜杨明华。"',
        '紫川秀和帝林携手冲锋，无畏地对抗敌人。',
        '杨明华冷笑："紫川秀，你终将死在我手里。"',
        '紫川秀大笑："杨明华，你的阴谋不会得逞。"',
        '帝林分析战局，紫川秀沉思对策，斯特林断后。',
        '紫川秀道："为了大陆和平，我必须变得更强。"',
        '帝林说："紫川秀的目标是统一帝国，这是他的使命。"',
        '紫川秀突破自我，实力提升，终于觉醒了潜能。',
        '斯特林道："紫川秀成长了，他不再是那个天真的少年。"',
        '帝林说："紫川秀想要建立新秩序，这是他的梦想。"',
        '紫川秀和帝林是生死之交，他们的友谊经得起考验。'
    ].join('\n\n');
}
