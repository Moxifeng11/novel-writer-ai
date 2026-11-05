/**
 * monitor-cards.ts — 协同写作右侧「本章监控」五张卡片
 *
 * 从 `ui/co-writing-view.ts` 抽出：注入溯源、伏笔状态、实体动态、设定守卫、状态监控。
 * 数据通过宿主接口注入，DOM 结构、类名与展开/收起行为与抽取前逐行一致。
 */
import type { TFile } from 'obsidian';
import type { GuardSummary } from '@/ui/cowrite/live-analysis-controller';

/** 伏笔快照（与章节状态快照结构一致）。 */
export interface ForeshadowSnapshot {
    unrevealed: Array<{ name?: string; plannedReveal?: string } | string>;
    revealed: unknown[];
    abandoned: unknown[];
}

/** 监控卡宿主：提供数据快照与 vault 读取。 */
export interface MonitorCardsHost {
    /** 卡片挂载容器 */
    container: HTMLElement;
    /** 注入账本文本 */
    getInjectionLedgerText(): string;
    /** 伏笔快照 */
    getForeshadowSnapshot(): ForeshadowSnapshot | null;
    /** 正文路径；未绑定章节返回空串 */
    getBodyPath(): string;
    /** 项目路径 */
    getProject(): string;
    /** 按路径取文件 */
    getFile(path: string): TFile | null;
    /** 全部 vault 文件 */
    getFiles(): TFile[];
    /** 取文件 frontmatter */
    getFrontmatter(file: TFile): Record<string, unknown>;
    /** 最近一次设定守卫结果 */
    getGuardSummary(): GuardSummary | null;
    /** 编辑器正文 */
    getEditorText(): string;
}

/** 正文统计结果。 */
export interface TextStats {
    /** 非空段落数 */
    paragraphs: number;
    /** 对话片段数 */
    dialogueCount: number;
    /** 总字数（trim 后） */
    totalChars: number;
    /** 对话比例（%） */
    dialogueRatio: number;
    /** 平均段落长度 */
    averageParagraphLength: number;
    /** 动作词频次 */
    actionCount: number;
}

const ACTION_WORDS = ['打', '杀', '战', '攻', '守', '逃', '追', '躲', '闪', '挡'];

/**
 * 统计正文的段落、对话、字数与动作描写频次。
 *
 * @param text - 正文
 * @returns 统计数据
 * @example
 * ```ts
 * const stats = computeTextStats(editorText);
 * ```
 */
