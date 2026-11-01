/**
 * P0-5: 分卷大纲树状预览控制器 — 可折叠、可编辑冲突/概览、带搜索框
 * v6.x: 新增拖拽排序、多选、右键菜单、键盘快捷键
 *
 * 从 FullWriterView 外迁而来：原 renderOutlineTreeView / _loadOutlineTreeData /
 * _saveOutlineChapterData 三个方法，以及 _otvData / _otvCollapsed 两个状态字段。
 * 控制器自管内部缓存，不回调 view 的 private 成员（避免 TS2341）。
 */
import { App, TFile, TFolder, Modal, Notice } from 'obsidian';
import { showSuccess, showError, showWarning } from '../../utils/helpers';
import { OutlineTreeVolume, OutlineTreeChapter, SceneOutlineTreeVolume, SceneOutlineTreeChapter, SceneNode, SceneType, SceneStatus, SCENE_TYPE_LABELS, SCENE_STATUS_LABELS } from '../../shared/types';
import { pjVolumeOutlineDir, pjVolumeOutlineFile, pjBodyDir, pjStepDir, pjBodyFile, pjStepDir as pjStepDirFn } from '../../shared/paths';
import { ObsidianFileSystem } from '../../shared/file-system-port';
import { createLogger } from '../../shared/logger';
import { isImeComposing } from '../../shared/keyboard';


const log = createLogger('OutlineTreeController');
interface DragState {
    type: 'volume' | 'chapter' | 'scene';
    sourceVolIndex: number;
    sourceChapIndex?: number;
    sourceSceneIndex?: number;
    multiSelected: Array<{ volIndex: number; chapIndex?: number; sceneIndex?: number }>;
}

interface SelectedItem {
    type: 'volume' | 'chapter' | 'scene';
    volIndex: number;
    chapIndex?: number;
    sceneIndex?: number;
}

export class OutlineTreeController {
    private app: App;
    private getProject: () => string | undefined;

    private _otvData?: { volumes: OutlineTreeVolume[] };
    private _otvCollapsed?: Set<string>;
    private _selectedItems: Set<string> = new Set();
    private _lastClickedItem?: SelectedItem;
    private _dragState: DragState | null = null;
    private _contextMenuEl: HTMLElement | null = null;
    private _treeRoot: HTMLElement | null = null;
    private _area: HTMLElement | null = null;
    private _fs: ObsidianFileSystem;
    /** S1: 文档级监听句柄 —— render 可被多次调用，须保留引用以便解绑，避免重复绑定与泄漏 */
    private _onDocumentClick: (() => void) | null = null;
    private _onDocumentKeyDown: ((e: KeyboardEvent) => void) | null = null;

    constructor(app: App, getProject: () => string | undefined) {
        this.app = app;
        this.getProject = getProject;
        this._fs = new ObsidianFileSystem(app);
    }

    /**
     * 解绑本控制器注册的文档级监听（S1）。
     * 幂等：解绑后句柄置空，重复调用无副作用。
     * 若日后恢复树状预览（`full-writer-view` 中被注释的 render(previewSection) 调用），
     * 须在视图 onClose 时调用本方法。
     */
    dispose(): void {
        if (this._onDocumentClick) {
            document.removeEventListener('click', this._onDocumentClick);
            this._onDocumentClick = null;
        }
        if (this._onDocumentKeyDown) {
            document.removeEventListener('keydown', this._onDocumentKeyDown);
            this._onDocumentKeyDown = null;
        }
        this._closeContextMenu();
    }

