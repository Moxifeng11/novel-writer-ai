/**
 * epub-builder.ts — 生成 EPUB 3（含 EPUB2 的 NCX 兼容层）
 *
 * 不依赖第三方库：EPUB 就是「mimetype + META-INF + OEBPS」的 ZIP，
 * 用本地 zip-writer 以 store 模式打包即可被主流阅读器（Apple Books /
 * Calibre / 微信读书导入 / Kindle 转换）打开。
 *
 * 章节来源与 Markdown/TXT 导出共用 ManuscriptChapter，保证字数与章序一致。
 */
import {
    formatChapterLabel,
    normalizeChapterBody,
    summarizeManuscriptChapters,
    type ManuscriptChapter,
} from './manuscript-compiler';
import { createZip, type ZipEntry } from './zip-writer';

/**
 * 书籍元数据。
 */
export interface BookMetadata {
    title: string;
    author?: string;
    language?: string;
    /** 可复现导出/测试用；默认当前时间 */
    date?: Date;
    /** 不传则按书名+作者+时间生成稳定 urn */
    identifier?: string;
    /** 平台投稿简介（EPUB dc:description；短篇/剧本导出时填） */
    description?: string;
    /** 平台标签（EPUB dc:subject） */
    subject?: string[];
    /** 封面图；存在时生成 cover.xhtml、properties="cover-image" 与 EPUB2 兼容 meta */
    cover?: BookCover;
}

/**
 * 封面资源。
 */
export interface BookCover {
    data: Uint8Array;
    /** 如 image/png / image/jpeg / image/webp */
    mediaType: string;
    /** 不带点：png / jpg / jpeg / webp */
    fileExt: string;
}

/** EPUB 支持的封面扩展名 → media type（png/jpg 为核心类型，webp 各大阅读器已普遍支持） */
const COVER_MEDIA_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};

/**
 * 按扩展名返回封面媒体类型。
 *
 * @param ext - 扩展名
 * @returns 媒体类型或 null
 */
export function coverMediaTypeForExt(ext: string): string | null {
    return COVER_MEDIA_TYPES[ext.toLowerCase()] ?? null;
}

/**
 * 书籍构建选项。
 */
export interface BookBuildOptions {
    includeVolumeHeadings: boolean;
    includeChapterTitles: boolean;
    /** 长篇=章，短篇=节，剧本=集 */
    unitLabel?: string;
    metadata: BookMetadata;
    /** 固定 ZIP 时间戳（测试用） */
    zipDate?: Date;
}

/**
 * 构建产物（文件名/字节/媒体类型）。
 */
export interface BuiltBook {
    data: Uint8Array;
    chapterCount: number;
    volumeCount: number;
    wordCount: number;
    emptyChapters: number;
}

/**
 * EPUB 媒体类型常量。
 */
export const EPUB_MIMETYPE = 'application/epub+zip';