export function computeTextStats(text: string): TextStats {
    const paragraphs = text.split('\n').filter(p => p.trim()).length;
    const dialogueCount = (text.match(/["“‘『」』][^"“”‘’『』]*["“”‘’『』]/g) || []).length;
    const totalChars = text.trim().length;
    const dialogueRatio = totalChars > 0 ? Math.round((dialogueCount * 20 / totalChars) * 100) : 0;
    const averageParagraphLength = totalChars > 0 ? Math.round(totalChars / Math.max(1, paragraphs)) : 0;
    const actionCount = ACTION_WORDS.reduce((acc, word) => acc + (text.match(new RegExp(word, 'g')) || []).length, 0);
    return { paragraphs, dialogueCount, totalChars, dialogueRatio, averageParagraphLength, actionCount };
}

/**
 * 格式化单条伏笔。
 *
 * @param item - 伏笔条目（字符串或对象）
 * @returns 展示文本
 * @example
 * ```ts
 * formatForeshadowItem({ name: '玉佩', plannedReveal: '第3章' });
 * ```
 */
export function formatForeshadowItem(item: { name?: string; plannedReveal?: string } | string): string {
    if (typeof item === 'string') return item;
    const name = item.name || String(item);
    return `${name}${item.plannedReveal ? ` (预计: ${item.plannedReveal})` : ''}`;
}

/**
 * 格式化人物状态行（境界/状态/最近变更）。
 *
 * @param charName - 人物名
 * @param fm - 人物设定 frontmatter
 * @returns 展示文本
 * @example
 * ```ts
 * formatEntityStatusLine('林凡', { 当前状态: '受伤', 境界: '筑基' });
 * ```
 */
export function formatEntityStatusLine(charName: string, fm: Record<string, unknown>): string {
    const status = (fm['当前状态'] as string | undefined) || '未知';
    const realm = (fm['境界'] as string | undefined) || (fm['修为'] as string | undefined) || '';
    const lastChange = fm['entity_last_changed_at'] ? `(${fm['entity_last_changed_at'] as string})` : '';
    return `${charName}${realm ? ` · ${realm}` : ''} · ${status} ${lastChange}`;
}

/** 创建监控卡骨架（卡片/头/折叠箭头/正文）。 */
function createMonitorCard(
    container: HTMLElement,
    icon: string,
    title: string,
): { card: HTMLElement; header: HTMLElement; toggle: HTMLElement; body: HTMLElement } {
    const card = container.createDiv({ cls: 'nw-cowrite-monitor-card' });
    const header = card.createDiv({ cls: 'nw-cowrite-monitor-card-header' });
    header.createSpan({ cls: 'nw-cowrite-monitor-card-icon', text: icon });
    header.createSpan({ cls: 'nw-cowrite-monitor-card-title', text: title });
    const toggle = header.createSpan({ cls: 'nw-cowrite-monitor-card-toggle', text: '▶' });
    const body = card.createDiv({ cls: 'nw-cowrite-monitor-card-body' });
    return { card, header, toggle, body };
}

/** 绑定展开/收起：display 切换 + 箭头 + 卡片状态类。 */
function bindExpandToggle(
    card: HTMLElement,
    header: HTMLElement,
    toggle: HTMLElement,
    detail: HTMLElement,
): void {
    header.addEventListener('click', () => {
        const isExpanded = detail.style.display === 'block';
        detail.style.display = isExpanded ? 'none' : 'block';
        toggle.textContent = isExpanded ? '▶' : '▼';
        card.toggleClass('nw-cowrite-monitor-card-expanded', !isExpanded);
    });
}

/** 渲染注入溯源卡。 */
function renderLedgerCard(host: MonitorCardsHost): void {
    // Facade 有 engine getter（CoWriterEngine）；getInjectionLedgerText 定义在引擎上
    const text = host.getInjectionLedgerText();
    const { card, header, toggle, body } = createMonitorCard(host.container, '🧾', '注入溯源');
    if (!text) {
        body.createDiv({ cls: 'nw-cowrite-monitor-summary', text: '注入账本尚未生成' });
        return;
    }
    const lines = text.split('\n');
    body.createDiv({ cls: 'nw-cowrite-monitor-summary', text: lines[0] || '' });
    const detail = body.createDiv({ cls: 'nw-cowrite-monitor-detail' });
    detail.setCssStyles({ display: 'none' });
    const list = detail.createEl('ul', { cls: 'nw-cowrite-monitor-list' });
    for (const line of lines.slice(1)) {
        if (line.trim()) list.createEl('li', { text: line.replace(/^- /, '') });
    }
    bindExpandToggle(card, header, toggle, detail);
}

/** 渲染伏笔状态卡。 */
function renderForeshadowCard(host: MonitorCardsHost): void {
    const foreshadows: ForeshadowSnapshot = host.getForeshadowSnapshot() || {
        unrevealed: [],
        revealed: [],
        abandoned: [],
    };
    const unrevealed = foreshadows.unrevealed || [];
    const revealed = foreshadows.revealed || [];
    const abandoned = foreshadows.abandoned || [];

    const { card, header, toggle, body } = createMonitorCard(host.container, '📌', '伏笔状态追踪');
    body.createDiv({
        cls: 'nw-cowrite-monitor-summary',
        text: `未揭示 ${unrevealed.length} · 已揭示 ${revealed.length} · 已放弃 ${abandoned.length}`,
    });

    const detail = body.createDiv({ cls: 'nw-cowrite-monitor-detail' });
    detail.setCssStyles({ display: 'none' });
    if (unrevealed.length > 0) {
        detail.createDiv({ cls: 'nw-cowrite-monitor-detail-title', text: '未揭示伏笔:' });
        const ul = detail.createEl('ul', { cls: 'nw-cowrite-monitor-list' });
        unrevealed.slice(0, 5).forEach(item => {
            ul.createEl('li', { text: formatForeshadowItem(item) });
        });
        if (unrevealed.length > 5) ul.createEl('li', { cls: 'nw-cowrite-monitor-more', text: `...还有 ${unrevealed.length - 5} 条` });
    }
    bindExpandToggle(card, header, toggle, detail);
}

/** 渲染实体动态卡。 */
function renderEntityCard(host: MonitorCardsHost): void {
    const { card, header, toggle, body } = createMonitorCard(host.container, '🧑', '实体动态');

    // 正文路径必须走 getBodyPath()：旧实现拼的是 `${project}/${volume}/${chapterName}_正文.md`，
    // 真实落盘路径是 03-大纲与章节/正文/...，拼接结果永远不存在 → 卡片恒为全 0。
    const bodyPath = host.getBodyPath();
    const file = bodyPath ? host.getFile(bodyPath) : null;
    const fm = file ? host.getFrontmatter(file) : {};
    const chars = (fm['涉及人物'] || []) as string[];
    const locs = (fm['涉及地点'] || []) as string[];
    const factions = (fm['涉及势力'] || []) as string[];
    const items = (fm['涉及物品功法'] || []) as string[];

    body.createDiv({
        cls: 'nw-cowrite-monitor-summary',
        text: `人物 ${chars.length} · 地点 ${locs.length} · 势力 ${factions.length} · 物品 ${items.length}`,
    });

    const detail = body.createDiv({ cls: 'nw-cowrite-monitor-detail' });
    detail.setCssStyles({ display: 'none' });

    if (chars.length > 0) {
        detail.createDiv({ cls: 'nw-cowrite-monitor-detail-title', text: '涉及人物:' });
        const ul = detail.createEl('ul', { cls: 'nw-cowrite-monitor-list' });
        // 只在本项目的人物设定目录里找：全库 includes 匹配会把同名角色的别书状态显示出来
        const projectPrefix = host.getProject() ? `${host.getProject()}/` : '';
        chars.slice(0, 5).forEach(charName => {
            const charFile = host.getFiles().find(f =>
                f.path.startsWith(projectPrefix) && f.path.includes('人物设定') && f.name.includes(charName)
            ) || null;
            const charFm = charFile ? host.getFrontmatter(charFile) : {};
            ul.createEl('li', { text: formatEntityStatusLine(charName, charFm) });
        });
        if (chars.length > 5) ul.createEl('li', { cls: 'nw-cowrite-monitor-more', text: `...还有 ${chars.length - 5} 人` });
    }

    if (locs.length > 0) {
        detail.createDiv({ cls: 'nw-cowrite-monitor-detail-title', text: '涉及地点:' });
        detail.createDiv({ cls: 'nw-cowrite-monitor-tags', text: locs.slice(0, 8).join(', ') + (locs.length > 8 ? `...` : '') });
    }
    if (factions.length > 0) {
        detail.createDiv({ cls: 'nw-cowrite-monitor-detail-title', text: '涉及势力:' });
        detail.createDiv({ cls: 'nw-cowrite-monitor-tags', text: factions.slice(0, 8).join(', ') + (factions.length > 8 ? `...` : '') });
    }

    bindExpandToggle(card, header, toggle, detail);
}

/** 渲染设定守卫卡。 */
function renderGuardCard(host: MonitorCardsHost): void {
    const { card, header, toggle, body } = createMonitorCard(host.container, '⚠️', '设定守卫');

    // 数据源是 LiveAnalysisController 的真实守卫结果。
    // 旧实现读 `liveAnalysis.issues` —— 该字段从来没有存在过，卡片恒显示「高 0 · 中 0 · 低 0」。
    const summary = host.getGuardSummary();
    const oocCount = summary?.oocWarnings.length ?? 0;
    const changeCount = summary?.entityChanges.length ?? 0;
    const scoreText = summary?.consistencyScore != null ? `一致性 ${summary.consistencyScore}% · ` : '';

    if (!summary) {
        body.createDiv({ cls: 'nw-cowrite-monitor-summary', text: '本章尚未检查（输入停顿或点「设定检查」后自动执行）' });
        return;
    }

    body.createDiv({
        cls: 'nw-cowrite-monitor-summary',
        text: `${scoreText}OOC ${oocCount} · 实体变更 ${changeCount}`,
    });

    const detail = body.createDiv({ cls: 'nw-cowrite-monitor-detail' });
    detail.setCssStyles({ display: 'none' });

    if (oocCount > 0 || changeCount > 0) {
        const ul = detail.createEl('ul', { cls: 'nw-cowrite-monitor-list' });
        summary.oocWarnings.slice(0, 5).forEach(warning => {
            const li = ul.createEl('li');
            const tag = li.createSpan({ cls: 'nw-cowrite-monitor-priority', text: 'OOC' });
            tag.setCssStyles({ color: '#ef4444' });
            li.createSpan({ text: ` ${warning}` });
        });
        summary.entityChanges.slice(0, 5).forEach(change => {
            const li = ul.createEl('li');
            const tag = li.createSpan({ cls: 'nw-cowrite-monitor-priority', text: '变更' });
            tag.setCssStyles({ color: '#3b82f6' });
            li.createSpan({ text: ` ${change.entityName} → ${change.newStatus}` });
        });
    }

    bindExpandToggle(card, header, toggle, detail);
}

/** 渲染状态监控卡。 */
function renderStatusCard(host: MonitorCardsHost): void {
    const { card, header, toggle, body } = createMonitorCard(host.container, '📊', '状态监控');
    const stats = computeTextStats(host.getEditorText());

    body.createDiv({
        cls: 'nw-cowrite-monitor-summary',
        text: `段落 ${stats.paragraphs} · 对话 ${stats.dialogueRatio}% · 字数 ${stats.totalChars}`,
    });

    const detail = body.createDiv({ cls: 'nw-cowrite-monitor-detail' });
    detail.setCssStyles({ display: 'none' });
    detail.createDiv({ cls: 'nw-cowrite-monitor-detail-title', text: '详细统计:' });
    detail.createDiv({ cls: 'nw-cowrite-monitor-stat', text: `平均段落长度: ${stats.averageParagraphLength} 字` });
    detail.createDiv({ cls: 'nw-cowrite-monitor-stat', text: `对话片段数: ${stats.dialogueCount}` });
    detail.createDiv({ cls: 'nw-cowrite-monitor-stat', text: `动作描写频次: ${stats.actionCount}` });

    bindExpandToggle(card, header, toggle, detail);
}

/**
 * 渲染右侧全部监控卡（顺序固定）。
 *
 * @param host - 监控卡宿主
 * @example
 * ```ts
 * renderMonitorCards({ container, getInjectionLedgerText, ... });
 * ```
 */
export function renderMonitorCards(host: MonitorCardsHost): void {
    host.container.empty();
    renderLedgerCard(host);
    renderForeshadowCard(host);
    renderEntityCard(host);
    renderGuardCard(host);
    renderStatusCard(host);
}
