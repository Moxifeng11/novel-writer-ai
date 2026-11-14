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

import type NovelWriterPlugin from '@/main';
import { formatWords, type StatsSummary } from '@/shared/writing-stats';
import { setSanitizedHtml } from '@/ui/rendering/safe-html';
import { PET_POSE_SHEET_BIGFISH, PET_POSE_SHEET_CUIGENGJI } from '@/shared/pet-pose-sheet.generated';
import { clampPetPoint, PET_DEFAULT_SNAP_EDGES, petViewportOf, snapPetPoint, type PetViewport, type PetSnapEdges } from '@/shared/pet-geometry';
import { onNodeDoc } from '@/shared/dom-window';

/**
 * WritingPetDeps 类型定义。
 */
export interface WritingPetDeps {
    plugin: NovelWriterPlugin;
    getSummary: () => StatsSummary | null;
    getTarget: () => number;
    openStats: () => void;
    /** 打开用量与成本账本（快捷摘要里的成本入口） */
    openUsage?: () => void;
    hide: () => void;
}

/**
 * 宠物分层定义（图层信息唯一来源）。
 *
 * 设计依据：docs/design/desktop-pet-qstyle-layered.md §1.1。
 * 每层是独立 <g class="nw-pet-layer">，外层定位、内层动画，互不覆盖 transform。
 */
export const PET_LAYERS = [
    { id: 'shadow', label: '底层投影', required: true, defaultVisible: true },
    { id: 'aura', label: '氛围光', required: false, defaultVisible: false },
    { id: 'body', label: '主体形态', required: true, defaultVisible: true },
    { id: 'detail', label: '细节装饰', required: true, defaultVisible: true },
    { id: 'fx', label: '状态特效', required: false, defaultVisible: true },
] as const;

/** 图层 id */
export type PetLayerId = (typeof PET_LAYERS)[number]['id'];

/**
 * 宠物状态（6 档，对齐催更姬 pet-mood）。
 *
 * idle/happy/sleep 来自写作进度；writing/thinking/error 供生成链路复用。
 */
export type PetMood = 'idle' | 'happy' | 'sleep' | 'writing' | 'thinking' | 'error';

/**

/** 宠物角色（对齐催更姬 PetRole） */
export type PetRole = 'cuigengji' | 'bigfish';

/** 角色显示名 */
export const PET_ROLE_LABELS: Record<PetRole, string> = {
    cuigengji: '催更姬',
    bigfish: '大肥鱼',
};

/**
 * 角色雪碧图配置（催更姬同款切帧）。
 *
 * - cuigengji：2×2，idle 左上 / writing·sleep 右上 / happy 左下 / thinking·error 右下
 * - bigfish：3×2，idle 左上 / thinking 中上 / writing 右上 / happy 左下 / sleep 中下 / error 右下
 */
export const PET_ROLE_SHEETS: Record<PetRole, {
    dataUrl: string;
    cols: number;
    rows: number;
    frames: Record<PetMood, { col: number; row: number }>;
}> = {
    cuigengji: {
        dataUrl: PET_POSE_SHEET_CUIGENGJI,
        cols: 2,
        rows: 2,
        frames: {
            idle: { col: 0, row: 0 },
            writing: { col: 1, row: 0 },
            sleep: { col: 1, row: 0 },
            happy: { col: 0, row: 1 },
            thinking: { col: 1, row: 1 },
            error: { col: 1, row: 1 },
        },
    },
    bigfish: {
        dataUrl: PET_POSE_SHEET_BIGFISH,
        cols: 3,
        rows: 2,
        frames: {
            idle: { col: 0, row: 0 },
            thinking: { col: 1, row: 0 },
            writing: { col: 2, row: 0 },
            happy: { col: 0, row: 1 },
            sleep: { col: 1, row: 1 },
            error: { col: 2, row: 1 },
        },
    },
};

/** 当前角色雪碧图（默认催更姬） */
export const PET_POSE_SHEET = { cols: PET_ROLE_SHEETS.cuigengji.cols, rows: PET_ROLE_SHEETS.cuigengji.rows } as const;

/** 状态 → 雪碧图帧（默认角色；换角色后以 PET_ROLE_SHEETS[role].frames 为准） */
export const PET_POSE_FRAMES: Record<PetMood, { col: number; row: number }> = PET_ROLE_SHEETS.cuigengji.frames;

/**
 * 计算某状态在雪碧图中的帧坐标（百分比，供 background-position）。
 *
 * @param mood - 宠物状态
 * @param role - 宠物角色（决定用哪张雪碧图与帧排布；默认催更姬）
 * @returns 0–100 的 x/y 百分比
 */
