/**
 * pet-image-model.ts — 桌宠自定义形象配置（纯函数）
 *
 * 设计前提：**插件不内置任何第三方美术资源**（版权/商用限制）。
 *  - 默认形象 = 代码绘制的分层 SVG（无版权风险）
 *  - 用户可指定自己的图片（vault 内 PNG/JPG/WebP），按网格切帧
 *
 * 雪碧图约定（v2，支持动画）：
 *  - **行 = 状态**：按 PET_IMAGE_MOOD_ORDER 自上而下（行数不足时后面的状态共用最后一行）
 *  - **列 = 动画帧**：同一状态的连续帧，桌宠会自动循环播放
 *  - 网格可由图片尺寸自动识别（detectPetGrid），也可手动覆盖
 */

/** 桌宠图片配置 */
export interface PetImageConfig {
    /**
     * 图片来源：
     * - `vault`：vault 内相对路径（`path`）
     * - `file`：从本机任意位置选择的图片，已压缩为 data URL（`dataUrl`）
     */
    source: 'vault' | 'file';
    /** vault 相对路径（source=vault 时必填） */
    path?: string;
    /** 本机图片的 data URL（source=file 时必填） */
    dataUrl?: string;
    /** 网格列数 */
    cols: number;
    /** 网格行数 */
    rows: number;
}

/** 支持的图片扩展名 */
export const PET_IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/** 默认网格（2×2） */
export const PET_IMAGE_DEFAULT_COLS = 2;
/** 默认网格行数 */
export const PET_IMAGE_DEFAULT_ROWS = 2;

/**
 * 状态在雪碧图中的排列顺序（用户按此顺序准备帧）。
 */
export const PET_IMAGE_MOOD_ORDER: readonly string[] = [
    'idle', 'writing', 'thinking', 'happy', 'sleep', 'error',
];

/**
 * 路径是否是可用的图片。
 *
 * @param path - vault 相对路径
 * @returns 可用返回 true
 */
export function isSupportedImagePath(path: string): boolean {
    const lower = String(path || '').trim().toLowerCase();
    if (!lower) return false;
    return PET_IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * 是否是合法的图片 data URL。
 *
 * @param value - 待检查字符串
 * @returns 合法返回 true
 */
export function isImageDataUrl(value: string): boolean {
    return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(String(value || '').trim());
}

/**
 * 规范化用户输入的配置；非法返回 null。
 *
 * @param raw - 原始配置（可能来自设置）
 * @returns 规范化配置或 null
 */
export function normalizePetImageConfig(raw: unknown): PetImageConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const input = raw as Partial<PetImageConfig>;
    const cols = Number(input.cols);
    const rows = Number(input.rows);
    const grid = {
        cols: Number.isFinite(cols) && cols >= 1 && cols <= 8 ? Math.floor(cols) : PET_IMAGE_DEFAULT_COLS,
        rows: Number.isFinite(rows) && rows >= 1 && rows <= 8 ? Math.floor(rows) : PET_IMAGE_DEFAULT_ROWS,
    };
    // 本机图片（data URL）优先；否则回落到 vault 路径
    const dataUrl = String(input.dataUrl ?? '').trim();
    if (input.source === 'file' || (dataUrl && isImageDataUrl(dataUrl))) {
        return isImageDataUrl(dataUrl) ? { source: 'file', dataUrl, ...grid } : null;
    }
    const path = String(input.path ?? '').trim();
    if (!isSupportedImagePath(path)) return null;
    return { source: 'vault', path, ...grid };
}

/**
 * 状态对应的行号（行 = 状态；行数不足时后面的状态共用最后一行）。
 *
 * @param mood - 宠物状态
 * @param rows - 网格行数
 * @returns 行号（0 起）
 * @example
 * ```ts
 * petMoodRow('writing', 6); // 1
 * petMoodRow('error', 2);   // 1（行数不足钳到最后一行）
 * ```
 */
export function petMoodRow(mood: string, rows: number): number {
    const total = Math.max(1, Math.floor(rows));
    const index = PET_IMAGE_MOOD_ORDER.indexOf(mood);
    const safeIndex = index >= 0 ? index : 0;
    return Math.min(safeIndex, total - 1);
}

/**
 * 计算某状态的某一动画帧坐标（百分比，供 background-position）。
 *
 * 列 = 动画帧，行 = 状态；帧号超出列数时回绕。
 *
 * @param mood - 宠物状态
 * @param frame - 动画帧序号（0 起）
 * @param config - 图片配置
 * @returns 0–100 的 x/y 百分比
 * @example
 * ```ts
 * petFramePosition('idle', 1, { source: 'file', dataUrl, cols: 3, rows: 2 });
 * // { xPercent: 50, yPercent: 0 }
 * ```
 */
