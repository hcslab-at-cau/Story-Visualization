import { randomUUID } from "node:crypto"
import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EPub } from "epub2"
import {
  DEFAULT_EPUB_PARSE_LIMITS,
  parseEpubDocumentForTesting,
  type EpubDocumentReader,
  type EpubParseLimits,
  type ParseEpubContext,
} from "../../src/lib/epub.ts"
import type { RawChapter } from "../../src/types/schema.ts"

function inProcessReader(epub: EPub): EpubDocumentReader {
  return {
    spine: epub.spine,
    manifest: epub.manifest,
    toc: epub.toc,
    archiveEntryNames: epub.zip.names,
    getChapter: (chapterId) => new Promise<string>((resolve, reject) => {
      epub.getChapter(chapterId, (error: Error, text?: string) => {
        if (error) reject(error)
        else resolve(text ?? "")
      })
    }),
  }
}

export async function parseEpubInProcessForTesting(
  buffer: Buffer,
  docIdOrContext: string | ParseEpubContext,
  limits: EpubParseLimits = DEFAULT_EPUB_PARSE_LIMITS,
): Promise<RawChapter[]> {
  const tempPath = join(tmpdir(), `epub-test-${randomUUID()}.epub`)
  writeFileSync(tempPath, buffer, { flag: "wx" })

  try {
    const epub = await EPub.createAsync(tempPath)
    return await parseEpubDocumentForTesting(
      inProcessReader(epub),
      docIdOrContext,
      limits,
    )
  } finally {
    rmSync(tempPath, { force: true })
  }
}
