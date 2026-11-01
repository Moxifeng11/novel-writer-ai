/**
 * @deprecated 此文件已废弃，不再从 UI 入口调用。
 * 知识库管理功能已统一到 KnowledgeBaseView（ui/views/knowledge-base-view.ts）。
 * 写作辅助功能保留在 CoWritingView 右栏内联知识库 Tab 中。
 * 保留此文件仅供历史参考，不应在新代码中引用。
 * 废弃日期：2026-07-12
 */
/**
 * knowledge-floating-panel.ts — 写作知识库浮动面板
 * 节奏建议 + 技巧推荐 + 相似片段
 */
import { WorkspaceLeaf, Notice, TFile } from "obsidian";
import NovelWriterPlugin from "../main";
import { DraggablePanel } from "./draggable-panel";
import { KnowledgeBaseManager, BookBasicInfo } from "../services/knowledge-base-manager";
import { KnowledgeSearchResult } from "../engine/knowledge-vector-store";
import { kbBookRhythmAnalysisFile } from "../shared/paths";
import { formatKnowledgeChunkLabel } from "../shared/knowledge-position";
import { VIEW_TYPE_CO_WRITE } from "./co-writing-view";
import { createLogger } from '../shared/logger';
import { isImeComposing } from '../shared/keyboard';


const log = createLogger('KnowledgeFloatingPanel');
export const VIEW_TYPE_KNOWLEDGE = "nw-float-knowledge";

type TabKey = "style" | "rhythm" | "technique" | "structure" | "character" | "similar";

const TAB_LABELS: Record<TabKey, string> = {
  style: "🎨 风格分析",
  rhythm: "🎯 节奏建议",
  technique: "✨ 技巧推荐",
  structure: "🏗️ 结构拆解",
  character: "👥 人物设定",
  similar: "🔍 相似片段",
};

interface TechniqueItem {
  name: string;
  category: string;
  confidence: number;
  examples: string[];
}

interface SimilarSegment {
  id: string;
  similarity: number;
  bookName: string;
  position: string;
  preview: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  style: "风格",
  rhythm: "节奏",
  technique: "技巧",
  structure: "结构",
  character: "人设",
  foreshadow: "伏笔",
};

export class KnowledgeFloatingPanel extends DraggablePanel {
  private kbManager: KnowledgeBaseManager | null = null;
  private activeTab: TabKey = "rhythm";

  private tabContent!: HTMLElement;
  private rhythmTabContent!: HTMLElement;
  private techniqueTabContent!: HTMLElement;
  private similarTabContent!: HTMLElement;
  private styleTabContent!: HTMLElement;
  private structureTabContent!: HTMLElement;
  private characterTabContent!: HTMLElement;

  private selectedBooks: Set<string> = new Set();
  private searchQuery = "";
  private expandedExamples: Record<string, boolean> = {};

  private booksCache: BookBasicInfo[] = [];
  private booksCacheLoaded = false;

  private techniqueResults: KnowledgeSearchResult[] = [];
  private techniqueLoading = false;
  private similarResults: KnowledgeSearchResult[] = [];
  private similarLoading = false;
  private similarOnlyRefBooks = true;
  private similarTopN = 10;
  private expandedSimilar: Record<string, boolean> = {};

  constructor(leaf: WorkspaceLeaf, plugin: NovelWriterPlugin) {
    super(leaf, plugin, "knowledge", "📚 写作知识库", "book-open");
  }

  protected renderBody(container: HTMLElement): void {
    container.addClass("nw-float-knowledge-panel");

    this.initKnowledgeManager();
    this.renderTabs(container);
    this.tabContent = container.createDiv({ cls: "nw-float-knowledge-content" });
    this.renderTabContent();
  }

  private initKnowledgeManager(): void {
    try {
      // 使用插件共享实例（由 EngineRegistry 初始化），避免多实例状态不同步
      this.kbManager = this.plugin.knowledgeBaseManager ?? null;
    } catch (e) {
      this.kbManager = null;
    }
  }

  private renderTabs(container: HTMLElement): void {
    const tabsContainer = container.createDiv({
      cls: "nw-float-knowledge-tabs",
    });

    const tabKeys: TabKey[] = ["style", "rhythm", "technique", "structure", "character", "similar"];
    for (const key of tabKeys) {
      const tab = tabsContainer.createEl("button", {
        cls: `nw-float-knowledge-tab nw-tab-${key}${this.activeTab === key ? " active" : ""}`,
        text: TAB_LABELS[key],
      });
      tab.addEventListener("click", () => {
        this.activeTab = key;
        this.updateTabStyles(tabsContainer);
        this.renderTabContent();
      });
    }
  }

  private updateTabStyles(tabsContainer: HTMLElement): void {
    const tabs = tabsContainer.querySelectorAll(".nw-float-knowledge-tab");
    const tabKeys: TabKey[] = ["style", "rhythm", "technique", "structure", "character", "similar"];
    tabs.forEach((tab, index) => {
      const key = tabKeys[index];
      if (this.activeTab === key) {
        tab.addClass("active");
      } else {
        tab.removeClass("active");
      }
    });
  }

