import type { StoryBeat } from './story-state-types';

/** 单个 beat 的验收结果 */
export interface BeatVerifyItem {
    beat: StoryBeat;
    completed: boolean;
}

/** BeatVerifier.verify 的整体结果 */
export interface BeatVerifyResult {
    passed: boolean;
    completionRate: number;
    results: BeatVerifyItem[];
    missingRequired: StoryBeat[];
}

/**
 * BeatVerifier — 正文剧情节点验收（程序规则层）
 * 对应 spec: story-quality-closed-loop-optimization 第 2.2 节。
 *
 * 纯函数：判断正文是否覆盖各剧情任务卡。无网络、无副作用。
 * 命中策略：description 整串或其子短语（按标点切分，长度≥2）出现在正文即视为完成。
 */
export class BeatVerifier {
    verify(body: string, beats: StoryBeat[]): BeatVerifyResult {
        const text = typeof body === 'string' ? body : '';
        const list = Array.isArray(beats) ? beats : [];

        const results: BeatVerifyItem[] = list.map((beat) => ({
            beat,
            completed: this.isCovered(text, beat.description),
        }));

        const missingRequired = results
            .filter((r) => r.beat.required && !r.completed)
            .map((r) => r.beat);

        const completionRate = results.length === 0
            ? 1
            : results.filter((r) => r.completed).length / results.length;

        return {
            passed: missingRequired.length === 0,
            completionRate,
            results,
            missingRequired,
        };
    }

    private isCovered(body: string, description: string): boolean {
        if (!body || !description) return false;
        const desc = description.trim();
        if (desc === '') return false;
        if (body.includes(desc)) return true;

        const phrases = desc
            .split(/[，,。.；;、\s（）()【】\[\]]+/)
            .map((p) => p.trim())
            .filter((p) => p.length >= 2);

        return phrases.some((p) => body.includes(p));
    }
}
