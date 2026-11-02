/**
 * creative-randomizer.ts - layered true-random creative factors.
 *
 * Layer 1: premise factors (identity / power / pressure / expectation break)
 * Layer 2: structure factors (reversal type, emotion curve, escalation style)
 * Layer 3: texture factors (dialogue style, detail channel, scene rhythm)
 * Layer 4: differentiation seed + forbidden-pattern blacklist
 *
 * All randomness comes from CSPRNG; frameworks stay deterministic.
 */
import { trueRandom, type RandomSource } from './true-random';
import type { CreationMode } from '../../shared/creation-mode';

/**
 * RandomFactorSet 类型定义。
 */
export interface RandomFactorSet {
    seed: string;
    layers: {
        premise: string[];
        structure: string[];
        texture: string[];
        differentiation: string[];
    };
    forbiddenPatterns: string[];
}

const PREMISE_FACTORS: Record<'shared' | 'short' | 'script', string[][]> = {
    shared: [
        ['落魄专家', '基层执行者', '边缘家族成员', '失业中年', '刚接手烂摊子的新人', '被误认的普通人', '临时顶替者'],
        ['过度诚实', '强制沉默', '只能记住 24 小时', '对疼痛过度敏感', '能听懂动物', '必须每天完成一件善事'],
        ['被熟人背叛', '被系统冤枉', '被迫接手烂尾工程', '亲人留下的债务', '被公开羞辱后失去工作', '重要证据消失'],
        ['期待复仇却发现自己错怪了人', '期待浪漫却卷入商业阴谋', '期待安稳却被迫承担秘密'],
    ],
    short: [
        ['全职主妇', '被偏心的女儿', '职场新人', '小城教师', '夜班护士', '离婚律师', '归乡青年'],
        ['婚姻财产危机', '原生家庭偏心', '真假身份', '职场潜规则', '校园遗憾', '亲戚道德绑架'],
        ['财产分割', '抚养权', '合同陷阱', '舆论反杀', '家庭秘密', '高考志愿'],
    ],
    script: [
        ['外卖员', '退役特种兵', '赘婿', '豪门私生子', '代驾司机', '前台小妹', '护工'],
        ['身份错位', '系统任务', '读心', '契约婚姻', '被迫隐婚', '时间回溯 10 秒'],
        ['当众羞辱', '亲人被威胁', '爱人被抢', '公司被夺', '孩子被带走'],
    ],
};

const STRUCTURE_FACTORS: Record<'shared' | 'short' | 'script', string[][]> = {
    shared: [
        ['反转类型：身份揭示', '反转类型：信息错位', '反转类型：立场互换', '反转类型：目标重构', '反转类型：假败真胜'],
        ['情绪曲线：先抑后扬', '情绪曲线：先扬后抑再扬', '情绪曲线：持续高压后释放', '情绪曲线：层层递进'],
        ['升级方式：资源反杀', '升级方式：规则漏洞', '升级方式：盟友倒戈', '升级方式：公开对峙', '升级方式：证据链反转'],
    ],
    short: [
        ['推进器：财产证据', '推进器：证人开口', '推进器：一次意外重逢', '推进器：亲属反水'],
        ['兑现节奏：每 3 节小兑现', '兑现节奏：每 4 节大反转'],
    ],
    script: [
        ['集节奏：每集 1 次羞辱 + 1 次反击', '集节奏：2 集压迫 + 1 集强兑现'],
        ['场景策略：室内对峙为主', '场景策略：公共场合打脸', '场景策略：封闭空间反转'],
    ],
};

const TEXTURE_FACTORS: string[][] = [
    ['对白风格：短句压迫', '对白风格：冷幽默', '对白风格：方言口语', '对白风格：克制潜台词'],
    ['细节通道：身体感受', '细节通道：声音', '细节通道：气味', '细节通道：光线', '细节通道：温度'],
    ['场景节奏：快切短段', '场景节奏：长镜头压迫', '场景节奏：静场反转'],
];

