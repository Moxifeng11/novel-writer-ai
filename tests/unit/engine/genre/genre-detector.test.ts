import { describe, it, expect, beforeEach } from 'vitest';
import { GenreDetector } from '../../../../engine/genre/genre-detector';
import { GenreConfigRegistry } from '../../../../engine/genre/genre-config-registry';

/**
 * 测试用特征词（直接从 genre-presets JSON 提取，避免硬编码不一致）
 */
const CULTIVATION_SIGNALS = [
    '功法', '修为', '境界', '渡劫', '灵根', '修真', '炼气', '筑基', '金丹', '元婴', '化神',
];

// 选用 military 独有的 detectorSignals，避免与 history 共享的"战争/将军/帝国"产生交叉命中
const MILITARY_ONLY_SIGNALS = [
    '统帅', '谋略', '厮杀', '溃退', '军团', '统领', '战役', '战术', '战略',
];

const ROMANCE_SIGNALS = [
    '甜宠', '虐恋', '告白', '邂逅', '情书', '约会', '心动', '暧昧', '喜欢', '爱', '恋人', '男友', '女友',
];

/**
 * 构造测试文本：每个关键词重复 N 次，用空格分隔，避免子串重叠干扰。
 */
function buildText(keywords: string[], repeats: number): string {
    return keywords.map(kw => kw.repeat(repeats)).join(' ');
}

describe('GenreDetector - 题材识别', () => {
    let detector: GenreDetector;

    beforeEach(() => {
        GenreConfigRegistry.resetInstance();
        detector = new GenreDetector();
    });

    describe('detect - 单一题材识别', () => {
        it('修仙样本返回 cultivation', () => {
            const text = buildText(CULTIVATION_SIGNALS, 5);
            const result = detector.detect(text);
            expect(result.genreId).toBe('cultivation');
            expect(result.confidence).toBeGreaterThan(0);
        });

        it('军事样本返回 military', () => {
            const text = buildText(MILITARY_ONLY_SIGNALS, 5);
            const result = detector.detect(text);
            expect(result.genreId).toBe('military');
            expect(result.confidence).toBeGreaterThan(0);
        });

        it('言情样本返回 romance', () => {
            const text = buildText(ROMANCE_SIGNALS, 5);
            const result = detector.detect(text);
            expect(result.genreId).toBe('romance');
            expect(result.confidence).toBeGreaterThan(0);
        });
    });

    describe('detect - 未识别题材兜底', () => {
        it('通用文本返回 generic', () => {
            const text = '今天天气不错，我们一起去散步。路边的花开得很美，鸟儿在歌唱。';
            const result = detector.detect(text);
            expect(result.genreId).toBe('generic');
            expect(result.confidence).toBe(0);
        });

        it('空文本返回 generic', () => {
            const result = detector.detect('');
            expect(result.genreId).toBe('generic');
            expect(result.confidence).toBe(0);
        });

        it('特征词命中不足时返回 generic', () => {
            // 仅含 1 个修仙词 1 次，但若总命中数低且 confidence 不达 0.4 时可能返回 generic
            // 此处构造多题材各 1 次命中，让 confidence 难达阈值
            const text = '功法 统帅 甜宠 诡计';
            const result = detector.detect(text);
            // 每个题材各命中 1 次，confidence = 1/4 = 0.25 < 0.4 → generic
            expect(result.genreId).toBe('generic');
            expect(result.confidence).toBe(0);
        });
    });

    describe('detect - 多题材混合识别', () => {
        it('修仙+言情混合且比例相近时返回 primary + secondary', () => {
            // cultivation 命中 11*5=55，romance 命中 13*4=52，52/55≈0.945 >= 0.7 → 触发 secondary
            const text = buildText(CULTIVATION_SIGNALS, 5) + ' ' + buildText(ROMANCE_SIGNALS, 4);
            const result = detector.detect(text);
            expect(result.genreId).toBe('cultivation');
            expect(result.primary).toBe('cultivation');
            expect(result.secondary).toBe('romance');
            expect(result.confidence).toBeGreaterThan(0.4);
        });

        it('主题材占绝对优势时不返回 secondary', () => {
            // cultivation 命中 11*10=110，romance 命中 13*1=13，13/110≈0.12 < 0.7 → 不触发 secondary
            const text = buildText(CULTIVATION_SIGNALS, 10) + ' ' + buildText(ROMANCE_SIGNALS, 1);
            const result = detector.detect(text);
            expect(result.genreId).toBe('cultivation');
            expect(result.secondary).toBeUndefined();
        });
    });

    describe('detect - 抽样行为', () => {
        it('文本超过 5000 字时只抽样前 5000 字', () => {
            // 构造 6000 字的通用前缀 + 修仙特征词
            const padding = '天气真好'.repeat(1500); // 6000 字
            const text = padding + buildText(CULTIVATION_SIGNALS, 5);
            const result = detector.detect(text);
            // 修仙特征词在 5000 字之后，抽样不到 → 返回 generic
            expect(result.genreId).toBe('generic');
            expect(result.confidence).toBe(0);
        });

        it('文本不足 5000 字时使用全部文本', () => {
            const text = buildText(CULTIVATION_SIGNALS, 3); // 总长约 200 字
            const result = detector.detect(text);
            expect(result.genreId).toBe('cultivation');
        });
    });
});
