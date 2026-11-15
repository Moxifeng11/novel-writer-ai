/**
 * rhythm-baseline-model.ts — 节奏基准推导与偏离检测（纯函数）
 *
 * 原实现：只有规划里显式写「节奏：快/中/慢」才检测，未标注则永不检测。
 * 这里从情绪曲线（逐场景强度）推导基准，让未标注章节也能检测节奏偏离。
 */

/** 场景强度 */
export interface SceneIntensity {
    /** 场景序号 */
    index: number;
    /** 强度 0–100 */
    intensity: number;
    /** 场景类型（可选） */
    kind?: string;
}

/** 节奏基准 */
export interface RhythmBaseline {
    /** 期望强度曲线（与输入同序） */
    expected: number[];
    /** 判定为「应当上升」的位置（场景序号） */
    risingPoints: number[];
    /** 判定为「应当回落」的位置 */
    fallingPoints: number[];
}

/** 节奏偏离 */
export interface RhythmDeviation {
    /** 场景序号 */
    index: number;
    /** 实际强度 */
    actual: number;
    /** 期望强度 */
    expected: number;
    /** 差值（实际-期望） */
    delta: number;
    /** 类型 */
    kind: 'flat' | 'spike' | 'drop' | 'no-hook';
    /** 说明 */
    message: string;
}

/**
 * 由强度序列推导节奏基准。
 *
 * 规则：整体应呈「波浪上升」——每 3 个场景一个小高潮，末端最高；
 * 相邻差过大（>35）提示断崖，过小（<5）提示平铺。
 *
 * @param scenes - 场景强度
 * @returns 基准
 */
export function deriveBaseline(scenes: readonly SceneIntensity[]): RhythmBaseline {
    const expected: number[] = [];
    const risingPoints: number[] = [];
    const fallingPoints: number[] = [];
    const total = scenes.length;
    for (let i = 0; i < total; i++) {
        const progress = total <= 1 ? 1 : i / (total - 1);
        // 基准：随进度上升，叠加 3 场一次的小起伏
        const wave = Math.sin((i + 1) * Math.PI / 3) * 8;
        expected.push(clamp(Math.round(35 + progress * 50 + wave)));
        if (i > 0 && (i + 1) % 3 === 0) risingPoints.push(scenes[i].index);
        if (i > 0 && (i + 1) % 3 === 1) fallingPoints.push(scenes[i].index);
    }
    return { expected, risingPoints, fallingPoints };
}

/**
 * 检测节奏偏离。
 *
 * @param scenes - 场景强度
 * @param options - 阈值
 * @returns 偏离列表
 */
export function detectRhythmDeviations(
    scenes: readonly SceneIntensity[],
    options: { spikeThreshold?: number; flatThreshold?: number } = {},
): RhythmDeviation[] {
    if (scenes.length < 2) return [];
    const spike = Math.max(10, options.spikeThreshold ?? 35);
    const flat = Math.max(1, options.flatThreshold ?? 5);
    const baseline = deriveBaseline(scenes);
    const deviations: RhythmDeviation[] = [];
    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const expected = baseline.expected[i] ?? scene.intensity;
        const delta = scene.intensity - expected;
        const previous = i > 0 ? scenes[i - 1].intensity : scene.intensity;
        const stepDelta = scene.intensity - previous;
        if (i > 0 && stepDelta >= spike) {
            deviations.push({ index: scene.index, actual: scene.intensity, expected, delta: stepDelta, kind: 'spike', message: `场景${scene.index}较前场突增 ${stepDelta}，检查是否缺铺垫` });
        } else if (i > 0 && stepDelta <= -spike) {
            deviations.push({ index: scene.index, actual: scene.intensity, expected, delta: stepDelta, kind: 'drop', message: `场景${scene.index}较前场骤降 ${Math.abs(stepDelta)}，检查是否泄气` });
        }
        if (i > 0) {
            const diff = Math.abs(scene.intensity - scenes[i - 1].intensity);
            if (diff < flat) {
                deviations.push({ index: scene.index, actual: scene.intensity, expected, delta, kind: 'flat', message: `场景${scene.index}与前场强度差仅 ${diff}，可能平铺` });
            }
        }
    }
    return deviations;
}

/**
 * 渲染节奏报告。
 *
 * @param scenes - 场景强度
 * @param deviations - 偏离
 * @returns 文本
 */
export function renderRhythmReport(
    scenes: readonly SceneIntensity[],
    deviations: readonly RhythmDeviation[],
): string {
    if (scenes.length === 0) return '';
    const baseline = deriveBaseline(scenes);
    const lines = ['【节奏曲线】'];
    lines.push(scenes.map((scene, i) => `场景${scene.index}:${scene.intensity}(期望${baseline.expected[i]})`).join(' → '));
    if (deviations.length === 0) {
        lines.push('【节奏判定】无明显偏离');
        return lines.join('\n');
    }
    lines.push(`【节奏判定】${deviations.length} 处偏离：`);
    for (const deviation of deviations) lines.push(`- ${deviation.message}`);
    return lines.join('\n');
}

/** 限制到 0–100 */
function clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
}
