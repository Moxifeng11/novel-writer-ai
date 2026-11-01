/**
 * writing-pet.ts — 桌面宠物（浮窗常驻显示今日字数）
 *
 * 形态：<body> 级浮窗（不是 workspace leaf），这样它能浮在任何视图上方，
 * 也不会在标签栏/侧栏留下一个叶子。拖动位置写进 settings.petPosition。
 *
 * 交互：
 * - 单击宠物：展开/收起迷你统计卡
 * - 双击宠物 / 点卡片里的「统计」：打开写作统计弹窗
 * - 右上角 ×：隐藏宠物（写 petEnabled=false，可在设置里重新打开）
 * - 写完一章：main 调用 notifyDelta()，宠物做一个短暂的「开心」动作
 */

import type NovelWriterPlugin from '../main';
import { formatWords, type StatsSummary } from '../shared/writing-stats';

export interface WritingPetDeps {
    plugin: NovelWriterPlugin;
    getSummary: () => StatsSummary | null;
    getTarget: () => number;
    openStats: () => void;
    hide: () => void;
}

/** 宠物墨色猫 SVG（无外部资源，深浅色主题都能看清） */
const PET_SVG = `
<svg class="nw-pet-svg" viewBox="0 0 120 110" role="img" aria-hidden="true" focusable="false">
    <ellipse class="nw-pet-shadow" cx="60" cy="101" rx="34" ry="6"/>
    <path class="nw-pet-tail" d="M92 84c14 2 20-8 16-17-3-7-12-8-15-2"/>
    <ellipse class="nw-pet-body" cx="60" cy="78" rx="30" ry="22"/>
    <ellipse class="nw-pet-paw" cx="44" cy="96" rx="9" ry="5"/>
    <ellipse class="nw-pet-paw" cx="76" cy="96" rx="9" ry="5"/>
    <path class="nw-pet-ear" d="M32 30l6-16 15 9z"/>
    <path class="nw-pet-ear" d="M88 30l-6-16-15 9z"/>
    <ellipse class="nw-pet-head" cx="60" cy="40" rx="30" ry="26"/>
    <ellipse class="nw-pet-eye" cx="49" cy="38" rx="3.6" ry="4.6"/>
    <ellipse class="nw-pet-eye" cx="71" cy="38" rx="3.6" ry="4.6"/>
    <path class="nw-pet-mouth" d="M55 49c2 3 8 3 10 0"/>
    <line class="nw-pet-whisker" x1="30" y1="42" x2="42" y2="44"/>
    <line class="nw-pet-whisker" x1="30" y1="49" x2="42" y2="49"/>
    <line class="nw-pet-whisker" x1="90" y1="42" x2="78" y2="44"/>
    <line class="nw-pet-whisker" x1="90" y1="49" x2="78" y2="49"/>
    <path class="nw-pet-pen" d="M84 60l9-9 5 5-9 9-6 1z"/>
</svg>`;

export class WritingPet {
    private deps: WritingPetDeps;
    private root: HTMLElement | null = null;
    private bubbleMain: HTMLElement | null = null;
    private bubbleSub: HTMLElement | null = null;
    private card: HTMLElement | null = null;
    private mood: 'idle' | 'happy' | 'sleep' = 'idle';
    private expanded = false;
    private dragging = false;
    private moved = false;
    private dragStart = { x: 0, y: 0 };
    private origin = { x: 0, y: 0 };
    private pulseTimer: ReturnType<typeof setTimeout> | null = null;
    private boundMove = (e: PointerEvent) => this.onPointerMove(e);
    private boundUp = () => this.onPointerUp();

    constructor(deps: WritingPetDeps) {
        this.deps = deps;
    }

    get isMounted(): boolean {
        return !!this.root && this.root.isConnected;
    }

