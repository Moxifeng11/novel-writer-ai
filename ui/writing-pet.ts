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

import { Notice } from 'obsidian';
import { t } from '@/i18n';
import type NovelWriterPlugin from '@/main';
import { formatWords, type StatsSummary } from '@/shared/writing-stats';
import { setSanitizedHtml } from '@/ui/rendering/safe-html';
import {
    normalizePetImageConfig,
    poseFrameFor,
    type PetImageConfig,
} from '@/shared/pet-image-model';
import { getDegradationNotifier } from '@/shared/degradation-notifier';
import {
    getActivePetActivity,
    markPetActivity,
    subscribePetActivity,
    type PetActivityKind,
} from '@/shared/pet-activity';
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
    { id: 'shadow', label: t('fullwriter.pet.layerShadow'), required: true, defaultVisible: true },
    { id: 'aura', label: t('fullwriter.pet.layerAura'), required: false, defaultVisible: false },
    { id: 'body', label: t('fullwriter.pet.layerBody'), required: true, defaultVisible: true },
    { id: 'detail', label: t('fullwriter.pet.layerDetail'), required: true, defaultVisible: true },
    { id: 'fx', label: t('fullwriter.pet.layerFx'), required: false, defaultVisible: true },
] as const;

/** 图层 id */
export type PetLayerId = (typeof PET_LAYERS)[number]['id'];

/**
 * 宠物状态（6 档，对齐催更姬 pet-mood）。
 *
 * idle/happy/sleep 来自写作进度；writing/thinking/error 供生成链路复用。
 */
export type PetMood = 'idle' | 'happy' | 'sleep' | 'writing' | 'thinking' | 'error';

/** 运行时活动 → 宠物状态（纯映射，便于测试与复用） */
export const PET_ACTIVITY_MOOD: Record<PetActivityKind, PetMood> = {
    writing: 'writing',
    thinking: 'thinking',
    happy: 'happy',
    error: 'error',
};

/**
 * 合成宠物图片配置：settings 里本机图片只存元数据（cols/rows），
 * 图片本体由插件启动时从插件目录回读到运行时字段。
 *
 * @param deps - 宠物依赖（plugin 提供运行时 dataUrl）
 * @returns 配置或 null
 * @example
 * ```ts
 * const config = resolvePetImageConfig(deps);
 * // settings.petImage={source:'file',cols:2,rows:2} + 运行时有图 → 返回带 dataUrl 的配置
 * ```
 */
export function resolvePetImageConfig(deps: WritingPetDeps): PetImageConfig | null {
    const config = normalizePetImageConfig((deps.plugin.settings as { petImage?: unknown }).petImage);
    if (!config || config.source !== 'file' || config.dataUrl) return config;
    const runtime = deps.plugin.getPetImageRuntimeDataUrl?.() ?? null;
    return runtime ? { ...config, dataUrl: runtime } : config;
}

/**
 * 把运行时活动映射为宠物状态（无活动返回 null，由调用方回落字数状态）。
 *
 * @param kind - 活动类型
 * @returns 宠物状态或 null
 * @example
 * ```ts
 * moodForPetActivity('thinking'); // 'thinking'
 * moodForPetActivity(null);       // null
 * ```
 */
export function moodForPetActivity(kind: PetActivityKind | null): PetMood | null {
    if (!kind) return null;
    return PET_ACTIVITY_MOOD[kind];
}

/**


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
/**
 * 由今日进度决定基础情绪。
 *
 * @param today - 今日字数
 * @param target - 每日目标（0 表示未设目标）
 * @returns 基础情绪
 */
export function moodForProgress(today: number, target: number): PetMood {
    if (today <= 0) return 'sleep';
    if (target > 0 && today >= target) return 'happy';
    return 'idle';
}

/**
 * 今日字数是否比上次观测增加（用于「写完一段就庆祝」）。
 *
 * @param previous - 上次观测的今日字数（null 表示首次观测）
 * @param current - 本次今日字数
 * @returns 应当庆祝返回 true
 */
export function shouldCelebrate(previous: number | null, current: number): boolean {
    return previous !== null && current > previous;
}

/**
 * WritingPet 类（桌面宠物：分层/切帧/拖拽/快捷摘要/情绪联动）。
 */
