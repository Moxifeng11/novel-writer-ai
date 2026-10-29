import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../../engine/prompt-builder';

/**
 * 协同写作的三条非主链路（联想 / 选区改写 / 句级迭代）此前不带预算：
 * 本地模型按 num_ctx 从 prompt 尾部硬截断，而「选中文本 / 上下文 / 迭代指令」正好在末尾，
 * 被截断时模型看不到任务本身。这里锁定三条链路的必保片段与裁剪顺序。
 */
describe('PromptBuilder — 联想 / 改写 / 迭代的预算裁剪', () => {
    const BIG_KNOWLEDGE = '知识库片段'.repeat(4000); // 20000 字，远超小窗口
    const budget = { maxInputTokens: 600, modelId: 'test-local' };

    it('联想：超预算时丢弃知识库，但保留上下文与输出约束', () => {
        const builder = new PromptBuilder(() => null);
        const prompt = builder.buildAssociationPrompt(
            '前文上下文'.repeat(40),
            { type: 'dialogue', confidence: 0.8 },
            undefined,
            [BIG_KNOWLEDGE],
            undefined,
            budget
        );

        expect(prompt).not.toContain(BIG_KNOWLEDGE);
        expect(prompt).toContain('【上下文】');
        expect(prompt).toContain('【提示】完成这个对话。');
        expect(prompt.trimEnd().endsWith('直接输出续写内容，不要解释：')).toBe(true);
    });

    it('联想：不传预算时保持旧行为（知识库全文进入 prompt）', () => {
        const builder = new PromptBuilder(() => null);
        const prompt = builder.buildAssociationPrompt(
            '前文上下文',
            { type: 'dialogue', confidence: 0.8 },
            undefined,
            [BIG_KNOWLEDGE]
        );

        expect(prompt).toContain(BIG_KNOWLEDGE);
    });

    it('选区改写：超预算时仍完整保留选中文本与改写目标', () => {
        const builder = new PromptBuilder(() => null);
        const selected = '他推开门，屋里没有人。';
        const prompt = builder.buildRewritePrompt(
            selected,
            '前文'.repeat(100),
            '后文'.repeat(100),
            '语气更冷',
            'description',
            undefined,
            [BIG_KNOWLEDGE],
            budget
        );

        expect(prompt).not.toContain(BIG_KNOWLEDGE);
        expect(prompt).toContain('【选中文本】');
        expect(prompt).toContain(selected);
        expect(prompt).toContain('【改写目标】');
        expect(prompt).toContain('【特别指令】\n语气更冷');
    });

    it('选区改写：不传预算时保持旧行为', () => {
        const builder = new PromptBuilder(() => null);
        const prompt = builder.buildRewritePrompt(
            '选中文本',
            '前文',
            '后文',
            '',
            'description',
            undefined,
            [BIG_KNOWLEDGE]
        );

        expect(prompt).toContain(BIG_KNOWLEDGE);
    });

    it('句级迭代：超预算时仍完整保留原候选与用户迭代指令', () => {
        const builder = new PromptBuilder(() => null);
        const prompt = builder.buildIteratePrompt(
            '原候选句子。',
            '前文'.repeat(200),
            '把语气改冷，去掉感叹号',
            '保持第三人称',
            undefined,
            [BIG_KNOWLEDGE],
            budget
        );

        expect(prompt).not.toContain(BIG_KNOWLEDGE);
        expect(prompt).toContain('【原候选】');
        expect(prompt).toContain('原候选句子。');
        expect(prompt).toContain('【用户迭代指令】');
        expect(prompt).toContain('把语气改冷，去掉感叹号');
        expect(prompt.trimEnd().endsWith('不要解释，不要列点。')).toBe(true);
    });

    it('句级迭代：不传预算时保持旧行为', () => {
        const builder = new PromptBuilder(() => null);
        const prompt = builder.buildIteratePrompt(
            '原候选句子。',
            '前文',
            '改冷一点',
            '',
            undefined,
            [BIG_KNOWLEDGE]
        );

        expect(prompt).toContain(BIG_KNOWLEDGE);
    });
});

/**
 * 快照收集 2000 字前文，但 prompt 长期固定只取尾部 800 字：
 * 大窗口下上下文被静默丢掉三分之二。这里锁定「按预算自适应」的三档行为。
 */