    async render(area: HTMLElement): Promise<void> {
        // S1: render 可能被多次调用，先解绑上一轮注册的文档级监听，避免重复绑定与泄漏
        this.dispose();

        const project = this.getProject();
        if (!project) return;

        this._area = area;
        area.empty();
        const container = area.createDiv({ cls: 'novel-writer-otv-container' });

        const searchRow = container.createDiv({ attr: { style: 'margin-bottom:10px;display:flex;gap:8px;align-items:center;' } });
        searchRow.createSpan({ text: '🔍', attr: { style: 'font-size:14px;' } });
        const searchInput = searchRow.createEl('input', {
            attr: { type: 'text', placeholder: '搜索章号或关键词...', style: 'flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);' }
        }) as HTMLInputElement;

        const hintRow = container.createDiv({ attr: { style: 'margin-bottom:8px;font-size:11px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap;' } });
        hintRow.createSpan({ text: '💡 拖拽排序 · Ctrl/Cmd+点击多选 · Shift+范围选 · 右键菜单 · Alt+↑↓移动' });

        const treeRoot = container.createDiv({ cls: 'novel-writer-otv-tree' });
        this._treeRoot = treeRoot;

        if (!this._otvData) this._otvData = { volumes: [] };
        if (!this._otvCollapsed) this._otvCollapsed = new Set<string>();

        if (this._otvData.volumes.length === 0) {
            await this._loadOutlineTreeData();
        }

        treeRoot.addEventListener('click', (e) => {
            if (e.target === treeRoot || (e.target as HTMLElement).classList.contains('novel-writer-otv-tree')) {
                this._clearSelection();
                this._renderTree();
            }
        });

        treeRoot.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._closeContextMenu();
        });

        this._onDocumentClick = () => this._closeContextMenu();
        document.addEventListener('click', this._onDocumentClick);

        const onKeyDown = (e: KeyboardEvent) => {
            if (!this._area || !this._area.isConnected) return;
            // 组字中不接管按键
            if (isImeComposing(e)) return;
            const activeEl = document.activeElement as HTMLElement | null;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
            // CodeMirror 正文是 contenteditable：在工作台处于后台标签页时，
            // 不排除它会让 Backspace / Alt+↑↓ 在别的笔记里删改大纲章节。
            if (activeEl && activeEl.isContentEditable) return;
            // 焦点必须落在本面板内（或面板拥有焦点之外的空白页），否则不接管
            const focusInArea = !!activeEl && this._area.contains(activeEl);
            const focusOnBody = !activeEl || activeEl === document.body;
            if (!focusInArea && !focusOnBody) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this._selectedItems.size > 0) {
                    e.preventDefault();
                    this._handleDeleteSelected();
                }
            }
            if (e.altKey && e.key === 'ArrowUp') {
                e.preventDefault();
                if (e.shiftKey) {
                    this._moveSelectedVolume(-1);
                } else {
                    this._moveSelectedChapter(-1);
                }
            }
            if (e.altKey && e.key === 'ArrowDown') {
                e.preventDefault();
                if (e.shiftKey) {
                    this._moveSelectedVolume(1);
                } else {
                    this._moveSelectedChapter(1);
                }
            }
        };
        this._onDocumentKeyDown = onKeyDown;
        document.addEventListener('keydown', onKeyDown);

        const renderTree = () => this._renderTree();

        searchInput.addEventListener('input', renderTree);

        this._renderTree = () => {
            treeRoot.empty();
            const keyword = searchInput.value.trim().toLowerCase();

            for (let volIndex = 0; volIndex < this._otvData!.volumes.length; volIndex++) {
                const vol = this._otvData!.volumes[volIndex];
                const volId = `vol-${vol.num}`;
                const volCollapsed = this._otvCollapsed!.has(volId);
                const volMatch = !keyword || vol.title.toLowerCase().includes(keyword) || String(vol.num).includes(keyword);
                const volSelected = this._selectedItems.has(`v-${volIndex}`);

                const volRow = treeRoot.createDiv({
                    cls: `novel-writer-otv-vol-row${volSelected ? ' novel-writer-otv-selected' : ''}`,
                    attr: {
                        style: 'display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:pointer;border-radius:4px;margin:2px 0;',
                        'data-vol-index': String(volIndex),
                        'data-type': 'volume',
                        draggable: 'true'
                    }
                });
                if (volSelected) {
                    volRow.style.background = 'var(--background-modifier-hover)';
                }
                if (!volMatch) volRow.style.opacity = '0.4';

                const toggleIcon = volRow.createSpan({ text: volCollapsed ? '▶' : '▼', attr: { style: 'font-size:10px;width:16px;text-align:center;flex-shrink:0;' } });
                const dragHandle = volRow.createSpan({ text: '⋮⋮', attr: { style: 'font-size:10px;color:var(--text-faint);cursor:grab;flex-shrink:0;user-select:none;' } });
                const volTitleEl = volRow.createSpan({ text: `📘 ${vol.title}`, attr: { style: 'font-weight:bold;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' } });
                const chapCountEl = volRow.createSpan({ text: `${vol.chapters.length}章`, attr: { style: 'font-size:11px;color:var(--text-muted);flex-shrink:0;' } });

                toggleIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this._otvCollapsed!.has(volId)) this._otvCollapsed!.delete(volId);
                    else this._otvCollapsed!.add(volId);
                    this._renderTree();
                });

                volRow.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._handleItemClick('volume', volIndex, undefined, e);
                });

                volRow.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    this._handleRenameVolume(volIndex);
                });

                volRow.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._showVolumeContextMenu(e.clientX, e.clientY, volIndex);
                });

                this._setupDragEvents(volRow, 'volume', volIndex);

                const dropIndicator = treeRoot.createDiv({
                    cls: 'novel-writer-otv-drop-indicator',
                    attr: {
                        style: 'display:none;height:2px;background:var(--interactive-accent);margin:2px 0;border-radius:1px;',
                        'data-drop-vol': String(volIndex),
                        'data-drop-pos': 'before'
                    }
                });

                if (!volCollapsed) {
                    const chapContainer = treeRoot.createDiv({
                        attr: { style: 'padding-left:24px;', 'data-vol-container': String(volIndex) }
                    });
                    for (let chapIndex = 0; chapIndex < vol.chapters.length; chapIndex++) {
                        const ch = vol.chapters[chapIndex];
                        const chMatch = !keyword || ch.summary.toLowerCase().includes(keyword) || String(ch.num).includes(keyword);
                        if (keyword && !volMatch && !chMatch) continue;

                        const chapId = `v-${volIndex}-c-${chapIndex}`;
                        const chSelected = this._selectedItems.has(chapId);

                        const chRow = chapContainer.createDiv({
                            cls: `novel-writer-otv-ch-row${chSelected ? ' novel-writer-otv-selected' : ''}`,
                            attr: {
                                style: `padding:4px 8px;margin:2px 0;border-radius:4px;${chSelected ? 'background:var(--background-modifier-hover);' : ''}`,
                                'data-vol-index': String(volIndex),
                                'data-chap-index': String(chapIndex),
                                'data-type': 'chapter',
                                draggable: 'true'
                            }
                        });

                        const chHeader = chRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;' } });

                        const chDragHandle = chHeader.createSpan({ text: '⋮⋮', attr: { style: 'font-size:10px;color:var(--text-faint);cursor:grab;flex-shrink:0;user-select:none;width:16px;text-align:center;' } });
                        chHeader.createSpan({ text: `第${ch.num}章`, attr: { style: 'font-weight:bold;color:var(--text-accent);min-width:56px;flex-shrink:0;' } });

                        const conflictInput = chHeader.createEl('input', {
                            attr: { type: 'text', value: ch.conflict || '', placeholder: '核心冲突', style: 'flex:1;padding:2px 6px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);min-width:0;' }
                        }) as HTMLInputElement;

                        conflictInput.addEventListener('click', (e) => e.stopPropagation());
                        conflictInput.addEventListener('mousedown', (e) => e.stopPropagation());
                        conflictInput.addEventListener('focus', () => {
                            this._clearSelection();
                            this._renderTree();
                        });

                        const summaryRow = chRow.createDiv({ attr: { style: 'margin-top:2px;margin-left:64px;display:flex;gap:4px;align-items:center;' } });
                        const summaryInput = summaryRow.createEl('input', {
                            attr: { type: 'text', value: ch.summary || '', placeholder: '一句话概览...', style: 'flex:1;padding:2px 6px;font-size:12px;border-radius:3px;border:1px solid var(--background-modifier-border);min-width:0;' }
                        }) as HTMLInputElement;

                        summaryInput.addEventListener('click', (e) => e.stopPropagation());
                        summaryInput.addEventListener('mousedown', (e) => e.stopPropagation());
                        summaryInput.addEventListener('focus', () => {
                            this._clearSelection();
                            this._renderTree();
                        });

                        const saveBtn = summaryRow.createEl('button', {
                            text: '💾', attr: { style: 'padding:1px 8px;font-size:11px;border-radius:3px;border:1px solid var(--background-modifier-border);cursor:pointer;background:var(--interactive-accent);color:var(--text-on-accent);flex-shrink:0;' }
                        });
                        saveBtn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            const newConflict = conflictInput.value.trim();
                            const newSummary = summaryInput.value.trim();
                            ch.conflict = newConflict;
                            ch.summary = newSummary;
                            await this._saveOutlineChapterData(ch.num, newConflict, newSummary);
                            showSuccess(`第${ch.num}章 已保存`);
                        });

                        chRow.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._handleItemClick('chapter', volIndex, chapIndex, e);
                        });

                        chRow.addEventListener('dblclick', (e) => {
                            e.stopPropagation();
                            this._openChapterFile(volIndex, chapIndex);
                        });

                        chRow.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            this._showChapterContextMenu(e.clientX, e.clientY, volIndex, chapIndex);
                        });

                        this._setupDragEvents(chRow, 'chapter', volIndex, chapIndex);

                        const chapDropIndicator = chapContainer.createDiv({
                            cls: 'novel-writer-otv-drop-indicator',
                            attr: {
                                style: 'display:none;height:2px;background:var(--interactive-accent);margin:1px 0;border-radius:1px;',
                                'data-drop-vol': String(volIndex),
                                'data-drop-chap': String(chapIndex),
                                'data-drop-pos': 'before'
                            }
                        });

                        const scenes = (ch as SceneOutlineTreeChapter).scenes || [];
                        if (scenes.length > 0) {
                            const sceneContainer = chapContainer.createDiv({
                                attr: { style: 'padding-left:20px;', 'data-chap-container': `${volIndex}-${chapIndex}` }
                            });
                            for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
                                const scene = scenes[sceneIndex];
                                const sceneMatch = !keyword || scene.title.toLowerCase().includes(keyword) || scene.summary.toLowerCase().includes(keyword);
                                if (keyword && !volMatch && !chMatch && !sceneMatch) continue;

                                const sceneId = `v-${volIndex}-c-${chapIndex}-s-${sceneIndex}`;
                                const sceneSelected = this._selectedItems.has(sceneId);

                                const sceneRow = sceneContainer.createDiv({
                                    cls: `novel-writer-otv-scene-row${sceneSelected ? ' novel-writer-otv-selected' : ''}`,
                                    attr: {
                                        style: `padding:3px 8px;margin:1px 0;border-radius:3px;${sceneSelected ? 'background:var(--background-modifier-hover);' : ''}`,
                                        'data-vol-index': String(volIndex),
                                        'data-chap-index': String(chapIndex),
                                        'data-scene-index': String(sceneIndex),
                                        'data-type': 'scene',
                                        draggable: 'true'
                                    }
                                });

                                const sceneHeader = sceneRow.createDiv({ attr: { style: 'display:flex;align-items:center;gap:6px;' } });

                                const sceneDragHandle = sceneHeader.createSpan({ text: '⋮⋮', attr: { style: 'font-size:9px;color:var(--text-faint);cursor:grab;flex-shrink:0;user-select:none;width:12px;text-align:center;' } });
                                sceneHeader.createSpan({ text: `🎬`, attr: { style: 'font-size:11px;flex-shrink:0;' } });
                                sceneHeader.createSpan({ text: `${scene.order}. ${scene.title}`, attr: { style: 'font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' } });

                                const statusColors: Record<SceneStatus, string> = {
                                    not_started: '#6b7280',
                                    writing: '#3b82f6',
                                    in_progress: '#3b82f6',
                                    completed: '#10b981',
                                    needs_revision: '#f59e0b'
                                };
                                sceneHeader.createSpan({
                                    text: SCENE_STATUS_LABELS[scene.status],
                                    attr: {
                                        style: `font-size:10px;padding:1px 6px;border-radius:3px;color:white;background:${statusColors[scene.status]};flex-shrink:0;`
                                    }
                                });

                                sceneRow.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    this._handleItemClick('scene', volIndex, chapIndex, e, sceneIndex);
                                });

                                sceneRow.addEventListener('dblclick', (e) => {
                                    e.stopPropagation();
                                    this._openSceneEditor(volIndex, chapIndex, sceneIndex);
                                });

                                sceneRow.addEventListener('contextmenu', (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    this._showSceneContextMenu(e.clientX, e.clientY, volIndex, chapIndex, sceneIndex);
                                });

                                this._setupDragEvents(sceneRow, 'scene', volIndex, chapIndex, sceneIndex);

                                const sceneDropIndicator = sceneContainer.createDiv({
                                    cls: 'novel-writer-otv-drop-indicator',
                                    attr: {
                                        style: 'display:none;height:2px;background:var(--interactive-accent);margin:1px 0;border-radius:1px;',
                                        'data-drop-vol': String(volIndex),
                                        'data-drop-chap': String(chapIndex),
                                        'data-drop-scene': String(sceneIndex),
                                        'data-drop-pos': 'before'
                                    }
                                });
                            }

                            const sceneEndDrop = sceneContainer.createDiv({
                                cls: 'novel-writer-otv-drop-indicator novel-writer-otv-drop-scene-end',
                                attr: {
                                    style: 'display:none;height:2px;background:var(--interactive-accent);margin:1px 0;border-radius:1px;',
                                    'data-drop-vol': String(volIndex),
                                    'data-drop-chap': String(chapIndex),
                                    'data-drop-pos': 'after-last-scene'
                                }
                            });
                        }
                    }

                    const volEndDrop = chapContainer.createDiv({
                        cls: 'novel-writer-otv-drop-indicator novel-writer-otv-drop-vol-end',
                        attr: {
                            style: 'display:none;height:2px;background:var(--interactive-accent);margin:1px 0;border-radius:1px;',
                            'data-drop-vol': String(volIndex),
                            'data-drop-pos': 'after-last'
                        }
                    });
                }
            }

            if (this._otvData!.volumes.length === 0) {
                treeRoot.createDiv({
                    text: '暂无分卷大纲数据',
                    attr: { style: 'padding:20px;text-align:center;color:var(--text-muted);font-size:13px;' }
                });
            }
        };

        this._renderTree();
    }

    private _renderTree: () => void = () => {};

    private _itemKey(type: 'volume' | 'chapter' | 'scene', volIndex: number, chapIndex?: number, sceneIndex?: number): string {
        if (type === 'volume') return `v-${volIndex}`;
        if (type === 'chapter') return `v-${volIndex}-c-${chapIndex}`;
        return `v-${volIndex}-c-${chapIndex}-s-${sceneIndex}`;
    }

    private _clearSelection(): void {
        this._selectedItems.clear();
        this._lastClickedItem = undefined;
    }

    private _handleItemClick(type: 'volume' | 'chapter' | 'scene', volIndex: number, chapIndex: number | undefined, e: MouseEvent, sceneIndex?: number): void {
        const key = this._itemKey(type, volIndex, chapIndex, sceneIndex);
        const ctrlOrCmd = e.ctrlKey || e.metaKey;
        const shiftKey = e.shiftKey;

        if (shiftKey && this._lastClickedItem) {
            this._selectRange(this._lastClickedItem, { type, volIndex, chapIndex, sceneIndex });
        } else if (ctrlOrCmd) {
            if (this._selectedItems.has(key)) {
                this._selectedItems.delete(key);
            } else {
                this._selectedItems.add(key);
            }
            this._lastClickedItem = { type, volIndex, chapIndex, sceneIndex };
        } else {
            this._clearSelection();
            this._selectedItems.add(key);
            this._lastClickedItem = { type, volIndex, chapIndex, sceneIndex };
        }

        this._renderTree();
    }

    private _selectRange(from: SelectedItem, to: SelectedItem): void {
        this._selectedItems.clear();

        const allItems: SelectedItem[] = [];
        for (let vi = 0; vi < this._otvData!.volumes.length; vi++) {
            const vol = this._otvData!.volumes[vi];
            allItems.push({ type: 'volume', volIndex: vi });
            for (let ci = 0; ci < vol.chapters.length; ci++) {
                allItems.push({ type: 'chapter', volIndex: vi, chapIndex: ci });
                const scenes = (vol.chapters[ci] as SceneOutlineTreeChapter).scenes || [];
                for (let si = 0; si < scenes.length; si++) {
                    allItems.push({ type: 'scene', volIndex: vi, chapIndex: ci, sceneIndex: si });
                }
            }
        }

        const fromIdx = allItems.findIndex(item =>
            item.type === from.type && item.volIndex === from.volIndex && item.chapIndex === from.chapIndex && item.sceneIndex === from.sceneIndex
        );
        const toIdx = allItems.findIndex(item =>
            item.type === to.type && item.volIndex === to.volIndex && item.chapIndex === to.chapIndex && item.sceneIndex === to.sceneIndex
        );

        if (fromIdx === -1 || toIdx === -1) return;

        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);

        for (let i = start; i <= end; i++) {
            const item = allItems[i];
            this._selectedItems.add(this._itemKey(item.type, item.volIndex, item.chapIndex, item.sceneIndex));
        }
    }

    private _getSelectedItems(): SelectedItem[] {
        const result: SelectedItem[] = [];
        for (const key of this._selectedItems) {
            const parts = key.split('-');
            if (parts[0] === 'v' && parts.length >= 2) {
                const volIndex = parseInt(parts[1]);
                if (parts.length === 2) {
                    result.push({ type: 'volume', volIndex });
                } else if (parts[2] === 'c' && parts.length >= 4) {
                    const chapIndex = parseInt(parts[3]);
                    if (parts.length === 4) {
                        result.push({ type: 'chapter', volIndex, chapIndex });
                    } else if (parts[4] === 's' && parts.length >= 6) {
                        const sceneIndex = parseInt(parts[5]);
                        result.push({ type: 'scene', volIndex, chapIndex, sceneIndex });
                    }
                }
            }
        }
        return result.sort((a, b) => {
            if (a.volIndex !== b.volIndex) return a.volIndex - b.volIndex;
            if (a.type === 'volume') return -1;
            if (b.type === 'volume') return 1;
            if (a.type === 'chapter') return -1;
            if (b.type === 'chapter') return 1;
            return (a.chapIndex || 0) - (b.chapIndex || 0);
        });
    }

    private _setupDragEvents(el: HTMLElement, type: 'volume' | 'chapter' | 'scene', volIndex: number, chapIndex?: number, sceneIndex?: number): void {
        el.addEventListener('dragstart', (e) => {
            if (!e.dataTransfer) return;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify({ type, volIndex, chapIndex, sceneIndex }));

            const selected = this._getSelectedItems();
            const isSelected = this._selectedItems.has(this._itemKey(type, volIndex, chapIndex, sceneIndex));

            let dragItems: Array<{ volIndex: number; chapIndex?: number; sceneIndex?: number }>;
            if (isSelected && selected.length > 1) {
                dragItems = selected.map(s => ({ volIndex: s.volIndex, chapIndex: s.chapIndex, sceneIndex: s.sceneIndex }));
                this._dragState = {
                    type: type,
                    sourceVolIndex: volIndex,
                    sourceChapIndex: chapIndex,
                    sourceSceneIndex: sceneIndex,
                    multiSelected: dragItems
                };
            } else {
                this._clearSelection();
                this._selectedItems.add(this._itemKey(type, volIndex, chapIndex, sceneIndex));
                this._dragState = {
                    type,
                    sourceVolIndex: volIndex,
                    sourceChapIndex: chapIndex,
                    sourceSceneIndex: sceneIndex,
                    multiSelected: [{ volIndex, chapIndex, sceneIndex }]
                };
            }

            el.classList.add('novel-writer-otv-dragging');
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('novel-writer-otv-dragging');
            this._dragState = null;
            this._hideAllDropIndicators();
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!this._dragState) return;
            e.dataTransfer!.dropEffect = 'move';
            this._showDropIndicator(e, type, volIndex, chapIndex, sceneIndex);
        });

        el.addEventListener('dragleave', () => {
            this._hideAllDropIndicators();
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this._dragState) return;
            this._handleDrop(e, type, volIndex, chapIndex, sceneIndex);
        });
    }

    private _showDropIndicator(e: DragEvent, targetType: 'volume' | 'chapter' | 'scene', volIndex: number, chapIndex?: number, sceneIndex?: number): void {
        if (!this._treeRoot || !this._dragState) return;
        this._hideAllDropIndicators();

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isBefore = e.clientY < midY;

        const indicators = this._treeRoot.querySelectorAll('.novel-writer-otv-drop-indicator');
        let targetIndicator: Element | null = null;

        if (targetType === 'volume') {
            if (isBefore) {
                targetIndicator = this._treeRoot.querySelector(`[data-drop-vol="${volIndex}"][data-drop-pos="before"]`);
            } else {
                const vol = this._otvData!.volumes[volIndex];
                if (vol && vol.chapters.length > 0 && !this._otvCollapsed!.has(`vol-${vol.num}`)) {
                    const chapContainer = this._treeRoot.querySelector(`[data-vol-container="${volIndex}"]`);
                    const endIndicator = chapContainer?.querySelector('.novel-writer-otv-drop-vol-end');
                    targetIndicator = endIndicator || null;
                } else {
                    const nextVol = this._otvData!.volumes[volIndex + 1];
                    if (nextVol) {
                        targetIndicator = this._treeRoot.querySelector(`[data-drop-vol="${volIndex + 1}"][data-drop-pos="before"]`);
                    } else {
                        const volRows = this._treeRoot.querySelectorAll('.novel-writer-otv-vol-row');
                        const lastVolRow = volRows[volRows.length - 1];
                        if (lastVolRow) {
                            const afterDiv = document.createElement('div');
                            afterDiv.className = 'novel-writer-otv-drop-indicator';
                            afterDiv.style.cssText = 'height:2px;background:var(--interactive-accent);margin:2px 0;border-radius:1px;display:block;';
                            lastVolRow.after(afterDiv);
                            return;
                        }
                    }
                }
            }
        } else if (targetType === 'chapter') {
            if (isBefore) {
                targetIndicator = this._treeRoot.querySelector(`[data-drop-vol="${volIndex}"][data-drop-chap="${chapIndex}"][data-drop-pos="before"]`);
            } else {
                const vol = this._otvData!.volumes[volIndex];
                if (vol && chapIndex !== undefined && chapIndex < vol.chapters.length - 1) {
                    targetIndicator = this._treeRoot.querySelector(`[data-drop-vol="${volIndex}"][data-drop-chap="${chapIndex + 1}"][data-drop-pos="before"]`);
                } else {
                    const chapContainer = this._treeRoot.querySelector(`[data-vol-container="${volIndex}"]`);
                    const endIndicator = chapContainer?.querySelector('.novel-writer-otv-drop-vol-end');
                    targetIndicator = endIndicator || null;
                }
            }
        } else {
            if (isBefore) {
                targetIndicator = this._treeRoot.querySelector(`[data-drop-vol="${volIndex}"][data-drop-chap="${chapIndex}"][data-drop-scene="${sceneIndex}"][data-drop-pos="before"]`);
            } else {
                const vol = this._otvData!.volumes[volIndex];
                const ch = vol?.chapters[chapIndex!] as SceneOutlineTreeChapter;
                if (ch && sceneIndex !== undefined && sceneIndex < (ch.scenes?.length || 0) - 1) {
                    targetIndicator = this._treeRoot.querySelector(`[data-drop-vol="${volIndex}"][data-drop-chap="${chapIndex}"][data-drop-scene="${sceneIndex + 1}"][data-drop-pos="before"]`);
                } else {
                    const sceneContainer = this._treeRoot.querySelector(`[data-chap-container="${volIndex}-${chapIndex}"]`);
                    const endIndicator = sceneContainer?.querySelector('.novel-writer-otv-drop-scene-end');
                    targetIndicator = endIndicator || null;
                }
            }
        }

        if (targetIndicator) {
            (targetIndicator as HTMLElement).style.display = 'block';
        }
    }

    private _hideAllDropIndicators(): void {
        if (!this._treeRoot) return;
        const indicators = this._treeRoot.querySelectorAll('.novel-writer-otv-drop-indicator');
        indicators.forEach(el => {
            (el as HTMLElement).style.display = 'none';
        });
    }

    private _handleDrop(e: DragEvent, targetType: 'volume' | 'chapter' | 'scene', targetVolIndex: number, targetChapIndex?: number, targetSceneIndex?: number): void {
        if (!this._dragState || !this._otvData) return;

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        const dragState = this._dragState;
        this._dragState = null;
        this._hideAllDropIndicators();

        const isAllVolumes = dragState.multiSelected.every(item => item.chapIndex === undefined);
        const isAllChapters = dragState.multiSelected.every(item => item.chapIndex !== undefined && item.sceneIndex === undefined);
        const isAllScenes = dragState.multiSelected.every(item => item.sceneIndex !== undefined);

        if (isAllVolumes) {
            this._handleVolumeDrop(dragState.multiSelected.map(i => i.volIndex), targetVolIndex, insertBefore);
        } else if (isAllChapters) {
            let targetVol = targetVolIndex;
            let targetChap: number | undefined;

            if (targetType === 'volume') {
                if (insertBefore) {
                    targetChap = 0;
                } else {
                    targetVol = targetVolIndex;
                    targetChap = this._otvData.volumes[targetVolIndex]?.chapters.length || 0;
                }
            } else {
                targetVol = targetVolIndex;
                targetChap = targetChapIndex !== undefined ? (insertBefore ? targetChapIndex : targetChapIndex + 1) : 0;
            }

            this._handleChapterDrop(dragState.multiSelected, targetVol, targetChap);
        } else if (isAllScenes) {
            let targetVol = targetVolIndex;
            let targetChap = targetChapIndex;
            let targetScene = targetSceneIndex;

            if (targetType === 'volume') {
                targetChap = 0;
                targetScene = 0;
            } else if (targetType === 'chapter') {
                targetScene = 0;
            }

            if (targetChap === undefined) targetChap = 0;
            if (targetScene === undefined) targetScene = 0;

            this._handleSceneDrop(dragState.multiSelected, targetVol, targetChap, targetScene);
        }

        this._clearSelection();
        this._renderTree();
    }

    private _handleSceneDrop(
        sources: Array<{ volIndex: number; chapIndex?: number; sceneIndex?: number }>,
        targetVolIndex: number,
        targetChapIndex: number,
        targetSceneIndex: number
    ): void {
        if (!this._otvData) return;

        const sorted = [...sources].sort((a, b) => {
            if (a.volIndex !== b.volIndex) return b.volIndex - a.volIndex;
            if ((a.chapIndex || 0) !== (b.chapIndex || 0)) return (b.chapIndex || 0) - (a.chapIndex || 0);
            return (b.sceneIndex || 0) - (a.sceneIndex || 0);
        });

        const movedScenes: SceneNode[] = [];
        for (const src of sorted) {
            if (src.chapIndex === undefined || src.sceneIndex === undefined) continue;
            const vol = this._otvData.volumes[src.volIndex];
            if (!vol) continue;
            const ch = vol.chapters[src.chapIndex] as SceneOutlineTreeChapter;
            if (!ch?.scenes) continue;
            const [scene] = ch.scenes.splice(src.sceneIndex, 1);
            if (scene) movedScenes.unshift(scene);
        }

        const targetVol = this._otvData.volumes[targetVolIndex];
        if (!targetVol) return;
        const targetCh = targetVol.chapters[targetChapIndex] as SceneOutlineTreeChapter;
        if (!targetCh) return;

        if (!targetCh.scenes) targetCh.scenes = [];

        let insertScene = targetSceneIndex;
        const sameChapSources = sources.filter(s => s.volIndex === targetVolIndex && s.chapIndex === targetChapIndex && s.sceneIndex !== undefined);
        if (sameChapSources.length > 0) {
            const maxBefore = Math.max(...sameChapSources.filter(s => (s.sceneIndex || 0) < targetSceneIndex).map(s => s.sceneIndex || 0), -1);
            if (maxBefore >= 0) {
                insertScene -= sameChapSources.filter(s => (s.sceneIndex || 0) < targetSceneIndex).length;
            }
        }

        targetCh.scenes.splice(insertScene, 0, ...movedScenes);
        targetCh.scenes.forEach((scene, i) => {
            scene.order = i + 1;
        });

        showSuccess('场景顺序已调整');
    }

    private _openSceneEditor(volIndex: number, chapIndex: number, sceneIndex: number): void {
        const project = this.getProject();
        if (!project) return;

        const vol = this._otvData?.volumes[volIndex];
        const ch = vol?.chapters[chapIndex];
        const scenes = (ch as SceneOutlineTreeChapter).scenes || [];
        const scene = scenes[sceneIndex];

        if (scene) {
            new Notice(`打开场景编辑: ${scene.title}`);
        }
    }

    private _showSceneContextMenu(x: number, y: number, volIndex: number, chapIndex: number, sceneIndex: number): void {
        this._closeContextMenu();

        const menu = document.createElement('div');
        menu.className = 'novel-writer-otv-context-menu';
        menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:6px;padding:4px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2);min-width:140px;`;

        const items = [
            { text: '编辑场景', icon: '✏️', action: () => this._openSceneEditor(volIndex, chapIndex, sceneIndex) },
            { text: '删除场景', icon: '🗑️', action: () => this._deleteScene(volIndex, chapIndex, sceneIndex) },
            { text: '上移', icon: '⬆️', action: () => this._moveScene(volIndex, chapIndex, sceneIndex, -1) },
            { text: '下移', icon: '⬇️', action: () => this._moveScene(volIndex, chapIndex, sceneIndex, 1) },
        ];

        items.forEach(item => {
            const btn = menu.createEl('button', {
                text: `${item.icon} ${item.text}`,
                attr: {
                    style: 'width:100%;text-align:left;padding:6px 10px;border:none;background:none;border-radius:4px;cursor:pointer;font-size:13px;color:var(--text-normal);'
                }
            });
            btn.onclick = () => {
                item.action();
                this._closeContextMenu();
            };
            btn.onmouseenter = () => btn.style.background = 'var(--background-modifier-hover)';
            btn.onmouseleave = () => btn.style.background = 'none';
        });

        document.body.appendChild(menu);
        this._contextMenuEl = menu;
    }

    private _deleteScene(volIndex: number, chapIndex: number, sceneIndex: number): void {
        if (!this._otvData) return;

        const vol = this._otvData.volumes[volIndex];
        const ch = vol?.chapters[chapIndex] as SceneOutlineTreeChapter;
        if (!ch?.scenes) return;

        ch.scenes.splice(sceneIndex, 1);
        ch.scenes.forEach((scene, i) => {
            scene.order = i + 1;
        });

        this._renderTree();
        showSuccess('场景已删除');
    }

    private _moveScene(volIndex: number, chapIndex: number, sceneIndex: number, direction: number): void {
        if (!this._otvData) return;

        const vol = this._otvData.volumes[volIndex];
        const ch = vol?.chapters[chapIndex] as SceneOutlineTreeChapter;
        if (!ch?.scenes) return;

        const newIndex = sceneIndex + direction;
        if (newIndex < 0 || newIndex >= ch.scenes.length) return;

        const [scene] = ch.scenes.splice(sceneIndex, 1);
        ch.scenes.splice(newIndex, 0, scene);
        ch.scenes.forEach((s, i) => {
            s.order = i + 1;
        });

        this._renderTree();
        showSuccess('场景已移动');
    }

    private _handleVolumeDrop(sourceVolIndices: number[], targetVolIndex: number, insertBefore: boolean): void {
        if (!this._otvData) return;

        const sorted = [...sourceVolIndices].sort((a, b) => b - a);
        const movedVols: OutlineTreeVolume[] = [];

        for (const vi of sorted) {
            const [vol] = this._otvData.volumes.splice(vi, 1);
            if (vol) movedVols.unshift(vol);
        }

        let insertIdx = targetVolIndex;
        for (const vi of sourceVolIndices) {
            if (vi < targetVolIndex) insertIdx--;
        }
        if (!insertBefore) insertIdx++;

        this._otvData.volumes.splice(insertIdx, 0, ...movedVols);

        this._confirmAndApplyChanges('调整分卷顺序，需要重新编号分卷并修改文件结构吗？', async () => {
            await this._renumberAllVolumes();
            showSuccess('分卷顺序已调整');
        });
    }

    private _handleChapterDrop(
        sources: Array<{ volIndex: number; chapIndex?: number }>,
        targetVolIndex: number,
        targetChapIndex: number
    ): void {
        if (!this._otvData) return;

        const sorted = [...sources].sort((a, b) => {
            if (a.volIndex !== b.volIndex) return b.volIndex - a.volIndex;
            return (b.chapIndex || 0) - (a.chapIndex || 0);
        });

        const movedChapters: OutlineTreeChapter[] = [];
        for (const src of sorted) {
            if (src.chapIndex === undefined) continue;
            const vol = this._otvData.volumes[src.volIndex];
            if (!vol) continue;
            const [ch] = vol.chapters.splice(src.chapIndex, 1);
            if (ch) movedChapters.unshift(ch);
        }

        let insertVol = targetVolIndex;
        let insertChap = targetChapIndex;

        const sameVolSources = sources.filter(s => s.volIndex === targetVolIndex && s.chapIndex !== undefined);
        if (sameVolSources.length > 0) {
            const maxBefore = Math.max(...sameVolSources.filter(s => (s.chapIndex || 0) < targetChapIndex).map(s => s.chapIndex || 0), -1);
            if (maxBefore >= 0) {
                insertChap -= sameVolSources.filter(s => (s.chapIndex || 0) < targetChapIndex).length;
            }
        }

        const targetVol = this._otvData.volumes[insertVol];
        if (targetVol) {
            targetVol.chapters.splice(insertChap, 0, ...movedChapters);
        }

        this._confirmAndApplyChanges('调整章节顺序，需要重新编号章节并修改文件结构吗？', async () => {
            await this._renumberAllChapters();
            showSuccess('章节顺序已调整');
        });
    }

    private _confirmAndApplyChanges(message: string, action: () => Promise<void>): void {
        const confirmed = window.confirm(message + '\n\n（此操作将重命名文件并更新分卷大纲，建议先备份）');
        if (confirmed) {
            action().catch(err => {
                log.error(err);
                showError('操作失败: ' + (err?.message || '未知错误'));
            });
        } else {
            this._loadOutlineTreeData().then(() => this._renderTree());
        }
    }

    private async _renumberAllVolumes(): Promise<void> {
        const project = this.getProject();
        if (!project || !this._otvData) return;

        const oldVolumes = [...this._otvData.volumes];
        const volumeDir = pjVolumeOutlineDir(project);
        const bodyRoot = `${project}/03-大纲与章节/正文`;
        const stepRoot = `${project}/03-大纲与章节/步骤结果`;

        const fs = this._fs;

        for (let i = 0; i < oldVolumes.length; i++) {
            const oldNum = oldVolumes[i].num;
            const newNum = i + 1;
            if (oldNum === newNum) continue;

            const oldVolFile = pjVolumeOutlineFile(project, oldNum);
            const newVolFile = pjVolumeOutlineFile(project, newNum);
            const oldBodyDir = pjBodyDir(project, oldNum);
            const newBodyDir = pjBodyDir(project, newNum);
            const oldStepDir = pjStepDirFn(project, oldNum, 1).replace(/\/第\d+章$/, '');
            const newStepDir = pjStepDirFn(project, newNum, 1).replace(/\/第\d+章$/, '');

            try {
                if (await fs.exists(oldVolFile)) {
                    let content = await fs.read(oldVolFile);
                    content = content.replace(/### 第(\d+)卷/g, `### 第${newNum}卷`);
                    content = content.replace(/\*\*章节范围\*\*[：:]\s*第(\d+)章\s*[-–—]\s*第(\d+)章/, `**章节范围**：第${oldVolumes[i].chapters[0]?.num || 1}章 - 第${oldVolumes[i].chapters[oldVolumes[i].chapters.length - 1]?.num || 1}章`);
                    await fs.write(newVolFile, content);
                    await fs.delete(oldVolFile);
                }
            } catch (e) {
                log.warn('重命名分卷大纲失败:', e);
            }

            try {
                const allFiles = this.app.vault.getFiles();
                const oldBodyFiles = allFiles.filter(f => f.path.startsWith(oldBodyDir + '/'));
                for (const f of oldBodyFiles) {
                    const newPath = f.path.replace(oldBodyDir, newBodyDir);
                    const newDir = newPath.substring(0, newPath.lastIndexOf('/'));
                    await this._ensureDir(newDir);
                    await this.app.vault.rename(f, newPath);
                }
            } catch (e) {
                log.warn('移动正文目录失败:', e);
            }

            try {
                const allFiles = this.app.vault.getFiles();
                const oldStepFiles = allFiles.filter(f => f.path.startsWith(oldStepDir + '/'));
                for (const f of oldStepFiles) {
                    const newPath = f.path.replace(oldStepDir, newStepDir);
                    const newDir = newPath.substring(0, newPath.lastIndexOf('/'));
                    await this._ensureDir(newDir);
                    await this.app.vault.rename(f, newPath);
                }
            } catch (e) {
                log.warn('移动步骤结果目录失败:', e);
            }
        }

        this._otvData.volumes.forEach((vol, idx) => {
            vol.num = idx + 1;
        });

        await this._loadOutlineTreeData();
        this._renderTree();
    }

    private async _ensureDir(dirPath: string): Promise<void> {
        try {
            if (!await this._fs.exists(dirPath)) {
                await this._fs.mkdir(dirPath);
            }
        } catch (e) {
            // ignore
        }
    }

    private async _renumberAllChapters(): Promise<void> {
        const project = this.getProject();
        if (!project || !this._otvData) return;

        let globalChapterNum = 1;
        const fs = this._fs;

        for (const vol of this._otvData.volumes) {
            const volStart = globalChapterNum;
            const pending: Array<{ ci: number; oldNum: number; newNum: number }> = [];

            for (let ci = 0; ci < vol.chapters.length; ci++) {
                const oldNum = vol.chapters[ci].num;
                const newNum = globalChapterNum;
                if (oldNum !== newNum) {
                    pending.push({ ci, oldNum, newNum });
                }
                globalChapterNum++;
            }

            if (pending.length > 0) {
                await this._applyChapterRenumber(project, vol.num, vol.chapters, pending);
            }

            const volEnd = globalChapterNum - 1;
            try {
                const volFile = pjVolumeOutlineFile(project, vol.num);
                if (await fs.exists(volFile)) {
                    let content = await fs.read(volFile);
                    content = content.replace(/\*\*章节范围\*\*[：:]\s*第(\d+)章\s*[-–—]\s*第(\d+)章/, `**章节范围**：第${volStart}章 - 第${volEnd}章`);

                    const lines = content.split('\n');
                    let inTable = false;
                    let tableStart = -1;
                    let tableEnd = -1;
                    for (let li = 0; li < lines.length; li++) {
                        if (lines[li].startsWith('|') && lines[li].includes('---')) {
                            inTable = true;
                            tableStart = li - 1;
                            continue;
                        }
                        if (inTable && !lines[li].startsWith('|')) {
                            tableEnd = li;
                            break;
                        }
                    }

                    if (tableStart >= 0) {
                        const newTableLines: string[] = [];
                        newTableLines.push('| 章号 | 核心冲突 |');
                        newTableLines.push('| --- | --- |');
                        for (const ch of vol.chapters) {
                            newTableLines.push(`| ${ch.num} | ${ch.conflict || ''} |`);
                        }
                        if (tableEnd < 0) tableEnd = lines.length;
                        lines.splice(tableStart, tableEnd - tableStart, ...newTableLines);
                        content = lines.join('\n');
                    }

                    await fs.write(volFile, content);
                }
            } catch (e) {
                log.warn('更新分卷大纲失败:', e);
            }
        }

        await this._loadOutlineTreeData();
        this._renderTree();
    }

    /**
     * 章节重编号（两阶段）：先把所有待改名的文件移到临时名，再改到最终名。
     *
     * 单遍升序改名在插入章节时必然撞名（第2章→第3章 时第3章还没让开），
     * rename 抛错被吞而内存编号照常前移 → 树与磁盘错位、同章双文件。
     * 只有该章所有文件都改名成功才更新 num，失败则保留旧编号（宁可断号，不可重号）。
     */
    private async _applyChapterRenumber(
        project: string,
        volNum: number,
        chapters: Array<{ num: number }>,
        pending: Array<{ ci: number; oldNum: number; newNum: number }>,
    ): Promise<void> {
        const TMP_SUFFIX = '.nw-renum-tmp';
        const toTemp = (path: string): string => `${path}${TMP_SUFFIX}.md`;
        const fromTemp = (path: string): string => path.slice(0, -TMP_SUFFIX.length - 3);

        interface Staged {
            ci: number;
            temp: string;
            target: string;
            oldNum: number;
            newNum: number;
            kind: 'body' | 'step';
        }
        const staged: Staged[] = [];
        const failed = new Set<number>();

        // Phase 1：全部移出原位，腾空目标名
        for (const p of pending) {
            const oldBodyFile = pjBodyFile(project, volNum, p.oldNum);
            const newBodyFile = pjBodyFile(project, volNum, p.newNum);
            try {
                const bodyFile = this.app.vault.getAbstractFileByPath(oldBodyFile);
                if (bodyFile instanceof TFile) {
                    const temp = toTemp(oldBodyFile);
                    await this.app.vault.rename(bodyFile, temp);
                    staged.push({ ci: p.ci, temp, target: newBodyFile, oldNum: p.oldNum, newNum: p.newNum, kind: 'body' });
                }
            } catch (e) {
                failed.add(p.ci);
                log.warn(`重命名章节 ${p.oldNum}->${p.newNum} 正文暂存失败:`, e);
            }

            const oldStepDir = pjStepDirFn(project, volNum, p.oldNum);
            const newStepDir = pjStepDirFn(project, volNum, p.newNum);
            try {
                const stepFiles = this.app.vault.getFiles().filter(f => f.path.startsWith(oldStepDir + '/'));
                for (const f of stepFiles) {
                    const originalPath = f.path;
                    const temp = toTemp(originalPath);
                    await this.app.vault.rename(f, temp);
                    staged.push({
                        ci: p.ci,
                        temp,
                        target: originalPath.replace(oldStepDir, newStepDir),
                        oldNum: p.oldNum,
                        newNum: p.newNum,
                        kind: 'step',
                    });
                }
            } catch (e) {
                failed.add(p.ci);
                log.warn(`重命名章节 ${p.oldNum}->${p.newNum} 步骤文件暂存失败:`, e);
            }
        }

        // Phase 2：改内容 → 落到最终名；失败则（含内容）退回原名，避免临时文件或改号文件留在库里
        for (const s of staged) {
            let originalContent: string | undefined;
            try {
                const file = this.app.vault.getAbstractFileByPath(s.temp);
                if (!(file instanceof TFile)) throw new Error(`临时文件不存在: ${s.temp}`);
                const content = await this.app.vault.read(file);
                originalContent = content;
                let next = content;
                if (s.kind === 'body') {
                    next = content.replace(/^第(\d+)章/gm, `第${s.newNum}章`);
                    next = next.replace(/^---[\s\S]*?---/, (fm) => fm.replace(/章:\s*.+/, `章: 第${s.newNum}章`));
                } else {
                    next = content.replace(new RegExp(`第${s.oldNum}章`, 'g'), `第${s.newNum}章`);
                }
                if (next !== content) {
                    await this.app.vault.modify(file, next);
                }
                const newDir = s.target.substring(0, s.target.lastIndexOf('/'));
                await this._ensureDir(newDir);
                await this.app.vault.rename(file, s.target);
            } catch (e) {
                failed.add(s.ci);
                log.warn(`章节 ${s.oldNum}->${s.newNum} 落盘失败:`, e);
                await this._restoreStagedFile(s.temp, fromTemp(s.temp), originalContent);
            }
        }

        for (const p of pending) {
            if (!failed.has(p.ci)) {
                chapters[p.ci].num = p.newNum;
            } else {
                log.warn(`章节 ${p.oldNum}->${p.newNum} 重编号未完成，保留旧编号以避免重号`);
            }
        }
    }

    /** 落盘失败时把临时文件（连同改号前内容）退回原名，尽力而为，失败只记日志 */
    private async _restoreStagedFile(tempPath: string, originalPath: string, originalContent?: string): Promise<void> {
        try {
            const file = this.app.vault.getAbstractFileByPath(tempPath);
            if (file instanceof TFile) {
                if (originalContent !== undefined) {
                    await this.app.vault.modify(file, originalContent);
                }
                await this.app.vault.rename(file, originalPath);
            }
        } catch (e) {
            log.warn(`恢复临时文件 ${tempPath} 失败:`, e);
        }
    }

    private _showContextMenu(x: number, y: number, items: Array<{ label: string; icon?: string; action: () => void; danger?: boolean; disabled?: boolean }>): void {
        this._closeContextMenu();

        const menu = document.createElement('div');
        menu.className = 'novel-writer-otv-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            padding: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 99999;
            min-width: 180px;
            font-size: 13px;
        `;

        for (const item of items) {
            if (item.label === '---') {
                const sep = document.createElement('div');
                sep.style.cssText = 'height:1px;background:var(--background-modifier-border);margin:4px 0;';
                menu.appendChild(sep);
                continue;
            }

            const menuItem = document.createElement('div');
            menuItem.textContent = (item.icon ? item.icon + ' ' : '') + item.label;
            menuItem.style.cssText = `
                padding: 6px 12px;
                cursor: ${item.disabled ? 'not-allowed' : 'pointer'};
                border-radius: 4px;
                color: ${item.danger ? 'var(--text-error)' : 'var(--text-normal)'};
                opacity: ${item.disabled ? '0.5' : '1'};
            `;

            if (!item.disabled) {
                menuItem.addEventListener('mouseenter', () => {
                    menuItem.style.background = 'var(--background-modifier-hover)';
                });
                menuItem.addEventListener('mouseleave', () => {
                    menuItem.style.background = 'transparent';
                });
                menuItem.addEventListener('click', () => {
                    item.action();
                    this._closeContextMenu();
                });
            }

            menu.appendChild(menuItem);
        }

        document.body.appendChild(menu);
        this._contextMenuEl = menu;

        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
        }
    }

    private _closeContextMenu(): void {
        if (this._contextMenuEl) {
            this._contextMenuEl.remove();
            this._contextMenuEl = null;
        }
    }

    private _showVolumeContextMenu(x: number, y: number, volIndex: number): void {
        if (!this._otvData) return;

        if (!this._selectedItems.has(`v-${volIndex}`)) {
            this._clearSelection();
            this._selectedItems.add(`v-${volIndex}`);
            this._renderTree();
        }

        const vol = this._otvData.volumes[volIndex];
        const selected = this._getSelectedItems();
        const hasVolSelection = selected.some(s => s.type === 'volume');
        const multiVol = selected.filter(s => s.type === 'volume').length > 1;

        const items: Array<{ label: string; icon?: string; action: () => void; danger?: boolean; disabled?: boolean }> = [
            { label: '上移', icon: '⬆️', action: () => this._moveSelectedVolume(-1), disabled: volIndex === 0 || hasVolSelection && multiVol },
            { label: '下移', icon: '⬇️', action: () => this._moveSelectedVolume(1), disabled: volIndex === this._otvData!.volumes.length - 1 || hasVolSelection && multiVol },
            { label: '---', action: () => {} },
            { label: '重命名', icon: '✏️', action: () => this._handleRenameVolume(volIndex) },
            { label: '新增章节', icon: '➕', action: () => this._addChapterToVolume(volIndex) },
            { label: '---', action: () => {} },
            { label: '删除卷', icon: '🗑️', action: () => this._handleDeleteVolume(volIndex), danger: true },
        ];

        this._showContextMenu(x, y, items);
    }

    private _showChapterContextMenu(x: number, y: number, volIndex: number, chapIndex: number): void {
        if (!this._otvData) return;

        const chapId = `v-${volIndex}-c-${chapIndex}`;
        if (!this._selectedItems.has(chapId)) {
            this._clearSelection();
            this._selectedItems.add(chapId);
            this._renderTree();
        }

        const vol = this._otvData.volumes[volIndex];
        const ch = vol.chapters[chapIndex];
        const selected = this._getSelectedItems();
        const chapSelected = selected.filter(s => s.type === 'chapter');
        const multiChap = chapSelected.length > 1;

        const items: Array<{ label: string; icon?: string; action: () => void; danger?: boolean; disabled?: boolean }> = [
            { label: '上移', icon: '⬆️', action: () => this._moveSelectedChapter(-1), disabled: chapIndex === 0 && !multiChap },
            { label: '下移', icon: '⬇️', action: () => this._moveSelectedChapter(1), disabled: chapIndex === vol.chapters.length - 1 && !multiChap },
            { label: '移到卷首', icon: '⏫', action: () => this._moveChapterToEdge(volIndex, true) },
            { label: '移到卷尾', icon: '⏬', action: () => this._moveChapterToEdge(volIndex, false) },
            { label: '---', action: () => {} },
            { label: '移动到...', icon: '📂', action: () => this._showMoveToVolumeMenu(x, y, volIndex, chapIndex) },
            { label: '---', action: () => {} },
            { label: '重命名', icon: '✏️', action: () => this._handleRenameChapter(volIndex, chapIndex), disabled: multiChap },
            { label: '打开章节', icon: '📖', action: () => this._openChapterFile(volIndex, chapIndex), disabled: multiChap },
            { label: '---', action: () => {} },
            { label: `删除${multiChap ? '选中章节' : '章节'}`, icon: '🗑️', action: () => this._handleDeleteSelected(), danger: true },
        ];

        this._showContextMenu(x, y, items);
    }

    private _showMoveToVolumeMenu(x: number, y: number, sourceVolIndex: number, sourceChapIndex: number): void {
        if (!this._otvData) return;

        const items = this._otvData.volumes.map((vol, idx) => ({
            label: `第${vol.num}卷 ${vol.title}`,
            action: () => {
                const selected = this._getSelectedItems().filter(s => s.type === 'chapter');
                if (selected.length === 0) return;
                this._handleChapterDrop(
                    selected.map(s => ({ volIndex: s.volIndex, chapIndex: s.chapIndex })),
                    idx,
                    this._otvData!.volumes[idx].chapters.length
                );
            },
            disabled: idx === sourceVolIndex
        }));

        this._showContextMenu(x + 180, y, items);
    }

    private _moveSelectedVolume(direction: number): void {
        if (!this._otvData) return;
        const selected = this._getSelectedItems().filter(s => s.type === 'volume');
        if (selected.length !== 1) {
            showWarning('请选择单个分卷进行移动');
            return;
        }

        const volIndex = selected[0].volIndex;
        const newIndex = volIndex + direction;

        if (newIndex < 0 || newIndex >= this._otvData.volumes.length) return;

        const [vol] = this._otvData.volumes.splice(volIndex, 1);
        this._otvData.volumes.splice(newIndex, 0, vol);

        this._clearSelection();
        this._selectedItems.add(`v-${newIndex}`);

        this._confirmAndApplyChanges('调整分卷顺序，需要重新编号分卷并修改文件结构吗？', async () => {
            await this._renumberAllVolumes();
            showSuccess('分卷已移动');
        });
    }

    private _moveSelectedChapter(direction: number): void {
        if (!this._otvData) return;
        const selected = this._getSelectedItems().filter(s => s.type === 'chapter');
        if (selected.length === 0) return;

        const byVol = new Map<number, number[]>();
        for (const s of selected) {
            if (!byVol.has(s.volIndex)) byVol.set(s.volIndex, []);
            byVol.get(s.volIndex)!.push(s.chapIndex || 0);
        }

        let canMove = true;
        for (const [volIdx, indices] of byVol) {
            const vol = this._otvData.volumes[volIdx];
            if (!vol) continue;
            const sorted = [...indices].sort((a, b) => a - b);
            if (direction < 0 && sorted[0] === 0) canMove = false;
            if (direction > 0 && sorted[sorted.length - 1] === vol.chapters.length - 1) canMove = false;
        }

        if (!canMove) return;

        const allToMove: Array<{ volIndex: number; chapIndex: number }> = [];
        for (const [volIdx, indices] of byVol) {
            const sorted = [...indices].sort((a, b) => direction > 0 ? b - a : a - b);
            for (const ci of sorted) {
                allToMove.push({ volIndex: volIdx, chapIndex: ci });
            }
        }

        for (const item of allToMove) {
            const vol = this._otvData.volumes[item.volIndex];
            if (!vol) continue;
            const [ch] = vol.chapters.splice(item.chapIndex, 1);
            if (ch) vol.chapters.splice(item.chapIndex + direction, 0, ch);
        }

        this._clearSelection();
        for (const item of allToMove) {
            this._selectedItems.add(this._itemKey('chapter', item.volIndex, item.chapIndex + direction));
        }

        this._confirmAndApplyChanges('调整章节顺序，需要重新编号章节并修改文件结构吗？', async () => {
            await this._renumberAllChapters();
            showSuccess('章节已移动');
        });
    }

    private _moveChapterToEdge(volIndex: number, toTop: boolean): void {
        if (!this._otvData) return;
        const selected = this._getSelectedItems().filter(s => s.type === 'chapter' && s.volIndex === volIndex);
        if (selected.length === 0) return;

        const vol = this._otvData.volumes[volIndex];
        const indices = selected.map(s => s.chapIndex || 0).sort((a, b) => b - a);

        const moved: OutlineTreeChapter[] = [];
        for (const ci of indices) {
            const [ch] = vol.chapters.splice(ci, 1);
            if (ch) moved.unshift(ch);
        }

        if (toTop) {
            vol.chapters.unshift(...moved);
        } else {
            vol.chapters.push(...moved);
        }

        this._clearSelection();
        for (let i = 0; i < moved.length; i++) {
            const newIdx = toTop ? i : vol.chapters.length - moved.length + i;
            this._selectedItems.add(this._itemKey('chapter', volIndex, newIdx));
        }

        this._confirmAndApplyChanges('调整章节顺序，需要重新编号章节并修改文件结构吗？', async () => {
            await this._renumberAllChapters();
            showSuccess('章节已移动');
        });
    }

    private _handleRenameVolume(volIndex: number): void {
        if (!this._otvData) return;
        const vol = this._otvData.volumes[volIndex];
        const newTitle = window.prompt('输入新的分卷名称:', vol.title);
        if (newTitle === null || newTitle.trim() === '' || newTitle.trim() === vol.title) return;

        vol.title = newTitle.trim();

        (async () => {
            const project = this.getProject();
            if (!project) return;
            try {
                const volFile = pjVolumeOutlineFile(project, vol.num);
                if (await this._fs.exists(volFile)) {
                    let content = await this._fs.read(volFile);
                    content = content.replace(/\*\*卷名\*\*[：:]\s*《?(.+?)》?/, `**卷名**：《${newTitle.trim()}》`);
                    await this._fs.write(volFile, content);
                }
                showSuccess('分卷已重命名');
                this._renderTree();
            } catch (e) {
                showError('重命名失败');
                this._loadOutlineTreeData().then(() => this._renderTree());
            }
        })();
    }

    private _handleRenameChapter(volIndex: number, chapIndex: number): void {
        if (!this._otvData) return;
        showWarning('章节重命名请通过修改章节文件标题实现，拖拽排序会自动重新编号');
    }

    private _addChapterToVolume(volIndex: number): void {
        showWarning('新增章节请使用向导或批量创建功能');
    }

    private _openChapterFile(volIndex: number, chapIndex: number): void {
        if (!this._otvData) return;
        const project = this.getProject();
        if (!project) return;

        const vol = this._otvData.volumes[volIndex];
        const ch = vol.chapters[chapIndex];
        const filePath = pjBodyFile(project, vol.num, ch.num);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf().openFile(file);
        } else {
            showWarning('章节文件不存在');
        }
    }

    private _handleDeleteVolume(volIndex: number): void {
        if (!this._otvData) return;
        const vol = this._otvData.volumes[volIndex];
        if (!window.confirm(`确定要删除「第${vol.num}卷 ${vol.title}」吗？\n\n此操作将删除卷目录下所有文件，不可恢复！`)) return;

        (async () => {
            const project = this.getProject();
            if (!project) return;
            try {
                const volFile = pjVolumeOutlineFile(project, vol.num);
                if (await this._fs.exists(volFile)) {
                    await this._fs.delete(volFile);
                }
                showSuccess('分卷已删除');
                await this._loadOutlineTreeData();
                this._clearSelection();
                this._renderTree();
            } catch (e) {
                showError('删除失败: ' + (e as Error)?.message);
            }
        })();
    }

    private _handleDeleteSelected(): void {
        const selected = this._getSelectedItems();
        if (selected.length === 0) return;

        const chapters = selected.filter(s => s.type === 'chapter');
        const volumes = selected.filter(s => s.type === 'volume');

        if (volumes.length > 0) {
            const volNames = volumes.map(v => {
                const vol = this._otvData!.volumes[v.volIndex];
                return vol ? `第${vol.num}卷 ${vol.title}` : '';
            }).join('、');
            if (!window.confirm(`确定要删除 ${volumes.length} 个分卷吗？\n${volNames}\n\n此操作不可恢复！`)) return;
            this._deleteVolumes(volumes.map(v => v.volIndex));
            return;
        }

        if (chapters.length > 0) {
            if (!window.confirm(`确定要删除选中的 ${chapters.length} 个章节吗？\n\n此操作将删除章节文件，不可恢复！`)) return;
            this._deleteChapters(chapters.map(c => ({ volIndex: c.volIndex, chapIndex: c.chapIndex || 0 })));
        }
    }

    private _deleteVolumes(volIndices: number[]): void {
        const project = this.getProject();
        if (!project || !this._otvData) return;

        const sorted = [...volIndices].sort((a, b) => b - a);

        (async () => {
            try {
                for (const vi of sorted) {
                    const vol = this._otvData!.volumes[vi];
                    if (!vol) continue;
                    const volFile = pjVolumeOutlineFile(project, vol.num);
                    if (await this._fs.exists(volFile)) {
                        await this._fs.delete(volFile);
                    }
                }
                showSuccess('分卷已删除');
                await this._loadOutlineTreeData();
                await this._renumberAllVolumes();
                this._clearSelection();
                this._renderTree();
            } catch (e) {
                showError('删除失败: ' + (e as Error)?.message);
            }
        })();
    }

    private _deleteChapters(chapters: Array<{ volIndex: number; chapIndex: number }>): void {
        const project = this.getProject();
        if (!project || !this._otvData) return;

        const sorted = [...chapters].sort((a, b) => {
            if (a.volIndex !== b.volIndex) return b.volIndex - a.volIndex;
            return b.chapIndex - a.chapIndex;
        });

        (async () => {
            try {
                for (const ch of sorted) {
                    const vol = this._otvData!.volumes[ch.volIndex];
                    if (!vol) continue;
                    const chapter = vol.chapters[ch.chapIndex];
                    if (!chapter) continue;

                    const bodyFile = pjBodyFile(project, vol.num, chapter.num);
                    const file = this.app.vault.getAbstractFileByPath(bodyFile);
                    if (file instanceof TFile) {
                        await this.app.vault.trash(file, true);
                    }

                    const stepDir = pjStepDirFn(project, vol.num, chapter.num);
                    const allFiles = this.app.vault.getFiles();
                    const stepFiles = allFiles.filter(f => f.path.startsWith(stepDir + '/'));
                    for (const sf of stepFiles) {
                        await this.app.vault.trash(sf, true);
                    }
                }
                showSuccess('章节已删除');
                await this._renumberAllChapters();
                this._clearSelection();
                this._renderTree();
            } catch (e) {
                showError('删除失败: ' + (e as Error)?.message);
            }
        })();
    }

    private async _loadOutlineTreeData(): Promise<void> {
        const project = this.getProject();
        if (!project) return;

        const volumeDir = pjVolumeOutlineDir(project);
        const volumeFiles = this.app.vault.getFiles()
            .filter(f => f.path.startsWith(`${volumeDir}/`) && f.name.endsWith('_分卷大纲.md'))
            .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
        if (volumeFiles.length === 0) {
            log.warn('[OutlineTree] 未找到分卷大纲目录:', volumeDir);
            return;
        }
        const parts: string[] = [];
        for (const f of volumeFiles) {
            try { parts.push(await this.app.vault.read(f)); } catch (e) { log.warn('[OutlineTree] 读取失败', f.path, e); }
        }
        const planContent = parts.join('\n\n');
        const volumes: OutlineTreeVolume[] = [];

        const volSections = planContent.split(/^###\s+第(\d+)卷/gm);
        for (let i = 1; i < volSections.length; i += 2) {
            const volNum = parseInt(volSections[i]);
            const volBody = volSections[i + 1] || '';

            const titleMatch = volBody.match(/\*\*卷名\*\*[：:]\s*《?(.+?)》?/);
            const volTitle = titleMatch ? titleMatch[1].trim() : `第${volNum}卷`;

            const rangeMatch = volBody.match(/\*\*章节范围\*\*[：:]\s*第(\d+)章\s*[-–—]\s*第(\d+)章/);
            const startCh = rangeMatch ? parseInt(rangeMatch[1]) : 1;
            const endCh = rangeMatch ? parseInt(rangeMatch[2]) : 1;

            const conflictMap: Map<number, string> = new Map();
            const tableRegex = /\|(\d+)\s*\|(.+?)\|/g;
            let m;
            while ((m = tableRegex.exec(volBody)) !== null) {
                const chNum = parseInt(m[1]);
                const conflict = m[2].trim();
                if (!isNaN(chNum) && conflict && conflict !== '...') {
                    conflictMap.set(chNum, conflict);
                }
            }

            const chapters: OutlineTreeChapter[] = [];
            for (let chNum = startCh; chNum <= endCh; chNum++) {
                const chapName = `第${chNum}章`;
                let summary = '';
                try {
                    const stepDir = pjStepDir(project, volNum, chNum);
                    const outlineFiles = this.app.vault.getFiles().filter(f =>
                        f.path.startsWith(`${stepDir}/`) &&
                        f.name.includes(chapName) &&
                        f.name.includes('大纲摘要')
                    );
                    if (outlineFiles.length > 0) {
                        const content = await this.app.vault.read(outlineFiles[0]);
                        const locMatch = content.match(/全书定位[：:]\s*(.+)/);
                        if (locMatch) {
                            summary = locMatch[1].trim().slice(0, 50);
                        } else {
                            const lines = content.split('\n');
                            for (const line of lines) {
                                const t = line.trim();
                                if (t && !t.startsWith('#') && !t.startsWith('|') && !t.startsWith('-') && !t.startsWith('>') && t.length > 10) {
                                    summary = t.slice(0, 50);
                                    break;
                                }
                            }
                        }
                    }
                } catch { /* ignore */ }

                chapters.push({
                    num: chNum,
                    conflict: conflictMap.get(chNum) || '',
                    summary
                });
            }

            volumes.push({ num: volNum, title: volTitle, chapters });
        }

        volumes.sort((a, b) => a.num - b.num);

        this._otvData!.volumes = volumes;
    }

    private async _saveOutlineChapterData(chNum: number, conflict: string, summary: string): Promise<void> {
        const project = this.getProject();
        if (!project) return;

        const volDir = pjVolumeOutlineDir(project);
        const volumeFiles = this.app.vault.getFiles()
            .filter(f => f.path.startsWith(`${volDir}/`) && f.name.endsWith('_分卷大纲.md'));

        let targetFile: TFile | null = null;
        let targetVolN = 0;
        for (const f of volumeFiles) {
            const content = await this.app.vault.read(f);
            const rangeMatch = content.match(/\*\*章节范围\*\*[：:]\s*第(\d+)章\s*[-–—]\s*第(\d+)章/);
            if (rangeMatch) {
                const s = parseInt(rangeMatch[1]);
                const e = parseInt(rangeMatch[2]);
                if (chNum >= s && chNum <= e) {
                    targetFile = f;
                    const volMatch = f.name.match(/^第(\d+)卷/);
                    if (volMatch) targetVolN = parseInt(volMatch[1], 10);
                    break;
                }
            }
        }

        if (targetFile) {
            let content = await this.app.vault.read(targetFile);
            const tableRowRegex = new RegExp(`(\\|\\s*${chNum}\\s*\\|)\\s*(.*?)\\s*\\|`, 'g');
            content = content.replace(tableRowRegex, `$1 ${conflict} |`);
            await this.app.vault.modify(targetFile, content);
        }

        if (summary && targetVolN > 0) {
            const stepDir = pjStepDir(project, targetVolN, chNum);
            const allFiles = this.app.vault.getFiles();
            const outlineFile = allFiles.find(f =>
                f.path.startsWith(`${stepDir}/`) &&
                f.name.includes(`第${chNum}章`) &&
                f.name.includes('大纲摘要')
            );
            if (outlineFile instanceof TFile) {
                let content = await this.app.vault.read(outlineFile);
                if (content.includes('全书定位')) {
                    content = content.replace(/全书定位[：:].*/g, `全书定位：${summary}`);
                } else {
                    content = content.replace(/^(##\s)/m, `全书定位：${summary}\n\n$1`);
                }
                await this.app.vault.modify(outlineFile, content);
            }
        }
    }

    refresh(): void {
        if (this._otvData) {
            this._otvData.volumes = [];
        }
        this._loadOutlineTreeData().then(() => {
            this._clearSelection();
            this._renderTree();
        });
    }
}
