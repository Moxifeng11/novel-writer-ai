/**
 * settlement-service.ts — 章节结算服务（独立可调用）
 *
 * 将 settlement 从 StepRunner 解耦为独立 service，
 * 使 FullWriterView 和 CoWritingView 均可直接调用结算。
 *
 * 用法：
 *   import { SettlementService } from '../services/settlement-service';
 *   const svc = new SettlementService(app);
 *   await svc.settleChapter(project, chapDir, chapterName, bodyText);
 */

import { App } from 'obsidian';
import { SettlementEngine, SettlementResult } from '../engine/settlement-engine';
import type { Notifier } from '../shared/types';
import { NOOP_NOTIFIER } from '../shared/types';
import type NovelWriterPlugin from '../main';
import { ENGINE_NAMES } from '../engine/engine-registry';
import { createLogger } from '../shared/logger';


const log = createLogger('SettlementService');
export interface SettlementContext {
  project: string;
  chapDir: string;
  chapterName: string;
  bodyText: string;
}

export type { SettlementResult } from '../engine/settlement-engine';

export class SettlementService {
  private plugin: NovelWriterPlugin;
  private settlementEngine: SettlementEngine;
  private notifier: Notifier;

  constructor(plugin: NovelWriterPlugin, notifier?: Notifier) {
    this.plugin = plugin;
    this.notifier = notifier || NOOP_NOTIFIER;
    this.settlementEngine = plugin.engineRegistry.get<SettlementEngine>(ENGINE_NAMES.SETTLEMENT_ENGINE);
  }

  /**
   * 执行章节结算（包含分析报告生成、关系更新、叙事总览更新、伏笔揭示）
   */
  async settleChapter(ctx: SettlementContext): Promise<SettlementResult> {
    const { project, chapDir, chapterName, bodyText } = ctx;

    try {
      const result = await this.settlementEngine.settle(
        project, chapDir, chapterName,
        '' /* report 由 settlement engine 从分析报告文件读取 */,
        bodyText,
      );

      this.notifier.showNotice(`✅ ${chapterName} 结算完成 — 更新 ${result.updated} 项，新建 ${result.created} 项`, 6000);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('[SettlementService] 结算异常:', msg);
      throw e; // 让调用方处理
    }
  }
}
