/**
 * pet-image-model.ts — 桌宠自定义形象配置（纯函数）
 *
 * 设计前提：**插件不内置任何第三方美术资源**（版权/商用限制）。
 *  - 默认形象 = 代码绘制的分层 SVG（无版权风险）
 *  - 用户可指定自己的图片（vault 内 PNG/JPG/WebP），按网格切帧
 *
 * 雪碧图约定：状态按固定顺序排列，用户按 cols×rows 切分即可。
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
 * 计算某状态在雪碧图中的帧坐标（百分比，供 background-position）。
 *
 * 状态顺序见 PET_IMAGE_MOOD_ORDER；超出网格的索引回落到 0。
 *
 * @param mood - 宠物状态
 * @param config - 图片配置
 * @returns 0–100 的 x/y 百分比
 */
export function poseFrameFor(mood: string, config: PetImageConfig): { xPercent: number; yPercent: number } {
    const cols = Math.max(1, Math.floor(config.cols));
    const rows = Math.max(1, Math.floor(config.rows));
    const index = Math.max(0, PET_IMAGE_MOOD_ORDER.indexOf(mood));
    const cell = index % (cols * rows);
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    return {
        xPercent: cols > 1 ? (col / (cols - 1)) * 100 : 0,
        yPercent: rows > 1 ? (row / (rows - 1)) * 100 : 0,
    };
}

/**
 * 切帧方式说明（设置页提示用）。
 *
 * @param config - 图片配置
 * @returns 说明文本
 */
export function describePetImageConfig(config: PetImageConfig): string {
    const from = config.source === 'file' ? '本机图片' : `vault：${config.path ?? ''}`;
    return `${from} · ${config.cols}×${config.rows} 网格 · 状态顺序：${PET_IMAGE_MOOD_ORDER.join(' / ')}`;
}
