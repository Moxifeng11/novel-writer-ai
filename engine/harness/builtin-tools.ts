/**
 * builtin-tools.ts - deterministic local tools for harness M1.
 *
 * Only zero-AI validators live here. They are safe to call on every task and
 * never touch正文 files.
 */
import { creativeRandomizer } from './creative-randomizer';
import type { HarnessTool } from './tool-registry';

type AnyInput = Record<string, unknown>;

function text(input: AnyInput, key: string): string {
    return String(input[key] ?? '').trim();
}

function num(input: AnyInput, key: string, fallback: number): number {
    const value = Number(input[key]);
    return Number.isFinite(value) ? value : fallback;
}

export function createBuiltinHarnessTools(): HarnessTool[] {
    return [
        {
            id: 'long.body-format',
            mode: 'long',
            kind: 'local',
            title: '正文格式校验',
            description: '检查正文是否以模型元文本开头、是否含标题。',
            permission: 'read',
            async run(input: AnyInput) {
                const body = text(input, 'text');
                const issues: string[] = [];
                if (!body) issues.push('正文为空');
                if (/^(好的|好的，|我将|以下是|下面是)/.test(body.slice(0, 80))) {
                    issues.push('正文以模型叙述开头');
                }
                if (!/^#{1,3}\s+.+/m.test(body)) issues.push('缺少章节标题');
                return { ok: issues.length === 0, issues };
            },
        },
        {
            id: 'short.taxonomy-check',
            mode: 'short',
            kind: 'local',
            title: '五维分类校验',
            description: '检查主分类/情节/角色/情绪/背景是否齐全。',
            permission: 'read',
            async run(input: AnyInput) {
                const required = ['primaryCategory', 'plot', 'character', 'emotion', 'background'];
                const issues = required
                    .filter(key => !text(input, key))
                    .map(key => `缺少 ${key}`);
                return { ok: issues.length === 0, issues };
            },
        },
        {
            id: 'short.random-brief',
            mode: 'short',
            kind: 'local',
            title: '真随机因子',
            description: '用 CSPRNG 生成四层随机因子与禁用套路。',
            permission: 'read',
            async run() {
                return creativeRandomizer.brief('short');
            },
        },
        {
            id: 'short.section-words',
            mode: 'short',
            kind: 'local',
            title: '节字数校验',
            description: '检查单节字数是否在 1500–4500 之间。',
            permission: 'read',
            async run(input: AnyInput) {
                const count = text(input, 'text').replace(/\s/g, '').length;
                const min = num(input, 'min', 1500);
                const max = num(input, 'max', 4500);
                return { ok: count >= min && count <= max, count, min, max };
            },
        },
        {
            id: 'short.reversal-coverage',
            mode: 'short',
            kind: 'local',
            title: '反转覆盖检查',
            description: '检查分节大纲中的反转数量是否达到 3–5 个要求。',
            permission: 'read',
            async run(input: AnyInput) {
                const outline = text(input, 'outline');
                const count = (outline.match(/反转/g) || []).length;
                return { ok: count >= 3, count };
            },
        },
        {
            id: 'short.ending-payoff',
            mode: 'short',
            kind: 'local',
            title: '结尾兑现检查',
            description: '检查结尾是否有足够内容且不是空泛总结。',
            permission: 'read',
            async run(input: AnyInput) {
                const ending = text(input, 'ending');
                const issues: string[] = [];
                if (ending.length < 80) issues.push('结尾过短，可能未完成兑现');
                if (/^(总之|总而言之|故事到这里)/.test(ending)) issues.push('结尾像总结而非兑现');
                return { ok: issues.length === 0, issues };
            },
        },
        {
            id: 'script.genre-check',
            mode: 'script',
            kind: 'local',
            title: '剧本类型校验',
            description: '检查类型是否在允许列表内。',
            permission: 'read',
            async run(input: AnyInput) {
                const genre = text(input, 'genre');
                const allowed = Array.isArray(input.allowed) ? input.allowed.map(String) : [];
                return { ok: !!genre && (allowed.length === 0 || allowed.includes(genre)), genre };
            },
        },
        {
            id: 'script.shot-duration',
            mode: 'script',
            kind: 'local',
            title: '镜头时长求和',
            description: '求和并与目标秒数比较，默认容差 5 秒。',
            permission: 'read',
            async run(input: AnyInput) {
                const durations = Array.isArray(input.durations) ? input.durations.map(Number) : [];
                const total = durations.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
                const target = num(input, 'targetSeconds', 90);
                const tolerance = num(input, 'tolerance', 5);
                return { ok: Math.abs(total - target) <= tolerance, total, target, tolerance };
            },
        },
        {
            id: 'script.hook-3s',
            mode: 'script',
            kind: 'local',
            title: '3 秒钩子检查',
            description: '检查开场是否含可见冲突/羞辱/危机/身份错位。',
            permission: 'read',
            async run(input: AnyInput) {
                const opening = text(input, 'text').slice(0, 120);
                const hit = /(羞辱|耳光|泼|跪|离婚|撕|抢|威胁|身份|认亲|背叛|抓|血|死|报警|赶出)/.test(opening);
                return { ok: hit, opening };
            },
        },
        {
            id: 'script.episode-ids',
            mode: 'script',
            kind: 'local',
            title: '集/场/镜 ID 生成',
            description: '按集、场、镜数量生成稳定 ID。',
            permission: 'read',
            async run(input: AnyInput) {
                const episode = Math.max(1, Math.floor(num(input, 'episode', 1)));
                const scenes = Math.max(1, Math.floor(num(input, 'scenes', 1)));
                const shots = Math.max(1, Math.floor(num(input, 'shots', 1)));
                const ids: string[] = [];
                for (let scene = 1; scene <= scenes; scene++) {
                    for (let shot = 1; shot <= shots; shot++) {
                        ids.push(`E${String(episode).padStart(2, '0')}-S${String(scene).padStart(2, '0')}-SH${String(shot).padStart(2, '0')}`);
                    }
                }
                return { episode, scenes, shots, ids };
            },
        },
        {
            id: 'script.dialogue-filmable',
            mode: 'script',
            kind: 'local',
            title: '对白可拍性检查',
            description: '检查对白是否过长或像小说解释。',
            permission: 'read',
            async run(input: AnyInput) {
                const dialogue = text(input, 'text');
                const issues: string[] = [];
                if (dialogue.length > 120) issues.push('单段对白过长，可能不可拍');
                if (/(心里想|内心|不禁|仿佛|似乎)/.test(dialogue)) issues.push('对白含小说式心理描写');
                return { ok: issues.length === 0, issues };
            },
        },
    ];
}