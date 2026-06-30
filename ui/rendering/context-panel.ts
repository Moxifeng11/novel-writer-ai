import { App, MarkdownRenderer, TFile, Component } from 'obsidian';
import { GatheredContext, CharacterData, ForeshadowData, TimelineEvent, MarkdownContent } from '../../engine/context-manager';
import { LocationFrontmatter, FactionFrontmatter, ItemFrontmatter } from '../../shared/types';
import { TimelineRow, FanficRules } from '../../shared/template-validator';
import { getWritingStylePath, getLegacyWritingStylePath } from '../../shared/paths';
import { findWritingStyleFile, getWritingStyleCandidatePaths } from '../writing-style-paths';
import { mkdirp, readMergedVolumeOutline } from '../../utils/helpers';
import type { NovelWriterPluginAPI } from '../../shared/plugin-api';

/**
 * 上下文监控面板渲染器。
 * 在右侧栏中渲染人物状态、伏笔库、分卷大纲、时间线、世界观、设定库、写作规则等。
 */
export class ContextPanel {
    private cachedComponent: Component;

    constructor(private app: App) {
        this.cachedComponent = new Component();
        // R3-2: 挂入生命周期，确保 MarkdownRenderer.render 注册的子组件被 Obsidian 管理
        this.cachedComponent.load();
    }

    /** R3-2: 卸载 cachedComponent，释放其注册的所有子资源（DOM listener / MarkdownPostProcessor 等） */
    unload(): void {
        this.cachedComponent.unload();
    }