export function poseFrameFor(
    mood: PetMood,
    role: PetRole = 'cuigengji',
): { xPercent: number; yPercent: number } {
    const sheet = PET_ROLE_SHEETS[role] ?? PET_ROLE_SHEETS.cuigengji;
    const frame = sheet.frames[mood] ?? sheet.frames.idle;
    const cols = Math.max(1, sheet.cols);
    const rows = Math.max(1, sheet.rows);
    return {
        xPercent: cols > 1 ? (frame.col / (cols - 1)) * 100 : 0,
        yPercent: rows > 1 ? (frame.row / (rows - 1)) * 100 : 0,
    };
}

/** 分层 SVG：5 层，外层 <g class="nw-pet-layer"> 定位、内层 .nw-pet-anim 动画 */
const PET_SVG = `
<svg class="nw-pet-svg" viewBox="0 0 120 110" role="img" aria-hidden="true" focusable="false">
    <g class="nw-pet-layer nw-pet-layer--shadow nw-is-layer-visible" data-layer="shadow">
        <g class="nw-pet-anim nw-pet-anim--shadow"><ellipse class="nw-pet-shadow" cx="60" cy="101" rx="34" ry="6"/></g>
    </g>
    <g class="nw-pet-layer nw-pet-layer--aura" data-layer="aura">
        <g class="nw-pet-anim nw-pet-anim--aura"><circle class="nw-pet-aura" cx="60" cy="62" r="44"/></g>
    </g>
    <g class="nw-pet-layer nw-pet-layer--body nw-is-layer-visible" data-layer="body">
        <g class="nw-pet-anim nw-pet-anim--body">
            <path class="nw-pet-tail" d="M92 84c14 2 20-8 16-17-3-7-12-8-15-2"/>
            <ellipse class="nw-pet-body" cx="60" cy="78" rx="30" ry="22"/>
            <ellipse class="nw-pet-paw" cx="44" cy="96" rx="9" ry="5"/>
            <ellipse class="nw-pet-paw" cx="76" cy="96" rx="9" ry="5"/>
            <path class="nw-pet-ear" d="M32 30l6-16 15 9z"/>
            <path class="nw-pet-ear" d="M88 30l-6-16-15 9z"/>
            <ellipse class="nw-pet-head" cx="60" cy="40" rx="30" ry="26"/>
        </g>
    </g>
    <g class="nw-pet-layer nw-pet-layer--detail nw-is-layer-visible" data-layer="detail">
        <g class="nw-pet-anim nw-pet-anim--detail">
            <ellipse class="nw-pet-eye" cx="49" cy="38" rx="3.6" ry="4.6"/>
            <ellipse class="nw-pet-eye" cx="71" cy="38" rx="3.6" ry="4.6"/>
            <path class="nw-pet-mouth" d="M55 49c2 3 8 3 10 0"/>
            <line class="nw-pet-whisker" x1="30" y1="42" x2="42" y2="44"/>
            <line class="nw-pet-whisker" x1="30" y1="49" x2="42" y2="49"/>
            <line class="nw-pet-whisker" x1="90" y1="42" x2="78" y2="44"/>
            <line class="nw-pet-whisker" x1="90" y1="49" x2="78" y2="49"/>
            <path class="nw-pet-pen" d="M84 60l9-9 5 5-9 9-6 1z"/>
        </g>
    </g>
    <g class="nw-pet-layer nw-pet-layer--fx nw-is-layer-visible" data-layer="fx">
        <g class="nw-pet-anim nw-pet-anim--fx">
            <text class="nw-pet-zzz" x="86" y="26">z</text>
            <text class="nw-pet-spark" x="34" y="24">✦</text>
        </g>
    </g>
</svg>`;

/**
 * WritingPet 类。
 */
export class WritingPet {
    private deps: WritingPetDeps;
    private root: HTMLElement | null = null;
    private bubbleMain: HTMLElement | null = null;
    private bubbleSub: HTMLElement | null = null;
    private card: HTMLElement | null = null;
    private mood: PetMood = 'idle';
    /** 当前宠物角色（持久化在 plugin.settings.petRole） */
    private role: PetRole = 'cuigengji';
    private expanded = false;
    private dragging = false;
    private moved = false;
    private dragStart = { x: 0, y: 0 };
    private origin = { x: 0, y: 0 };
    private pulseTimer: ReturnType<typeof setTimeout> | null = null;
    /** 快捷摘要自动刷新定时器（60s；文档隐藏时跳过） */
    private refreshTimer: number | null = null;
    private boundMove = (e: PointerEvent) => this.onPointerMove(e);
    private boundUp = () => this.onPointerUp();
    /** 拖拽期间 document 级监听的解绑器（绑在宠物所属窗口） */
    private dragDisposers: Array<() => void> = [];