export class WritingPet {
    private deps: WritingPetDeps;
    private root: HTMLElement | null = null;
    private bubbleMain: HTMLElement | null = null;
    private bubbleSub: HTMLElement | null = null;
    private card: HTMLElement | null = null;
    private mood: PetMood = 'idle';
    /** 瞬态情绪（写完/降级时短暂覆盖基础情绪） */
    private transientMood: { mood: PetMood; until: number } | null = null;
    /** 上次观测的今日字数（用于检测「刚写了字」） */
    private lastToday: number | null = null;
    /** 降级事件订阅的取消函数 */
    private disposeDegradationSink: (() => void) | null = null;
    /** 用户自定义形象（settings.petImage；null = 内置分层 SVG） */
    private imageConfig: PetImageConfig | null = null;
    private expanded = false;
    private dragging = false;
    private moved = false;
    private dragStart = { x: 0, y: 0 };
    private origin = { x: 0, y: 0 };
    private pulseTimer: ReturnType<typeof setTimeout> | null = null;
    /** 快捷摘要自动刷新定时器（60s；文档隐藏时跳过） */
    private refreshTimer: number | null = null;
    /** 运行时活动订阅（写作/AI 思考/完成/出错 → 切对应帧） */
    private disposeActivity: (() => void) | null = null;
    /** 活动轮询定时器（TTL 过期后回到常规状态） */
    private activityTimer: number | null = null;
    /** 上次展示的运行时活动（避免重复切帧） */
    private lastActivity: PetActivityKind | null = null;
    private boundMove = (e: PointerEvent) => this.onPointerMove(e);
    private boundUp = () => this.onPointerUp();
    /** 拖拽期间 document 级监听的解绑器（绑在宠物所属窗口） */
    private dragDisposers: Array<() => void> = [];

    constructor(deps: WritingPetDeps) {
        this.deps = deps;
        this.imageConfig = resolvePetImageConfig(deps);
    }

    /**
     * 设置自定义形象（null = 回到内置分层 SVG）。
     *
     * @param config - 图片配置或 null
     */
    async setImage(config: PetImageConfig | null): Promise<void> {
        this.imageConfig = config;
        (this.deps.plugin.settings as { petImage?: PetImageConfig }).petImage = config ?? undefined;
        await this.deps.plugin.saveSettings();
        if (!this.root) return;
        // 重建宠物主体（切 SVG ↔ 图片是结构变化，直接重挂最稳）
        this.destroy();
        this.mount();
        this.update();
    }

    /**
     * 短暂切换情绪（如写完一段 → 庆祝；降级 → 出错），到期自动回到基础情绪。
     *
     * @param mood - 目标情绪
     * @param durationMs - 持续毫秒（默认 4s）
     */
    flashMood(mood: PetMood, durationMs = 4000): void {
        if (!this.isMounted) return;
        this.transientMood = { mood, until: Date.now() + Math.max(500, durationMs) };
        this.setMood(mood);
        window.setTimeout(() => {
            if (!this.transientMood) return;
            if (Date.now() < this.transientMood.until) return;
            this.transientMood = null;
            this.update();
        }, Math.max(500, durationMs) + 60);
    }

    /** 把当前状态对应的格子坐标写入 CSS 变量（每格 = 一个状态） */
    private applyFrame(): void {
        if (!this.root) return;
        if (!this.imageConfig) return;
        const frame = poseFrameFor(this.mood, this.imageConfig);
        this.root.style.setProperty('--nw-pet-frame-x', `${frame.xPercent}%`);
        this.root.style.setProperty('--nw-pet-frame-y', `${frame.yPercent}%`);
    }

    /** 运行时活动 → 宠物状态映射（引用共享纯函数） */
    private static readonly ACTIVITY_MOOD: Record<PetActivityKind, PetMood> = PET_ACTIVITY_MOOD;

    /**
     * 订阅运行时活动：写作 / AI 思考 / 刚完成 / 出错 → 切对应帧。
     *
     * 这是「识别正在运行的功能」的入口：各层只往 shared/pet-activity 打标记，
     * 宠物据此换帧；标记过期后回落到字数驱动的常规状态。
     */
    private subscribeActivities(): void {
        if (this.disposeActivity) return;
        this.disposeActivity = subscribePetActivity((kind) => {
            this.lastActivity = kind;
            if (!this.isMounted) return;
            if (kind) this.setMood(WritingPet.ACTIVITY_MOOD[kind]);
            else this.update();
        });
        // TTL 过期没有事件：每秒轮询一次活动，变化时切换（成本可忽略）
        if (!this.activityTimer) {
            this.activityTimer = window.setInterval(() => {
                if (!this.isMounted) return;
                const kind = getActivePetActivity();
                if (kind === this.lastActivity) return;
                this.lastActivity = kind;
                if (kind) this.setMood(WritingPet.ACTIVITY_MOOD[kind]);
                else this.update();
            }, 1000);
        }
    }

