/**
 * suggestion-history-store.ts - 协同建议历史持久化（C3 抽离）
 *
 * 从 CoWritingView 抽出的「历史建议读写」职责块：计算历史 JSON 路径、
 * 章节切换后懒加载历史、接受建议后写盘（最多保留 20 条）。控制器持有
 * view 引用，复用主视图的 ensureVaultFolder 与 app.vault。
 */

import { TFile } from 'obsidian';
import type { CoWritingView } from '../co-writing-view';
import { SentenceEditRecord } from '../../shared/types';
import { pjStepDir } from '../../shared/paths';
import { createLogger } from '../../shared/logger';


const log = createLogger('SuggestionHistoryStore');
/**
 * SuggestionHistoryStore 类。
 */
export class SuggestionHistoryStore {
  view: CoWritingView;
  /** 串行化写盘：并发 persist 会同时判定「文件不存在」→ 后者 create 抛错被吞，静默少写一批 */
  private persistChain: Promise<void> = Promise.resolve();

  constructor(view: CoWritingView) {
    this.view = view;
  }

  /**
   * 获取历史路径。
   */
  getHistoryPath() {
    const view = this.view;
    if (!view.project || !view.volume || !view.chapterNum)
      return "";
    const volMatch = view.volume.match(/第(\d+)卷/);
    const volN = volMatch ? parseInt(volMatch[1], 10) : 0;
    if (volN <= 0) return "";
    return `${pjStepDir(view.project, volN, view.chapterNum)}/协同历史.json`;
  }

  /**
   * loadSuggestionHistory 方法。
   */
  async loadSuggestionHistory() {
    const view = this.view;
    if (view.historyLoaded || !view.project || !view.volume || !view.chapterNum)
      return;
    try {
      const historyPath = this.getHistoryPath();
      const file = historyPath ? view.app.vault.getAbstractFileByPath(historyPath) : null;
      if (!(file instanceof TFile)) {
        // 文件不存在属于确定结果：不必再重试
        view.historyLoaded = true;
        return;
      }
      const raw = await view.app.vault.read(file);
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed?.records) ? parsed.records : Array.isArray(parsed) ? parsed : [];
      view.suggestionHistory = records.filter((rec: SentenceEditRecord) => rec && rec.id).slice(-20);
      view.historyLoaded = true;
    } catch (e) {
      // 读取/解析失败不能锁死：否则本次会话历史面板永远为空，也不会再重试
      view.historyLoaded = false;
      log.warn("[SuggestionHistoryStore] B3: 历史建议加载失败:", e);
    }
  }

  /**
   * persistSuggestionHistory 方法。
   */
  async persistSuggestionHistory() {
    this.persistChain = this.persistChain.then(() => this.doPersist()).catch(() => {});
    return this.persistChain;
  }

  private async doPersist() {
    const view = this.view;
    try {
      const historyPath = this.getHistoryPath();
      if (!historyPath)
        return;
      const dir = historyPath.split("/").slice(0, -1).join("/");
      await view.ensureVaultFolder(dir);
      const payload = JSON.stringify({
        project: view.project,
        volume: view.volume,
        chapterNum: view.chapterNum,
        chapterName: view.chapterName || `第${view.chapterNum}章`,
        updatedAt: new Date().toISOString(),
        records: view.suggestionHistory.slice(-20)
      }, null, 2);
      const file = view.app.vault.getAbstractFileByPath(historyPath);
      if (file instanceof TFile) {
        await view.app.vault.modify(file, payload);
        return;
      }
      try {
        await view.app.vault.create(historyPath, payload);
      } catch (createError) {
        // create 与外部/并发创建竞争时，退回 modify，别把这一批历史吞掉
        const raced = view.app.vault.getAbstractFileByPath(historyPath);
        if (!(raced instanceof TFile)) throw createError;
        await view.app.vault.modify(raced, payload);
      }
    } catch (e) {
      log.warn("[SuggestionHistoryStore] B3: 历史建议保存失败:", e);
    }
  }
}
