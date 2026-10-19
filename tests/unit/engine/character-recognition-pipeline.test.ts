import { describe, it, expect, beforeEach } from 'vitest';
import { CharacterRecognitionPipeline } from '../../../engine/character-recognition-pipeline';
import { CharacterDeconstructor } from '../../../engine/deconstructors/character-deconstructor';
import { SuggestionManager } from '../../../engine/suggestion-manager';

describe('CharacterRecognitionPipeline', () => {
    let deconstructor: CharacterDeconstructor;
    let suggestionManager: SuggestionManager;
    let pipeline: CharacterRecognitionPipeline;

    beforeEach(() => {
        deconstructor = new CharacterDeconstructor();
        suggestionManager = new SuggestionManager();
        pipeline = new CharacterRecognitionPipeline(deconstructor, suggestionManager);
    });

    describe('纯规则模式（rule layer only）', () => {
        it('空文本返回空结果', async () => {
            const result = await pipeline.analyze('', {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            expect(result.ruleCandidates).toEqual([]);
            expect(result.finalCharacters).toEqual([]);
            expect(result.layerStatus.rule).toBe('success');
            expect(result.layerStatus.vector).toBe('skipped');
            expect(result.layerStatus.llm).toBe('skipped');
        });

        it('规则层状态为 success', async () => {
            const text = '李逸风道："今日天气不错。"王婉儿说："是啊。"';
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            expect(result.layerStatus.rule).toBe('success');
            expect(result.layerStatus.vector).toBe('skipped');
            expect(result.layerStatus.llm).toBe('skipped');
        });

        it('角色数量与原 character-deconstructor 一致', async () => {
            const text = buildTestText();
            const deconResult = await deconstructor.analyze(text);
            const pipelineResult = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            expect(pipelineResult.finalCharacters.length).toBe(deconResult.characters.length);
        });

        it('角色名称与原 character-deconstructor 一致', async () => {
            const text = buildTestText();
            const deconResult = await deconstructor.analyze(text);
            const pipelineResult = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            const deconNames = deconResult.characters.map(c => c.name).sort();
            const pipelineNames = pipelineResult.finalCharacters.map(c => c.name).sort();
            expect(pipelineNames).toEqual(deconNames);
        });

        it('CharacterCandidate 包含必填字段', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            for (const candidate of result.ruleCandidates) {
                expect(candidate.name).toBeTruthy();
                expect(typeof candidate.confidence).toBe('number');
                expect(candidate.confidence).toBeGreaterThanOrEqual(0);
                expect(candidate.confidence).toBeLessThanOrEqual(1);
                expect(candidate.source).toBe('rule');
                expect(Array.isArray(candidate.evidence)).toBe(true);
                expect(candidate.mentionCount).toBeGreaterThan(0);
            }
        });

        it('证据片段最多 5 条', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            for (const candidate of result.ruleCandidates) {
                expect(candidate.evidence.length).toBeLessThanOrEqual(5);
            }
        });

        it('生成 character 类型的建议', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            expect(result.suggestions.length).toBeGreaterThan(0);
            for (const suggestion of result.suggestions) {
                expect(suggestion.type).toBe('character');
                expect(suggestion.source).toBe('rule');
                expect(suggestion.status).toBe('pending');
            }
        });

        it('置信度在 0-1 之间', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            for (const candidate of result.ruleCandidates) {
                expect(candidate.confidence).toBeGreaterThanOrEqual(0);
                expect(candidate.confidence).toBeLessThanOrEqual(1);
            }
        });
    });

    describe('最大候选数限制', () => {
        it('超过 maxCandidates 时按置信度截断', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false,
                maxCandidates: 2
            });
            expect(result.ruleCandidates.length).toBeLessThanOrEqual(2);
        });

        it('默认 maxCandidates 为 100', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            expect(result.ruleCandidates.length).toBeLessThanOrEqual(100);
        });
    });

    describe('进度回调', () => {
        it('纯规则模式触发正确的进度回调', async () => {
            const progressEvents: Array<{ stage: string; progress: number }> = [];
            const text = buildTestText();
            await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: false,
                enableLLMLayer: false,
                onProgress: (stage, progress) => {
                    progressEvents.push({ stage, progress });
                }
            });
            expect(progressEvents.length).toBeGreaterThan(0);
            const ruleStages = progressEvents.filter(e => e.stage === '规则层');
            expect(ruleStages.length).toBeGreaterThanOrEqual(2);
            expect(ruleStages[ruleStages.length - 1].progress).toBe(33);
        });
    });

    describe('向量层和 LLM 层空实现', () => {
        it('向量层在未配置 VectorEnhancer 时返回 skipped', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: true,
                enableLLMLayer: false
            });
            expect(result.layerStatus.vector).toBe('skipped');
            expect(result.vectorFiltered.length).toBe(result.ruleCandidates.length);
        });

        it('向量层返回 mergeSuggestions 字段（空数组）', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: true,
                enableLLMLayer: false
            });
            expect(Array.isArray(result.mergeSuggestions)).toBe(true);
            expect(result.mergeSuggestions.length).toBe(0);
        });

        it('LLM 层在未配置 LLMEnhancer 时返回 skipped', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: true,
                enableLLMLayer: true
            });
            expect(result.layerStatus.llm).toBe('skipped');
            expect(result.llmVerified.length).toBe(result.vectorFiltered.length);
        });

        it('向量层 source 标记为 vector', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: true,
                enableLLMLayer: false
            });
            for (const candidate of result.vectorFiltered) {
                expect(candidate.source).toBe('vector');
            }
        });

        it('LLM 层 source 标记为 llm', async () => {
            const text = buildTestText();
            const result = await pipeline.analyze(text, {
                enableRuleLayer: true,
                enableVectorLayer: true,
                enableLLMLayer: true
            });
            for (const candidate of result.llmVerified) {
                expect(candidate.source).toBe('llm');
            }
        });
    });

    describe('降级逻辑', () => {
        it('关闭规则层时返回 skipped', async () => {
            const result = await pipeline.analyze('test', {
                enableRuleLayer: false,
                enableVectorLayer: false,
                enableLLMLayer: false
            });
            expect(result.layerStatus.rule).toBe('skipped');
            expect(result.finalCharacters).toEqual([]);
        });
    });
});

