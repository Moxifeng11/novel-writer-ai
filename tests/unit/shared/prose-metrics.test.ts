import { describe, expect, it } from 'vitest';
import {
    analyzeProse,
    formatProseMetrics,
    scoreProseRisk,
    splitProseParagraphs,
    splitProseSentences,
} from '../../../shared/prose-metrics';

describe('prose-metrics', () => {
    it('空文本返回全零', () => {
        const metrics = analyzeProse('');
        expect(metrics.chars).toBe(0);
        expect(metrics.sentences).toBe(0);
        expect(metrics.paragraphs).toBe(0);
        expect(scoreProseRisk(metrics).score).toBe(0);
    });

    it('按行切段，忽略标题行', () => {
        const paragraphs = splitProseParagraphs('# 第1章 标题\n\n他抬手。\n风灌进来。');
        expect(paragraphs).toEqual(['他抬手。', '风灌进来。']);
    });

    it('切句保留句末标点', () => {
        const sentences = splitProseSentences('他抬手。风灌进来！真的吗？');
        expect(sentences).toEqual(['他抬手。', '风灌进来！', '真的吗？']);
    });

    it('碎片化文本：段短、单句段多、风险高', () => {
        const text = [
            '砂打在脸上。',
            '后颈那道月牙疤先挨了一下。',
            '硌得生疼。',
            '他把肩膀往绳栏上又抵了抵。',
            '桥跟着晃。',
        ].join('\n');
        const metrics = analyzeProse(text);
        const report = scoreProseRisk(metrics);

        expect(metrics.paragraphs).toBe(5);
        expect(metrics.avgNarrativeParagraphLength).toBeLessThan(30);
        expect(metrics.singleSentenceNarrativeParagraphRatio).toBe(1);
        expect(report.score).toBeGreaterThanOrEqual(60);
        expect(report.level).toBe('high');
        expect(report.issues.some((issue) => issue.id === 'fragmented-paragraphs')).toBe(true);
    });

    it('自然段文本：段长和句长明显改善', () => {
        const text = [
            '砂打在脸上，生疼。沈砚后颈那道月牙疤先挨了一下，硌得他龇了龇牙，把肩膀往绳栏上又抵了抵。桥跟着晃，脚底下踩的木板吱一声往左边歪过去半寸，他脚尖赶紧抓了抓鞋底，几粒碎砂灌进鞋尖，硌着脚趾头，难受得他直想骂娘。',
            '“站直了。”沈铁山的声音压得极低，从牙缝里往外挤。沈砚把背挺了挺，眼睛却还盯着桥那头灰白色的测脉碑。',
        ].join('\n');
        const metrics = analyzeProse(text);

        expect(metrics.paragraphs).toBe(2);
        expect(metrics.avgNarrativeParagraphLength).toBeGreaterThan(60);
        expect(metrics.singleSentenceNarrativeParagraphRatio).toBeLessThan(0.5);
    });

    it('统计对话占比与标点熵', () => {
        const text = '“你来了？”他问。\n“嗯。”她把伞收起来，抖了抖水，“路上堵。”';
        const metrics = analyzeProse(text);

        expect(metrics.dialogueCharsRatio).toBeGreaterThan(0.1);
        expect(metrics.punctuationEntropy).toBeGreaterThan(1);
        expect(formatProseMetrics(metrics)).toContain('对话');
    });

    it('叙述段里夹一句对话仍算叙述段', () => {
        const text = '沈砚把包袱放在桌角，手指在布结上停了一下。“够吗？”他问。沈铁山没回头，只把肩膀缩了缩。';
        const metrics = analyzeProse(text);

        expect(metrics.narrativeParagraphs).toBe(1);
        expect(metrics.dialogueParagraphs).toBe(0);
        expect(metrics.avgNarrativeParagraphLength).toBeGreaterThan(20);
    });

    it('标点越单一，熵越低', () => {
        const monotone = analyzeProse('他走了。她也走了。风停了。');
        const varied = analyzeProse('他走了？她也走了……风停了：真的吗！');
        expect(varied.punctuationEntropy).toBeGreaterThan(monotone.punctuationEntropy);
    });
});

