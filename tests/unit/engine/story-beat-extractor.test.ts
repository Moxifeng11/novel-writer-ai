import { describe, it, expect } from 'vitest';
import { StoryBeatExtractor } from '../../../engine/story-beat-extractor';

describe('StoryBeatExtractor — 边界与降级', () => {
  it('默认构造函数不报错', () => {
    expect(new StoryBeatExtractor()).toBeDefined();
  });

  it('空文本返回空数组', () => {
    const extractor = new StoryBeatExtractor();
    expect(extractor.extract('')).toEqual([]);
    expect(extractor.extract('   \n  ')).toEqual([]);
  });

  it('非字符串输入返回空数组', () => {
    const extractor = new StoryBeatExtractor();
    // @ts-expect-error 故意传非法输入验证降级
    expect(extractor.extract(null)).toEqual([]);
    // @ts-expect-error 故意传非法输入验证降级
    expect(extractor.extract(undefined)).toEqual([]);
  });
});

describe('StoryBeatExtractor — 解析与类型映射', () => {
  it('识别带类型标记的条目', () => {
    const extractor = new StoryBeatExtractor();
    const plan = [
      '- 事件：主角进入禁地',
      '- 冲突：与守卫正面交锋',
      '- 揭示：主角身世的第一条线索',
      '- 情绪：从恐惧转为坚定',
      '- 关系：与同伴产生裂痕',
      '- 钩子：结尾出现神秘黑影',
    ].join('\n');
    const beats = extractor.extract(plan);
    expect(beats).toHaveLength(6);
    expect(beats.map((b) => b.type)).toEqual([
      'event', 'conflict', 'reveal', 'emotion', 'relationship', 'hook',
    ]);
    expect(beats[0].description).toBe('主角进入禁地');
  });

  it('每个 beat 生成唯一 id', () => {
    const extractor = new StoryBeatExtractor();
    const beats = extractor.extract('- 事件：A\n- 事件：B');
    expect(beats).toHaveLength(2);
    expect(beats[0].id).not.toBe(beats[1].id);
  });

  it('含"必须"关键字的条目标记为 required', () => {
    const extractor = new StoryBeatExtractor();
    const beats = extractor.extract('- 事件（必须）：救出人质\n- 事件：路边小插曲');
    expect(beats[0].required).toBe(true);
    expect(beats[1].required).toBe(false);
  });

  it('无类型标记的条目默认归为 event', () => {
    const extractor = new StoryBeatExtractor();
    const beats = extractor.extract('- 主角赶往城门');
    expect(beats).toHaveLength(1);
    expect(beats[0].type).toBe('event');
    expect(beats[0].description).toBe('主角赶往城门');
  });

  it('忽略非列表行（标题、空行）', () => {
    const extractor = new StoryBeatExtractor();
    const plan = '# 第三章规划\n\n概述：本章推进主线\n\n- 事件：决战开始';
    const beats = extractor.extract(plan);
    expect(beats).toHaveLength(1);
    expect(beats[0].description).toBe('决战开始');
  });
});