    /**
     * 渲染上下文监控面板到 workspace 中。
     * @param workspace 工作区容器元素
     * @param context 已加载的上下文数据
     * @param project 当前项目名
     * @param chapterNum 当前章节号
     * @param plugin 插件实例（用于访问 settings）
     * @param estimateTotalChars token 估算函数
     */
    render(
        workspace: HTMLElement,
        context: GatheredContext | null,
        project: string,
        chapterNum: number,
        plugin: NovelWriterPluginAPI,
        estimateTotalChars: () => number,
    ): void {
        const panel = workspace.createDiv({ cls: 'novel-writer-fw-context-panel' });
        panel.createEl('h4', { text: '📊 上下文监控', cls: 'novel-writer-fw-panel-title' });

        // 上下文模式状态提示 + token 估算
        const modeHint = plugin.settings.contextScope === 'full' ? '（完整遍历所有实体）' : '（仅注入本章涉及实体）';
        panel.createEl('div', { text: `当前：${modeHint}`, cls: 'novel-writer-context-mode-hint' }).style.cssText = 'font-size:11px;color:var(--text-faint);margin-bottom:6px;';
        
        // v3.5.0: token 预算（从 vars 读取，运行时由 FullWriterView 注入到 plugin 上）
        const fwView = (plugin as unknown as { fullWriterView?: { vars?: Record<string, string> } }).fullWriterView;
        const ctxTokens = parseInt(fwView?.vars?.['_contextTokens'] || '0') || 0;
        const maxCtx = plugin.settings.maxContext || 128000;
        if (ctxTokens > 0) {
            const pct = Math.round(ctxTokens / maxCtx * 100);
            const color = pct > 70 ? '#ff4444' : pct > 50 ? '#ffaa00' : 'var(--text-faint)';
            panel.createEl('div', { text: `Token 预算: ${ctxTokens.toLocaleString()} / ${(maxCtx/1000).toFixed(0)}K (${pct}%)`, cls: 'novel-writer-context-mode-hint' }).style.cssText = `font-size:11px;color:${color};margin-bottom:6px;`; 
        }

        // 上下文切换按钮行
        const scopeBtnRow = panel.createEl('div', { cls: 'novel-writer-context-scope-row' });
        const labelText = plugin.settings.contextScope === 'full' ? '🔍 上下文：完整模式' : '📌 上下文：紧凑模式';
        const scopeLabel = scopeBtnRow.createEl('span', { text: labelText, cls: 'novel-writer-scope-label' });


        scopeLabel.addEventListener('click', async () => {
            if (plugin.settings.contextScope === 'full') {
                plugin.settings.contextScope = 'compact';
                scopeLabel.setText('📌 上下文：紧凑模式');
            } else {
                plugin.settings.contextScope = 'full';
                scopeLabel.setText('🔍 上下文：完整模式');
            }
            await plugin.saveSettings();
            // ✅ P0修复#1：切换后立即刷新上下文面板
            try {
                plugin.refreshFullWriterContextPanel();
            } catch (e) {
                console.warn('[ContextPanel] 刷新上下文面板失败:', e);
            }
        });

        if (!context) {
            panel.createEl('p', { text: '上下文未加载' });
            return;
        }

        const ctx = context;
        const d = ctx.data;

        // ✅ v1.6.0: 显示失败的模块提示
        const failedModules = d['_failedModules'] as string[] | undefined;
        if (failedModules && failedModules.length > 0) {
            const warnEl = panel.createDiv({ cls: 'novel-writer-fw-warning', attr: {
                style: 'padding: 6px 10px; margin-bottom: 8px; background: var(--background-modifier-error-rgb, 255, 100, 100, 0.1); border-radius: 4px; font-size: 0.85em; color: var(--text-error);'
            }});
            warnEl.createSpan({ text: `⚠️ 以下模块加载失败：${failedModules.join('、')}（已跳过）` });
        }

        // ✅ P0修复#2：按 contextScope 过滤显示
        // 涉及实体集由 full-writer-view.ts 预先计算并存到 plugin 上
        const involvedChars = plugin._involvedChars || new Set<string>();
        const involvedLocs = plugin._involvedLocs || new Set<string>();
        const involvedFactions = plugin._involvedFactions || new Set<string>();
        const involvedItems = plugin._involvedItems || new Set<string>();

        // 人物状态
        this.renderCollapsibleCard(panel, '👤 人物状态', (body) => {
            const chars = d.character_state as CharacterData[] || [];
            if (chars.length === 0) {
                body.createEl('p', { text: '无人物数据', cls: 'novel-writer-fw-muted' });
                return;
            }
            const list = body.createEl('ul', { cls: 'novel-writer-fw-char-list' });
            for (const c of chars) {
                const name = c.name || c.姓名 || c.fileName || '?';
                // ✅ P0修复#2：compact 模式下只显示涉及人物
                if (plugin.settings.contextScope === 'compact' && involvedChars.size > 0 && !involvedChars.has(name)) {
                    continue;
                }
                const status = c.当前状态 || '未知';
                const mood = c.当前情绪 || '';
                const motivation = c.核心动机 || '';
                const identity = c.身份 || '';
                const coreDrive = c.核心驱动力_软肋 || '';
                const li = list.createEl('li');
                li.createSpan({ text: name, cls: 'novel-writer-fw-char-name' });
                if (identity) li.createSpan({ text: ` — ${identity}`, cls: 'novel-writer-fw-char-detail' });
                li.createEl('br');
                li.createSpan({ text: `状态：${status}`, cls: 'novel-writer-fw-char-detail' });
                if (mood) {
                    li.createEl('br');
                    li.createSpan({ text: `情绪：${mood}`, cls: 'novel-writer-fw-char-detail' });
                }
                if (motivation) {
                    li.createEl('br');
                    li.createSpan({ text: `动机：${motivation}`, cls: 'novel-writer-fw-char-detail' });
                }
                if (coreDrive) {
                    li.createEl('br');
                    li.createSpan({ text: `软肋：${coreDrive}`, cls: 'novel-writer-fw-char-detail' });
                }
            }
        });

        // 伏笔库
        // ===== 地点 =====
        this.renderCollapsibleCard(panel, '📍 地点', (body) => {
            const locs = d.locations || [];
            if (locs.length === 0) {
                body.createEl('p', { text: '无地点数据', cls: 'novel-writer-fw-muted' });
                return;
            }
            const list = body.createEl('ul', { cls: 'novel-writer-fw-entity-list' });
            for (const l of locs) {
                const name = l.名称 || l.name || l.fileName || '?';
                // ✅ P0修复#2：compact 模式下只显示涉及地点
                if (plugin.settings.contextScope === 'compact' && involvedLocs.size > 0 && !involvedLocs.has(name)) {
                    continue;
                }
                const type = l.类型 || '';
                const importance = l.重要程度 || '';
                if (!name) continue;
                const li = list.createEl('li');
                li.createSpan({ text: name, cls: 'novel-writer-fw-entity-name' });
                if (type) li.createSpan({ text: ` — ${type}`, cls: 'novel-writer-fw-entity-detail' });
                if (importance) {
                    li.createEl('br');
                    li.createSpan({ text: `重要程度：${importance}`, cls: 'novel-writer-fw-entity-detail' });
                }
            }
        });

        // ===== 势力 =====
        this.renderCollapsibleCard(panel, '🏰 势力', (body) => {
            const factions = d.factions || [];
            if (factions.length === 0) {
                body.createEl('p', { text: '无势力数据', cls: 'novel-writer-fw-muted' });
                return;
            }
            const list = body.createEl('ul', { cls: 'novel-writer-fw-entity-list' });
            for (const f of factions) {
                const name = f.名称 || f.name || f.fileName || '?';
                // ✅ P0修复#2：compact 模式下只显示涉及势力
                if (plugin.settings.contextScope === 'compact' && involvedFactions.size > 0 && !involvedFactions.has(name)) {
                    continue;
                }
                const type = f.类型 || '';
                const leader = f.领袖 || '';
                const rank = f['地位/排名'] || '';
                if (!name) continue;
                const li = list.createEl('li');
                li.createSpan({ text: name, cls: 'novel-writer-fw-entity-name' });
                if (type) li.createSpan({ text: ` — ${type}`, cls: 'novel-writer-fw-entity-detail' });
                li.createEl('br');
                if (leader) li.createSpan({ text: `领袖：${leader}`, cls: 'novel-writer-fw-entity-detail' });
                if (leader && rank) li.createSpan({ text: ' | ', cls: 'novel-writer-fw-entity-detail' });
                if (rank) li.createSpan({ text: `地位：${rank}`, cls: 'novel-writer-fw-entity-detail' });
            }
        });

        // ===== 物品功法 =====
        this.renderCollapsibleCard(panel, '⚔️ 物品功法', (body) => {
            const items = d.items || [];
            if (items.length === 0) {
                body.createEl('p', { text: '无物品功法数据', cls: 'novel-writer-fw-muted' });
                return;
            }
            const list = body.createEl('ul', { cls: 'novel-writer-fw-entity-list' });
            for (const i of items) {
                const name = i.名称 || i.name || i.fileName || '?';
                // ✅ P0修复#2：compact 模式下只显示涉及物品
                if (plugin.settings.contextScope === 'compact' && involvedItems.size > 0 && !involvedItems.has(name)) {
                    continue;
                }
                const type = i.类型 || '';
                const rank = i['品阶/等级'] || '';
                if (!name) continue;
                const li = list.createEl('li');
                li.createSpan({ text: name, cls: 'novel-writer-fw-entity-name' });
                if (type) li.createSpan({ text: ` — ${type}`, cls: 'novel-writer-fw-entity-detail' });
                if (rank) {
                    li.createEl('br');
                    li.createSpan({ text: `等级：${rank}`, cls: 'novel-writer-fw-entity-detail' });
                }
            }
        });

        this.renderCollapsibleCard(panel, '🔮 伏笔库', (body) => {
            const foreshadows = d.foreshadows as ForeshadowData | undefined;
            if (!foreshadows || foreshadows.unrevealed.length === 0) {
                body.createEl('p', { text: '无未揭示伏笔', cls: 'novel-writer-fw-muted' });
                return;
            }
            const list = body.createEl('ul', { cls: 'novel-writer-fw-foreshadow-list' });
            for (const f of foreshadows.unrevealed) {
                const li = list.createEl('li');
                const impClass = f.importance === '高' ? 'novel-writer-fw-imp-high' :
                                 f.importance === '低' ? 'novel-writer-fw-imp-low' : '';
                li.createSpan({ text: `[${f.importance || '中'}]`, cls: `novel-writer-fw-imp ${impClass}` });
                li.createSpan({ text: ` ${f.name}` });
                if (f.buryChapter) {
                    li.createEl('br');
                    li.createSpan({ text: `埋于：${f.buryChapter} | 计划回收：${f.plannedReveal || '待定'}`, cls: 'novel-writer-fw-muted' });
                }
            }
        });

        // 分卷大纲
        this.renderCollapsibleCard(panel, '📋 分卷大纲', async (body) => {
            // v4.0：分卷大纲按卷归档，合并读取
            const content = await readMergedVolumeOutline(this.app, project);
            if (!content.trim()) {
                body.createEl('p', { text: '无分卷大纲文件', cls: 'novel-writer-fw-muted' });
                return;
            }
            try {
                const lines = content.split('\n');
                const tableLines: string[] = [];
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('|')) {
                        // 跳过分隔符行（如 |---|---|）
                        if (/^\|[\s\-:]+\|$/.test(trimmed)) continue;
                        tableLines.push(trimmed);
                    }
                }
                if (tableLines.length < 2) {
                    const outline = d.outline as MarkdownContent | null;
                    if (outline && outline.raw) {
                        body.createDiv({ text: outline.raw.slice(0, 1000), cls: 'novel-writer-fw-context-text' });
                    } else {
                        body.createEl('p', { text: '无大纲表格数据', cls: 'novel-writer-fw-muted' });
                    }
                    return;
                }
                const headerLine = tableLines[0];
                const headers = headerLine.split('|').map(s => s.trim()).filter(Boolean);
                const chapColIdx = headers.findIndex(h => h.includes('章号') || h.includes('章节') || h.includes('章'));
                let matchedRow: string[] | null = null;
                for (let i = 1; i < tableLines.length; i++) {
                    const cols = tableLines[i].split('|').map(s => s.trim()).filter(Boolean);
                    if (chapColIdx >= 0 && chapColIdx < cols.length) {
                        const chapCell = cols[chapColIdx].trim();
                        // 兼容两种格式：纯数字 "1" 和 "第1章"
                        const named = chapCell.match(/第(\d+)章/);
                        const cellNum = named ? parseInt(named[1]) : parseInt(chapCell);
                        if (!isNaN(cellNum) && cellNum === chapterNum) {
                            matchedRow = cols;
                            break;
                        }
                    }
                }
                if (matchedRow && matchedRow.length > 0) {
                    const table = body.createEl('table', { cls: 'novel-writer-fw-outline-table' });
                    table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse;';
                    const tbody = table.createEl('tbody');
                    const displayHeaders = headers.length === matchedRow.length ? headers : [];
                    const maxCols = Math.max(displayHeaders.length, matchedRow.length);
                    for (let i = 0; i < maxCols; i++) {
                        const row = tbody.createEl('tr');
                        if (i < displayHeaders.length) {
                            const th = row.createEl('th', { text: displayHeaders[i] });
                            th.style.cssText = 'text-align:right;padding:2px 6px;color:var(--text-muted);white-space:nowrap;font-weight:600;';
                        }
                        const td = row.createEl('td', { text: matchedRow[i] || '' });
                        td.style.cssText = 'padding:2px 6px;color:var(--text-normal);word-break:break-all;';
                    }
                } else {
                    const outline = d.outline as MarkdownContent | null;
                    if (outline && outline.raw) {
                        body.createDiv({ text: outline.raw.slice(0, 1000), cls: 'novel-writer-fw-context-text' });
                    } else {
                        body.createEl('p', { text: '当前章节无大纲行数据', cls: 'novel-writer-fw-muted' });
                    }
                }
            } catch {
                const outline = d.outline as MarkdownContent | null;
                if (outline && outline.raw) {
                    body.createDiv({ text: outline.raw.slice(0, 1000), cls: 'novel-writer-fw-context-text' });
                } else {
                    body.createEl('p', { text: '读取大纲失败', cls: 'novel-writer-fw-muted' });
                }
            }
        });

        // 时间线
        this.renderCollapsibleCard(panel, '⏱️ 时间线', (body) => {
            const tl = d.timeline as TimelineEvent[] || [];
            if (tl.length === 0) {
                body.createEl('p', { text: '无时间线事件', cls: 'novel-writer-fw-muted' });
                return;
            }
            // 按与当前章节的接近度排序，取最近15条
            const sorted = [...tl].sort((a, b) => {
                const aNum = parseInt(a.chapter.match(/第(\d+)章/)?.[1] || '0');
                const bNum = parseInt(b.chapter.match(/第(\d+)章/)?.[1] || '0');
                return Math.abs(aNum - chapterNum) - Math.abs(bNum - chapterNum);
            });
            const recent = sorted.slice(0, 15);
            const table = body.createEl('table', { cls: 'novel-writer-fw-context-table' });
            const thead = table.createEl('thead');
            const headerRow = thead.createEl('tr');
            headerRow.createEl('th', { text: '时间' });
            headerRow.createEl('th', { text: '章节' });
            headerRow.createEl('th', { text: '事件' });
            const tbody = table.createEl('tbody');
            for (const e of recent) {
                const row = tbody.createEl('tr');
                row.createEl('td', { text: e.time });
                row.createEl('td', { text: e.chapter });
                row.createEl('td', { text: e.event });
            }
        });

        // ===== 同人：原作剧情时间线（canon）=====
        if (d.fanfic_canon_timeline && (d.fanfic_canon_timeline as TimelineRow[]).length > 0) {
            this.renderCollapsibleCard(panel, '📜 原作剧情时间线', (body) => {
                const canonRows = d.fanfic_canon_timeline as TimelineRow[];
                const table = body.createEl('table', { cls: 'nw-context-fanfic-canon novel-writer-fw-context-table' });
                const thead = table.createEl('thead');
                const headerRow = thead.createEl('tr');
                ['时间节点', '原作事件', '涉及人物', '章节参考', '切入方式'].forEach(h => {
                    headerRow.createEl('th', { text: h });
                });
                const tbody = table.createEl('tbody');
                for (const row of canonRows.slice(0, 20)) {
                    const tr = tbody.createEl('tr');
                    tr.createEl('td', { text: row['时间节点'] || '' });
                    tr.createEl('td', { text: row['原作事件'] || '' });
                    tr.createEl('td', { text: row['涉及人物'] || '' });
                    tr.createEl('td', { text: row['章节参考'] || '' });
                    tr.createEl('td', { text: row['你的同人如何切入'] || '' });
                }
                if (canonRows.length > 20) {
                    body.createEl('p', { text: `...还有${canonRows.length - 20}行`, cls: 'novel-writer-fw-muted' });
                }
            });
        }

        // ===== 同人：故事背景时间线（fan）=====
        if (d.fanfic_fan_timeline && (d.fanfic_fan_timeline as TimelineRow[]).length > 0) {
            this.renderCollapsibleCard(panel, '📖 故事背景时间线', (body) => {
                const fanRows = d.fanfic_fan_timeline as TimelineRow[];
                const table = body.createEl('table', { cls: 'nw-context-fanfic-fan novel-writer-fw-context-table' });
                const thead = table.createEl('thead');
                const headerRow = thead.createEl('tr');
                ['你的时间节点', '你的事件', '对应原作时间', '涉及人物'].forEach(h => {
                    headerRow.createEl('th', { text: h });
                });
                const tbody = table.createEl('tbody');
                for (const row of fanRows.slice(0, 20)) {
                    const tr = tbody.createEl('tr');
                    tr.createEl('td', { text: row['你的时间节点'] || '' });
                    tr.createEl('td', { text: row['你的事件'] || '' });
                    tr.createEl('td', { text: row['对应原作时间'] || '' });
                    tr.createEl('td', { text: row['涉及人物'] || '' });
                }
                if (fanRows.length > 20) {
                    body.createEl('p', { text: `...还有${fanRows.length - 20}行`, cls: 'novel-writer-fw-muted' });
                }
            });
        }

        // ===== 同人：OOC 规则 =====
        if (d.fanfic_rules) {
            const rules = d.fanfic_rules as FanficRules;
            if (rules.mustFollow?.length > 0 || rules.redlines?.length > 0) {
                this.renderCollapsibleCard(panel, '⚠️ OOC 防护规则', (body) => {
                    const warnBox = body.createDiv({ cls: 'nw-context-fanfic-rules' });
                    warnBox.style.cssText = 'background:#fff3cd;border:2px solid #ffc107;border-radius:6px;padding:12px;margin-top:8px;';
                    
                    if (rules.mustFollow?.length > 0) {
                        warnBox.createEl('strong', { text: '必须遵守的原作规则：', attr: { style: 'color:#856404;' } });
                        const ul = warnBox.createEl('ul', { attr: { style: 'margin:4px 0 8px 16px;color:#856404;font-size:12px;' } });
                        for (const r of rules.mustFollow) {
                            ul.createEl('li', { text: r });
                        }
                    }
                    
                    if (rules.redlines?.length > 0) {
                        warnBox.createEl('strong', { text: '🚫 禁止触及的红线：', attr: { style: 'color:#721c24;' } });
                        const ul = warnBox.createEl('ul', { attr: { style: 'margin:4px 0 4px 16px;color:#721c24;font-size:12px;' } });
                        for (const r of rules.redlines) {
                            ul.createEl('li', { text: r });
                        }
                    }
                });
            }
        }

        // 世界观
        this.renderCollapsibleCard(panel, '🌍 世界观', async (body) => {
            const wv = d.world_view as MarkdownContent | null;
            if (!wv || !wv.raw) {
                body.createEl('p', { text: '无世界观数据', cls: 'novel-writer-fw-muted' });
                return;
            }
            const wvDiv = body.createDiv({ cls: 'novel-writer-fw-context-text' });
            await MarkdownRenderer.render(this.app, wv.raw.slice(0, 500), wvDiv, '', this.cachedComponent);
        });

        // 设定库
        this.renderCollapsibleCard(panel, '⚙️ 设定库', (body) => {
            const sl = d.setting_lib as MarkdownContent | null;
            if (sl) {
                body.createDiv({ text: sl.raw ? sl.raw.slice(0, 500) : '', cls: 'novel-writer-fw-context-text' });
            }
            if (!sl || !sl.raw || !sl.raw.trim()) {
                body.createEl('p', { text: '暂无设定库，请先生成', cls: 'novel-writer-fw-muted' });
            }
        });

        // 写作规则
        this.renderCollapsibleCard(panel, '🖋️ 写作规则', (body) => {
            const wr = d.writing_rules;
            if (!wr) {
                body.createEl('p', { text: '无写作规则数据', cls: 'novel-writer-fw-muted' });
                return;
            }
            // 强制写作规则
            if (wr.mandatory && wr.mandatory.length > 0) {
                const sectionDiv = body.createDiv({ attr: { style: 'margin-bottom:8px;' } });
                sectionDiv.createEl('strong', { text: '📜 强制规则:', attr: { style: 'font-size:11px;' } });
                for (const r of wr.mandatory.slice(0, 5)) {
                    const ruleDiv = sectionDiv.createDiv({ attr: { style: 'margin:4px 0 4px 8px;padding:4px 6px;background:var(--background-primary);border-radius:4px;font-size:11px;' } });
                    ruleDiv.createEl('div', { text: `▸ ${r.title}`, attr: { style: 'font-weight:600;color:var(--text-normal);margin-bottom:2px;' } });
                    if (r.description && r.description.trim()) {
                        ruleDiv.createEl('div', { text: r.description.slice(0, 150), attr: { style: 'color:var(--text-muted);font-size:10px;' } });
                    }
                    if (r.points && r.points.length > 0) {
                        const ptsList = ruleDiv.createEl('ul', { attr: { style: 'margin:2px 0 0 12px;padding:0;font-size:10px;color:var(--text-muted);' } });
                        for (const pt of r.points.slice(0, 3)) {
                            ptsList.createEl('li', { text: pt });
                        }
                    }
                }
            }
            // 章节自查清单
            if (wr.checklist && wr.checklist.length > 0) {
                const chkDiv = body.createDiv({ attr: { style: 'margin-bottom:8px;' } });
                chkDiv.createEl('strong', { text: '✅ 自查清单:', attr: { style: 'font-size:11px;' } });
                const chkList = chkDiv.createEl('ul', { attr: { style: 'margin:4px 0 0 8px;padding:0;font-size:11px;color:var(--text-muted);' } });
                for (const item of wr.checklist.slice(0, 8)) {
                    chkList.createEl('li', { text: item, attr: { style: 'margin:2px 0;' } });
                }
                if (wr.checklist.length > 8) {
                    chkDiv.createEl('span', { text: `...还有${wr.checklist.length - 8}项`, attr: { style: 'font-size:10px;color:var(--text-faint);' } });
                }
            }
            // 文风参考
            if (wr.style && wr.style.trim()) {
                const styleDiv = body.createDiv({ attr: { style: 'margin-bottom:4px;' } });
                styleDiv.createEl('strong', { text: '🖊️ 文风参考:', attr: { style: 'font-size:11px;' } });
                styleDiv.createEl('p', {
                    text: wr.style.slice(0, 200),
                    cls: 'novel-writer-fw-muted',
                    attr: { style: 'font-size:10px;margin:2px 0 0 8px;white-space:pre-wrap;' }
                });
            }
            if ((!wr.mandatory || wr.mandatory.length === 0) && (!wr.checklist || wr.checklist.length === 0) && (!wr.style || !wr.style.trim())) {
                body.createEl('p', { text: '无写作规则内容', cls: 'novel-writer-fw-muted' });
            }
        });

        // 文笔风格（软参考）
        this.renderCollapsibleCard(panel, '✒️ 文笔风格', async (body) => {
            const ws = d.writing_style as MarkdownContent | null;
            if (ws && ws.raw && ws.raw.trim()) {
                const preview = ws.raw.substring(0, 300);
                const wsDiv = body.createDiv({ cls: 'novel-writer-fw-context-text' });
                // R3-2: 统一使用 cachedComponent 作为生命周期宿主（与 L433 世界观渲染一致）
                await MarkdownRenderer.render(
                    this.app,
                    preview + (ws.raw.length > 300 ? '...' : ''),
                    wsDiv,
                    '',
                    this.cachedComponent,
                );
                const editLink = body.createEl('a', {
                    text: '编辑文笔风格',
                    attr: { style: 'font-size: 0.85em; cursor: pointer;' }
                });
                editLink.addEventListener('click', async () => {
                    const wsFile = await findWritingStyleFile(this.app, project, { allowPlaceholder: true });
                    if (wsFile) {
                        await plugin.safeOpenFile(wsFile as TFile);
                    }
                });
            } else if (project) {
                body.createEl('p', { text: '暂无文笔风格', cls: 'novel-writer-fw-muted' });
                const createBtn = body.createEl('button', { text: '创建文笔风格' });
                createBtn.style.cssText = 'padding: 4px 10px; font-size: 0.8em; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: transparent; cursor: pointer; margin-top: 6px;';
                createBtn.addEventListener('click', async () => {
                    const templatePath = '元文件/00-系统模板/文笔风格模板.md';
                    const targetPath = getWritingStylePath(project);
                    const folderPath = targetPath.substring(0, targetPath.lastIndexOf('/'));
                    if (!this.app.vault.getAbstractFileByPath(folderPath)) await this.app.vault.createFolder(folderPath);
                    if (!this.app.vault.getAbstractFileByPath(targetPath)) {
                        const tplFile = this.app.vault.getAbstractFileByPath(templatePath);
                        if (tplFile) {
                            const tplContent = await this.app.vault.read(tplFile as TFile);
                            await this.app.vault.create(targetPath, tplContent);
                        }
                    }
                    const wsFile = this.app.vault.getAbstractFileByPath(targetPath);
                    if (wsFile) await plugin.safeOpenFile(wsFile as TFile);
                });
            }
        });

        // Token用量估算
        this.renderCollapsibleCard(panel, '📊 上下文使用进度', (body) => {
            const totalChars = estimateTotalChars();
            const estimatedTokens = Math.floor(totalChars / 4);
            const maxTokens = plugin.settings.maxContext;

            const barContainer = body.createDiv({ cls: 'novel-writer-fw-token-bar-container' });
            const bar = barContainer.createDiv({ cls: 'novel-writer-fw-token-bar' });
            const pct = Math.min(100, (estimatedTokens / maxTokens) * 100);
            const fill = bar.createDiv({ cls: 'novel-writer-fw-token-fill' });
            fill.style.width = `${pct}%`;

            if (pct > 80) {
                fill.style.backgroundColor = '#ff3b30';
            } else if (pct > 60) {
                fill.style.backgroundColor = '#ff9500';
            }

            body.createEl('p', {
                text: `~${estimatedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens（${pct.toFixed(1)}%）`,
                cls: 'novel-writer-fw-token-text'
            });
        }, true);
    }

    /**
     * 创建可折叠卡片
     */
    private renderCollapsibleCard(panel: HTMLElement, title: string, renderBody: (body: HTMLElement) => void, reRender: boolean = false): void {
        const container = panel.createDiv({ cls: 'nw-context-bar__collapsible-card' });
        
        const header = container.createDiv({ cls: 'nw-context-bar__collapsible-header' });
        const titleEl = header.createSpan({ cls: 'nw-context-bar__collapsible-title', text: title });
        const iconEl = header.createSpan({ cls: 'nw-context-bar__collapsible-icon' });
        
        const body = container.createDiv({ cls: 'nw-context-bar__collapsible-body' });
        
        let collapsed = true;
        body.style.display = 'none';
        iconEl.setText('▶');
        
        header.onclick = () => {
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'block';
            iconEl.setText(collapsed ? '▶' : '▼');
            if (reRender && !collapsed) {
                body.empty();
                renderBody(body);
            }
        };
        
        // Pre-render body content (hidden by default)
        // v3.4.9 P0-1: 包裹 try-catch 防止任一卡片异常导致整个面板崩溃
        try { renderBody(body); } catch (e) {
            body.createEl('p', { text: '⚠️ 渲染异常', attr: { style: 'color:var(--text-error);font-size:11px;' } });
            console.warn('[ContextPanel] renderCollapsibleCard renderBody 异常:', e);
        }
    }
}