describe('CharacterRecognitionPipeline — 带 vectorEnhancer 和 llmEnhancer 的构造', () => {
    let deconstructor: CharacterDeconstructor;
    let suggestionManager: SuggestionManager;

    beforeEach(() => {
        deconstructor = new CharacterDeconstructor();
        suggestionManager = new SuggestionManager();
    });

    it('构造函数接受 vectorEnhancer 参数', () => {
        const mockVectorEnhancer = {
            isAvailable: async () => true,
            filterCandidatesBySemantics: async (candidates: any[]) => candidates,
            mergeCandidatesByContextSimilarity: async () => [],
        };

        const pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            mockVectorEnhancer as any
        );

        expect(pipeline).toBeDefined();
    });

    it('构造函数接受 llmEnhancer 参数', () => {
        const mockLlmEnhancer = {
            verifyCharactersWithLLM: async (candidates: any[]) => candidates,
            extractTitlesAndAliases: async () => [],
        };

        const pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            undefined,
            mockLlmEnhancer as any
        );

        expect(pipeline).toBeDefined();
    });

    it('构造函数同时接受 vectorEnhancer 和 llmEnhancer', () => {
        const mockVectorEnhancer = {
            isAvailable: async () => true,
            filterCandidatesBySemantics: async (candidates: any[]) => candidates,
            mergeCandidatesByContextSimilarity: async () => [],
        };
        const mockLlmEnhancer = {
            verifyCharactersWithLLM: async (candidates: any[]) => candidates,
            extractTitlesAndAliases: async () => [],
        };

        const pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            mockVectorEnhancer as any,
            mockLlmEnhancer as any
        );

        expect(pipeline).toBeDefined();
    });
});

