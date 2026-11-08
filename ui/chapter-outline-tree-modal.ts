import { App, Modal, TFile } from 'obsidian';
import type NovelWriterAI from '@/main';
import { pjVolumeOutlineDir, pjStepDir } from '@/shared/paths';
import { createLogger } from '@/shared/logger';
import { writeVaultText } from '@/shared/file-system-port';
import { isImeComposing } from '@/shared/keyboard';
import { projectIdFromPath } from '@/shared/paths';
import { showErrorNotice, showSuccessNotice } from './components/notice-helpers';


const log = createLogger('ChapterOutlineTreeModal');
/** 解析后的卷结构 */
interface VolumeNode {
    volName: string;
    volNum: number;
    chapterRange: string;
    coreConflict: string;
    startLine: number;
    endLine: number;
    chapters: ChapterNode[];
}

/** 解析后的章结构 */
interface ChapterNode {
    chapNum: number;
    conflict: string;
    rowLine: number;
    volIndex: number;
    /** 该章所在的源文件索引（v4.0 多卷归档下用于回写） */
    sourceIdx: number;
    /** 场景列表 */
    scenes: SceneNode[];
    /** 场景展开文件路径 */
    sceneSourcePath?: string;
}

/** 场景节点 */
interface SceneNode {
    sceneNum: number;
    sceneName: string;
    objective: string;
    emotionArc: string;
    conflict: string;
    sensoryHook: string;
    bodyReaction: string;
    subtext: string;
    isKeyScene: boolean;
    keySceneReason: string;
    dialogueFunction: string;
    cliffhanger: string;
}

/** 大纲来源文件（v4.0 一个卷一个文件；旧版为单文件兜底） */
interface OutlineSource {
    path: string;
    lines: string[];
}

/**
 * ChapterOutlineTreeModal 类。
 */
export class ChapterOutlineTreeModal extends Modal {
    private plugin: NovelWriterAI;
    /** v4.0：项目名，按卷归档读取分卷大纲；旧版单文件用 legacyPath 兜底 */
    private project: string;
    /** 旧版单文件路径（仅当传入的是 .md 单文件时使用） */
    private legacyPath: string | null = null;
    /** 所有来源文件（每卷一个；旧版单文件时只有一个），保存时按文件分组回写 */
    private sources: OutlineSource[] = [];
    private volumes: VolumeNode[] = [];
    /** 章节区间搜索：起始章号（含0=未设置） */
    private rangeFrom = 0;
    /** 章节区间搜索：结束章号（含0=未设置） */
    private rangeTo = 0;
    private expandedVolumes: Set<number> = new Set();
    /** 拖拽状态 */
    private dragState: {
        isDragging: boolean;
        draggedChap: ChapterNode | null;
        draggedVolIndex: number;
        draggedChapIndex: number;
    } = {
        isDragging: false,
        draggedChap: null,
        draggedVolIndex: -1,
        draggedChapIndex: -1,
    };
    /** 跨卷移动时需要删除的行：源文件索引 -> 行号集合 */
    private deletedRows: Map<number, Set<number>> = new Map();

    /**
     * @param project 项目名（v4.0 按卷归档），或旧版单文件 `.md` 路径（向后兼容）
     */
    constructor(app: App, plugin: NovelWriterAI, project: string) {
        super(app);
        this.plugin = plugin;
        if (project.endsWith('.md')) {
            // 向后兼容：直接传入单文件路径
            this.legacyPath = project;
            this.project = projectIdFromPath(project);
        } else {
            this.project = project;
        }
    }

    /**
     * onOpen 方法。
     */
    async onOpen() {
    this.modalEl.addClass('nw-scope');
        const { contentEl } = this;

        // v3.4.8: 两层 CSS 规则 — 覆盖 Obsidian .modal 父容器约束
        const wrapper = contentEl.parentElement as HTMLElement;
        if (wrapper) {
            wrapper.addClass('nw-modal');
        }
        contentEl.style.setProperty('padding', '16px 20px', 'important');

        contentEl.empty();
        contentEl.addClass('nw-outline-tree-modal');

        await this.loadOutline();

        if (this.volumes.length === 0) {
            contentEl.createEl('p', { text: '⚠️ 未找到分卷大纲，请先执行"全书规划"步骤。', cls: 'nw-u-c-text-warning nw-u-p-20px-2' });
            return;
        }

        this.volumes.forEach((_, i) => this.expandedVolumes.add(i));
        this.render();
    }

    /**
     * onClose 方法。
     */
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private async loadOutline(): Promise<void> {
        try {
            this.sources = [];
            if (this.legacyPath) {
                // 向后兼容：单文件
                const file = this.app.vault.getAbstractFileByPath(this.legacyPath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    this.sources.push({ path: this.legacyPath, lines: content.split('\n') });
                }
            } else {
                // v4.0：按卷归档，逐卷文件加载（卷号升序），各文件独立行模型
                const dir = pjVolumeOutlineDir(this.project);
                const volFiles = this.app.vault.getFiles()
                    .filter(f => f.path.startsWith(`${dir}/`) && f.name.endsWith('_分卷大纲.md'))
                    .sort((a, b) => {
                        const na = parseInt(a.name.match(/第(\d+)卷/)?.[1] || '0');
                        const nb = parseInt(b.name.match(/第(\d+)卷/)?.[1] || '0');
                        return na - nb;
                    });
                for (const f of volFiles) {
                    const content = await this.app.vault.read(f);
                    this.sources.push({ path: f.path, lines: content.split('\n') });
                }
                // 旧版单文件兜底（v3.x 尚未迁移时）
                if (this.sources.length === 0) {
                    const legacy = this.app.vault.getAbstractFileByPath(`${this.project}/03-大纲与章节/分卷大纲.md`);
                    if (legacy instanceof TFile) {
                        const content = await this.app.vault.read(legacy);
                        this.sources.push({ path: legacy.path, lines: content.split('\n') });
                    }
                }
            }
            this.parseContent();
            await this.loadAllScenes();
        } catch (e) {
            log.error('[OutlineTree] 读取分卷大纲失败:', e);
        }
    }