const DIFFERENTIATION_FACTORS: string[][] = [
    ['避免：龙傲天无代价胜利', '避免：主角全知全能', '避免：反派纯坏无动机'],
    ['要求：给反派一个可理解动机', '要求：给主角一个不能退的理由', '要求：至少一次代价交换'],
    ['视角约束：主角视角限知', '视角约束：双视角错位', '视角约束：旁观者开场切入'],
];

const FORBIDDEN_PATTERN_GROUPS: string[][] = [
    ['少年觉醒血脉 + 宗门大比', '退婚流 + 当众打脸开局', '废材逆袭 + 神秘老爷爷'],
    ['车祸失忆开局', '真假千金开局无新变量', '重生复仇只靠先知记忆'],
];

/**
 * RandomizedBrief 类型定义。
 */
export interface RandomizedBrief {
    mode: CreationMode;
    seed: string;
    factors: RandomFactorSet;
    promptBlock: string;
}

/**
 * CreativeRandomizer 类。
 */
export class CreativeRandomizer {
    constructor(private readonly random: RandomSource = trueRandom) {}

    /**
     * buildFactors 方法。
     * @param mode - 模式
      * @returns RandomFactorSet 实例
     */
    buildFactors(mode: CreationMode): RandomFactorSet {
        const scope = mode === 'short' ? 'short' : mode === 'script' ? 'script' : 'shared';
        const pickLayer = (key: keyof typeof PREMISE_FACTORS): string[] => {
            const groups = PREMISE_FACTORS[key] || [];
            return groups.map(group => this.random.pick(group));
        };

        return {
            seed: this.random.uuid(),
            layers: {
                premise: pickLayer('shared').concat(pickLayer(scope as 'short' | 'script' | 'shared')),
                structure: pickLayer('shared').concat(pickLayer(scope as 'short' | 'script' | 'shared')),
                texture: [this.random.pick(TEXTURE_FACTORS[0]), this.random.pick(TEXTURE_FACTORS[1]), this.random.pick(TEXTURE_FACTORS[2])],
                differentiation: this.random.pickMany(DIFFERENTIATION_FACTORS[0], 2)
                    .concat(this.random.pick(DIFFERENTIATION_FACTORS[1]))
                    .concat(this.random.pick(DIFFERENTIATION_FACTORS[2])),
            },
            forbiddenPatterns: this.random.pickMany(
                FORBIDDEN_PATTERN_GROUPS.flat(),
                Math.max(2, Math.min(4, FORBIDDEN_PATTERN_GROUPS.flat().length)),
            ),
        };
    }

    /**
     * promptBlock 方法。
     * @param factors - 因子列表
     * @returns 文本结果
     */
    promptBlock(factors: RandomFactorSet): string {
        return [
            '【多层真随机创作因子】',
            `随机种子：${factors.seed}`,
            '',
            '【前提层：主角/能力/压力/期待破坏】',
            ...factors.layers.premise.map(item => `- ${item}`),
            '',
            '【结构层：反转/情绪/升级】',
            ...factors.layers.structure.map(item => `- ${item}`),
            '',
            '【质感层：对白/细节/节奏】',
            ...factors.layers.texture.map(item => `- ${item}`),
            '',
            '【差异化约束】',
            ...factors.layers.differentiation.map(item => `- ${item}`),
            '',
            '【禁用套路】',
            ...factors.forbiddenPatterns.map(item => `- ${item}`),
            '',
            '硬性要求：随机因子必须实质影响情节走向、人物设定、细节描写、对白风格与场景安排；',
            '不得只把因子当作装饰。输出内容必须与常见同题材模板明显不同。',
        ].join('\n');
    }

    /**
     * 简报。
     * @param mode - 模式
      * @returns RandomizedBrief 实例
     */
    brief(mode: CreationMode): RandomizedBrief {
        const factors = this.buildFactors(mode);
        return { mode, seed: factors.seed, factors, promptBlock: this.promptBlock(factors) };
    }
}

/**
 * creativeRandomizer 常量。
 */
export const creativeRandomizer = new CreativeRandomizer();