describe('CharacterRecognitionPipeline — 三层流水线（mock 依赖）', () => {
    let deconstructor: CharacterDeconstructor;
    let suggestionManager: SuggestionManager;
    let mockVectorEnhancer: any;
    let mockLlmEnhancer: any;
    let pipeline: CharacterRecognitionPipeline;

    beforeEach(() => {
        deconstructor = new CharacterDeconstructor();
        suggestionManager = new SuggestionManager();

        mockVectorEnhancer = {
            isAvailable: async () => true,
            filterCandidatesBySemantics: async (candidates: any[]) => candidates.slice(0, Math.ceil(candidates.length / 2)),
            mergeCandidatesByContextSimilarity: async () => [
                {
                    id: 'merge-1',
                    type: 'character_merge',
                    status: 'pending',
                    confidence: 0.85,
                    source: 'vector',
                    payload: { from: '角色A', to: '角色B' },
                    createdAt: Date.now(),
                }
            ],
        };

        mockLlmEnhancer = {
            verifyCharactersWithLLM: async (candidates: any[]) => candidates.map(c => ({ ...c, source: 'llm' })),
            extractTitlesAndAliases: async () => [
                {
                    id: 'title-1',
                    type: 'character',
                    status: 'pending',
                    confidence: 0.9,
                    source: 'llm',
                    payload: { name: '角色A', title: '大侠' },
                    createdAt: Date.now(),
                }
            ],
        };

        pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            mockVectorEnhancer,
            mockLlmEnhancer
        );
    });

    it('完整三层流水线全部成功', async () => {
        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: true
        });

        expect(result.layerStatus.rule).toBe('success');
        expect(result.layerStatus.vector).toBe('success');
        expect(result.layerStatus.llm).toBe('success');
    });

    it('向量层过滤后候选数减少', async () => {
        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: false
        });

        expect(result.layerStatus.vector).toBe('success');
        expect(result.vectorFiltered.length).toBeLessThanOrEqual(result.ruleCandidates.length);
    });

    it('mergeSuggestions 传递向量层和 LLM 层的合并建议', async () => {
        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: true
        });

        expect(Array.isArray(result.mergeSuggestions)).toBe(true);
        expect(result.mergeSuggestions.length).toBeGreaterThan(0);

        const sources = new Set(result.mergeSuggestions.map(s => s.source));
        expect(sources.has('vector') || sources.has('llm')).toBe(true);
    });

    it('LLM 层 source 标记正确', async () => {
        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: true
        });

        for (const candidate of result.llmVerified) {
            expect(candidate.source).toBe('llm');
        }
    });
});

describe('CharacterRecognitionPipeline — 部分层失败的降级', () => {
    let deconstructor: CharacterDeconstructor;
    let suggestionManager: SuggestionManager;

    beforeEach(() => {
        deconstructor = new CharacterDeconstructor();
        suggestionManager = new SuggestionManager();
    });

    it('向量层异常时内部捕获并降级使用规则层结果', async () => {
        const mockVectorEnhancer = {
            isAvailable: async () => { throw new Error('向量服务不可用'); },
            filterCandidatesBySemantics: async () => [],
            mergeCandidatesByContextSimilarity: async () => [],
        };

        const pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            mockVectorEnhancer as any
        );

        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: false
        });

        expect(result.layerStatus.rule).toBe('success');
        expect(result.layerStatus.vector).toBe('skipped');
        expect(result.vectorFiltered.length).toBe(result.ruleCandidates.length);
    });

    it('LLM 层异常时内部捕获并降级使用向量层结果', async () => {
        const mockVectorEnhancer = {
            isAvailable: async () => true,
            filterCandidatesBySemantics: async (candidates: any[]) => candidates,
            mergeCandidatesByContextSimilarity: async () => [],
        };

        const mockLlmEnhancer = {
            verifyCharactersWithLLM: async () => { throw new Error('LLM 服务不可用'); },
            extractTitlesAndAliases: async () => [],
        };

        const pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            mockVectorEnhancer as any,
            mockLlmEnhancer as any
        );

        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: true
        });

        expect(result.layerStatus.rule).toBe('success');
        expect(result.layerStatus.vector).toBe('success');
        expect(result.layerStatus.llm).toBe('skipped');
        expect(result.llmVerified.length).toBe(result.vectorFiltered.length);
    });

    it('向量层不可用时状态为 skipped', async () => {
        const mockVectorEnhancer = {
            isAvailable: async () => false,
            filterCandidatesBySemantics: async () => [],
            mergeCandidatesByContextSimilarity: async () => [],
        };

        const pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            mockVectorEnhancer as any
        );

        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: false
        });

        expect(result.layerStatus.vector).toBe('skipped');
    });
});

