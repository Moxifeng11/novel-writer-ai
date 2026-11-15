/**
 * unit-context-prompt.ts — 短篇/剧本的单元级上下文段落（纯函数）
 *
 * 与协同写作 `chapter-brief` 同构：**当前单元全字段 + 其余单元一行摘要**，
 * 避免整份大纲/圣经/分镜表全量注入。
 */

import type { ScriptEpisodeCard, ScriptSceneCard, ShortUnitCard, ShotCard } from './unit-card-model';

/**
 * 渲染短篇节上下文（当前节全字段，其余一行）。
 *
 * @param cards - 节卡
 * @param currentIndex - 当前节号（1 起）
 * @returns 段落
 */
export function renderShortUnitContext(cards: readonly ShortUnitCard[], currentIndex: number): string {
    if (cards.length === 0) return '';
    const current = cards.find(card => card.index === currentIndex) ?? cards[0];
    const lines = [`【当前节】第${current.index}节${current.title ? `「${current.title}」` : ''}`];
    for (const [key, value] of Object.entries(current.fields)) lines.push(`- ${key}：${value}`);
    const others = cards.filter(card => card.index !== current.index);
    if (others.length > 0) {
        lines.push('【其余节（仅标题）】');
        for (const card of others) lines.push(`- 第${card.index}节${card.title ? `：${card.title}` : ''}`);
    }
    return lines.join('\n');
}

/**
 * 渲染剧本集/场/镜上下文。
 *
 * 当前集全字段 + 当前场完整信息 + 当前场的分镜 + 其余集一行。
 *
 * @param episodes - 集卡
 * @param scenes - 场卡
 * @param shots - 镜卡
 * @param current - 当前集号与场号
 * @returns 段落
 */
export function renderScriptUnitContext(
    episodes: readonly ScriptEpisodeCard[],
    scenes: readonly ScriptSceneCard[],
    shots: readonly ShotCard[],
    current: { episode: number; scene?: number },
): string {
    if (episodes.length === 0) return '';
    const episode = episodes.find(item => item.index === current.episode) ?? episodes[0];
    const lines = [`【当前集】第${episode.index}集${episode.title ? `「${episode.title}」` : ''}`];
    for (const [key, value] of Object.entries(episode.fields)) lines.push(`- ${key}：${value}`);

    const episodeScenes = scenes.filter(scene => scene.episode === episode.index);
    const currentScene = episodeScenes.find(scene => scene.scene === current.scene) ?? episodeScenes[0];
    if (currentScene) {
        lines.push(`【当前场】${currentScene.id} ${currentScene.timeOfDay} ${currentScene.location}`);
        if (currentScene.characters.length > 0) lines.push(`- 人物：${currentScene.characters.join('、')}`);
        lines.push(`- 动作 ${currentScene.actionLines} 行 / 对白 ${currentScene.dialogueLines} 行`);
        const scenePrefixes = [currentScene.id, currentScene.id.replace(/^EP/, 'E')];
        const sceneShots = shots.filter(shot => scenePrefixes.some(prefix => shot.shotId.startsWith(prefix)));
        if (sceneShots.length > 0) {
            lines.push('【本场分镜】');
            for (const shot of sceneShots) {
                const brief = Object.entries(shot.fields).slice(0, 4).map(([key, value]) => `${key}=${value}`).join('，');
                lines.push(`- ${shot.shotId}：${brief}`);
            }
        }
    }
    const otherScenes = episodeScenes.filter(scene => scene.id !== currentScene?.id);
    if (otherScenes.length > 0) {
        lines.push('【本集其余场（仅一行）】');
        for (const scene of otherScenes) lines.push(`- ${scene.id} ${scene.timeOfDay} ${scene.location}`);
    }
    const otherEpisodes = episodes.filter(item => item.index !== episode.index);
    if (otherEpisodes.length > 0) {
        lines.push('【其余集（仅标题）】');
        for (const item of otherEpisodes) lines.push(`- 第${item.index}集${item.title ? `：${item.title}` : ''}`);
    }
    return lines.join('\n');
}

/**
 * 估算段落 token（中文≈1.5 字/token，保守取 2 字/token）。
 *
 * @param text - 段落
 * @returns 估算 token
 */
export function unitContextTokens(text: string): number {
    return Math.ceil(String(text ?? '').length / 2);
}