    mount(): void {
        if (this.isMounted) return;
        const root = document.body.createDiv({ cls: 'nw-pet', attr: { 'data-nw-pet': '1' } });
        this.root = root;
        const saved = this.deps.plugin.settings.petPosition;
        const fallbackY = Math.max(80, window.innerHeight - 260);
        this.placeAt(
            Number.isFinite(saved?.x) ? Number(saved!.x) : 18,
            Number.isFinite(saved?.y) ? Number(saved!.y) : fallbackY,
        );

        const bubble = root.createDiv({ cls: 'nw-pet-bubble' });
        this.bubbleMain = bubble.createDiv({ cls: 'nw-pet-bubble-main' });
        this.bubbleSub = bubble.createDiv({ cls: 'nw-pet-bubble-sub' });

        const petBody = root.createDiv({
            cls: 'nw-pet-body-wrap',
            attr: { role: 'button', tabindex: '0', 'aria-label': '写作宠物，单击查看本周/本月，双击打开统计' },
        });
        petBody.innerHTML = PET_SVG;
        petBody.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        petBody.addEventListener('click', () => {
            if (this.moved) return;
            this.toggleCard();
        });
        petBody.addEventListener('dblclick', () => this.deps.openStats());
        petBody.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleCard();
            }
        });

        const close = root.createEl('button', {
            cls: 'nw-pet-close',
            text: '×',
            attr: { type: 'button', 'aria-label': '隐藏写作宠物' },
        });
        close.addEventListener('click', (event) => {
            event.stopPropagation();
            this.deps.hide();
            this.destroy();
        });

        this.card = root.createDiv({ cls: 'nw-pet-card' });
        this.card.style.display = 'none';
        this.update();
    }

    /** 每分钟/每次台账变化时刷新文案与心情 */
    update(): void {
        if (!this.isMounted) return;
        const summary = this.deps.getSummary();
        const target = Math.max(0, Number(this.deps.getTarget()) || 0);
        const today = summary?.today ?? 0;
        const ratio = target > 0 ? Math.min(1, today / target) : 0;

        if (this.bubbleMain) {
            this.bubbleMain.setText(today > 0 ? `今日 ${formatWords(today)} 字` : '今日还没动笔');
        }
        if (this.bubbleSub) {
            if (target > 0) {
                this.bubbleSub.setText(`${Math.round(ratio * 100)}% / ${formatWords(target)} 字`);
            } else {
                this.bubbleSub.setText('点我看看进度');
            }
        }

        const nextMood: 'idle' | 'happy' | 'sleep' = today <= 0
            ? 'sleep'
            : (target > 0 && today >= target ? 'happy' : 'idle');
        this.setMood(nextMood);

        if (this.card) this.renderCard(summary, target, ratio);
    }

    /** 写完一章：短促的开心动作（不改心情，只是动一下） */
    notifyDelta(delta: number): void {
        if (!this.isMounted || delta <= 0) return;
        this.update();
        this.root?.addClass('nw-is-pulse');
        if (this.pulseTimer) clearTimeout(this.pulseTimer);
        this.pulseTimer = setTimeout(() => {
            this.pulseTimer = null;
            this.root?.removeClass('nw-is-pulse');
        }, 1200);
    }

    destroy(): void {
        if (this.pulseTimer) {
            clearTimeout(this.pulseTimer);
            this.pulseTimer = null;
        }
        document.removeEventListener('pointermove', this.boundMove);
        document.removeEventListener('pointerup', this.boundUp);
        this.root?.remove();
        this.root = null;
        this.bubbleMain = null;
        this.bubbleSub = null;
        this.card = null;
    }

    private setMood(mood: 'idle' | 'happy' | 'sleep'): void {
        if (this.mood === mood || !this.root) return;
        this.mood = mood;
        this.root.removeClass('nw-is-idle', 'nw-is-happy', 'nw-is-sleep');
        this.root.addClass(`nw-is-${mood}`);
    }

    private toggleCard(): void {
        if (!this.card) return;
        this.expanded = !this.expanded;
        this.card.style.display = this.expanded ? '' : 'none';
        if (this.expanded) this.update();
    }

    private renderCard(summary: StatsSummary | null, target: number, ratio: number): void {
        if (!this.card) return;
        this.card.empty();
        const rows: Array<{ label: string; value: string }> = [
            { label: '本周', value: formatWords(summary?.week ?? 0) },
            { label: '本月', value: formatWords(summary?.month ?? 0) },
            { label: '累计', value: formatWords(summary?.total ?? 0) },
            { label: '连续', value: `${summary?.streak ?? 0} 天` },
        ];
        for (const row of rows) {
            const line = this.card.createDiv({ cls: 'nw-pet-card-row' });
            line.createSpan({ text: row.label });
            line.createSpan({ text: row.value, cls: 'nw-pet-card-value' });
        }
        if (target > 0) {
            const track = this.card.createDiv({ cls: 'nw-pet-card-track' });
            const fill = track.createDiv({ cls: 'nw-pet-card-fill' });
            fill.style.width = `${Math.round(ratio * 100)}%`;
            if (ratio >= 1) fill.addClass('nw-is-done');
        }
        const open = this.card.createEl('button', {
            cls: 'nw-pet-card-open',
            text: '查看完整统计',
            attr: { type: 'button' },
        });
        open.addEventListener('click', (event) => {
            event.stopPropagation();
            this.deps.openStats();
        });
    }

    private onPointerDown(event: PointerEvent): void {
        if ((event.target as HTMLElement)?.closest('button')) return;
        if (!this.root) return;
        this.dragging = true;
        this.moved = false;
        this.dragStart = { x: event.clientX, y: event.clientY };
        const rect = this.root.getBoundingClientRect();
        this.origin = { x: rect.left, y: rect.top };
        document.addEventListener('pointermove', this.boundMove);
        document.addEventListener('pointerup', this.boundUp);
    }

    private onPointerMove(event: PointerEvent): void {
        if (!this.dragging || !this.root) return;
        const dx = event.clientX - this.dragStart.x;
        const dy = event.clientY - this.dragStart.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.moved = true;
        this.placeAt(this.origin.x + dx, this.origin.y + dy);
    }

    private onPointerUp(): void {
        if (!this.dragging) return;
        this.dragging = false;
        document.removeEventListener('pointermove', this.boundMove);
        document.removeEventListener('pointerup', this.boundUp);
        if (!this.moved || !this.root) return;
        const rect = this.root.getBoundingClientRect();
        const settings = this.deps.plugin.settings;
        settings.petPosition = { x: Math.round(rect.left), y: Math.round(rect.top) };
        void this.deps.plugin.saveSettings();
        // 拖动结束后的那次 click 不应再触发展开
        setTimeout(() => { this.moved = false; }, 0);
    }

    private placeAt(x: number, y: number): void {
        if (!this.root) return;
        const width = this.root.offsetWidth || 150;
        const height = this.root.offsetHeight || 170;
        const maxX = Math.max(8, window.innerWidth - width - 8);
        const maxY = Math.max(8, window.innerHeight - height - 8);
        this.root.style.left = `${Math.min(Math.max(8, Math.round(x)), maxX)}px`;
        this.root.style.top = `${Math.min(Math.max(8, Math.round(y)), maxY)}px`;
    }
}
