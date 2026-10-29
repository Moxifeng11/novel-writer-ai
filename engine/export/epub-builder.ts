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

export interface BookMetadata {
    title: string;
    author?: string;
    language?: string;
    /** 可复现导出/测试用；默认当前时间 */
    date?: Date;
    /** 不传则按书名+作者+时间生成稳定 urn */
    identifier?: string;
}

export interface BookBuildOptions {
    includeVolumeHeadings: boolean;
    includeChapterTitles: boolean;
    /** 长篇=章，短篇=节，剧本=集 */
    unitLabel?: string;
    metadata: BookMetadata;
    /** 固定 ZIP 时间戳（测试用） */
    zipDate?: Date;
}

export interface BuiltBook {
    data: Uint8Array;
    chapterCount: number;
    volumeCount: number;
    wordCount: number;
    emptyChapters: number;
}

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

/** 正文按行拆段：本项目正文约定「一个自然段一行」，剧本也是一行一个元素 */
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

    return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(metadata.language || 'zh-CN')}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:language>${escapeXml(metadata.language || 'zh-CN')}</dc:language>
${creator}    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
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

/** 生成 EPUB 二进制与统计信息 */
export function buildEpub(chapters: ManuscriptChapter[], options: BookBuildOptions): BuiltBook {
    const stats = summarizeManuscriptChapters(chapters);
    const metadata: BookMetadata = {
        title: options.metadata.title || '未命名稿件',
        author: options.metadata.author,
        language: options.metadata.language || 'zh-CN',
        date: options.metadata.date,
    };
    const date = metadata.date ?? new Date();
    const modified = isoModified(date);
    const identifier = metadata.identifier
        || `urn:novel-writer-ai:${fnv1a(`${metadata.title}|${metadata.author || ''}|${modified}`)}`;

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

    const zipEntries: ZipEntry[] = [
        // OCF 要求 mimetype 是 ZIP 的第一个条目且不压缩
        { path: 'mimetype', data: EPUB_MIMETYPE },
        { path: 'META-INF/container.xml', data: buildContainerXml() },
        { path: 'OEBPS/content.opf', data: buildContentOpf(entries, metadata, identifier, modified) },
        {
            path: 'OEBPS/nav.xhtml',
            data: buildNavXhtml(entries, metadata.title, metadata.language || 'zh-CN'),
        },
        { path: 'OEBPS/toc.ncx', data: buildTocNcx(entries, metadata.title, identifier) },
        { path: 'OEBPS/style.css', data: buildStyleCss() },
        ...chapterFiles,
    ];

    return {
        data: createZip(zipEntries, { date: options.zipDate ?? date }),
        chapterCount: stats.chapterCount,
        volumeCount: stats.volumeCount,
        wordCount: stats.wordCount,
        emptyChapters: stats.emptyChapters,
    };
}
