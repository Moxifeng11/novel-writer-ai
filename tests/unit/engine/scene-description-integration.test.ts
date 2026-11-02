import { describe, it, expect } from 'vitest';
import { BODY_GENERATION_USER_TEMPLATE_V2 } from '../../../engine/prompts/body-v2-prompts';
import { CO_WRITE_DIRECTION_PROMPTS, CO_WRITE_PROMPTS } from '../../../engine/prompts/co-write-prompts';

describe('场景描写在整章与协同写作中的注入', () => {
    it('整章正文模板包含场景描写硬约束与场景卡', () => {
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('${sceneCardDigest}');
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('【场景落地提示】');
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('sensory_hook');
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('body_reaction');
        expect(BODY_GENERATION_USER_TEMPLATE_V2).toContain('时间/地点过渡');
    });

    it('协同写作 description 方向要求使用场景卡而不是泛泛氛围', () => {
        const prompt = CO_WRITE_DIRECTION_PROMPTS.description;
        expect(prompt).toContain('当前场景卡');
        expect(prompt).toContain('sensory_hook');
        expect(prompt).toContain('不推进剧情');
    });

    it('协同写作 system 只写具体地点/时间/感官，不使用空泛气氛', () => {
        expect(CO_WRITE_PROMPTS.sentenceSystem).toContain('具体地点');
        expect(CO_WRITE_PROMPTS.sentenceSystem).toContain('感官细节');
    });
});