    constructor(deps: WritingPetDeps) {
        this.deps = deps;
        const savedRole = (deps.plugin.settings as { petRole?: PetRole }).petRole;
        this.role = savedRole === 'bigfish' ? 'bigfish' : 'cuigengji';
    }

    /**
     * 切换宠物角色（催更姬 / 大肥鱼），并持久化到插件设置。
     *
     * @param role - 目标角色
     */
    async setRole(role: PetRole): Promise<void> {
        if (this.role === role) return;
        this.role = role;
        (this.deps.plugin.settings as { petRole?: PetRole }).petRole = role;
        await this.deps.plugin.saveSettings();
        if (!this.root) return;
        const sheet = PET_ROLE_SHEETS[role] ?? PET_ROLE_SHEETS.cuigengji;
        const pose = this.root.querySelector('.nw-pet-pose') as HTMLElement | null;
        if (pose) {
            pose.style.backgroundImage = `url(${sheet.dataUrl})`;
            pose.style.backgroundSize = `${sheet.cols * 100}% ${sheet.rows * 100}%`;
        }
        this.applyFrame();
    }

    /** 把当前状态对应的帧坐标写入 CSS 变量 */
    private applyFrame(): void {
        if (!this.root) return;
        const frame = poseFrameFor(this.mood, this.role);
        this.root.style.setProperty('--nw-pet-frame-x', `${frame.xPercent}%`);
        this.root.style.setProperty('--nw-pet-frame-y', `${frame.yPercent}%`);
    }

    /**
     * 设置某图层可见性。
     *
     * 必需层（shadow/body/detail）关掉会破坏形态，但仍允许关闭以便排查；
     * 可选层（aura/fx）关闭不影响识别。
     *
     * @param layer - 图层 id
     * @param visible - 是否可见
     */
    setLayerVisible(layer: PetLayerId, visible: boolean): void {
        if (!this.root) return;
        this.root.querySelectorAll(`.nw-pet-layer[data-layer="${layer}"]`).forEach((element) => {
            element.toggleClass('nw-is-layer-visible', visible);
        });
    }

    get isMounted(): boolean {
        return !!this.root && this.root.isConnected;
    }

    /**
     * 挂载。
     */
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
        // 浮动动画放在内层 HTML 容器：外层是点击/拖拽目标，必须保持几何稳定。
        const floatWrap = petBody.createDiv({ cls: 'nw-pet-float' });
        // 催更姬同款切帧：单图 + background-position（帧坐标由 applyFrame 写入 --nw-pet-frame-*）
        const sheet = PET_ROLE_SHEETS[this.role] ?? PET_ROLE_SHEETS.cuigengji;
        const pose = floatWrap.createDiv({ cls: 'nw-pet-pose', attr: { 'aria-hidden': 'true' } });
        pose.style.backgroundImage = `url(${sheet.dataUrl})`;
        pose.style.backgroundSize = `${sheet.cols * 100}% ${sheet.rows * 100}%`;
        // 窗口/可视区尺寸变化后重新钳制，避免宠物被留在屏幕外
        const handleViewportChange = (): void => {
            if (!this.root || this.dragging) return;
            const rect = this.root.getBoundingClientRect();
            this.placeAt(rect.left, rect.top);
        };
        const disposer = onNodeDoc(root, 'resize', handleViewportChange);
        this.dragDisposers.push(disposer);
        window.visualViewport?.addEventListener('resize', handleViewportChange);
        this.dragDisposers.push(() => window.visualViewport?.removeEventListener('resize', handleViewportChange));

