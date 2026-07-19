/**
 * quality-history-store.ts — 质量评估历史存储（实时监控 V2 Task 5）
 *
 * 使用 LruCache 实现质量评估历史记录的存储和查询。
 * 支持：
 *   - 按章节 ID 存储历史记录
 *   - 获取最近 N 条记录
 *   - 清除历史
 */

import { LruCache } from '../repository/lru-cache';

export interface QualityHistoryRecord {
  timestamp: number;
  overallScore: number;
  scoreBreakdown?: Record<string, number>;
}

export interface QualityHistoryStoreOptions {
  maxSize?: number;
  ttlMs?: number;
}

export class QualityHistoryStore {
  private cache: LruCache<string, QualityHistoryRecord[]>;

  constructor(options: QualityHistoryStoreOptions = {}) {
    this.cache = new LruCache<string, QualityHistoryRecord[]>({
      maxSize: options.maxSize ?? 100,
      ttlMs: options.ttlMs ?? 24 * 60 * 60 * 1000, // 默认 1 天
    });
  }

  /**
   * 添加一条评估记录
   */
  addRecord(chapterId: string, record: QualityHistoryRecord): void {
    const key = this.buildKey(chapterId);
    const existing = this.cache.get(key) ?? [];
    const updated = [...existing, record].slice(-50); // 保留最近 50 条
    this.cache.set(key, updated);
  }

  /**
   * 获取章节的历史记录（按时间升序）
   */
  getHistory(chapterId: string): QualityHistoryRecord[] | null {
    const key = this.buildKey(chapterId);
    return this.cache.get(key) ?? null;
  }

  /**
   * 获取最近的 N 条记录
   */
  getRecentRecords(chapterId: string, limit: number): QualityHistoryRecord[] {
    const history = this.getHistory(chapterId);
    if (!history) return [];
    return history.slice(-limit);
  }

  /**
   * 清除章节历史
   */
  clearHistory(chapterId: string): void {
    const key = this.buildKey(chapterId);
    this.cache.delete(key);
  }

  /**
   * 清除所有历史
   */
  clearAll(): void {
    this.cache.clear();
  }

  private buildKey(chapterId: string): string {
    return `quality-history::${chapterId}`;
  }
}