    /** 解析所有来源文件为树结构（rowLine 相对各自源文件，sourceIdx 标记来源） */
    private parseContent(): void {
        this.volumes = [];

        for (let srcIdx = 0; srcIdx < this.sources.length; srcIdx++) {
            const lines = this.sources[srcIdx].lines;
            let currentVol: VolumeNode | null = null;
            let inChapterTable = false;

            for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // 检测卷标题: ### 第N卷
            const volMatch = trimmed.match(/^###\s*第(\d+)卷/);
            if (volMatch) {
                // v3.4.8 fix: 先 push 旧卷到数组，再创建新卷
                if (currentVol) {
                    currentVol.endLine = i - 1;
                    this.volumes.push(currentVol);
                }
                currentVol = {
                    volNum: parseInt(volMatch[1]),
                    volName: '',
                    chapterRange: '',
                    coreConflict: '',
                    startLine: i,
                    endLine: lines.length - 1,
                    chapters: [],
                };
                inChapterTable = false;
                continue;
            }

            if (!currentVol) continue;

            // 解析卷名: - **卷名**：xxx
            const nameMatch = trimmed.match(/[-*]\s*\*{0,2}卷名\*{0,2}\s*[:：]\s*(.+)/);
            if (nameMatch) { currentVol.volName = nameMatch[1].trim(); continue; }

            // 解析章节范围
            const rangeMatch = trimmed.match(/[-*]\s*\*{0,2}章节范围\*{0,2}\s*[:：]\s*(.+)/);
            if (rangeMatch) { currentVol.chapterRange = rangeMatch[1].trim(); continue; }

            // 解析卷核心冲突
            const conflictMatch = trimmed.match(/[-*]\s*\*{0,2}核心冲突\*{0,2}\s*[:：]\s*(.+)/);
            if (conflictMatch) { currentVol.coreConflict = conflictMatch[1].trim(); continue; }

            // 检测章节分配表头
            if (trimmed.startsWith('| 章号') || trimmed.startsWith('|章号')) {
                inChapterTable = true;
                continue;
            }

            // 表格分隔行
            if (inChapterTable && /^\|[-| ]+\|$/.test(trimmed)) continue;

            // 解析章节表格行: | 1 | xxx |
                if (inChapterTable) {
                    const rowMatch = trimmed.match(/^\|\s*(\d+)\s*\|(.+)\|$/);
                    if (rowMatch) {
                        currentVol.chapters.push({
                            chapNum: parseInt(rowMatch[1]),
                            conflict: rowMatch[2].trim(),
                            rowLine: i,
                            volIndex: this.volumes.length,
                            sourceIdx: srcIdx,
                            scenes: [],
                        });
                        continue;
                    }
                }

            if (inChapterTable && !trimmed.startsWith('|')) {
                inChapterTable = false;
            }
            }

            // 最后一个卷
            if (currentVol) {
                currentVol.endLine = lines.length - 1;
                this.volumes.push(currentVol);
            }
        }

        log.warn('[OutlineTree] 解析完成: 共', this.volumes.length, '卷, 总章节', this.volumes.reduce((s, v) => s + v.chapters.length, 0));
    }

    private async loadAllScenes(): Promise<void> {
        for (const vol of this.volumes) {
            for (const chap of vol.chapters) {
                await this.loadScenesForChapter(chap, vol.volNum);
            }
        }
    }

    private async loadScenesForChapter(chap: ChapterNode, volNum: number): Promise<void> {
        const scenePath = `${pjStepDir(this.project, volNum, chap.chapNum)}/第${chap.chapNum}章_Scene展开.md`;
        const file = this.app.vault.getAbstractFileByPath(scenePath);
        if (!(file instanceof TFile)) {
            chap.scenes = [];
            return;
        }

        try {
            const content = await this.app.vault.read(file);
            chap.sceneSourcePath = scenePath;
            chap.scenes = this.parseSceneContent(content);
        } catch (e) {
            log.error('[OutlineTree] 读取场景展开文件失败:', scenePath, e);
            chap.scenes = [];
        }
    }

    private parseSceneContent(content: string): SceneNode[] {
        const scenes: SceneNode[] = [];
        const lines = content.split('\n');
        let currentScene: Partial<SceneNode> | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            const sceneMatch = trimmed.match(/^#{2,6}\s*(?:场景\s*([一二三四五六七八九十百千万亿零〇两]+|\d+)|scene\s*(\d+))\s*[：:]\s*(.+)$/);
            if (sceneMatch) {
                if (currentScene) {
                    scenes.push(this.completeScene(currentScene));
                }
                let sceneNum = 0;
                if (sceneMatch[1] !== undefined) {
                    const cnNum = this.parseChineseNumber(sceneMatch[1]);
                    sceneNum = cnNum ?? scenes.length + 1;
                } else if (sceneMatch[2] !== undefined) {
                    sceneNum = parseInt(sceneMatch[2], 10);
                } else {
                    sceneNum = scenes.length + 1;
                }
                currentScene = {
                    sceneNum,
                    sceneName: sceneMatch[3].trim(),
                    objective: '',
                    emotionArc: '',
                    conflict: '',
                    sensoryHook: '',
                    bodyReaction: '',
                    subtext: '',
                    isKeyScene: false,
                    keySceneReason: '',
                    dialogueFunction: '',
                    cliffhanger: '',
                };
                continue;
            }

            if (!currentScene) continue;

            const objMatch = trimmed.match(/^\s*\*?\*?objective\s*[：:]\s*(.+)$/i);
            if (objMatch) { currentScene.objective = objMatch[1].trim(); continue; }

            const arcMatch = trimmed.match(/^\s*\*?\*?emotion_arc\s*[：:]\s*(.+)$/i);
            if (arcMatch) { currentScene.emotionArc = arcMatch[1].trim(); continue; }

            const conflictMatch = trimmed.match(/^\s*\*?\*?conflict\s*[：:]\s*(.+)$/i);
            if (conflictMatch) { currentScene.conflict = conflictMatch[1].trim(); continue; }

            const sensoryMatch = trimmed.match(/^\s*\*?\*?sensory_hook\s*[：:]\s*(.+)$/i);
            if (sensoryMatch) { currentScene.sensoryHook = sensoryMatch[1].trim(); continue; }

            const bodyMatch = trimmed.match(/^\s*\*?\*?body_reaction\s*[：:]\s*(.+)$/i);
            if (bodyMatch) { currentScene.bodyReaction = bodyMatch[1].trim(); continue; }

            const subtextMatch = trimmed.match(/^\s*\*?\*?subtext\s*[：:]\s*(.+)$/i);
            if (subtextMatch) { currentScene.subtext = subtextMatch[1].trim(); continue; }

            const keySceneMatch = trimmed.match(/^\s*\*?\*?key_scene\s*[：:]\s*(.+)$/i);
            if (keySceneMatch) {
                const keySceneText = keySceneMatch[1].trim();
                currentScene.isKeyScene = keySceneText.includes('⭐') || keySceneText.includes('名场面');
                currentScene.keySceneReason = keySceneText;
                continue;
            }

            const dialogueMatch = trimmed.match(/^\s*\*?\*?dialogue_function\s*[：:]\s*(.+)$/i);
            if (dialogueMatch) { currentScene.dialogueFunction = dialogueMatch[1].trim(); continue; }

            const cliffhangerMatch = trimmed.match(/^\s*\*?\*?cliffhanger\s*[：:]\s*(.+)$/i);
            if (cliffhangerMatch) { currentScene.cliffhanger = cliffhangerMatch[1].trim(); continue; }
        }

        if (currentScene) {
            scenes.push(this.completeScene(currentScene));
        }

        return scenes;
    }