        petBody.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        petBody.addEventListener('click', () => {
            if (this.moved) return;
            this.toggleCard();
        });
        petBody.addEventListener('dblclick', () => this.deps.openStats());
        petBody.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.openRoleMenu(petBody);
        });
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
        this.card.addClass('nw-u-d-none');
        this.update();

        // 快捷摘要自动刷新：写作中数字实时变化（60s；隐藏标签页跳过，避免无谓计算）
        if (!this.refreshTimer) {
            this.refreshTimer = window.setInterval(() => {
                if (document.hidden) return;
                this.update();
            }, 60_000);
        }
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

        const nextMood: PetMood = today <= 0
            ? 'sleep'
            : (target > 0 && today >= target ? 'happy' : 'idle');
        this.setMood(nextMood);

        if (this.card) this.renderCard(summary, target, ratio);
    }

    /**
     * 写完一章：短促的开心动作（不改心情，只是动一下）
     *
     * @param delta - 增量
     */
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

    /**
     * 销毁。
     */
    destroy(): void {
        if (this.pulseTimer) {
            clearTimeout(this.pulseTimer);
            this.pulseTimer = null;
        }
        this.disposeDragListeners();
        this.root?.remove();
        this.root = null;
        this.bubbleMain = null;
        this.bubbleSub = null;
        this.card = null;
    }

    /** 释放拖拽期间的 document 级监听（同一文档解绑，避免重复绑定/泄漏） */
    private disposeDragListeners(): void {
        if (this.refreshTimer) {
            window.clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        for (const dispose of this.dragDisposers) dispose();
        this.dragDisposers = [];
    }

    private setMood(mood: PetMood): void {
        if (this.mood === mood || !this.root) return;
        this.mood = mood;
        this.root.removeClass('nw-is-idle', 'nw-is-happy', 'nw-is-sleep', 'nw-is-writing', 'nw-is-thinking', 'nw-is-error');
        this.root.setAttribute('data-pet-state', mood);
        this.root.addClass(`nw-is-${mood}`);
        this.applyFrame();
    }

    /**
     * 打开角色切换菜单（右键触发，对齐催更姬的右键操作）。
     *
     * @param anchor - 锚点元素
     */
    private openRoleMenu(anchor: HTMLElement): void {
        this.root?.querySelector('.nw-pet-role-menu')?.remove();
        const menu = anchor.createDiv({ cls: 'nw-pet-role-menu' });
        menu.createDiv({ cls: 'nw-pet-role-menu-title', text: '吸附边' });
        const snapRow = menu.createDiv({ cls: 'nw-pet-role-snap' });
        const currentSnap = (this.deps.plugin.settings as { petSnapEdges?: { left: boolean; right: boolean; bottom: boolean; threshold?: number } }).petSnapEdges
            ?? { left: true, right: true, bottom: true };
        for (const [edge, label] of [['left', '左'], ['right', '右'], ['bottom', '底']] as const) {
            const chip = snapRow.createEl('button', {
                cls: `nw-pet-snap-chip${currentSnap[edge] ? ' nw-is-active' : ''}`,
                text: label,
                attr: { type: 'button' },
            });
            chip.addEventListener('click', (event) => {
                event.stopPropagation();
                const next = { ...currentSnap, [edge]: !currentSnap[edge] };
                (this.deps.plugin.settings as { petSnapEdges?: typeof next }).petSnapEdges = next;
                void this.deps.plugin.saveSettings();
                chip.toggleClass('nw-is-active', next[edge]);
            });
        }

        menu.createDiv({ cls: 'nw-pet-role-menu-title', text: '桌宠形象' });
        // 用 onNodeDoc 绑定到宠物所在窗口，popout 窗口也能正确关闭
        let disposeOutside: (() => void) | null = null;
        const closeMenu = (): void => {
            menu.remove();
            disposeOutside?.();
            disposeOutside = null;
        };
        for (const role of Object.keys(PET_ROLE_LABELS) as PetRole[]) {
            const item = menu.createEl('button', {
                cls: `nw-pet-role-item${role === this.role ? ' nw-is-active' : ''}`,
                text: PET_ROLE_LABELS[role],
                attr: { type: 'button' },
            });
            item.addEventListener('click', (event) => {
                event.stopPropagation();
                void this.setRole(role);
                closeMenu();
            });
        }
        disposeOutside = onNodeDoc(menu, 'pointerdown', (event) => {
            if (menu.contains(event.target as Node)) return;
            closeMenu();
        }, true);
    }

    private toggleCard(): void {
        if (!this.card) return;
        this.expanded = !this.expanded;
        this.card.toggleClass('nw-u-d-none', !this.expanded);
        if (this.expanded) this.update();
    }

    private renderCard(summary: StatsSummary | null, target: number, ratio: number): void {
        if (!this.card) return;
        this.card.empty();
        const rows: Array<{ label: string; value: string }> = [
            { label: '今日', value: `${formatWords(summary?.today ?? 0)}${target > 0 ? ` / ${formatWords(target)}` : ''}` },
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
        const actions = this.card.createDiv({ cls: 'nw-pet-card-actions' });
        const addAction = (label: string, handler: () => void): void => {
            const button = actions.createEl('button', {
                cls: 'nw-pet-card-open',
                text: label,
                attr: { type: 'button' },
            });
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                handler();
            });
        };
        addAction('完整统计', () => this.deps.openStats());
        if (this.deps.openUsage) addAction('用量与成本', () => this.deps.openUsage?.());
    }

    private onPointerDown(event: PointerEvent): void {
        if ((event.target as HTMLElement)?.closest('button')) return;
        if (!this.root) return;
        this.dragging = true;
        this.moved = false;
        this.dragStart = { x: event.clientX, y: event.clientY };
        const rect = this.root.getBoundingClientRect();
        this.origin = { x: rect.left, y: rect.top };
        this.disposeDragListeners();
        this.dragDisposers = [
            onNodeDoc(this.root, 'pointermove', this.boundMove),
            onNodeDoc(this.root, 'pointerup', this.boundUp),
        ];
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
        this.disposeDragListeners();
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
