import { describe, it, expect } from 'vitest';
import { VolumeOutlineSummarizer, VolumeSummary } from '../../../engine/volume-outline-summarizer';

const FULL_OUTLINE = `
## 第1卷 觉醒

### 人物弧光
- 主角：从废物到天才
- 反派：从隐伏到现身
- 配角：从冷漠到忠诚

### 主要事件
- 祠堂血夜：主角觉醒血脉
- 后山遇袭：获得神秘传承
- 京城初战：一战成名
- 密室解毒：化解生死危机

### 伏笔安排
- 埋设：黑剑的秘密
- 埋设：身世之谜
- 回收：玉佩的来历

### 结尾过渡
主角离开家乡，前往京城寻找真相。

### 势力变动
- 林家：被灭门
- 王家：崛起
- 青云宗：开始关注主角
`;

describe('VolumeOutlineSummarizer.extract — 标准大纲格式提取', () => {
    it('提取全部字段', () => {
        const summarizer = new VolumeOutlineSummarizer();
        const result = summarizer.extract(FULL_OUTLINE, 1);

        expect(result.volumeNumber).toBe(1);
        expect(result.characterChanges).toEqual([
            '主角：从废物到天才',
            '反派：从隐伏到现身',
            '配角：从冷漠到忠诚',
        ]);
        expect(result.eventOutcomes).toEqual([
            '祠堂血夜：主角觉醒血脉',
            '后山遇袭：获得神秘传承',
            '京城初战：一战成名',
            '密室解毒：化解生死危机',
        ]);
        expect(result.newForeshadows).toEqual([
            '埋设：黑剑的秘密',
            '埋设：身世之谜',
        ]);
        expect(result.resolvedForeshadows).toEqual([
            '回收：玉佩的来历',
        ]);
        expect(result.pendingForeshadows).toEqual([
            '埋设：黑剑的秘密',
            '埋设：身世之谜',
        ]);
        expect(result.endingTransition).toBe('主角离开家乡，前往京城寻找真相。');
        expect(result.factionChanges).toEqual([
            '林家：被灭门',
            '王家：崛起',
            '青云宗：开始关注主角',
        ]);
    });

    it('支持 * 列表符号', () => {
        const outline = `
### 人物弧光
* 主角：从废物到天才
* 反派：从隐伏到现身

### 主要事件
* 祠堂血夜：主角觉醒血脉
`;
        const summarizer = new VolumeOutlineSummarizer();
        const result = summarizer.extract(outline, 2);

        expect(result.characterChanges).toEqual(['主角：从废物到天才', '反派：从隐伏到现身']);
        expect(result.eventOutcomes).toEqual(['祠堂血夜：主角觉醒血脉']);
    });

    it('已回收的伏笔不计入 pendingForeshadows', () => {
        const outline = `
### 伏笔安排
- 埋设：黑剑的秘密
- 埋设：身世之谜
- 回收：身世之谜
`;
        const summarizer = new VolumeOutlineSummarizer();
        const result = summarizer.extract(outline, 1);

        expect(result.newForeshadows).toEqual(['埋设：黑剑的秘密', '埋设：身世之谜']);
        expect(result.resolvedForeshadows).toEqual(['回收：身世之谜']);
        expect(result.pendingForeshadows).toEqual(['埋设：黑剑的秘密']);
    });
});

describe('VolumeOutlineSummarizer.extract — 边界情况', () => {
    it('空文本返回空结构', () => {
        const summarizer = new VolumeOutlineSummarizer();
        const result = summarizer.extract('', 1);

        expect(result.volumeNumber).toBe(1);
        expect(result.characterChanges).toEqual([]);
        expect(result.eventOutcomes).toEqual([]);
        expect(result.newForeshadows).toEqual([]);
        expect(result.resolvedForeshadows).toEqual([]);
        expect(result.pendingForeshadows).toEqual([]);
        expect(result.endingTransition).toBe('');
        expect(result.factionChanges).toEqual([]);
    });

    it('缺少章节返回对应空字段', () => {
        const outline = `
### 人物弧光
- 主角：从废物到天才
`;
        const summarizer = new VolumeOutlineSummarizer();
        const result = summarizer.extract(outline, 1);

        expect(result.characterChanges).toEqual(['主角：从废物到天才']);
        expect(result.eventOutcomes).toEqual([]);
        expect(result.newForeshadows).toEqual([]);
        expect(result.endingTransition).toBe('');
        expect(result.factionChanges).toEqual([]);
    });

    it('章节内无列表项返回空数组', () => {
        const outline = `
### 人物弧光
主角从废物到天才
`;
        const summarizer = new VolumeOutlineSummarizer();
        const result = summarizer.extract(outline, 1);

        expect(result.characterChanges).toEqual([]);
    });

    it('仅含空白字符的章节返回空字符串', () => {
        const outline = `
### 结尾过渡
   
`;
        const summarizer = new VolumeOutlineSummarizer();
        const result = summarizer.extract(outline, 1);

        expect(result.endingTransition).toBe('');
    });
});