    private completeScene(scene: Partial<SceneNode>): SceneNode {
        return {
            sceneNum: scene.sceneNum || 0,
            sceneName: scene.sceneName || '',
            objective: scene.objective || '',
            emotionArc: scene.emotionArc || '',
            conflict: scene.conflict || '',
            sensoryHook: scene.sensoryHook || '',
            bodyReaction: scene.bodyReaction || '',
            subtext: scene.subtext || '',
            isKeyScene: scene.isKeyScene || false,
            keySceneReason: scene.keySceneReason || '',
            dialogueFunction: scene.dialogueFunction || '',
            cliffhanger: scene.cliffhanger || '',
        };
    }

    private parseChineseNumber(str: string): number | null {
        if (!str || str.trim() === '') return null;
        const s = str.trim();
        const digits: Record<string, number> = {
            '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
            '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
        };
        const units: Record<string, number> = {
            '十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000,
        };

        let total = 0;
        let current = 0;
        let section = 0;
        let hasDigit = false;

        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (digits[ch] !== undefined) {
                current = digits[ch];
                hasDigit = true;
            } else if (units[ch] !== undefined) {
                const unit = units[ch];
                if (unit >= 10000) {
                    section = (section + current) * unit;
                    total += section;
                    section = 0;
                } else {
                    if (current === 0 && !hasDigit) current = 1;
                    section += current * unit;
                }
                current = 0;
                hasDigit = false;
            } else {
                return null;
            }
        }
        total += section + current;
        return total > 0 ? total : null;
    }

    /** 区间搜索是否匹配某章 */
    private isInRange(chapNum: number): boolean {
        const from = this.rangeFrom;
        const to = this.rangeTo;

        // 只有起始章 → 单章定位
        if (from > 0 && to === 0) return chapNum === from;
        // 起始 + 结束 → 区间
        if (from > 0 && to > 0) return chapNum >= from && chapNum <= to;
        // 只有结束章 → 查看到此章
        if (from === 0 && to > 0) return chapNum <= to;
        // 都没设置 → 不过滤
        return true;
    }

    /** 是否有任何区间过滤 */
    private hasRangeFilter(): boolean {
        return this.rangeFrom > 0 || this.rangeTo > 0;
    }

    /** 渲染主结构 */
    private render(): void {
        const { contentEl } = this;
        contentEl.empty();

        // ── 标题栏 + 章号区间搜索 + 全文切换 ──
        const header = contentEl.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-space-between-2 nw-u-ai-center-2 nw-u-fwr-wrap-2 nw-u-gap-8px-2 nw-u-p-0-4px-12px-4px nw-u-bb-1px-solid-background-m-2 nw-u-marginbottom-12px-2' });
        header.createEl('h3', { text: '📖 分卷大纲 · 章节冲突预览', cls: 'nw-u-m-0-2 nw-u-fs-1-1em nw-u-ws-nowrap-2' });

        // 章号区间搜索 + 全文按钮
        const actionsWrap = header.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-6px-2 nw-u-ai-center-2 nw-u-fwr-wrap-2' });
        const searchWrap = actionsWrap.createDiv({ cls: 'nw-u-d-flex-2 nw-u-gap-6px-2 nw-u-ai-center-2 nw-u-fs-0-85em' });
        searchWrap.createSpan({ text: '【', cls: 'nw-u-c-text-muted-2' });
        const fromInput = searchWrap.createEl('input', {
            attr: { placeholder: '起始章', style: 'width:60px; padding:3px 6px; border-radius:4px; border:1px solid var(--background-modifier-border); font-size:0.85em; text-align:center;', type: 'number', min: '1' }
        });
        fromInput.value = this.rangeFrom > 0 ? String(this.rangeFrom) : '';
        searchWrap.createSpan({ text: '章 ——【', cls: 'nw-u-c-text-muted-2' });
        const toInput = searchWrap.createEl('input', {
            attr: { placeholder: '结束章', style: 'width:60px; padding:3px 6px; border-radius:4px; border:1px solid var(--background-modifier-border); font-size:0.85em; text-align:center;', type: 'number', min: '1' }
        });
        toInput.value = this.rangeTo > 0 ? String(this.rangeTo) : '';
        searchWrap.createSpan({ text: '章 】', cls: 'nw-u-c-text-muted-2' });

        // 定位按钮
        const goBtn = searchWrap.createEl('button', {
            text: '🔍', attr: { style: 'padding:3px 8px; background:var(--text-accent); color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.85em;', title: '定位到章节区间' }
        });
        goBtn.addEventListener('click', () => {
            this.rangeFrom = parseInt(fromInput.value) || 0;
            this.rangeTo = parseInt(toInput.value) || 0;
            if (this.rangeFrom > 0 || this.rangeTo > 0) {
                // 展开包含目标章节的所有卷
                this.expandedVolumes.clear();
                for (let vi = 0; vi < this.volumes.length; vi++) {
                    if (this.volumes[vi].chapters.some(c => this.isInRange(c.chapNum))) {
                        this.expandedVolumes.add(vi);
                    }
                }
            }
            this.render();
        });

        // 清除按钮
        const clearBtn = searchWrap.createEl('button', {
            text: '✕', attr: { style: 'padding:3px 6px; border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; font-size:0.85em; background:var(--background-secondary);', title: '清除过滤' }
        });
        clearBtn.addEventListener('click', () => {
            this.rangeFrom = 0;
            this.rangeTo = 0;
            this.volumes.forEach((_, i) => this.expandedVolumes.add(i));
            this.render();
        });

        // 回车触发
        [fromInput, toInput].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') goBtn.click(); }));

        // v4.1.0: 查看全文切换 — 统一替代旧版内联纯文本预览
        const textBtn = actionsWrap.createEl('button', {
            text: '📄 全文', attr: { style: 'padding:3px 10px; border:1px solid var(--background-modifier-border); border-radius:4px; cursor:pointer; font-size:0.85em; background:var(--background-secondary);', title: '查看合并后的分卷大纲全文' }
        });
        let textEl: HTMLElement | null = null;
        textBtn.addEventListener('click', () => {
            if (textEl) { textEl.remove(); textEl = null; textBtn.textContent = '📄 全文'; return; }
            const raw = this.sources.map(s => s.lines.join('\n')).join('\n\n---\n');
            const bodyContent = raw.replace(/^---[\s\S]*?---\n*/gm, '').trim();
            textEl = contentEl.createDiv({
                cls: 'nw-u-m-0-4px-12px nw-u-p-10px-2 nw-u-b-1px-solid-background-m-2 nw-u-brd-6px-2 nw-u-maxh-30vh nw-u-ovy-auto-2 nw-u-fs-0-82em nw-u-lh-1-5-2 nw-u-ws-pre-wrap nw-u-wordbreak-break-word nw-u-bg-background-primary-2'
            });
            textEl.setText(bodyContent.slice(0, 20000));
            textBtn.textContent = '📄 收起';
        });

        // ── 树容器 ──
        const treeContainer = contentEl.createDiv({
            cls: 'nw-u-maxh-50vh nw-u-ovy-auto-2 nw-u-p-0-4px nw-u-marginbottom-12px-2'
        });

        // ── 渲染卷 ──
        let totalVisible = 0;
        for (let vi = 0; vi < this.volumes.length; vi++) {
            const vol = this.volumes[vi];
            const isExpanded = this.expandedVolumes.has(vi);

            // 区间过滤：检查该卷是否有匹配章节
            if (this.hasRangeFilter()) {
                const hasMatch = vol.chapters.some(c => this.isInRange(c.chapNum));
                if (!hasMatch) {
                    // 显示但折叠
                    if (!isExpanded) {
                        // 渲染折叠标题
                        const volHeader = treeContainer.createDiv({
                            cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-p-6px-8px-2 nw-u-m-2px-0 nw-u-brd-6px-2 nw-u-cur-pointer-2 nw-u-bg-background-secondary-2 nw-u-op-0-5'
                        });
                        volHeader.addEventListener('click', () => {
                            this.expandedVolumes.add(vi);
                            this.render();
                        });
                        volHeader.createSpan({ text: '▶', cls: 'nw-u-marginright-8px nw-u-fs-0-8em nw-u-minw-16px' });
                        volHeader.createSpan({ text: `第${vol.volNum}卷 ${vol.volName || '(未命名)'} — ${vol.chapters.length}章 (无匹配)`, cls: 'nw-u-fs-0-85em nw-u-c-text-faint-2' });
                    }
                    continue;
                }
            }

            // 卷标题行
            const volHeader = treeContainer.createDiv({
                cls: 'nw-u-d-flex-2 nw-u-ai-center-2 nw-u-p-8px-10px-2 nw-u-m-6px-0-2px-0 nw-u-brd-8px-2 nw-u-cur-pointer-2 nw-u-bg-background-secondary-2'
            });
            volHeader.addEventListener('click', () => {
                if (this.expandedVolumes.has(vi)) this.expandedVolumes.delete(vi);
                else this.expandedVolumes.add(vi);
                this.render();
            });

            volHeader.createSpan({ text: isExpanded ? '▼' : '▶', cls: 'nw-u-marginright-8px nw-u-fs-0-8em nw-u-minw-16px' });
            volHeader.createSpan({ text: `第${vol.volNum}卷`, cls: 'nw-u-fwt-700-2 nw-u-c-text-accent nw-u-marginright-8px' });
            volHeader.createSpan({ text: vol.volName || '(未命名)', cls: 'nw-u-c-text-normal-2 nw-u-fwt-600-2 nw-u-marginright-12px' });
            volHeader.createSpan({ text: `${vol.chapters.length}章`, cls: 'nw-u-fs-0-78em nw-u-c-text-faint-2' });

            if (!isExpanded) continue;

            // ── 卷概览面板（v3.4.8） ──
            const hasOverview = vol.coreConflict || vol.chapterRange;
            if (hasOverview) {
                const overviewBox = treeContainer.createDiv({
                    cls: 'nw-u-m-2px-4px-8px-28px nw-u-p-8px-10px-2 nw-u-brd-6px-2 nw-u-bg-rgba-color-accent-rgb- nw-u-blt-3px-solid-text-accent nw-u-fs-0-82em nw-u-lh-1-5-2'
                });
                if (vol.chapterRange) {
                    overviewBox.createSpan({ text: '📐 ', cls: 'nw-u-fs-0-9em' });
                    overviewBox.createSpan({ text: vol.chapterRange, cls: 'nw-u-c-text-faint-2' });
                }
                if (vol.coreConflict) {
                    if (vol.chapterRange) overviewBox.createEl('br');
                    overviewBox.createSpan({ text: '🎯 ', cls: 'nw-u-fs-0-9em' });
                    overviewBox.createSpan({ text: vol.coreConflict, cls: 'nw-u-c-text-muted-2' });
                }
                // 章节数统计
                if (this.hasRangeFilter()) {
                    const matchedInVol = vol.chapters.filter(c => this.isInRange(c.chapNum)).length;
                    overviewBox.createEl('br');
                    overviewBox.createSpan({ text: `🔍 匹配 ${matchedInVol}/${vol.chapters.length} 章`, cls: 'nw-u-c-text-accent nw-u-fs-0-85em' });
                }
            }

            // ── 章节列表 ──
            for (let ci = 0; ci < vol.chapters.length; ci++) {
                const chap = vol.chapters[ci];
                if (this.hasRangeFilter() && !this.isInRange(chap.chapNum)) continue;

                totalVisible++;
                const isTarget = (this.rangeFrom > 0 && chap.chapNum === this.rangeFrom) ||
                    (this.rangeTo > 0 && chap.chapNum === this.rangeTo);
                const isDragging = this.dragState.isDragging && this.dragState.draggedChap === chap;

                const conflictPreview = chap.conflict.length > 70 ? chap.conflict.substring(0, 70) + '...' : chap.conflict;

                const chapRow = treeContainer.createDiv({
                    attr: {
                        style: `display:flex; align-items:flex-start; padding:4px 8px 4px 8px; margin:1px 0; border-radius:4px; font-size:0.84em; ${isTarget ? 'background:rgba(245,158,11,0.18); border-left:3px solid #f59e0b;' : ''} ${isDragging ? 'opacity:0.4; background:rgba(var(--color-accent-rgb),0.1);' : ''}`,
                        draggable: 'true',
                        'data-vol-index': String(vi),
                        'data-chap-index': String(ci),
                    }
                });

                // 拖拽手柄
                const dragHandle = chapRow.createSpan({
                    text: '⠿',
                    attr: {
                        style: 'cursor:grab; margin-right:4px; color:var(--text-faint); user-select:none; font-size:0.9em;',
                        title: '拖拽排序',
                    }
                });
                dragHandle.addEventListener('mousedown', () => { dragHandle.style.cursor = 'grabbing'; });
                dragHandle.addEventListener('mouseup', () => { dragHandle.style.cursor = 'grab'; });

                // 章号
                chapRow.createSpan({
                    text: `第${chap.chapNum}章`,
                    cls: 'nw-u-fwt-600-2 nw-u-ws-nowrap-2 nw-u-marginright-8px nw-u-minw-48px nw-u-c-text-accent'
                });

                // 冲突文本（可编辑）
                const conflictSpan = chapRow.createSpan({
                    text: conflictPreview,
                    attr: {
                        style: 'flex:1; cursor:pointer; padding:2px 4px; border-radius:3px; border:1px solid transparent;',
                        title: chap.conflict
                    }
                });
                conflictSpan.addEventListener('click', () => this.startEdit(chapRow, conflictSpan, chap));

                // 编辑按钮
                const editBtn = chapRow.createSpan({
                    text: '✏️',
                    cls: 'nw-u-cur-pointer-2 nw-u-op-0-5 nw-u-fs-0-8em nw-u-marginleft-6px'
                });
                editBtn.addEventListener('click', (e) => { e.stopPropagation(); this.startEdit(chapRow, conflictSpan, chap); });

                // +场景按钮
                if (chap.scenes.length > 0 || chap.sceneSourcePath) {
                    const addSceneBtn = chapRow.createSpan({
                        text: '+ 场景',
                        cls: 'nw-u-cur-pointer-2 nw-u-op-0-5 nw-u-fs-0-7em nw-u-marginleft-4px-2 nw-u-c-text-accent'
                    });
                    addSceneBtn.addEventListener('click', (e) => { e.stopPropagation(); this.addScene(chap); });
                }

                // 拖拽事件
                chapRow.addEventListener('dragstart', (e) => this.handleDragStart(e, vi, ci, chap));
                chapRow.addEventListener('dragend', (e) => this.handleDragEnd(e));
                chapRow.addEventListener('dragover', (e) => this.handleDragOver(e, chapRow));
                chapRow.addEventListener('dragleave', (e) => this.handleDragLeave(e, chapRow));
                chapRow.addEventListener('drop', (e) => this.handleDrop(e, vi, ci));

                // ── 场景列表 ──
                for (let si = 0; si < chap.scenes.length; si++) {
                    const scene = chap.scenes[si];
                    const isLastScene = si === chap.scenes.length - 1;

                    const sceneRow = treeContainer.createDiv({
                        attr: {
                            style: `display:flex; align-items:flex-start; padding:3px 8px 3px 28px; margin:1px 0; border-radius:3px; font-size:0.78em;`,
                            draggable: 'true',
                            'data-vol-index': String(vi),
                            'data-chap-index': String(ci),
                            'data-scene-index': String(si),
                        }
                    });

                    // 拖拽手柄
                    const sceneDragHandle = sceneRow.createSpan({
                        text: '⠿',
                        attr: {
                            style: 'cursor:grab; margin-right:4px; color:var(--text-faint); user-select:none; font-size:0.8em;',
                            title: '拖拽排序',
                        }
                    });
                    sceneDragHandle.addEventListener('mousedown', () => { sceneDragHandle.style.cursor = 'grabbing'; });
                    sceneDragHandle.addEventListener('mouseup', () => { sceneDragHandle.style.cursor = 'grab'; });

                    // 场景编号
                    sceneRow.createSpan({
                        text: `场景${scene.sceneNum}`,
                        cls: 'nw-u-fwt-500-2 nw-u-ws-nowrap-2 nw-u-marginright-6px nw-u-minw-40px nw-u-c-text-muted-2'
                    });

                    // 场景名（可双击编辑）
                    const sceneNameSpan = sceneRow.createSpan({
                        text: scene.sceneName || '(未命名)',
                        attr: {
                            style: 'flex:1; cursor:pointer; padding:1px 3px; border-radius:2px; border:1px solid transparent;',
                            title: scene.sceneName
                        }
                    });
                    sceneNameSpan.addEventListener('dblclick', () => this.startSceneEdit(sceneRow, sceneNameSpan, scene, chap));

                    // 属性图标
                    if (scene.isKeyScene) {
                        sceneRow.createSpan({
                            text: '⭐',
                            attr: { style: 'margin-left:4px; font-size:0.85em;', title: `名场面: ${scene.keySceneReason}` }
                        });
                    }

                    if (scene.dialogueFunction) {
                        const dialogFunc = scene.dialogueFunction.length > 15 ? scene.dialogueFunction.substring(0, 15) + '...' : scene.dialogueFunction;
                        sceneRow.createSpan({
                            text: `💬 ${dialogFunc}`,
                            attr: { style: 'margin-left:4px; font-size:0.75em; color:var(--text-faint);', title: scene.dialogueFunction }
                        });
                    }

                    if (isLastScene && scene.cliffhanger) {
                        const cliff = scene.cliffhanger.length > 15 ? scene.cliffhanger.substring(0, 15) + '...' : scene.cliffhanger;
                        sceneRow.createSpan({
                            text: `🪝 ${cliff}`,
                            attr: { style: 'margin-left:4px; font-size:0.75em; color:var(--text-accent);', title: scene.cliffhanger }
                        });
                    }

                    // 删除按钮
                    const delSceneBtn = sceneRow.createSpan({
                        text: '🗑️',
                        cls: 'nw-u-cur-pointer-2 nw-u-op-0-4 nw-u-fs-0-7em nw-u-marginleft-6px'
                    });
                    delSceneBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteScene(chap, si); });

                    // 场景拖拽事件
                    sceneRow.addEventListener('dragstart', (e) => this.handleSceneDragStart(e, vi, ci, si));
                    sceneRow.addEventListener('dragend', (e) => this.handleSceneDragEnd(e));
                    sceneRow.addEventListener('dragover', (e) => this.handleSceneDragOver(e, sceneRow));
                    sceneRow.addEventListener('dragleave', (e) => this.handleSceneDragLeave(e, sceneRow));
                    sceneRow.addEventListener('drop', (e) => this.handleSceneDrop(e, vi, ci, si));
                }
            }
        }

        // 筛选结果
        if (this.hasRangeFilter() && totalVisible === 0) {
            treeContainer.createEl('p', { text: '未找到匹配的章节区间。', cls: 'nw-u-p-20px-2 nw-u-c-text-muted-2 nw-u-ta-center-2' });
        } else if (this.hasRangeFilter()) {
            treeContainer.createDiv({
                text: `匹配 ${totalVisible} 个章节`,
                cls: 'nw-u-p-4px-8px-2 nw-u-fs-0-8em nw-u-c-text-faint-2 nw-u-ta-right'
            });
        }

        // ── 底部按钮 ──
        const footer = contentEl.createDiv({ cls: 'nw-u-d-flex-2 nw-u-jc-flex-end-2 nw-u-gap-8px-2 nw-u-paddingtop-12px-2 nw-u-bt-1px-solid-background-m-2' });

        const cancelBtn = footer.createEl('button', {
            text: '✕ 关闭', attr: { style: 'padding:6px 16px; border-radius:6px; cursor:pointer; border:1px solid var(--background-modifier-border); background:var(--background-secondary);' }
        });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = footer.createEl('button', {
            text: '💾 保存所有修改', cls: 'nw-u-p-6px-16px nw-u-bg-text-accent nw-u-c-white-2 nw-u-b-none nw-u-brd-6px-2 nw-u-cur-pointer-2 nw-u-fwt-600-2'
        });
        saveBtn.addEventListener('click', () => this.saveAll());
    }

    /** 开始内联编辑 */
    private startEdit(container: HTMLElement, displaySpan: HTMLElement, chap: ChapterNode): void {
        container.querySelectorAll('.nw-inline-editor').forEach(el => el.remove());
        displaySpan.style.display = 'none';

        const editorWrap = container.createDiv({ cls: "nw-inline-editor nw-u-flex-1-2 nw-u-d-flex-2 nw-u-gap-4px-2", attr: {} });
        const input = editorWrap.createEl('input', {
            attr: { style: 'flex:1; padding:2px 6px; border-radius:3px; border:1px solid var(--text-accent); font-size:0.85em; background:var(--background-primary);' },
            value: chap.conflict
        });
        input.focus();

        const confirmBtn = editorWrap.createEl('button', {
            text: '✓', cls: 'nw-u-p-2px-6px-2 nw-u-bg-text-success nw-u-c-white-2 nw-u-b-none nw-u-brd-3px-2 nw-u-cur-pointer-2 nw-u-fs-0-8em'
        });
        confirmBtn.addEventListener('click', () => {
            const newVal = input.value.trim();
            if (newVal) {
                chap.conflict = newVal;
                displaySpan.textContent = newVal.length > 70 ? newVal.substring(0, 70) + '...' : newVal;
                showSuccessNotice('冲突已修改（点击"保存所有修改"写入文件）', { timeout: 2000 });
            }
            this.finishEdit(container, displaySpan);
        });

        const cancelEditBtn = editorWrap.createEl('button', {
            text: '✕', cls: 'nw-u-p-2px-6px-2 nw-u-bg-background-modifier-bo-3 nw-u-b-none nw-u-brd-3px-2 nw-u-cur-pointer-2 nw-u-fs-0-8em'
        });
        cancelEditBtn.addEventListener('click', () => this.finishEdit(container, displaySpan));

        input.addEventListener('keydown', (e) => {
            // IME 组字中 Enter/Escape 属于候选操作，不能确认/取消重命名
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') confirmBtn.click();
            else if (e.key === 'Escape') cancelEditBtn.click();
        });
    }

    private finishEdit(container: HTMLElement, displaySpan: HTMLElement): void {
        container.querySelectorAll('.nw-inline-editor').forEach(el => el.remove());
        displaySpan.style.display = '';
    }

    /** 场景编辑 */
    private startSceneEdit(container: HTMLElement, displaySpan: HTMLElement, scene: SceneNode, chap: ChapterNode): void {
        container.querySelectorAll('.nw-inline-editor').forEach(el => el.remove());
        displaySpan.style.display = 'none';

        const editorWrap = container.createDiv({ cls: "nw-inline-editor nw-u-flex-1-2 nw-u-d-flex-2 nw-u-gap-4px-2", attr: {} });
        const input = editorWrap.createEl('input', {
            attr: { style: 'flex:1; padding:1px 4px; border-radius:2px; border:1px solid var(--text-accent); font-size:0.78em; background:var(--background-primary);' },
            value: scene.sceneName
        });
        input.focus();

        const confirmBtn = editorWrap.createEl('button', {
            text: '✓', cls: 'nw-u-p-1px-4px nw-u-bg-text-success nw-u-c-white-2 nw-u-b-none nw-u-brd-2px-2 nw-u-cur-pointer-2 nw-u-fs-0-75em'
        });
        confirmBtn.addEventListener('click', () => {
            const newVal = input.value.trim();
            if (newVal) {
                scene.sceneName = newVal;
                displaySpan.textContent = newVal;
                showSuccessNotice('场景名已修改（点击"保存所有修改"写入文件）', { timeout: 2000 });
            }
            this.finishSceneEdit(container, displaySpan);
        });

        const cancelEditBtn = editorWrap.createEl('button', {
            text: '✕', cls: 'nw-u-p-1px-4px nw-u-bg-background-modifier-bo-3 nw-u-b-none nw-u-brd-2px-2 nw-u-cur-pointer-2 nw-u-fs-0-75em'
        });
        cancelEditBtn.addEventListener('click', () => this.finishSceneEdit(container, displaySpan));

        input.addEventListener('keydown', (e) => {
            // IME 组字中 Enter/Escape 属于候选操作，不能确认/取消重命名
            if (isImeComposing(e)) return;
            if (e.key === 'Enter') confirmBtn.click();
            else if (e.key === 'Escape') cancelEditBtn.click();
        });
    }

    private finishSceneEdit(container: HTMLElement, displaySpan: HTMLElement): void {
        container.querySelectorAll('.nw-inline-editor').forEach(el => el.remove());
        displaySpan.style.display = '';
    }

    /** 添加场景 */
    private addScene(chap: ChapterNode): void {
        const newSceneNum = chap.scenes.length > 0 ? Math.max(...chap.scenes.map(s => s.sceneNum)) + 1 : 1;
        const newScene: SceneNode = {
            sceneNum: newSceneNum,
            sceneName: '新场景',
            objective: '',
            emotionArc: '',
            conflict: '',
            sensoryHook: '',
            bodyReaction: '',
            subtext: '',
            isKeyScene: false,
            keySceneReason: '',
            dialogueFunction: '',
            cliffhanger: '',
        };
        chap.scenes.push(newScene);
        showSuccessNotice(`已添加场景${newSceneNum}（点击"保存所有修改"写入文件）`, { timeout: 2000 });
        this.render();
    }

    /** 删除场景 */
    private deleteScene(chap: ChapterNode, sceneIndex: number): void {
        const scene = chap.scenes[sceneIndex];
        chap.scenes.splice(sceneIndex, 1);
        this.reindexScenes(chap);
        showSuccessNotice(`已删除场景${scene.sceneNum}（点击"保存所有修改"写入文件）`, { timeout: 2000 });
        this.render();
    }

    private reindexScenes(chap: ChapterNode): void {
        chap.scenes.forEach((scene, idx) => {
            scene.sceneNum = idx + 1;
        });
    }

    /** 场景拖拽状态 */
    private sceneDragState: {
        isDragging: boolean;
        draggedVolIndex: number;
        draggedChapIndex: number;
        draggedSceneIndex: number;
    } = {
        isDragging: false,
        draggedVolIndex: -1,
        draggedChapIndex: -1,
        draggedSceneIndex: -1,
    };

    /** 场景拖拽开始 */
    private handleSceneDragStart(e: DragEvent, volIndex: number, chapIndex: number, sceneIndex: number): void {
        if (!e.dataTransfer) return;
        this.sceneDragState = {
            isDragging: true,
            draggedVolIndex: volIndex,
            draggedChapIndex: chapIndex,
            draggedSceneIndex: sceneIndex,
        };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `scene:${volIndex},${chapIndex},${sceneIndex}`);
    }

    /** 场景拖拽结束 */
    private handleSceneDragEnd(e: DragEvent): void {
        this.sceneDragState = {
            isDragging: false,
            draggedVolIndex: -1,
            draggedChapIndex: -1,
            draggedSceneIndex: -1,
        };
        document.querySelectorAll('.nw-scene-drag-over-top, .nw-scene-drag-over-bottom').forEach(el => {
            el.removeClass('nw-scene-drag-over-top');
            el.removeClass('nw-scene-drag-over-bottom');
        });
        this.render();
    }

    /** 场景拖拽经过 */
    private handleSceneDragOver(e: DragEvent, rowEl: HTMLElement): void {
        e.preventDefault();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = 'move';

        const rect = rowEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isTop = e.clientY < midY;

        rowEl.toggleClass('nw-scene-drag-over-top', isTop);
        rowEl.toggleClass('nw-scene-drag-over-bottom', !isTop);
    }

    /** 场景拖拽离开 */
    private handleSceneDragLeave(e: DragEvent, rowEl: HTMLElement): void {
        rowEl.removeClass('nw-scene-drag-over-top');
        rowEl.removeClass('nw-scene-drag-over-bottom');
    }

    /** 场景放下 */
    private handleSceneDrop(e: DragEvent, targetVolIndex: number, targetChapIndex: number, targetSceneIndex: number): void {
        e.preventDefault();
        e.stopPropagation();

        const { draggedVolIndex, draggedChapIndex, draggedSceneIndex } = this.sceneDragState;
        if (draggedVolIndex < 0 || draggedChapIndex < 0 || draggedSceneIndex < 0) return;

        if (draggedChapIndex !== targetChapIndex || draggedVolIndex !== targetVolIndex) {
            showErrorNotice('场景只能在同一章节内移动', { timeout: 2000 });
            return;
        }

        if (draggedSceneIndex === targetSceneIndex) return;

        const rowEl = (e.currentTarget as HTMLElement);
        const rect = rowEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        let newIndex = targetSceneIndex;
        if (!insertBefore) {
            newIndex = targetSceneIndex + 1;
        }

        const chap = this.volumes[draggedVolIndex].chapters[draggedChapIndex];
        const scene = chap.scenes[draggedSceneIndex];

        chap.scenes.splice(draggedSceneIndex, 1);
        chap.scenes.splice(newIndex, 0, scene);

        this.reindexScenes(chap);
        showSuccessNotice(`场景已重新排序（点击"保存所有修改"写入文件）`, { timeout: 2000 });
        this.render();
    }

    /** 拖拽开始 */
    private handleDragStart(e: DragEvent, volIndex: number, chapIndex: number, chap: ChapterNode): void {
        if (!e.dataTransfer) return;
        this.dragState = {
            isDragging: true,
            draggedChap: chap,
            draggedVolIndex: volIndex,
            draggedChapIndex: chapIndex,
        };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `${volIndex},${chapIndex}`);
    }

    /** 拖拽结束 */
    private handleDragEnd(e: DragEvent): void {
        this.dragState = {
            isDragging: false,
            draggedChap: null,
            draggedVolIndex: -1,
            draggedChapIndex: -1,
        };
        // 清除所有拖拽指示器样式
        document.querySelectorAll('.nw-drag-over-top, .nw-drag-over-bottom').forEach(el => {
            el.removeClass('nw-drag-over-top');
            el.removeClass('nw-drag-over-bottom');
        });
        this.render();
    }

    /** 拖拽经过 */
    private handleDragOver(e: DragEvent, rowEl: HTMLElement): void {
        e.preventDefault();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = 'move';

        const rect = rowEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isTop = e.clientY < midY;

        rowEl.toggleClass('nw-drag-over-top', isTop);
        rowEl.toggleClass('nw-drag-over-bottom', !isTop);
    }

    /** 拖拽离开 */
    private handleDragLeave(e: DragEvent, rowEl: HTMLElement): void {
        rowEl.removeClass('nw-drag-over-top');
        rowEl.removeClass('nw-drag-over-bottom');
    }

    /** 放下 */
    private handleDrop(e: DragEvent, targetVolIndex: number, targetChapIndex: number): void {
        e.preventDefault();
        e.stopPropagation();

        const { draggedVolIndex, draggedChapIndex, draggedChap } = this.dragState;
        if (!draggedChap || draggedVolIndex < 0 || draggedChapIndex < 0) return;

        if (draggedChapIndex === targetChapIndex && draggedVolIndex === targetVolIndex) return;

        const rowEl = (e.currentTarget as HTMLElement);
        const rect = rowEl.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        let newIndex = targetChapIndex;
        if (!insertBefore) {
            newIndex = targetChapIndex + 1;
        }

        if (draggedVolIndex === targetVolIndex) {
            const vol = this.volumes[draggedVolIndex];
            if (!vol) return;

            if (draggedChapIndex < newIndex) {
                newIndex--;
            }

            vol.chapters.splice(draggedChapIndex, 1);
            vol.chapters.splice(newIndex, 0, draggedChap);
        } else {
            const sourceVol = this.volumes[draggedVolIndex];
            const targetVol = this.volumes[targetVolIndex];
            if (!sourceVol || !targetVol) return;

            const originalSourceIdx = draggedChap.sourceIdx;
            const originalRowLine = draggedChap.rowLine;

            sourceVol.chapters.splice(draggedChapIndex, 1);

            draggedChap.volIndex = targetVolIndex;
            if (targetVol.chapters.length > 0) {
                draggedChap.sourceIdx = targetVol.chapters[0].sourceIdx;
            } else {
                let targetSrcIdx = draggedVolIndex;
                if (targetVolIndex < this.sources.length) {
                    targetSrcIdx = targetVolIndex;
                }
                draggedChap.sourceIdx = targetSrcIdx;
            }

            if (!this.deletedRows.has(originalSourceIdx)) {
                this.deletedRows.set(originalSourceIdx, new Set());
            }
            this.deletedRows.get(originalSourceIdx)!.add(originalRowLine);

            draggedChap.rowLine = -1;

            targetVol.chapters.splice(newIndex, 0, draggedChap);
        }

        this.updateAllChapterNumbers();

        const volName = this.volumes[targetVolIndex].volName || '(未命名)';
        showSuccessNotice(`已移动章节到第${this.volumes[targetVolIndex].volNum}卷"${volName}"第${newIndex + 1}位，章号已自动更新（点击"保存所有修改"写入文件）`, { timeout: 3000 });
        this.render();
    }

    /** 全局重新编号所有章节 */
    private updateAllChapterNumbers(): void {
        let currentChapNum = 1;

        for (const vol of this.volumes) {
            for (let ci = 0; ci < vol.chapters.length; ci++) {
                vol.chapters[ci].chapNum = currentChapNum++;
            }
        }
    }

    /** 保存所有修改到分卷大纲文件 */
    private async saveAll(): Promise<void> {
        try {
            const editsBySource = new Map<number, { lineIdx: number; newLine: string }[]>();
            const insertsBySource = new Map<number, { lineIdx: number; newLine: string }[]>();
            let totalEdits = 0;
            let sceneSaves = 0;

            for (const vol of this.volumes) {
                for (const chap of vol.chapters) {
                    const src = this.sources[chap.sourceIdx];
                    if (!src) continue;

                    if (chap.rowLine >= 0) {
                        const oldLine = src.lines[chap.rowLine];
                        // 原正则要求行尾必须是 `|`，手改成无尾管道的表格行会静默不写盘
                        const isChapterRow = /^\s*\|\s*\d+\s*\|/.test(oldLine);
                        const newLine = isChapterRow ? `| ${chap.chapNum} | ${chap.conflict} |` : oldLine;
                        if (newLine !== oldLine) {
                            if (!editsBySource.has(chap.sourceIdx)) editsBySource.set(chap.sourceIdx, []);
                            editsBySource.get(chap.sourceIdx)!.push({ lineIdx: chap.rowLine, newLine });
                            totalEdits++;
                        }
                    } else {
                        const insertLineIdx = this.findInsertLineInSource(src, vol);
                        const newLine = `| ${chap.chapNum} | ${chap.conflict} |`;
                        if (!insertsBySource.has(chap.sourceIdx)) insertsBySource.set(chap.sourceIdx, []);
                        insertsBySource.get(chap.sourceIdx)!.push({ lineIdx: insertLineIdx, newLine });
                        totalEdits++;
                    }

                    if (chap.scenes.length > 0 && chap.sceneSourcePath) {
                        await this.saveScenesForChapter(chap);
                        sceneSaves++;
                    }
                }
            }

            // 单遍重建：编辑/删除/插入都按「加载时的原始行号」描述，
            // 先删后插会让行号整体上移（删 1 行再加 1 行就落错章节）；
            // 按原始索引遍历、边遍历边产出，天然免疫位移。
            for (let srcIdx = 0; srcIdx < this.sources.length; srcIdx++) {
                const src = this.sources[srcIdx];
                const edits = editsBySource.get(srcIdx) ?? [];
                const inserts = insertsBySource.get(srcIdx) ?? [];
                const deletedSet = this.deletedRows.get(srcIdx) ?? new Set<number>();
                const editMap = new Map(edits.map(e => [e.lineIdx, e.newLine]));
                const insertsAfter = new Map<number, string[]>();
                const leadingInserts: string[] = [];
                for (const ins of inserts) {
                    if (ins.lineIdx < 0) {
                        leadingInserts.push(ins.newLine);
                        continue;
                    }
                    const list = insertsAfter.get(ins.lineIdx) ?? [];
                    list.push(ins.newLine);
                    insertsAfter.set(ins.lineIdx, list);
                }

                const rebuilt: string[] = [...leadingInserts];
                for (let i = 0; i < src.lines.length; i++) {
                    if (deletedSet.has(i)) continue;
                    rebuilt.push(editMap.get(i) ?? src.lines[i]);
                    for (const row of insertsAfter.get(i) ?? []) rebuilt.push(row);
                }
                src.lines = rebuilt;
            }

            for (let i = 0; i < this.sources.length; i++) {
                const src = this.sources[i];
                await writeVaultText(this.app, src.path, src.lines.join('\n'));
            }

            this.deletedRows.clear();

            // 写盘后必须重载：新增章节的 rowLine 还是 -1，不重载再点一次保存会重复插入同一行
            await this.loadOutline();
            this.render();

            const message = sceneSaves > 0
                ? `已保存 ${totalEdits} 处章节修改，${sceneSaves} 个场景文件`
                : `已保存 ${totalEdits} 处修改到分卷大纲`;
            showSuccessNotice(message, { timeout: 3000 });
        } catch (e) {
            log.error('[OutlineTree] 保存失败:', e);
            showErrorNotice((e as Error).message, { title: '保存失败', timeout: 5000 });
        }
    }

    private async saveScenesForChapter(chap: ChapterNode): Promise<void> {
        if (!chap.sceneSourcePath) return;

        const content = this.buildSceneContent(chap.scenes);
        await writeVaultText(this.app, chap.sceneSourcePath, content);
    }

    private buildSceneContent(scenes: SceneNode[]): string {
        let content = '';
        for (let i = 0; i < scenes.length; i++) {
            const scene = scenes[i];
            const isLast = i === scenes.length - 1;

            content += `## 场景${scene.sceneNum}：${scene.sceneName}\n`;
            content += `objective: ${scene.objective}\n`;
            content += `emotion_arc: ${scene.emotionArc}\n`;
            content += `conflict: ${scene.conflict}\n`;
            content += `sensory_hook: ${scene.sensoryHook}\n`;
            content += `body_reaction: ${scene.bodyReaction}\n`;
            content += `subtext: ${scene.subtext}\n`;
            content += `key_scene: ${scene.isKeyScene ? `⭐ 名场面 — ${scene.keySceneReason}` : '否'}\n`;
            content += `dialogue_function: ${scene.dialogueFunction}\n`;
            if (isLast) {
                content += `cliffhanger: ${scene.cliffhanger}\n`;
            }
            if (!isLast) {
                content += '\n';
            }
        }
        return content;
    }

    /** 在目标源文件中查找插入章节行的位置 */
    private findInsertLineInSource(src: OutlineSource, vol: VolumeNode): number {
        let inTable = false;
        let afterHeader = false;

        for (let i = 0; i < src.lines.length; i++) {
            const line = src.lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('| 章号') || trimmed.startsWith('|章号')) {
                inTable = true;
                afterHeader = false;
                continue;
            }

            if (inTable && /^\|[-| ]+\|$/.test(trimmed)) {
                afterHeader = true;
                continue;
            }

            if (inTable && afterHeader && !trimmed.startsWith('|')) {
                return i;
            }

            if (inTable && afterHeader && trimmed.startsWith('|')) {
                continue;
            }
        }

        return src.lines.length;
    }

}