    /** 取消活动订阅与轮询 */
    private disposeActivities(): void {
        this.disposeActivity?.();
        this.disposeActivity = null;
        if (this.activityTimer) {
            window.clearInterval(this.activityTimer);
            this.activityTimer = null;
        }
        this.lastActivity = null;
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
            attr: { role: 'button', tabindex: '0', 'aria-label': t('fullwriter.pet.ariaMain') },
        });
        // 浮动动画放在内层 HTML 容器：外层是点击/拖拽目标，必须保持几何稳定。
        const floatWrap = petBody.createDiv({ cls: 'nw-pet-float' });
        if (this.imageConfig) {
            // 用户自定义形象：单图切帧（帧坐标由 applyFrame 写入 --nw-pet-frame-*）
            const resource = this.imageConfig.source === 'file'
                ? (this.imageConfig.dataUrl
                    ?? this.deps.plugin.getPetImageRuntimeDataUrl?.()
                    ?? '')
                : this.deps.plugin.app.vault.adapter.getResourcePath(this.imageConfig.path ?? '');
            const pose = floatWrap.createDiv({ cls: 'nw-pet-pose', attr: { 'aria-hidden': 'true' } });
            pose.style.backgroundImage = `url(${resource})`;
            pose.style.backgroundSize = `${this.imageConfig.cols * 100}% ${this.imageConfig.rows * 100}%`;
        } else {
            // 内置形象：代码绘制的分层 SVG（无第三方美术资源）
            setSanitizedHtml(floatWrap, PET_SVG);
        }
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
            attr: { type: 'button', 'aria-label': t('fullwriter.pet.ariaHide') },
        });
        close.addEventListener('click', (event) => {
            event.stopPropagation();
            this.deps.hide();
            this.destroy();
        });

        this.card = root.createDiv({ cls: 'nw-pet-card' });
        this.card.addClass('nw-u-d-none');
        this.update();
        this.subscribeActivities();

        // 陪伴层用量联动：降级/失败事件 → 宠物短暂「出错」表情
        if (!this.disposeDegradationSink) {
            this.disposeDegradationSink = getDegradationNotifier().registerSink((event) => {
                if (event.severity === 'critical' || event.severity === 'warning') {
                    markPetActivity('error', 5000);
                    this.flashMood('error', 5000);
                }
            });
        }

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
            this.bubbleMain.setText(today > 0 ? t('fullwriter.pet.bubbleToday', { words: formatWords(today) }) : t('fullwriter.pet.bubbleNoWrite'));
        }
        if (this.bubbleSub) {
            if (target > 0) {
                this.bubbleSub.setText(t('fullwriter.pet.bubbleProgress', { pct: Math.round(ratio * 100), target: formatWords(target) }));
            } else {
                this.bubbleSub.setText(t('fullwriter.pet.bubbleTip'));
            }
        }

        // 正在运行的功能优先于字数状态：写作/AI 思考/完成/出错 时显示对应帧
        const activityMood = moodForPetActivity(getActivePetActivity());
        const nextMood: PetMood = activityMood ?? (today <= 0
            ? 'sleep'
            : (target > 0 && today >= target ? 'happy' : 'idle'));
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
        this.disposeActivities();
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
        this.disposeDegradationSink?.();
        this.disposeDegradationSink = null;
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
        menu.createDiv({ cls: 'nw-pet-role-menu-title', text: t('fullwriter.pet.snapEdge') });
        const snapRow = menu.createDiv({ cls: 'nw-pet-role-snap' });
        const currentSnap = (this.deps.plugin.settings as { petSnapEdges?: { left: boolean; right: boolean; bottom: boolean; threshold?: number } }).petSnapEdges
            ?? { left: true, right: true, bottom: true };
        for (const [edge, label] of [['left', t('fullwriter.pet.edgeLeft')], ['right', t('fullwriter.pet.edgeRight')], ['bottom', t('fullwriter.pet.edgeBottom')]] as const) {
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

        menu.createDiv({ cls: 'nw-pet-role-menu-title', text: t('fullwriter.pet.imageTitle') });
        // 用 onNodeDoc 绑定到宠物所在窗口，popout 窗口也能正确关闭
        let disposeOutside: (() => void) | null = null;
        const closeMenu = (): void => {
            menu.remove();
            disposeOutside?.();
            disposeOutside = null;
        };
        const current = this.imageConfig ? 'custom' : 'builtin';
        for (const [value, label] of [['builtin', t('fullwriter.pet.sourceBuiltin')], ['custom', t('fullwriter.pet.sourceCustom')]] as const) {
            const item = menu.createEl('button', {
                cls: `nw-pet-role-item${value === current ? ' nw-is-active' : ''}`,
                text: label,
                attr: { type: 'button' },
            });
            item.addEventListener('click', (event) => {
                event.stopPropagation();
                if (value === 'builtin') {
                    void this.setImage(null);
                } else if (!this.imageConfig) {
                    new Notice(t('fullwriter.pet.needCustomImage'));
                }
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
            { label: t('fullwriter.pet.popToday'), value: `${formatWords(summary?.today ?? 0)}${target > 0 ? ` / ${formatWords(target)}` : ''}` },
            { label: t('fullwriter.pet.popWeek'), value: formatWords(summary?.week ?? 0) },
            { label: t('fullwriter.pet.popMonth'), value: formatWords(summary?.month ?? 0) },
            { label: t('fullwriter.pet.popTotal'), value: formatWords(summary?.total ?? 0) },
            { label: t('fullwriter.pet.popStreak'), value: t('fullwriter.pet.popStreakValue', { count: summary?.streak ?? 0 }) },
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
        addAction(t('fullwriter.pet.actionFullStats'), () => this.deps.openStats());
        if (this.deps.openUsage) addAction(t('fullwriter.pet.actionUsage'), () => this.deps.openUsage?.());
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