describe('VolumeOutlineSummarizer.compress — 压缩功能', () => {
    function makeLongSummary(volumeNumber: number): VolumeSummary {
        const items: string[] = [];
        for (let i = 1; i <= 20; i++) {
            items.push(`事件${i}：${'a'.repeat(80)}`);
        }
        return {
            volumeNumber,
            characterChanges: [
                `角色A：${'b'.repeat(80)}`,
                `角色B：${'c'.repeat(80)}`,
                `角色C：${'d'.repeat(80)}`,
                `角色D：${'e'.repeat(80)}`,
            ],
            eventOutcomes: items,
            newForeshadows: [
                `埋设：伏笔${volumeNumber}-1：${'f'.repeat(60)}`,
                `埋设：伏笔${volumeNumber}-2：${'g'.repeat(60)}`,
            ],
            resolvedForeshadows: [],
            pendingForeshadows: [
                `埋设：伏笔${volumeNumber}-1：${'f'.repeat(60)}`,
                `埋设：伏笔${volumeNumber}-2：${'g'.repeat(60)}`,
            ],
            endingTransition: `结尾过渡内容：${'h'.repeat(200)}`,
            factionChanges: [
                `势力A：${'i'.repeat(80)}`,
                `势力B：${'j'.repeat(80)}`,
                `势力C：${'k'.repeat(80)}`,
            ],
        };
    }

    it('短摘要不触发压缩', () => {
        const s: VolumeSummary = {
            volumeNumber: 1,
            characterChanges: ['主角：从废物到天才'],
            eventOutcomes: ['祠堂血夜：主角觉醒血脉'],
            newForeshadows: [],
            resolvedForeshadows: [],
            pendingForeshadows: [],
            endingTransition: '主角离开家乡。',
            factionChanges: ['林家：被灭门'],
        };
        const summarizer = new VolumeOutlineSummarizer();
        const text = summarizer.compress([s], 6000);

        expect(text.length).toBeLessThanOrEqual(6000);
        expect(text).toContain('## 第1卷摘要');
        expect(text).toContain('### 人物弧光');
        expect(text).toContain('### 主要事件');
        expect(text).toContain('### 结尾过渡');
        expect(text).toContain('### 势力变动');
    });

    it('多卷长摘要压缩到 maxLength 以内', () => {
        const summaries: VolumeSummary[] = [];
        for (let i = 1; i <= 5; i++) {
            summaries.push(makeLongSummary(i));
        }

        const summarizer = new VolumeOutlineSummarizer();
        const text = summarizer.compress(summaries, 6000);

        expect(text.length).toBeLessThanOrEqual(6000);
    });

    it('最近卷保留完整，更早卷被简化', () => {
        const summaries: VolumeSummary[] = [];
        for (let i = 1; i <= 3; i++) {
            summaries.push(makeLongSummary(i));
        }

        const summarizer = new VolumeOutlineSummarizer();
        const text = summarizer.compress(summaries, 6000);

        expect(text.length).toBeLessThanOrEqual(6000);

        const parts = text.split('## 第');
        // parts[0] 为空，parts[1..3] 对应三卷
        expect(parts.length).toBeGreaterThanOrEqual(3);

        // 最近卷（第3卷）应包含结尾过渡和势力变动
        const lastPart = parts[parts.length - 1];
        expect(lastPart).toContain('### 结尾过渡');
        expect(lastPart).toContain('### 势力变动');
    });

    it('空数组返回空字符串', () => {
        const summarizer = new VolumeOutlineSummarizer();
        const text = summarizer.compress([], 6000);
        expect(text).toBe('');
    });
});