  private renderTabContent(): void {
    if (!this.tabContent) return;
    this.tabContent.empty();

    this.loadBooksIfNeeded().catch(() => {});

    switch (this.activeTab) {
      case "style":
        this.renderStyleTab(this.tabContent);
        break;
      case "rhythm":
        this.renderRhythmTab(this.tabContent);
        break;
      case "technique":
        this.renderTechniqueTab(this.tabContent);
        break;
      case "structure":
        this.renderStructureTab(this.tabContent);
        break;
      case "character":
        this.renderCharacterTab(this.tabContent);
        break;
      case "similar":
        this.renderSimilarTab(this.tabContent);
        break;
    }
  }

  // ============== Tab 1: 节奏建议 ==============
  private renderRhythmTab(container: HTMLElement): void {
    this.rhythmTabContent = container;

    const bookSelectSection = this.rhythmTabContent.createDiv({
      cls: "nw-float-card",
    });
    bookSelectSection.createEl("h5", { text: "📚 参考书籍" });
    const bookSelectBody = bookSelectSection.createDiv({
      cls: "nw-float-card-body",
    });
    this.renderBookMultiSelect(bookSelectBody);

    const currentRhythmSection = this.rhythmTabContent.createDiv({
      cls: "nw-float-card",
    });
    currentRhythmSection.createEl("h5", { text: "🎯 当前章节节奏" });
    const currentRhythmBody = currentRhythmSection.createDiv({
      cls: "nw-float-card-body",
    });
    this.renderCurrentRhythm(currentRhythmBody);

    const refRhythmSection = this.rhythmTabContent.createDiv({
      cls: "nw-float-card",
    });
    refRhythmSection.createEl("h5", { text: "📖 参考节奏模式" });
    const refRhythmBody = refRhythmSection.createDiv({
      cls: "nw-float-card-body",
    });
    this.renderRefRhythm(refRhythmBody);

    const suggestionSection = this.rhythmTabContent.createDiv({
      cls: "nw-float-card",
    });
    suggestionSection.createEl("h5", { text: "💡 节奏调整建议" });
    const suggestionBody = suggestionSection.createDiv({
      cls: "nw-float-card-body",
    });
    this.renderRhythmSuggestions(suggestionBody);
  }

