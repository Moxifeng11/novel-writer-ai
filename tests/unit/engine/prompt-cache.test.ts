import { describe, it, expect } from 'vitest';
import { PromptCache } from '../../../engine/prompt-cache';

function resp(content: string): any {
  return { content, error: null };
}

describe('PromptCache — TR-2.1 命中', () => {
  it('set 后 get 命中返回原响应', () => {
    const cache = new PromptCache(64);
    cache.set('h1', resp('正文内容'));
    expect(cache.get('h1')?.content).toBe('正文内容');
  });
});

describe('PromptCache — TR-2.2 未命中', () => {
  it('miss 返回 null', () => {
    const cache = new PromptCache(64);
    expect(cache.get('nope')).toBeNull();
  });
});

describe('PromptCache — TR-2.3 LRU 淘汰', () => {
  it('超过 maxEntries 时淘汰最旧条目', () => {
    const cache = new PromptCache(2);
    cache.set('old', resp('旧'));
    cache.set('mid', resp('中'));
    cache.set('new', resp('新')); // 触发淘汰 old
    expect(cache.get('old')).toBeNull();
    expect(cache.get('mid')?.content).toBe('中');
    expect(cache.get('new')?.content).toBe('新');
    expect(cache.size).toBe(2);
  });

  it('get 会刷新条目热度（最旧 = 最久未访问）', () => {
    const cache = new PromptCache(2);
    cache.set('a', resp('A'));
    cache.set('b', resp('B'));
    cache.get('a');          // a 变为最近使用
    cache.set('c', resp('C')); // 应淘汰 b 而非 a
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')?.content).toBe('A');
  });
});

describe('PromptCache — TR-2.4 清空', () => {
  it('clear 后 size=0，全部 miss', () => {
    const cache = new PromptCache(64);
    cache.set('h', resp('x'));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('h')).toBeNull();
  });
});

describe('PromptCache — 边界', () => {
  it('maxEntries=1 时 set 两次只留最后一条', () => {
    const cache = new PromptCache(1);
    cache.set('a', resp('A'));
    cache.set('b', resp('B'));
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')?.content).toBe('B');
  });

  it('默认构造（无参）可用', () => {
    const cache = new PromptCache();
    expect(cache.size).toBe(0);
  });
});
