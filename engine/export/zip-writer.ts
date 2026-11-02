/**
 * zip-writer.ts — 无依赖的最小 ZIP 打包器（store 模式）
 *
 * EPUB 与 DOCX 本质都是 ZIP。插件不允许引入运行时依赖（单文件 main.js），
 * 而这两种稿件只要求「能被阅读器打开」，不需要压缩率，因此这里只实现
 * store（method=0）与 CRC32——足够生成合规的 EPUB/DOCX，且输出可复现。
 */

/**
 * ZIP 条目。
 */
export interface ZipEntry {
    /** ZIP 内路径，必须用 `/` 分隔 */
    path: string;
    data: string | Uint8Array;
}

/**
 * ZIP 写入选项。
 */
export interface ZipOptions {
    /** 固定时间戳（测试/可复现导出用）；默认当前时间 */
    date?: Date;
}

const UTF8_FLAG = 0x0800;

const CRC_TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[index] = value >>> 0;
    }
    return table;
})();

/**
 * 计算 CRC32。
 *
 * @param data - 数据
 * @returns 校验值
 */
export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let index = 0; index < data.length; index++) {
        crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function encode(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

function toBytes(data: string | Uint8Array): Uint8Array {
    return typeof data === 'string' ? encode(data) : data;
}

function dosDateTime(date: Date): { time: number; date: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
    }
    return output;
}

/** 把若干文件打成 ZIP（全部 store，不压缩） */
export function createZip(entries: ZipEntry[], options: ZipOptions = {}): Uint8Array {
    const { time, date } = dosDateTime(options.date ?? new Date());
    const localChunks: Uint8Array[] = [];
    const centralChunks: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = encode(entry.path);
        const data = toBytes(entry.data);
        const crc = crc32(data);
        // 纯 ASCII 名字不置 UTF-8 标志：EPUB 的 mimetype 条目越「素」越稳
        const flags = /^[\x20-\x7e]*$/.test(entry.path) ? 0 : UTF8_FLAG;

        const local = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, flags, true);
        localView.setUint16(8, 0, true);
        localView.setUint16(10, time, true);
        localView.setUint16(12, date, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, data.length, true);
        localView.setUint32(22, data.length, true);
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true);
        local.set(nameBytes, 30);

        localChunks.push(local, data);

        const central = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, flags, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, time, true);
        centralView.setUint16(14, date, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, data.length, true);
        centralView.setUint32(24, data.length, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint16(30, 0, true);
        centralView.setUint16(32, 0, true);
        centralView.setUint16(34, 0, true);
        centralView.setUint16(36, 0, true);
        centralView.setUint32(38, 0, true);
        centralView.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        centralChunks.push(central);

        offset += local.length + data.length;
    }

    const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, centralSize, true);
    eocdView.setUint32(16, offset, true);
    eocdView.setUint16(20, 0, true);

    return concatChunks([...localChunks, ...centralChunks, eocd]);
}
