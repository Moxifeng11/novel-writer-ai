/**
 * human-sample-loader.ts — 启动时把本地真人样文灌进 style-exemplars
 *
 * 样文由 `npm run sample:human` 从本机《指纹资料库》抽取，落在插件 data 目录
 * （`.obsidian/plugins/novel-writer-ai/data/human-samples/`）。这里只做读取与注入：
 * 读不到就静默跳过（提示词自动退化为「弱约束模式」），绝不影响插件启动。
 *
 * 版权说明：样文来自已出版网文，仅本机使用，不随插件分发、不进仓库。
 */
import type { App } from 'obsidian';
import { setExemplarLibrary, clearExemplarLibrary, type ExemplarSample } from '@/engine/prompts/style-exemplars';
import { createLogger } from '@/shared/logger';
import { pluginDataFile } from '@/shared/paths';

const log = createLogger('HumanSamples');

/**
 * 插件 data 下的真人样文目录（vault 相对路径）。
 * 惰性求值：onload 注入 configDir + manifest.dir 后才得到真实路径。
 *
 * @returns 样文目录路径
 */
export function humanSampleDir(): string {
    return pluginDataFile('human-samples');
}

interface SampleFile {
    book?: string;
    samples?: Array<{ kind?: string; text?: string }>;
}

/**
 * 读取本地样文并注入；返回注入条数（0 表示没有样文）
 *
 * @param app - Obsidian 应用实例
 * @returns 数值结果
 */
export async function loadHumanSamples(app: App): Promise<number> {
    const adapter = app.vault.adapter;
    try {
        const dir = humanSampleDir();
        if (!(await adapter.exists(dir))) {
            return 0;
        }
        const listing = await adapter.list(dir);
        const files = listing.files.filter((file) => file.endsWith('.json') && !file.endsWith('baseline.json'));
        const collected: ExemplarSample[] = [];
        for (const file of files) {
            let raw: string;
            try {
                raw = await adapter.read(file);
            } catch {
                continue;
            }
            let parsed: SampleFile;
            try {
                parsed = JSON.parse(raw) as SampleFile;
            } catch {
                continue;
            }
            const book = parsed.book || file.split('/').pop()?.replace(/\.json$/, '') || 'unknown';
            for (const sample of parsed.samples || []) {
                const text = String(sample.text || '').trim();
                if (text.length < 120) continue;
                collected.push({ book, kind: String(sample.kind || '补充'), text });
            }
        }
        if (collected.length === 0) {
            clearExemplarLibrary();
            return 0;
        }
        setExemplarLibrary(collected);
        log.info(`[HumanSamples] 已加载 ${collected.length} 段本地真人样文（${files.length} 个文件）`);
        return collected.length;
    } catch (e) {
        log.warn('[HumanSamples] 加载本地样文失败（不影响启动）:', e);
        return 0;
    }
}