describe('CharacterRecognitionPipeline — mergeSuggestions 传递', () => {
    let deconstructor: CharacterDeconstructor;
    let suggestionManager: SuggestionManager;

    beforeEach(() => {
        deconstructor = new CharacterDeconstructor();
        suggestionManager = new SuggestionManager();
    });

    it('纯规则模式下 mergeSuggestions 为空数组', async () => {
        const pipeline = new CharacterRecognitionPipeline(deconstructor, suggestionManager);
        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: false,
            enableLLMLayer: false
        });

        expect(Array.isArray(result.mergeSuggestions)).toBe(true);
        expect(result.mergeSuggestions.length).toBe(0);
    });

    it('向量层返回 mergeSuggestions', async () => {
        const mergeSuggestionsMock = [
            {
                id: 'merge-1',
                type: 'character_merge' as any,
                status: 'pending' as any,
                confidence: 0.8,
                source: 'vector',
                payload: { from: 'A', to: 'B' },
                createdAt: Date.now(),
            }
        ];

        const mockVectorEnhancer = {
            isAvailable: async () => true,
            filterCandidatesBySemantics: async (candidates: any[]) => candidates,
            mergeCandidatesByContextSimilarity: async () => mergeSuggestionsMock,
        };

        const pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            mockVectorEnhancer as any
        );

        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: false
        });

        expect(result.mergeSuggestions.length).toBeGreaterThanOrEqual(1);
    });

    it('LLM 层返回的 mergeSuggestions 追加到结果中', async () => {
        const vectorMergeSuggestions = [
            {
                id: 'vector-merge-1',
                type: 'character_merge' as any,
                status: 'pending' as any,
                confidence: 0.8,
                source: 'vector',
                payload: {},
                createdAt: Date.now(),
            }
        ];

        const llmMergeSuggestions = [
            {
                id: 'llm-title-1',
                type: 'character' as any,
                status: 'pending' as any,
                confidence: 0.9,
                source: 'llm',
                payload: {},
                createdAt: Date.now(),
            }
        ];

        const mockVectorEnhancer = {
            isAvailable: async () => true,
            filterCandidatesBySemantics: async (candidates: any[]) => candidates,
            mergeCandidatesByContextSimilarity: async () => vectorMergeSuggestions,
        };

        const mockLlmEnhancer = {
            verifyCharactersWithLLM: async (candidates: any[]) => candidates,
            extractTitlesAndAliases: async () => llmMergeSuggestions,
        };

        const pipeline = new CharacterRecognitionPipeline(
            deconstructor,
            suggestionManager,
            mockVectorEnhancer as any,
            mockLlmEnhancer as any
        );

        const text = buildTestText();
        const result = await pipeline.analyze(text, {
            enableRuleLayer: true,
            enableVectorLayer: true,
            enableLLMLayer: true
        });

        expect(result.mergeSuggestions.length).toBeGreaterThanOrEqual(2);
        const sources = result.mergeSuggestions.map(s => s.source);
        expect(sources).toContain('vector');
        expect(sources).toContain('llm');
    });
});

function buildTestText(): string {
    return `李逸风道："今日天气不错，我们出去走走吧。"

王婉儿说："好啊，听说城南的桃花开了。"

张云飞笑道："那我也一起去，正好有事要找李兄商议。"

李逸风对王婉儿说："婉儿，你最近身体好些了吗？"

王婉儿轻轻点头："多谢李大哥关心，已经好多了。"

张云飞道："李兄，上次说的那件事，考虑得怎么样了？"

李逸风沉思片刻："此事重大，容我再想想。"

王婉儿说："你们在说什么呀，神神秘秘的。"

张云飞大笑："没什么，就是一些江湖上的事。"

李逸风站起身："走吧，再不走桃花都要谢了。"

三人一同走出院门，阳光洒在他们身上。
王婉儿的丫鬟小青跟在后面，手里提着一个食盒。
小青说："小姐，我准备好了糕点和茶水。"

李逸风赞道："还是小青细心。"

张云飞哈哈一笑："那是自然，婉儿姑娘的丫鬟，哪有不细心的道理。"

王婉儿脸上一红："张大哥又取笑我。"`;
}
