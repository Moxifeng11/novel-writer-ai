/**
 * Memory Preview — V2 Phase 3 记忆碎片 UI 预览
 *
 * 用法：
 *   const preview = new MemoryPreview(container, plugin);
 *   preview.refresh(triggeredMemories, allShards, project);
 *
 * 嵌入点：FullWriterView 的右侧监控区（与关系状态并列）
 */

import type { App } from 'obsidian';
import { TriggeredMemory, MemoryShard, getCharacterMemoryPath, loadCharacterMemories, markMemoryRevealed } from '../engine/memory-trigger';

/** 记忆预览宿主：仅需 app 即可标记已揭示 */
export interface MemoryPreviewHost {
    app: App;
}

export class MemoryPreview {
    private container: HTMLElement;
    private host: MemoryPreviewHost;

    constructor(container: HTMLElement, host: MemoryPreviewHost) {
        this.container = container;
        this.host = host;
    }

    /**
     * 刷新显示：触发记忆 + 全量记忆库
     */
    refresh(
        triggered: TriggeredMemory[],
        allShards: MemoryShard[],
        project: string,
        currentChapter?: string,
    ): void {
        this.container.empty();
        this.container.addClass('novel-writer-memory-preview');

        const title = this.container.createEl('div', {
            text: '🧩 记忆碎片',
            cls: 'novel-writer-section-title',
        });

        if (allShards.length === 0) {
            this.container.createEl('div', {
                text: '暂无记忆碎片。请先生成角色记忆。',
                attr: { style: 'color: var(--text-muted); font-size: 0.82em; margin-top: 4px;' },
            });
            return;
        }

        // 全量统计
        const unrevealed = allShards.filter(s => !s.revealed);
        const revealed = allShards.filter(s => s.revealed);
        const stats = this.container.createEl('div', {
            attr: { style: 'font-size: 0.78em; color: var(--text-muted); margin-bottom: 6px;' },
        });
        stats.createEl('span', { text: `共 ${allShards.length} 条（` });
        stats.createEl('span', {
            text: `${unrevealed.length} 未揭示`,
            attr: { style: 'color: var(--text-accent); font-weight: 600;' },
        });
        stats.createEl('span', { text: ` | ${revealed.length} 已揭示）` });

        // 触发记忆（如果有）
        if (triggered.length > 0) {
            const triggerSection = this.container.createEl('div', { cls: 'nw-memory-triggered' });
            triggerSection.createEl('div', {
                text: `⚡ 当前触发了 ${triggered.length} 条记忆`,
                attr: { style: 'font-size: 0.82em; font-weight: 600; color: var(--text-accent); margin-bottom: 4px;' },
            });

            for (const t of triggered) {
                this.renderMemoryCard(triggerSection, t.shard, t.score, t.reason, project, currentChapter);
            }
        }

        // 未揭示记忆库（可折叠）
        if (unrevealed.length > 0) {
            const unrevealedSection = this.container.createEl('details', { cls: 'nw-memory-collapsible' });
            unrevealedSection.createEl('summary', {
                text: `📋 未揭示记忆 (${unrevealed.length})`,
                attr: { style: 'cursor: pointer; font-size: 0.82em; font-weight: 600; margin: 8px 0;' },
            });

            const list = unrevealedSection.createEl('div', { cls: 'nw-memory-list' });
            for (const s of unrevealed.slice(0, 10)) {
                list.createEl('div', {
                    text: `${s.id}: ${s.title} — ${s.characterName} (重要度: ${s.importance})`,
                    attr: { style: 'font-size: 0.76em; color: var(--text-muted); padding: 2px 0; padding-left: 8px; border-left: 2px solid var(--text-faint);' },
                });
            }
            if (unrevealed.length > 10) {
                list.createEl('div', {
                    text: `... 还有 ${unrevealed.length - 10} 条`,
                    attr: { style: 'font-size: 0.73em; color: var(--text-faint); padding-left: 8px;' },
                });
            }
        }
    }

    private renderMemoryCard(
        parent: HTMLElement,
        shard: MemoryShard,
        score: number,
        reason: string,
        project: string,
        currentChapter?: string,
    ): void {
        const card = parent.createEl('div', {
            cls: 'nw-memory-card',
            attr: { style: 'border-left: 3px solid var(--text-accent); padding: 4px 8px; margin: 4px 0; font-size: 0.78em; background: var(--background-secondary); border-radius: 4px;' },
        });

        const header = card.createEl('div', {
            text: `${shard.id} ${shard.title}`,
            attr: { style: 'font-weight: 600;' },
        });
        header.createEl('span', {
            text: ` 匹配: ${(score * 100).toFixed(0)}%`,
            attr: { style: 'color: var(--text-accent); font-size: 0.85em;' },
        });

        card.createEl('div', {
            text: `📌 ${shard.characterName} · ${shard.timeContext} · ${shard.emotions.join('、')}`,
            attr: { style: 'color: var(--text-muted); margin: 2px 0;' },
        });

        card.createEl('div', {
            text: `触发: ${reason}`,
            attr: { style: 'color: var(--text-faint); font-size: 0.88em;' },
        });

        if (currentChapter && !shard.revealed) {
            const btn = card.createEl('button', {
                text: '✓ 标记为已揭示',
                attr: { style: 'margin-top: 4px; padding: 2px 8px; font-size: 0.78em; cursor: pointer;' },
            });
            btn.addEventListener('click', async () => {
                await markMemoryRevealed(
                    this.host.app, project, shard.characterName,
                    shard.id, currentChapter,
                );
                btn.disabled = true;
                btn.textContent = '✅ 已揭示';
            });
        }
    }
}