export function petFramePosition(
    mood: string,
    frame: number,
    config: PetImageConfig,
): { xPercent: number; yPercent: number } {
    const cols = Math.max(1, Math.floor(config.cols));
    const rows = Math.max(1, Math.floor(config.rows));
    const frameIndex = ((Math.floor(Number(frame) || 0) % cols) + cols) % cols;
    const row = petMoodRow(mood, rows);
    return {
        xPercent: cols > 1 ? (frameIndex / (cols - 1)) * 100 : 0,
        yPercent: rows > 1 ? (row / (rows - 1)) * 100 : 0,
    };
}

/**
 * 兼容旧调用：返回该状态第 0 帧的坐标。
 *
 * @param mood - 宠物状态
 * @param config - 图片配置
 * @returns 0–100 的 x/y 百分比
 */
export function poseFrameFor(mood: string, config: PetImageConfig): { xPercent: number; yPercent: number } {
    return petFramePosition(mood, 0, config);
}

/**
 * 某状态播放动画的帧间隔（毫秒）；不同状态节奏不同。
 *
 * @param mood - 宠物状态
 * @returns 帧间隔（毫秒）
 * @example
 * ```ts
 * window.setInterval(tick, petAnimationIntervalMs('writing')); // 130ms
 * ```
 */
export function petAnimationIntervalMs(mood: string): number {
    switch (mood) {
        case 'writing': return 130;
        case 'happy': return 110;
        case 'thinking': return 220;
        case 'sleep': return 420;
        case 'error': return 180;
        default: return 260;
    }
}

/**
 * 根据图片尺寸自动识别网格。
 *
 * 思路：优先让「单帧尽量接近正方形」，再在候选里挑帧数合理、单帧不碎的那组；
 * 正方形图片按 2×2（最常见的 2 状态×2 帧）处理，单帧图（尺寸不够切）回落 1×1。
 * 识别不准时用户可在设置里手动改，或点「自动识别网格」重试。
 *
 * @param width - 图片像素宽
 * @param height - 图片像素高
 * @returns 识别出的网格列/行
 * @example
 * ```ts
 * detectPetGrid(1536, 1024); // { cols: 3, rows: 2 }
 * ```
 */
export function detectPetGrid(width: number, height: number): { cols: number; rows: number } {
    const w = Math.floor(Number(width) || 0);
    const h = Math.floor(Number(height) || 0);
    if (w < 64 || h < 64) return { cols: 1, rows: 1 };
    // 正方形图片：宠物图最常见的排法是 2×2（2 状态 × 2 帧）；太小则按单帧
    if (w === h) {
        if (w >= 256 && w % 2 === 0) return { cols: 2, rows: 2 };
        return { cols: 1, rows: 1 };
    }

    const candidates: Array<{ cols: number; rows: number; score: number }> = [];
    for (let cols = 1; cols <= 8; cols += 1) {
        for (let rows = 1; rows <= 8; rows += 1) {
            const cellW = w / cols;
            const cellH = h / rows;
            if (!Number.isInteger(cellW) || !Number.isInteger(cellH)) continue;
            if (cellW < 64 || cellH < 64) continue;
            const aspectPenalty = Math.abs(Math.log(cellW / cellH)); // 0 = 正方形单帧
            const total = cols * rows;
            // 帧数过半的候选（>12）通常是把图切太碎
            const totalPenalty = total > 12 ? (total - 12) * 0.35 : 0;
            candidates.push({ cols, rows, score: aspectPenalty * 3 + totalPenalty });
        }
    }
    if (candidates.length === 0) return { cols: 1, rows: 1 };

    // 完全正方形单帧候选（1×1）只在图片本身不足两倍单帧尺寸时优先
    const sorted = candidates.sort((a, b) => a.score - b.score || b.cols * b.rows - a.cols * a.rows);
    const best = sorted[0];

    // 正方形图片：若最佳候选是 1×1，但图片足够大（≥256），按 2×2 处理（动画更常见）
    if (w === h && best.cols === 1 && best.rows === 1 && w >= 256) {
        return { cols: 2, rows: 2 };
    }
    // 单帧超大图（1×1 与 2×2 都“方形”）但宽度不是 2 的倍数等情况已在候选过滤里处理
    return { cols: best.cols, rows: best.rows };
}

/**
 * 切帧方式说明（设置页提示用）。
 *
 * @param config - 图片配置
 * @returns 说明文本
 */
export function describePetImageConfig(config: PetImageConfig): string {
    const from = config.source === 'file' ? '本机图片' : `vault：${config.path ?? ''}`;
    return `${from} · ${config.cols} 帧 × ${config.rows} 状态 · 状态自上而下：${PET_IMAGE_MOOD_ORDER.join(' / ')}`;
}
