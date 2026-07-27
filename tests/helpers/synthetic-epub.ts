import JSZip from "jszip"

export interface SyntheticEpubChapter {
  manifestId: string
  href: string
  title: string
  topic: string
}

export interface SyntheticEpubOptions {
  editionLabel?: string
  chapters?: SyntheticEpubChapter[]
}

const DEFAULT_CHAPTERS: SyntheticEpubChapter[] = [
  {
    manifestId: "chap-1",
    href: "Text/chapter-1.xhtml",
    title: "Signal Ridge",
    topic: "ridge patrol",
  },
  {
    manifestId: "chap-2",
    href: "Text/chapter-2.xhtml",
    title: "Archive Steps",
    topic: "archive stairwell",
  },
]

const escapeXml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;")

function buildParagraph(title: string, topic: string, paragraphIndex: number, editionLabel: string): string {
  const sentence = `${title} synthetic passage ${paragraphIndex + 1} tracks the ${topic} with edition marker ${editionLabel}, ` +
    "keeps character names and setting details invented for testing only, and repeats stable sensory beats so the parser sees long narrative prose."
  return Array.from({ length: 5 }, (_, index) => `${sentence} Sequence ${index + 1} closes with a checkpoint ledger and a weather note.`).join(" ")
}

function buildChapterDocument(chapter: SyntheticEpubChapter, editionLabel: string): string {
  const paragraphs = Array.from(
    { length: 3 },
    (_, index) => `<p>${escapeXml(buildParagraph(chapter.title, chapter.topic, index, editionLabel))}</p>`,
  ).join("\n    ")

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>${escapeXml(chapter.title)}</title>
  </head>
  <body>
    <h1>${escapeXml(chapter.title)}</h1>
    ${paragraphs}
  </body>
</html>`
}

function buildOpf(chapters: SyntheticEpubChapter[]): string {
  const manifestItems = [
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    ...chapters.map((chapter) => (
      `<item id="${escapeXml(chapter.manifestId)}" href="${escapeXml(chapter.href)}" media-type="application/xhtml+xml"/>`
    )),
  ].join("\n    ")

  const spineItems = chapters
    .map((chapter) => `<itemref idref="${escapeXml(chapter.manifestId)}"/>`)
    .join("\n    ")

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Synthetic EPUB</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:synthetic-epub</dc:identifier>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`
}

function buildToc(chapters: SyntheticEpubChapter[]): string {
  const navPoints = chapters
    .map((chapter, index) => `    <navPoint id="nav-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="${escapeXml(chapter.href)}"/>
    </navPoint>`)
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:synthetic-epub"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>Synthetic EPUB</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`
}

export async function buildSyntheticEpub(options: SyntheticEpubOptions = {}): Promise<Buffer> {
  const editionLabel = options.editionLabel ?? "base"
  const chapters = options.chapters ?? DEFAULT_CHAPTERS

  const zip = new JSZip()
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" })
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
  zip.file("OEBPS/content.opf", buildOpf(chapters))
  zip.file("OEBPS/toc.ncx", buildToc(chapters))

  for (const chapter of chapters) {
    zip.file(`OEBPS/${chapter.href}`, buildChapterDocument(chapter, editionLabel))
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}
