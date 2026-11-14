/**
 * pet-geometry.ts — 桌宠定位纯函数（边界钳制 / 边缘吸附）
 *
 * 参考催更姬 `features/pet/geometry.ts` 的做法，但适配本插件用 left/top 定位、
 * 且需要 popout 窗口与多屏可视区域（visualViewport）的差异。
 *
 * 纯函数：不碰 DOM、不依赖 Obsidian，方便单测。
 */

/** 桌宠左上角坐标（px，相对窗口） */
export interface PetPoint {
    x: number;
    y: number;
}

/** 可视区域（px，相对窗口左上角；right/bottom 为可视边界） */
export interface PetViewport {
    width: number;
    height: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** 桌宠与边缘的最小留白 */
export const PET_EDGE_MARGIN = 8;

/** 吸附边配置：哪些边允许吸附（默认三条都开） */
export interface PetSnapEdges {
    left: boolean;
    right: boolean;
    bottom: boolean;
}

/** 默认吸附边 */
export const PET_DEFAULT_SNAP_EDGES: PetSnapEdges = { left: true, right: true, bottom: true };

/** 拖拽松手后的吸附判定距离 */
export const PET_SNAP_THRESHOLD = 28;

/**
 * 把坐标钳制到可视区域内，保证桌宠完整可见。
 *
 * @param point - 目标坐标
 * @param view - 可视区域
 * @param size - 桌宠尺寸（正方形边长）
 * @returns 钳制后的坐标
 */
export function clampPetPoint(point: PetPoint, view: PetViewport, size: number): PetPoint {
    const minX = view.left + PET_EDGE_MARGIN;
    const maxX = Math.max(minX, view.right - size - PET_EDGE_MARGIN);
    const minY = view.top + PET_EDGE_MARGIN;
    const maxY = Math.max(minY, view.bottom - size - PET_EDGE_MARGIN);
    return {
        x: Math.max(minX, Math.min(maxX, point.x)),
        y: Math.max(minY, Math.min(maxY, point.y)),
    };
}

/**
 * 松手吸附：靠近左右边缘则贴边，靠近底部则贴底，否则只做边界钳制。
 *
 * 吸附距离内才生效，避免轻微拖动就被「吸走」。
 *
 * @param point - 松手坐标
 * @param view - 可视区域
 * @param size - 桌宠尺寸
 * @param threshold - 吸附判定距离（默认 PET_SNAP_THRESHOLD）
 * @param edges - 允许吸附的边（默认三条都开；可关闭左右或底部）
 * @returns 吸附后的坐标
 */
export function snapPetPoint(
    point: PetPoint,
    view: PetViewport,
    size: number,
    threshold: number = PET_SNAP_THRESHOLD,
    edges: PetSnapEdges = PET_DEFAULT_SNAP_EDGES,
): PetPoint {
    const clamped = clampPetPoint(point, view, size);
    const leftEdge = view.left + PET_EDGE_MARGIN;
    const rightEdge = view.right - size - PET_EDGE_MARGIN;
    const bottomEdge = view.bottom - size - PET_EDGE_MARGIN;
    let { x, y } = clamped;
    const limit = Math.max(0, threshold);
    if (edges.left && Math.abs(x - leftEdge) <= limit) x = leftEdge;
    else if (edges.right && Math.abs(x - rightEdge) <= limit) x = rightEdge;
    if (edges.bottom && Math.abs(y - bottomEdge) <= limit) y = bottomEdge;
    return { x, y };
}

/**
 * 由 window 尺寸与 visualViewport 偏移构造可视区域。
 *
 * @param innerWidth - 窗口宽
 * @param innerHeight - 窗口高
 * @param offset - visualViewport 偏移与尺寸（缺省视为无偏移、全窗口可见）
 * @returns 可视区域
 */
export function petViewportOf(
    innerWidth: number,
    innerHeight: number,
    offset?: { left?: number; top?: number; width?: number; height?: number },
): PetViewport {
    const left = Number.isFinite(offset?.left) ? Number(offset?.left) : 0;
    const top = Number.isFinite(offset?.top) ? Number(offset?.top) : 0;
    const width = Number.isFinite(offset?.width) && Number(offset?.width) > 0 ? Number(offset?.width) : innerWidth;
    const height = Number.isFinite(offset?.height) && Number(offset?.height) > 0 ? Number(offset?.height) : innerHeight;
    return {
        width: innerWidth,
        height: innerHeight,
        left,
        top,
        right: left + width,
        bottom: top + height,
    };
}
