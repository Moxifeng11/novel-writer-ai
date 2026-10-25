/**
 * scene-body-merge.ts — 逐场景确认结果合并为整章正文
 *
 * 场景确认向导按场景产出正文，落盘时需要按场景顺序拼接：
 * - 场景之间空一行，避免段落粘连
 * - 空场景 / 纯空白场景直接丢弃，不在正文里留下连续空行
 */

export interface SceneBodyLike {
    body: string;
}

export function mergeSceneBodies(scenes: readonly SceneBodyLike[]): string {
    return scenes
        .map((scene) => (scene.body || '').trim())
        .filter((body) => body.length > 0)
        .join('\n\n');
}