describe('prose-metrics — 去AI味硬伤检测（2026-10-30）', () => {
    it('分号被计数并触发硬伤', () => {
        const text = '他停下脚步，看着门口。守卫的脸色变了；另一只手按上了刀柄；空气突然安静下来。';
        const metrics = analyzeProse(text);
        expect(metrics.semicolonCount).toBe(2);
        const report = scoreProseRisk(metrics);
        expect(report.issues.some((issue) => issue.id === 'semicolon-ban')).toBe(true);
    });

    it('无分号的正常文本不触发', () => {
        const text = '他停下脚步，看着门口。守卫的脸色变了，另一只手按上了刀柄，空气突然安静下来。';
        const metrics = analyzeProse(text);
        expect(metrics.semicolonCount).toBe(0);
        expect(scoreProseRisk(metrics).issues.some((issue) => issue.id === 'semicolon-ban')).toBe(false);
    });

    it('省略号与破折号超过硬上限时触发', () => {
        const text = [
            '他没说完……手却抬了起来。',
            '风声停了……屋里只剩呼吸。',
            '她后退半步……后背抵上门框……',
            '那把刀——三年前的刀——就挂在他腰间，刀鞘上的裂纹，一道一道——像干涸的河床——记着每一次出鞘。',
        ].join('\n');
        const metrics = analyzeProse(text);
        expect(metrics.ellipsisCount).toBeGreaterThanOrEqual(5);
        expect(metrics.dashCount).toBeGreaterThanOrEqual(5);
        const report = scoreProseRisk(metrics);
        expect(report.issues.some((issue) => issue.id === 'ellipsis-ban')).toBe(true);
        expect(report.issues.some((issue) => issue.id === 'dash-cap')).toBe(true);
    });

    it('「不是A，是B」堆叠触发排比检测', () => {
        const text = [
            '这不是愤怒。这是更冷的东西。',
            '不是他不想说。是他不知道从哪说起。',
            '那不是求助。而是命令，一个字一个字砸在地上。',
            '不是怕死，是怕死得没有价值，怕那些跟着他的人白死，怕到头来连名字都留不下。',
        ].join('\n');
        const metrics = analyzeProse(text);
        expect(metrics.reversalPairCount).toBeGreaterThanOrEqual(4);
        const report = scoreProseRisk(metrics);
        expect(report.issues.some((issue) => issue.id === 'reversal-stacking')).toBe(true);
    });

    it('偶发一次「不是…是…」不触发', () => {
        const text = [
            '废墟里炸了。不是形容，是真的炸了。一个光头汉子从断墙后面窜出来，脚底踩碎了半块石板，整个人像支箭一样射向塔门。他身后紧跟着三个同样红了眼的散修，嘴里喊着谁都听不清的话，更多的人从废墟的各个角落涌出来，把塔门前的空地站满。',
        ].join('\n');
        const metrics = analyzeProse(text);
        expect(metrics.reversalPairCount).toBe(1);
        expect(scoreProseRisk(metrics).issues.some((issue) => issue.id === 'reversal-stacking')).toBe(false);
    });

    it('「不知道…只知道…」排比感慨被识别', () => {
        const text = [
            '她不知道自己叫什么。她只知道三个名字，每一个都在三百年前死掉了。',
            '他不明白为什么是她。他不明白为什么是现在。他只知道钟声再响的时候，一切都要重新开始。',
            '老周把火把插进土里，坐下来，往火里添了根柴。',
        ].join('\n');
        const metrics = analyzeProse(text);
        expect(metrics.unknowingPatternCount).toBeGreaterThanOrEqual(1);
        expect(scoreProseRisk(metrics).issues.some((issue) => issue.id === 'reversal-stacking')).toBe(true);
    });

    it('末段升华被识别，正常动作收尾不误报', () => {
        const elevated = [
            '萧白盯着屏幕，指尖悬在回车键上停了三秒，然后按了下去。训练室的灯一层层亮起来，走廊尽头有人开始鼓掌，声音顺着楼梯漫上来。鹿小野从最上面一层冲下来，一把搂住他的肩膀，嘴里喊着全队都听过的那句老话，把散落在各个训练位上的人全喊了出来。有人把冷掉的外卖重新热上，有人翻出压箱底的队服，白板上的字擦了又写、写了又擦，一直闹到楼下的保安上来敲门，才算消停。',
            '这是关于伤和荣耀、告别和重逢的故事。',
        ].join('\n');
        const metrics = analyzeProse(elevated);
        expect(metrics.elevatedEnding).toBe(true);
        expect(scoreProseRisk(metrics).issues.some((issue) => issue.id === 'elevated-ending')).toBe(true);

        const action = [
            '萧白盯着屏幕，指尖悬在回车键上停了三秒，然后按了下去。训练室的灯一层层亮起来，走廊尽头有人开始鼓掌，声音顺着楼梯漫上来。鹿小野从最上面一层冲下来，一把搂住他的肩膀，嘴里喊着全队都听过的那句老话，把散落在各个训练位上的人全喊了出来。有人把冷掉的外卖重新热上，有人翻出压箱底的队服，白板上的字擦了又写、写了又擦，一直闹到楼下的保安上来敲门，才算消停。',
            '他伸出左手，把手机扣在桌上，灯灭了。',
        ].join('\n');
        expect(analyzeProse(action).elevatedEnding).toBe(false);
    });

    it('formatProseMetrics 带出硬伤计数', () => {
        const text = '他停下脚步；守卫的脸色变了……刀出鞘了——';
        const formatted = formatProseMetrics(analyzeProse(text));
        expect(formatted).toContain('分号');
        expect(formatted).toContain('省略号');
    });
});