function escapeXml(text: string): string {
    return String(text ?? '')
        // XML 1.0 不允许的控制字符
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function isoModified(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 正文按行拆段：本项目正文约定「一个自然段一行」，剧本也是一行一个元素
 *
 * @param body - 正文
 * @returns 结果数组
 */
function bodyLines(body: string): string[] {
    return body
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.replace(/^#{1,6}\s+/, '').trim())
        .filter(line => line.length > 0);
}

function chapterFileName(index: number): string {
    return `chapter-${String(index + 1).padStart(4, '0')}.xhtml`;
}

function buildChapterXhtml(
    chapter: ManuscriptChapter,
    index: number,
    label: string,
    volumeHeading: string,
    options: BookBuildOptions,
): string {
    const parts: string[] = [];
    if (volumeHeading) parts.push(`    <h1 class="volume">${escapeXml(volumeHeading)}</h1>`);
    if (options.includeChapterTitles) parts.push(`    <h2>${escapeXml(label)}</h2>`);
    for (const line of bodyLines(normalizeChapterBody(chapter.content))) {
        parts.push(`    <p>${escapeXml(line)}</p>`);
    }
    if (parts.length === 0) parts.push('    <p class="empty"></p>');

    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(options.metadata.language || 'zh-CN')}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(label)}</title>
  <link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body>
  <section epub:type="chapter" id="chapter-${index + 1}">
${parts.join('\n')}
  </section>
</body>
</html>
`;
}

function buildContainerXml(): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function buildContentOpf(
    entries: Array<{ id: string; href: string; label: string }>,
    metadata: BookMetadata,
    identifier: string,
    modified: string,
): string {
    const manifest = entries
        .map(entry => `    <item id="${entry.id}" href="${entry.href}" media-type="application/xhtml+xml"/>`)
        .join('\n');
    const spine = entries
        .map(entry => `    <itemref idref="${entry.id}"/>`)
        .join('\n');
    const creator = metadata.author?.trim()
        ? `    <dc:creator>${escapeXml(metadata.author.trim())}</dc:creator>\n`
        : '';
    const description = metadata.description?.trim()
        ? `    <dc:description>${escapeXml(metadata.description.trim())}</dc:description>
`
        : '';
    const subjects = (metadata.subject ?? [])
        .map(subject => String(subject || '').trim())
        .filter(Boolean)
        .map(subject => `    <dc:subject>${escapeXml(subject)}</dc:subject>
`)
        .join('');
    // 封面：EPUB3 用 properties="cover-image"，EPUB2 老阅读器只认 <meta name="cover">
    const cover = metadata.cover;
    const coverManifest = cover
        ? `\n    <item id="cover-image" href="images/cover.${cover.fileExt}" media-type="${cover.mediaType}" properties="cover-image"/>` +
          `\n    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`
        : '';
    const coverMeta = cover
        ? `    <meta name="cover" content="cover-image"/>\n`
        : '';
    const coverSpine = cover ? `    <itemref idref="cover-page"/>\n` : '';

    return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(metadata.language || 'zh-CN')}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:language>${escapeXml(metadata.language || 'zh-CN')}</dc:language>
${creator}${description}${subjects}${coverMeta}    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>${coverManifest}
${manifest}
  </manifest>
  <spine toc="ncx">
${coverSpine}${spine}
  </spine>
</package>
`;
}

function buildNavXhtml(
    entries: Array<{ href: string; label: string }>,
    title: string,
    language: string,
): string {
    const items = entries
        .map(entry => `      <li><a href="${entry.href}">${escapeXml(entry.label)}</a></li>`)
        .join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`;
}

function buildTocNcx(
    entries: Array<{ href: string; label: string }>,
    title: string,
    identifier: string,
): string {
    const points = entries
        .map((entry, index) => `    <navPoint id="navPoint-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(entry.label)}</text></navLabel>
      <content src="${entry.href}"/>
    </navPoint>`)
        .join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

function buildCoverXhtml(imageHref: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>封面</title>
  <style type="text/css">
    body { margin: 0; padding: 0; text-align: center; background: #ffffff; }
    img { max-width: 100%; max-height: 100%; }
  </style>
</head>
<body>
  <div>
    <img src="${imageHref}" alt="cover"/>
  </div>
</body>
</html>
`;
}

function buildStyleCss(): string {
    return `body {
  margin: 1em;
  font-family: "Songti SC", "SimSun", "Noto Serif CJK SC", serif;
  line-height: 1.85;
  color: #1a1a1a;
}
h1.volume {
  margin: 1.6em 0 1em;
  font-size: 1.35em;
  text-align: center;
}
h2 {
  margin: 1.2em 0 0.8em;
  font-size: 1.15em;
}
p {
  margin: 0 0 0.6em;
  text-indent: 2em;
}
p.empty {
  min-height: 1em;
}
`;
}

/**
 * 生成 EPUB 二进制与统计信息
 *
 * @param chapters - 章节列表
 * @param options - 配置项
  * @returns BuiltBook 实例
 */
export function buildEpub(chapters: ManuscriptChapter[], options: BookBuildOptions): BuiltBook {
    const stats = summarizeManuscriptChapters(chapters);
    const metadata: BookMetadata = {
        title: options.metadata.title || '未命名稿件',
        author: options.metadata.author,
        language: options.metadata.language || 'zh-CN',
        date: options.metadata.date,
        cover: options.metadata.cover,
        // DSH-20261113-23 ①：description/subject/identifier 是设计要用的字段
        // （dc:description / dc:subject / unique-identifier），此前被白名单重建丢掉——
        // 平台投稿包的简介与标签静默消失。
        description: options.metadata.description,
        subject: options.metadata.subject,
        identifier: options.metadata.identifier,
    };
    const date = metadata.date ?? new Date();
    const modified = isoModified(date);
    const identifier = metadata.identifier
        || `urn:novel-writer-ai:${fnv1a(`${metadata.title}|${metadata.author || ''}|${modified}`)}`;
    const cover = metadata.cover && metadata.cover.data.length > 0 ? metadata.cover : undefined;

    const entries: Array<{ id: string; href: string; label: string }> = [];
    const chapterFiles: ZipEntry[] = [];
    let currentVolume: string | null = null;

    stats.sorted.forEach((chapter, index) => {
        let volumeHeading = '';
        if (options.includeVolumeHeadings && chapter.volume && chapter.volume !== currentVolume) {
            volumeHeading = chapter.volume;
        }
        if (chapter.volume) currentVolume = chapter.volume;

        const label = formatChapterLabel(chapter, { unitLabel: options.unitLabel });
        const fileName = chapterFileName(index);
        entries.push({ id: `chapter-${index + 1}`, href: `text/${fileName}`, label });
        chapterFiles.push({
            path: `OEBPS/text/${fileName}`,
            data: buildChapterXhtml(chapter, index, label, volumeHeading, options),
        });
    });

    // nav/ncx 的第一项是封面页（如有），正文目录随后
    const navEntries: Array<{ href: string; label: string }> = cover
        ? [{ href: 'cover.xhtml', label: '封面' }, ...entries]
        : entries;

    const zipEntries: ZipEntry[] = [
        // OCF 要求 mimetype 是 ZIP 的第一个条目且不压缩
        { path: 'mimetype', data: EPUB_MIMETYPE },
        { path: 'META-INF/container.xml', data: buildContainerXml() },
        { path: 'OEBPS/content.opf', data: buildContentOpf(entries, metadata, identifier, modified) },
        {
            path: 'OEBPS/nav.xhtml',
            data: buildNavXhtml(navEntries, metadata.title, metadata.language || 'zh-CN'),
        },
        { path: 'OEBPS/toc.ncx', data: buildTocNcx(navEntries, metadata.title, identifier) },
        { path: 'OEBPS/style.css', data: buildStyleCss() },
        ...chapterFiles,
    ];
    if (cover) {
        const imageHref = `images/cover.${cover.fileExt}`;
        zipEntries.push(
            { path: `OEBPS/${imageHref}`, data: cover.data },
            { path: 'OEBPS/cover.xhtml', data: buildCoverXhtml(imageHref) },
        );
    }

    return {
        data: createZip(zipEntries, { date: options.zipDate ?? date }),
        chapterCount: stats.chapterCount,
        volumeCount: stats.volumeCount,
        wordCount: stats.wordCount,
        emptyChapters: stats.emptyChapters,
    };
}