  private renderBookMultiSelect(container: HTMLElement): void {
    const books = this.getCompletedBooks();

    if (!this.booksCacheLoaded) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "加载中...",
      });
      this.loadBooksIfNeeded().then(() => {
        if (this.rhythmTabContent) {
          this.renderRhythmTab(this.rhythmTabContent);
        }
      }).catch(e => {
        log.warn('[KnowledgeFloatingPanel] 加载知识库书目失败:', e);
        container.empty();
        const retry = container.createDiv({ cls: 'nw-float-empty', text: '书目加载失败' });
        const btn = retry.createEl('button', { cls: 'nw-btn nw-btn-secondary', text: '重试' });
        btn.onclick = () => {
          this.booksCacheLoaded = false;
          this.renderRhythmTab(container);
        };
      });
      return;
    }

    if (books.length === 0) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "暂无已拆解的书籍",
      });
      return;
    }

    const hint = container.createDiv({
      cls: "nw-float-knowledge-hint",
      text: "选择参考书籍后显示对应分析",
    });

    const bookList = container.createDiv({
      cls: "nw-float-knowledge-book-list",
    });

    for (const book of books) {
      const bookItem = bookList.createDiv({
        cls: `nw-float-knowledge-book-item${
          this.selectedBooks.has(book.id) ? " selected" : ""
        }`,
      });

      const checkbox = bookItem.createEl("input", {
        attr: { type: "checkbox" },
      });
      checkbox.checked = this.selectedBooks.has(book.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedBooks.add(book.id);
          bookItem.addClass("selected");
        } else {
          this.selectedBooks.delete(book.id);
          bookItem.removeClass("selected");
        }
        this.refreshRhythmData();
      });

      bookItem.createSpan({ text: book.name });
    }
  }

  private async loadBooksIfNeeded(): Promise<void> {
    if (this.booksCacheLoaded) return;
    if (!this.kbManager) {
      this.booksCache = [];
      this.booksCacheLoaded = true;
      return;
    }
    try {
      this.booksCache = await this.kbManager.listBooks({ status: 'completed' });
      this.booksCacheLoaded = true;
    } catch (e) {
      log.warn('[KnowledgeFloatingPanel] 加载书籍列表失败:', e);
      this.booksCache = [];
      this.booksCacheLoaded = true;
    }
  }

  private getCompletedBooks(): BookBasicInfo[] {
    return this.booksCache.filter((b) => b.breakdownStatus === "completed");
  }

  private getCoWritingView(): any | null {
    try {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CO_WRITE);
      if (leaves.length > 0 && leaves[0].view) {
        return leaves[0].view;
      }
    } catch (e) {
      log.warn('[KnowledgeFloatingPanel] 获取协同写作视图失败:', e);
    }
    return null;
  }

  private getCurrentCursorPosition(): number | null {
    const view = this.getCoWritingView();
    if (view && typeof view.getCursorRelativePosition === 'function') {
      return view.getCursorRelativePosition();
    }
    return null;
  }

  private async getBookRhythmData(book: BookBasicInfo): Promise<any | null> {
    try {
      const rhythmPath = kbBookRhythmAnalysisFile(book.name);
      const file = this.app.vault.getAbstractFileByPath(rhythmPath);
      if (!(file instanceof TFile)) return null;
      const content = await this.app.vault.read(file);
      return this.parseRhythmAnalysis(content);
    } catch (e) {
      log.warn(`[KnowledgeFloatingPanel] 读取书籍 ${book.name} 节奏分析失败:`, e);
      return null;
    }
  }

  private parseRhythmAnalysis(content: string): any {
    const result: {
      plotStages: Array<{ type: string; startPosition: number; endPosition: number; description: string }>;
      emotionPoints: Array<{ position: number; type: string; intensity: number; description: string }>;
      avgRhythm: number;
      stats: any;
    } = {
      plotStages: [],
      emotionPoints: [],
      avgRhythm: 50,
      stats: {},
    };

    try {
      const plotStagesMatch = content.match(/##\s*剧情阶段划分([\s\S]*?)(?=\n##|\n#|$)/);
      if (plotStagesMatch) {
        const stageLines = plotStagesMatch[1].split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'));
        for (const line of stageLines) {
          const match = line.match(/(.+?)[：:]\s*(\d+)%[-~到](\d+)%[，,]\s*(.+)/);
          if (match) {
            result.plotStages.push({
              type: match[1].trim(),
              startPosition: parseInt(match[2]) / 100,
              endPosition: parseInt(match[3]) / 100,
              description: match[4].trim(),
            });
          }
        }
      }

      const avgRhythmMatch = content.match(/平均节奏[：:]\s*(\d+)/);
      if (avgRhythmMatch) {
        result.avgRhythm = parseInt(avgRhythmMatch[1]);
      }

      const statsMatch = content.match(/##\s*统计信息([\s\S]*?)(?=\n##|\n#|$)/);
      if (statsMatch) {
        const lines = statsMatch[1].split('\n').filter(l => l.trim());
        for (const line of lines) {
          const m = line.match(/[-\s]*(.+?)[：:]\s*(.+)/);
          if (m) {
            result.stats[m[1].trim()] = m[2].trim();
          }
        }
      }
    } catch (e) {
      log.warn('[KnowledgeFloatingPanel] 解析节奏分析失败:', e);
    }

    return result;
  }

  private getEmotionPointAtPosition(position: number, rhythmData: any): string {
    if (!rhythmData?.plotStages || rhythmData.plotStages.length === 0) {
      return '未知阶段';
    }
    for (const stage of rhythmData.plotStages) {
      if (position >= stage.startPosition && position <= stage.endPosition) {
        return stage.type;
      }
    }
    if (position < rhythmData.plotStages[0].startPosition) {
      return rhythmData.plotStages[0].type;
    }
    return rhythmData.plotStages[rhythmData.plotStages.length - 1].type;
  }

  private getStageDescriptionAtPosition(position: number, rhythmData: any): string {
    if (!rhythmData?.plotStages || rhythmData.plotStages.length === 0) {
      return '';
    }
    for (const stage of rhythmData.plotStages) {
      if (position >= stage.startPosition && position <= stage.endPosition) {
        return stage.description;
      }
    }
    if (position < rhythmData.plotStages[0].startPosition) {
      return rhythmData.plotStages[0].description;
    }
    return rhythmData.plotStages[rhythmData.plotStages.length - 1].description;
  }

  private renderCurrentRhythm(container: HTMLElement): void {
    const cursorPos = this.getCurrentCursorPosition();
    const hasPosition = cursorPos !== null;

    const posRow = container.createDiv({
      cls: "nw-float-knowledge-row",
    });
    posRow.createSpan({ cls: "nw-float-knowledge-label", text: "当前位置：" });
    posRow.createSpan({
      cls: "nw-float-knowledge-value",
      text: hasPosition ? `第 ${Math.round(cursorPos! * 100)}%` : "未检测到打开的章节",
    });

    const selectedBooks = this.getSelectedBooks();
    const defaultIntensity = 65;
    const defaultEmotionPoint = "铺垫期 → 小高潮前夜";
    const defaultTip = "💡 当前位置应处于情节铺垫阶段，建议加快节奏，为下一个小高潮做准备。";

    const intensityRow = container.createDiv({
      cls: "nw-float-knowledge-row",
    });
    intensityRow.createSpan({
      cls: "nw-float-knowledge-label",
      text: "目标节奏强度：",
    });
    const intensityWrap = intensityRow.createDiv({
      cls: "nw-float-knowledge-progress-wrap",
    });
    const intensityBar = intensityWrap.createDiv({
      cls: "nw-float-progress",
    });
    const intensityFill = intensityBar.createDiv({
      attr: { style: `width: ${defaultIntensity}%; background: var(--interactive-accent); height: 100%; border-radius: 4px;` },
    });
    const intensityText = intensityWrap.createSpan({
      cls: "nw-float-knowledge-progress-text",
      text: `${defaultIntensity}%`,
    });

    const emotionRow = container.createDiv({
      cls: "nw-float-knowledge-row",
    });
    emotionRow.createSpan({ cls: "nw-float-knowledge-label", text: "情绪点提示：" });
    const emotionValue = emotionRow.createSpan({
      cls: "nw-float-knowledge-value nw-float-warn-text",
      text: defaultEmotionPoint,
    });

    const emotionPointEl = container.createDiv({
      cls: "nw-float-knowledge-emotion-point",
      text: defaultTip,
    });

    if (hasPosition && selectedBooks.length > 0) {
      this.calculateRhythmMetrics(selectedBooks, cursorPos!).then(metrics => {
        if (metrics) {
          intensityFill.style.width = `${metrics.avgIntensity}%`;
          intensityText.textContent = `${Math.round(metrics.avgIntensity)}%`;
          emotionValue.textContent = metrics.emotionPoint;
          emotionPointEl.textContent = `💡 ${metrics.tip}`;
        }
      }).catch(e => {
        log.warn('[KnowledgeFloatingPanel] 计算节奏指标失败:', e);
      });
    }
  }

  private async calculateRhythmMetrics(books: BookBasicInfo[], position: number): Promise<{ avgIntensity: number; emotionPoint: string; tip: string } | null> {
    try {
      let totalIntensity = 0;
      let count = 0;
      const stageTypes = new Map<string, number>();

      for (const book of books) {
        const rhythmData = await this.getBookRhythmData(book);
        if (rhythmData) {
          totalIntensity += rhythmData.avgRhythm || 50;
          count++;

          const stageType = this.getEmotionPointAtPosition(position, rhythmData);
          stageTypes.set(stageType, (stageTypes.get(stageType) || 0) + 1);
        }
      }

      if (count === 0) return null;

      const avgIntensity = totalIntensity / count;

      let mostCommonStage = '未知阶段';
      let maxCount = 0;
      for (const [stage, cnt] of stageTypes) {
        if (cnt > maxCount) {
          maxCount = cnt;
          mostCommonStage = stage;
        }
      }

      let tip = '';
      if (position < 0.2) {
        tip = '当前处于开篇铺垫阶段，建议建立世界观与主角困境，设置悬念钩子吸引读者。';
      } else if (position < 0.4) {
        tip = '当前处于前期发展阶段，建议加快冲突升级节奏，引入第一个小高潮。';
      } else if (position < 0.6) {
        tip = '当前处于中期阶段，建议推动主要冲突走向高潮，同时回收部分伏笔。';
      } else if (position < 0.8) {
        tip = '当前处于中后期，建议节奏持续走高，为最终大高潮积蓄力量。';
      } else {
        tip = '当前接近结局，建议推进最终高潮并完成主题升华，给读者满意的收尾。';
      }

      return {
        avgIntensity,
        emotionPoint: mostCommonStage,
        tip,
      };
    } catch (e) {
      log.warn('[KnowledgeFloatingPanel] 计算节奏指标失败:', e);
      return null;
    }
  }

  private renderRefRhythm(container: HTMLElement): void {
    if (this.selectedBooks.size === 0) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "请先选择参考书籍",
      });
      return;
    }

    const selectedBooks = this.getSelectedBooks();
    const selectedBookNames = selectedBooks.map(b => b.name);

    container.createDiv({
      cls: "nw-float-knowledge-ref-title",
      text: `参考 ${selectedBookNames.join("、")} 的同位置节奏：`,
    });

    const cursorPos = this.getCurrentCursorPosition();
    const position = cursorPos ?? 0.5;

    const loadingEl = container.createDiv({
      cls: "nw-float-knowledge-ref-item",
      text: "▸ 正在加载参考书籍节奏数据...",
    });

    this.loadRefRhythmDescriptions(selectedBooks, position).then(items => {
      loadingEl.remove();
      for (const item of items) {
        container.createDiv({
          cls: "nw-float-knowledge-ref-item",
          text: item,
        });
      }
    }).catch(e => {
      log.warn('[KnowledgeFloatingPanel] 加载参考节奏失败:', e);
      loadingEl.textContent = "▸ 加载参考节奏数据失败";
    });
  }

  private async loadRefRhythmDescriptions(books: BookBasicInfo[], position: number): Promise<string[]> {
    const items: string[] = [];

    for (const book of books) {
      try {
        const rhythmData = await this.getBookRhythmData(book);
        if (rhythmData) {
          const stage = this.getEmotionPointAtPosition(position, rhythmData);
          const desc = this.getStageDescriptionAtPosition(position, rhythmData);
          items.push(`▸ 《${book.name}》${Math.round(position * 100)}% 处：${stage} — ${desc || '暂无详细描述'}`);
        } else {
          items.push(`▸ 《${book.name}》：暂无节奏分析数据`);
        }
      } catch (e) {
        items.push(`▸ 《${book.name}》：读取失败`);
      }
    }

    if (items.length === 0) {
      items.push("▸ 暂无可用的节奏参考数据");
    }

    return items;
  }

  private getSelectedBooks(): BookBasicInfo[] {
    return this.booksCache.filter((b) => this.selectedBooks.has(b.id));
  }

  private getSelectedBookNames(): string[] {
    return this.getSelectedBooks().map((b) => b.name);
  }

  private renderRhythmSuggestions(container: HTMLElement): void {
    if (this.selectedBooks.size === 0) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "请先选择参考书籍",
      });
      return;
    }

    const cursorPos = this.getCurrentCursorPosition();
    const position = cursorPos ?? 0.5;
    const selectedBooks = this.getSelectedBooks();

    const loadingEl = container.createDiv({
      cls: "nw-float-rec",
      text: "💡 正在生成节奏调整建议...",
    });

    this.generateRhythmSuggestions(selectedBooks, position).then(suggestions => {
      loadingEl.remove();
      for (const s of suggestions) {
        container.createDiv({
          cls: "nw-float-rec",
          text: `💡 ${s}`,
        });
      }
    }).catch(e => {
      log.warn('[KnowledgeFloatingPanel] 生成节奏建议失败:', e);
      loadingEl.textContent = "💡 生成建议失败，请稍后重试";
    });
  }

  private async generateRhythmSuggestions(books: BookBasicInfo[], position: number): Promise<string[]> {
    const suggestions: string[] = [];

    try {
      const bookCount = books.length;
      let hasRhythmData = false;

      for (const book of books) {
        const rhythmData = await this.getBookRhythmData(book);
        if (rhythmData && rhythmData.plotStages && rhythmData.plotStages.length > 0) {
          hasRhythmData = true;
          break;
        }
      }

      if (position < 0.2) {
        suggestions.push("开篇阶段建议快速引入主角和核心冲突，避免冗长的背景铺垫");
        suggestions.push("在第1-2章内设置第一个悬念钩子，抓住读者注意力");
        suggestions.push("通过对话和行动展示人物性格，而非大段心理描写");
      } else if (position < 0.4) {
        suggestions.push("前期发展阶段建议逐步升级冲突，让主角面临更多挑战");
        suggestions.push("引入重要配角和支线剧情，丰富故事层次");
        suggestions.push("在每章结尾设置小型悬念，保持阅读动力");
      } else if (position < 0.6) {
        suggestions.push("中期阶段建议推动主线冲突走向第一个大高潮");
        suggestions.push("适时回收前期伏笔，给读者满足感");
        suggestions.push("增加主角的内心挣扎和成长，让人物更立体");
      } else if (position < 0.8) {
        suggestions.push("中后期建议节奏持续走高，不断提升紧张感");
        suggestions.push("让主角遭遇重大挫折，为最终高潮积蓄情绪");
        suggestions.push("加快场景转换频率，营造紧迫感");
      } else {
        suggestions.push("结局阶段建议推进最终高潮，解决核心冲突");
        suggestions.push("完成主题升华，给读者留下深刻印象");
        suggestions.push("收尾要干脆利落，避免拖泥带水");
      }

      if (!hasRhythmData && bookCount > 0) {
        suggestions.unshift("注意：部分参考书籍暂无节奏分析数据，建议基于通用创作规律参考");
      }
    } catch (e) {
      log.warn('[KnowledgeFloatingPanel] 生成节奏建议异常:', e);
      suggestions.push("建议增加对话比例，提升节奏明快度");
      suggestions.push("在段落结尾设置悬念，吸引读者继续阅读");
      suggestions.push("压缩环境描写，聚焦主角行动和决策");
    }

    return suggestions.slice(0, 3);
  }

  private refreshRhythmData(): void {
    if (this.activeTab === "rhythm" && this.rhythmTabContent) {
      this.renderRhythmTab(this.rhythmTabContent);
    }
  }

  // ============== Tab 2: 技巧推荐 ==============
  private renderTechniqueTab(container: HTMLElement): void {
    this.techniqueTabContent = container;

    const refreshBtn = this.techniqueTabContent.createEl("button", {
      cls: "nw-float-btn nw-float-btn-primary nw-float-knowledge-refresh-btn",
      text: "🔍 根据选中文本推荐",
    });
    refreshBtn.addEventListener("click", () => {
      this.searchTechniquesFromSelection();
    });

    const resultsSection = this.techniqueTabContent.createDiv({
      cls: "nw-float-card",
    });
    resultsSection.createEl("h5", { text: "✨ 推荐技巧" });
    const resultsBody = resultsSection.createDiv({
      cls: "nw-float-card-body",
    });
    this.renderTechniqueResults(resultsBody);
  }

  private renderTechniqueResults(container: HTMLElement): void {
    if (this.techniqueLoading) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "搜索中...",
      });
      return;
    }

    if (this.techniqueResults.length === 0) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "点击上方按钮，根据选中文本推荐写作技巧",
      });
      return;
    }

    for (let i = 0; i < this.techniqueResults.length; i++) {
      const result = this.techniqueResults[i];
      this.renderTechniqueCard(container, result, i);
    }
  }

  private renderTechniqueCard(container: HTMLElement, result: KnowledgeSearchResult, index: number): void {
    const card = container.createDiv({
      cls: "nw-float-card nw-float-knowledge-tech-card",
    });

    const header = card.createDiv({
      cls: "nw-float-knowledge-tech-header",
    });

    const titleText = result.sample.slice(0, 20) + (result.sample.length > 20 ? "..." : "");
    header.createSpan({
      cls: "nw-float-knowledge-tech-name",
      text: titleText,
    });
    header.createSpan({
      cls: "nw-float-knowledge-tech-category",
      text: result.category || "写作技巧",
    });

    const sourceRow = card.createDiv({
      cls: "nw-float-knowledge-tech-source",
    });
    const chunkLabel = formatKnowledgeChunkLabel(result.position);
    const positionText = chunkLabel ? ` · ${chunkLabel}` : "";
    sourceRow.createSpan({
      cls: "nw-float-knowledge-tech-source-text",
      text: `《${result.bookName}》${positionText}`,
    });

    const similarityRow = card.createDiv({
      cls: "nw-float-knowledge-tech-confidence",
    });
    similarityRow.createSpan({ text: "相似度：" });
    const simBar = similarityRow.createDiv({
      cls: "nw-float-progress",
      attr: { style: "flex: 1; margin: 0 8px;" },
    });
    const scorePercent = Math.round(result.score * 100);
    const simFill = simBar.createDiv({
      attr: {
        style: `width: ${scorePercent}%; height: 100%; border-radius: 4px; background: ${
          scorePercent >= 80
            ? "var(--color-green)"
            : scorePercent >= 60
            ? "var(--color-yellow)"
            : "var(--color-red)"
        };`,
      },
    });
    similarityRow.createSpan({
      cls: "nw-float-knowledge-tech-conf-value",
      text: `${scorePercent}%`,
    });

    const sampleSection = card.createDiv({
      cls: "nw-float-knowledge-tech-sample",
    });
    sampleSection.createEl("h6", { text: "示例片段" });
    const sampleContent = sampleSection.createDiv({
      cls: "nw-float-knowledge-tech-sample-content",
      text: result.sample,
    });

    const actionRow = card.createDiv({
      cls: "nw-float-knowledge-tech-actions",
    });
    const insertBtn = actionRow.createEl("button", {
      cls: "nw-float-btn nw-float-btn-primary",
      text: "📋 插入参考",
    });
    insertBtn.addEventListener("click", () => {
      this.insertToEditor(result.sample);
    });
  }

  private async searchTechniquesFromSelection(): Promise<void> {
    const query = this.getSelectedText();
    if (!query || query.trim().length === 0) {
      new Notice("请先选中一段文本，或在编辑器中放置光标");
      return;
    }

    this.techniqueLoading = true;
    this.techniqueResults = [];
    if (this.techniqueTabContent) {
      this.renderTechniqueTab(this.techniqueTabContent);
    }

    try {
      this.techniqueResults = await this.searchTechniques(query);
    } catch (e) {
      log.warn('[KnowledgeFloatingPanel] 搜索技巧失败:', e);
      new Notice("搜索失败，请稍后重试");
    } finally {
      this.techniqueLoading = false;
      if (this.techniqueTabContent) {
        this.renderTechniqueTab(this.techniqueTabContent);
      }
    }
  }

  private async searchTechniques(query: string): Promise<KnowledgeSearchResult[]> {
    const vectorStore = this.plugin.knowledgeVectorStore;
    if (!vectorStore) {
      return [];
    }

    const bookIds = this.selectedBooks.size > 0 ? Array.from(this.selectedBooks) : undefined;

    return await vectorStore.search(query, {
      topN: 5,
      bookIds: bookIds,
      dimensions: ['technique', 'structure'],
    });
  }

  // ============== Tab 3: 相似片段 ==============
  private renderSimilarTab(container: HTMLElement): void {
    this.similarTabContent = container;

    const searchSection = this.similarTabContent.createDiv({
      cls: "nw-float-card",
    });
    searchSection.createEl("h5", { text: "🔍 语义搜索" });
    const searchBody = searchSection.createDiv({
      cls: "nw-float-card-body",
    });

    const searchRow = searchBody.createDiv({
      cls: "nw-float-knowledge-search-row",
    });
    const searchInput = searchRow.createEl("input", {
      type: "text",
      cls: "nw-float-knowledge-search-input",
      placeholder: "输入查询内容，搜索相似片段...",
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
    });
    searchInput.addEventListener("keydown", (e) => {
      // IME 组字中回车是确认候选，别用半截关键词检索
      if (isImeComposing(e)) return;
      if (e.key === "Enter") {
        this.doSimilarSearch();
      }
    });

    const searchBtn = searchRow.createEl("button", {
      cls: "nw-float-btn nw-float-btn-primary",
      text: "搜索",
    });
    searchBtn.addEventListener("click", () => {
      this.doSimilarSearch();
    });

    const optionsRow = searchBody.createDiv({
      cls: "nw-float-knowledge-similar-options",
    });

    const refBooksToggle = optionsRow.createDiv({
      cls: "nw-float-knowledge-similar-toggle",
    });
    const checkbox = refBooksToggle.createEl("input", {
      attr: { type: "checkbox", id: "similar-only-ref" },
    });
    checkbox.checked = this.similarOnlyRefBooks;
    checkbox.addEventListener("change", () => {
      this.similarOnlyRefBooks = checkbox.checked;
    });
    refBooksToggle.createEl("label", {
      attr: { for: "similar-only-ref" },
      text: "仅搜索参考书籍",
    });

    const topNRow = optionsRow.createDiv({
      cls: "nw-float-knowledge-similar-topn",
    });
    topNRow.createSpan({ text: "返回数量：" });
    const topNSelect = topNRow.createEl("select", {
      cls: "nw-float-knowledge-similar-select",
    });
    for (const n of [5, 10, 20, 50]) {
      const opt = topNSelect.createEl("option", {
        attr: { value: n.toString() },
        text: `${n}条`,
      });
      if (n === this.similarTopN) {
        opt.selected = true;
      }
    }
    topNSelect.addEventListener("change", () => {
      this.similarTopN = parseInt(topNSelect.value);
    });

    const resultsSection = this.similarTabContent.createDiv({
      cls: "nw-float-card",
    });
    resultsSection.createEl("h5", { text: "📄 搜索结果" });
    const resultsBody = resultsSection.createDiv({
      cls: "nw-float-card-body",
    });
    this.renderSimilarResults(resultsBody);
  }

  private async doSimilarSearch(): Promise<void> {
    if (!this.searchQuery || this.searchQuery.trim().length === 0) {
      new Notice("请输入搜索关键词");
      return;
    }

    this.similarLoading = true;
    this.similarResults = [];
    if (this.similarTabContent) {
      this.renderSimilarTab(this.similarTabContent);
    }

    try {
      this.similarResults = await this.searchSimilar(this.searchQuery, this.similarOnlyRefBooks);
    } catch (e) {
      log.warn('[KnowledgeFloatingPanel] 搜索相似片段失败:', e);
      new Notice("搜索失败，请稍后重试");
    } finally {
      this.similarLoading = false;
      if (this.similarTabContent) {
        this.renderSimilarTab(this.similarTabContent);
      }
    }
  }

  private async searchSimilar(query: string, onlyRefBooks: boolean): Promise<KnowledgeSearchResult[]> {
    const vectorStore = this.plugin.knowledgeVectorStore;
    if (!vectorStore) {
      return [];
    }

    const bookIds = onlyRefBooks && this.selectedBooks.size > 0
      ? Array.from(this.selectedBooks)
      : undefined;

    return await vectorStore.search(query, {
      topN: this.similarTopN,
      bookIds: bookIds,
    });
  }

  private renderSimilarResults(container: HTMLElement): void {
    if (this.similarLoading) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "搜索中...",
      });
      return;
    }

    if (!this.searchQuery || this.searchQuery.trim().length === 0) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "输入关键词搜索相似片段",
      });
      return;
    }

    if (this.similarResults.length === 0) {
      container.createDiv({
        cls: "nw-float-empty",
        text: "未找到相关片段，试试其他关键词",
      });
      return;
    }

    for (let i = 0; i < this.similarResults.length; i++) {
      const result = this.similarResults[i];
      this.renderSimilarSegment(container, result, i);
    }
  }

  private getDimensionLabel(dimension: string): string {
    return DIMENSION_LABELS[dimension] || dimension;
  }

  private renderSimilarSegment(container: HTMLElement, result: KnowledgeSearchResult, index: number): void {
    const item = container.createDiv({
      cls: "nw-float-knowledge-similar-item",
    });

    const headerRow = item.createDiv({
      cls: "nw-float-knowledge-similar-header",
    });

    const sourceInfo = headerRow.createDiv({
      cls: "nw-float-knowledge-similar-source",
    });
    sourceInfo.createSpan({
      cls: "nw-float-knowledge-similar-book",
      text: result.bookName,
    });
    const chunkLabel = formatKnowledgeChunkLabel(result.position);
    const positionText = chunkLabel ? ` · ${chunkLabel}` : "";
    sourceInfo.createSpan({
      cls: "nw-float-knowledge-similar-position",
      text: positionText,
    });

    const similarityWrap = headerRow.createDiv({
      cls: "nw-float-knowledge-similar-similarity",
    });
    const scorePercent = Math.round(result.score * 100);
    similarityWrap.createSpan({
      cls: "nw-float-knowledge-similar-similarity-value",
      text: `${scorePercent}%`,
    });
    const simBar = similarityWrap.createDiv({
      cls: "nw-float-progress",
      attr: { style: "width: 60px; margin-left: 6px;" },
    });
    const simFill = simBar.createDiv({
      attr: {
        style: `width: ${scorePercent}%; height: 100%; border-radius: 4px; background: ${
          scorePercent >= 80
            ? "var(--color-green)"
            : scorePercent >= 60
            ? "var(--color-yellow)"
            : "var(--color-red)"
        };`,
      },
    });

    const tagRow = item.createDiv({
      cls: "nw-float-knowledge-similar-tags",
    });
    tagRow.createSpan({
      cls: "nw-float-knowledge-similar-tag",
      text: this.getDimensionLabel(result.dimension),
    });
    if (result.category) {
      tagRow.createSpan({
        cls: "nw-float-knowledge-similar-tag",
        text: result.category,
      });
    }

    const resultKey = `similar-${index}`;
    const isExpanded = this.expandedSimilar[resultKey];
    const previewText = isExpanded ? result.sample : result.sample.slice(0, 100) + (result.sample.length > 100 ? "..." : "");

    const preview = item.createDiv({
      cls: "nw-float-knowledge-similar-preview",
      text: previewText,
    });
    preview.style.cursor = "pointer";
    preview.addEventListener("click", () => {
      this.expandedSimilar[resultKey] = !this.expandedSimilar[resultKey];
      if (this.similarTabContent) {
        this.renderSimilarTab(this.similarTabContent);
      }
    });

    const actionRow = item.createDiv({
      cls: "nw-float-knowledge-similar-actions",
    });
    const insertBtn = actionRow.createEl("button", {
      cls: "nw-float-btn nw-float-btn-primary",
      text: "📝 插入到编辑器",
    });
    insertBtn.addEventListener("click", () => {
      this.insertToEditor(result.sample);
    });
  }

  // ============== Tab 4: 风格分析 ==============
  private renderStyleTab(container: HTMLElement): void {
    this.styleTabContent = container;

    if (!this.kbManager || this.selectedBooks.size === 0) {
      this.renderEmptyState(container, "🎨 风格分析", "请先选择参考书籍，查看风格特征分析");
      return;
    }

    const header = container.createDiv({ cls: "nw-float-empty-header" });
    header.createEl("span", { text: "🎨 风格分析" });

    const card = container.createDiv({ cls: "nw-float-card" });
    card.createDiv({ cls: "nw-float-card-header", text: "风格特征" });
    card.createDiv({ cls: "nw-float-empty", text: "暂未获取到风格分析数据，请先对书籍进行完整拆解" });
  }

  // ============== Tab 5: 结构拆解 ==============
  private renderStructureTab(container: HTMLElement): void {
    this.structureTabContent = container;

    if (!this.kbManager || this.selectedBooks.size === 0) {
      this.renderEmptyState(container, "🏗️ 结构拆解", "请先选择参考书籍，查看结构分析");
      return;
    }

    const header = container.createDiv({ cls: "nw-float-empty-header" });
    header.createEl("span", { text: "🏗️ 结构拆解" });

    const card = container.createDiv({ cls: "nw-float-card" });
    card.createDiv({ cls: "nw-float-card-header", text: "结构分析" });
    card.createDiv({ cls: "nw-float-empty", text: "暂未获取到结构分析数据，请先对书籍进行完整拆解" });
  }

  // ============== Tab 6: 人物设定 ==============
  private renderCharacterTab(container: HTMLElement): void {
    this.characterTabContent = container;

    if (!this.kbManager || this.selectedBooks.size === 0) {
      this.renderEmptyState(container, "👥 人物设定", "请先选择参考书籍，查看人物分析");
      return;
    }

    const header = container.createDiv({ cls: "nw-float-empty-header" });
    header.createEl("span", { text: "👥 人物设定" });

    const card = container.createDiv({ cls: "nw-float-card" });
    card.createDiv({ cls: "nw-float-card-header", text: "人物分析" });
    card.createDiv({ cls: "nw-float-empty", text: "暂未获取到人物分析数据，请先对书籍进行完整拆解" });
  }

  private renderEmptyState(container: HTMLElement, title: string, description: string): void {
    container.empty();
    const header = container.createDiv({ cls: "nw-float-empty-header" });
    header.createEl("span", { text: title });
    const empty = container.createDiv({ cls: "nw-float-empty" });
    empty.createEl("div", { text: description });
  }

  // ============== 辅助方法 ==============
  private getSelectedText(): string {
    const view = this.getCoWritingView();
    if (!view || !view.rightEditor) {
      return "";
    }

    const editor = view.rightEditor as HTMLTextAreaElement;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    if (start !== end) {
      return editor.value.slice(start, end);
    }

    const cursorPos = start;
    const startPos = Math.max(0, cursorPos - 500);
    return editor.value.slice(startPos, cursorPos);
  }

  private insertToEditor(text: string): void {
    const view = this.getCoWritingView();
    if (!view || !view.rightEditor) {
      this.copyToClipboard(text);
      new Notice("未找到编辑器，已复制到剪贴板");
      return;
    }

    try {
      const editor = view.rightEditor as HTMLTextAreaElement;
      const selectionStart = editor.selectionStart ?? editor.value.length;
      const selectionEnd = editor.selectionEnd ?? selectionStart;
      const before = editor.value.slice(0, selectionStart);
      const after = editor.value.slice(selectionEnd);
      const replacesSelection = selectionEnd > selectionStart;

      const insertText = replacesSelection || text.startsWith("\n") || before.endsWith("\n") || before.length === 0
        ? text
        : `\n${text}`;

      editor.value = before + insertText + after;
      const newCursor = selectionStart + insertText.length;
      editor.selectionStart = editor.selectionEnd = newCursor;
      editor.focus();

      editor.dispatchEvent(new Event('input', { bubbles: true }));

      if (typeof view.updateSnapshot === 'function') {
        view.updateSnapshot(editor.value);
      }
      if (typeof view.refreshPreview === 'function') {
        view.refreshPreview(true);
      }

      new Notice("已插入到编辑器");
    } catch (e) {
      log.warn('[KnowledgeFloatingPanel] 插入编辑器失败:', e);
      this.copyToClipboard(text);
      new Notice("插入失败，已复制到剪贴板");
    }
  }

  private copyToClipboard(text: string): void {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        new Notice("已复制到剪贴板");
      })
      .catch(() => {
        new Notice("复制失败，请手动复制");
      });
  }

  /** 外部调用：刷新知识库面板数据 */
  async refresh(): Promise<void> {
    if (this.activeTab === "rhythm") {
      this.refreshRhythmData();
    }
  }
}
