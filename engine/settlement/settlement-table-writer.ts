/**
 * settlement-table-writer.ts — 结算表唯一落盘入口
 *
 * 结算表内容已由 settlement-artifacts.buildSettlementTable 统一生成；
 * 落盘此前散在 4 个 UI 入口（modify/create、delete+create），全部无锁：
 * 与结算引擎/协同保存并发时可能互相覆盖，delete+create 失败还会把旧表弄丢。
 * 这里收敛为「锁内覆盖写」，路径统一为 `03-大纲与章节/步骤结果/第N卷/第M章/第M章_结算表.md`；
 * 传入的 chapDir 若不是标准步骤目录（旧项目），仍回退到标准路径，保证跨入口一致。
 */
import { withWriteLock } from '@/shared/write-lock';
import type { FileSystemPort } from '@/shared/file-system-port';
import { pjStepDir, pjStepFile } from '@/shared/paths';

/** 结算表写入参数 */
export interface SettlementTableWriteInput {
    project: string;
    /** 卷名（第N卷）或卷号 */
    volume: string | number;
    /** 章号 */
    chapterNum: number;
    /** 章名（第N章）；仅用于 issue 报告，路径以 chapterNum 为准 */
    chapterName?: string;
    /** 结算表 Markdown（buildSettlementTable 产物） */
    content: string;
    /** 调用方已有的章目录；非标准步骤目录时回退标准路径 */
    chapDir?: string;
}

/**
 * 解析卷号
 *
 * @param volume - 卷名或卷号
 * @returns 卷号
 */
function volumeNumOf(volume: string | number): number {
    if (typeof volume === 'number') return Math.max(1, Math.floor(volume));
    return Number.parseInt(String(volume).match(/(\d+)/)?.[1] ?? '1', 10) || 1;
}

/**
 * 结算表标准路径（第N章_结算表.md）
 *
 * @param project - 项目
 * @param volume - 卷
 * @param chapterNum - 章号
 * @returns vault 相对路径
 */
export function settlementTablePath(project: string, volume: string | number, chapterNum: number): string {
    return pjStepFile(project, volumeNumOf(volume), Math.max(1, chapterNum), '结算表');
}

/**
 * 写结算表：mkdir + 锁内覆盖写（幂等；重复结算不堆叠、失败不丢旧表）。
 *
 * @param fs - 文件端口
 * @param input - 写入参数
 * @returns 实际写入路径
 */
export async function writeSettlementTableFile(fs: FileSystemPort, input: SettlementTableWriteInput): Promise<string> {
    const volNum = volumeNumOf(input.volume);
    const legacy = input.chapDir?.match(/\/03-大纲与章节\/步骤结果\/第(\d+)卷\/第(\d+)章$/);
    // F-7（2026-11-10 审计）：章号解析失败（序章/楔子/番外 → 0）时，标准 chapDir
    // 的目录章号优先——否则产出「第7章/第1章_结算表.md」错位，或非 legacy 路径
    // 钳到 1 直接覆盖第1章的结算表（数据丢失）。
    const chapNum = legacy
        ? Math.max(1, Number.parseInt(legacy[2], 10))
        : Math.max(1, Math.floor(input.chapterNum || 1));
    // chapDir 是标准步骤目录时直接沿用（兼容旧数据所在位置）；否则统一到标准路径
    const dir = legacy
        ? `${input.project}/03-大纲与章节/步骤结果/第${legacy[1]}卷/第${legacy[2]}章`
        : pjStepDir(input.project, volNum, chapNum);
    const path = `${dir}/第${chapNum}章_结算表.md`;
    await fs.mkdir(dir).catch(() => {});
    await withWriteLock(path, async () => {
        await fs.write(path, input.content);
    });
    return path;
}