describe('PromptBuilder — 续写前文长度随输入预算自适应', () => {
    // 总长 3009：【远标记】距尾 2009、【中标记】距尾 1006、【近标记】距尾 403
    const LONG_TEXT = '甲'.repeat(1000) + '【远标记】' + '乙'.repeat(1000)
        + '【中标记】' + '丙'.repeat(600) + '【近标记】' + '丁'.repeat(400);

    function buildUser(budget?: { maxInputTokens: number; modelId?: string }): string {
        const builder = new PromptBuilder(() => null);
        return builder.buildSuggestionPrompt(
            LONG_TEXT, 'action', '', '', '', undefined, undefined, undefined, undefined, budget
        ).user;
    }

    it('本地 8192 窗口把前文从 800 扩到 2000 字', () => {
        const user = buildUser({ maxInputTokens: 7472, modelId: 'local' });
        expect(user).toContain('【近标记】');
        expect(user).toContain('【中标记】');
        expect(user).not.toContain('【远标记】');
    });

    it('小窗口收紧到 800 字，不挤占设定与简报预算', () => {
        const user = buildUser({ maxInputTokens: 1000, modelId: 'small' });
        expect(user).toContain('【近标记】');
        expect(user).not.toContain('【中标记】');
    });

    it('不传预算时保持 800 字旧行为', () => {
        const user = buildUser();
        expect(user).toContain('【近标记】');
        expect(user).not.toContain('【中标记】');
    });
});

/**
 * 场景知识注入（injectForBodyGeneration）此前拼进 system：
 * 预算裁剪只作用于 sections，system 与 tail 永不裁剪，
 * 注入一长就会把整段 prompt 顶过窗口，本地模型从尾部截断正好切掉任务片段。
 */
describe('PromptBuilder — 场景知识注入参与预算裁剪', () => {
    const INJECTION = '## 写作指引\n\n### 风格要求\n' + '风格'.repeat(1500) + '【注入尾部标记】';

    function build(budget?: { maxInputTokens: number; modelId?: string }) {
        const builder = new PromptBuilder(() => null);
        return builder.buildSuggestionPrompt(
            '前文'.repeat(150), 'action', '', '', '', undefined, undefined, INJECTION, undefined, budget
        );
    }

    it('预算充足时注入完整进入 user，system 只保留静态规则', () => {
        const { system, user } = build({ maxInputTokens: 100_000, modelId: 'big' });
        expect(system).not.toContain('## 写作指引');
        expect(user).toContain('【注入尾部标记】');
    });

    it('超预算时先裁注入，已写内容与写作方向仍完整保留', () => {
        const { user } = build({ maxInputTokens: 900, modelId: 'small' });
        expect(user).not.toContain('【注入尾部标记】');
        expect(user).toContain('【已写内容】');
        expect(user).toContain('【写作方向】');
        expect(user).toContain('请自然地续写一个自然段');
    });

    it('不传预算时注入仍完整出现在 user', () => {
        const { system, user } = build();
        expect(system).not.toContain('## 写作指引');
        expect(user).toContain('【注入尾部标记】');
    });
});

/**
 * 项目写作规则与文笔风格此前也拼进 system（style 无长度限制）：
 * 与知识注入同样绕过预算裁剪，长文笔文件会直接顶爆本地窗口。
 */
describe('PromptBuilder — 项目规则与文笔风格参与预算裁剪', () => {
    const STYLE = '【文笔风格开始】' + '风'.repeat(3000) + '【风格尾部标记】';
    const RULES = '【规则开始】' + '规'.repeat(1200);
    const snapshot = () => ({ writingStyle: STYLE, writingRules: RULES }) as any;

    it('选区改写：超预算时先裁项目风格，选中文本与改写目标完整保留', () => {
        const builder = new PromptBuilder(snapshot);
        const prompt = builder.buildRewritePrompt(
            '他推开门，屋里没有人。',
            '前文'.repeat(100),
            '后文'.repeat(50),
            '语气更冷',
            'description',
            undefined,
            undefined,
            { maxInputTokens: 900, modelId: 'small' }
        );

        expect(prompt).not.toContain('【风格尾部标记】');
        expect(prompt).toContain('【选中文本】');
        expect(prompt).toContain('他推开门，屋里没有人。');
        expect(prompt).toContain('【改写目标】');
    });

    it('选区改写：预算充足时项目风格完整保留', () => {
        const builder = new PromptBuilder(snapshot);
        const prompt = builder.buildRewritePrompt(
            '选中文本',
            '前文',
            '后文',
            '',
            'description',
            undefined,
            undefined,
            { maxInputTokens: 100_000, modelId: 'big' }
        );

        expect(prompt).toContain('【风格尾部标记】');
        expect(prompt).toContain('【规则开始】');
    });

    it('联想：超预算时保留上下文与提示，项目风格可被裁剪', () => {
        const builder = new PromptBuilder(snapshot);
        const prompt = builder.buildAssociationPrompt(
            '前文上下文'.repeat(40),
            { type: 'dialogue', confidence: 0.8 },
            undefined,
            undefined,
            undefined,
            { maxInputTokens: 900, modelId: 'small' }
        );

        expect(prompt).toContain('【上下文】');
        expect(prompt).toContain('【提示】完成这个对话。');
        expect(prompt).not.toContain('【风格尾部标记】');
    });

    it('不传预算时项目风格保持完整（行为不变）', () => {
        const builder = new PromptBuilder(snapshot);
        const prompt = builder.buildAssociationPrompt(
            '前文上下文',
            { type: 'dialogue', confidence: 0.8 }
        );

        expect(prompt).toContain('【风格尾部标记】');
    });
});
