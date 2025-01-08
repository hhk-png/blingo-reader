import { readFileSync, unlink } from 'node:fs'
import { parsexml } from '@blingo-reader/shared'
import { saveResource } from './utils'
import {
  concatTypedArrays,
  mbpPagebreakRegex,
  toArrayBuffer,
} from './book'
import { MobiFile } from './mobiFile'
import type { MobiChapter, MobiToc, MobiTocItem, ProcessedChapter, ResolvedHref } from './types'

interface Options {
  imageSaveDir?: string
}

export async function initMobiFile(file: string | File, options?: Options) {
  const mobi = new Mobi(file, options)
  await mobi.innerLoadFile()
  await mobi.innerInit()

  return mobi
}

export class Mobi {
  private fileArrayBuffer!: ArrayBuffer
  private mobiFile!: MobiFile

  // chapter
  private chapters: MobiChapter[] = []
  private idToChapter = new Map<number, MobiChapter>()
  private toc: MobiToc = []

  private imageSaveDir = './images'
  private chapterCache = new Map<number, ProcessedChapter>()
  private resourceCache = new Map<string, string>()

  public getSpine(): MobiChapter[] {
    return this.chapters
  }

  public loadChapter(id: number): ProcessedChapter | undefined {
    // cache
    if (this.chapterCache.has(id)) {
      return this.chapterCache.get(id)!
    }

    const chapter = this.idToChapter.get(id)!
    if (!chapter) {
      return undefined
    }

    const processedChapter = this.replace(chapter.text)
    this.chapterCache.set(id, processedChapter)

    return processedChapter
  }

  public getToc(): MobiToc {
    return this.toc
  }

  public getCoverImage(): string | undefined {
    if (this.resourceCache.has('cover')) {
      return this.resourceCache.get('cover')!
    }

    const coverImage = this.mobiFile.getCoverImage()
    if (coverImage) {
      const coverUrl = saveResource(coverImage.raw, coverImage.type, 'cover', this.imageSaveDir)

      this.resourceCache.set('cover', coverUrl)
      return coverUrl
    }
    return undefined
  }

  public getMetadata() {
    return this.mobiFile.getMetadata()
  }

  constructor(private file: string | File, options: Options = {}) {
    this.imageSaveDir = options.imageSaveDir ?? './images'
  }

  async innerLoadFile() {
    this.fileArrayBuffer = await toArrayBuffer(
      __BROWSER__
        ? this.file as File
        : readFileSync(this.file as string),
    )
    this.mobiFile = new MobiFile(this.fileArrayBuffer)
  }

  async innerInit() {
    const { palmdocHeader } = this.mobiFile
    // get all chapter buffers
    const buffers: Uint8Array[] = []
    for (let i = 0; i < palmdocHeader.numTextRecords; i++) {
      buffers.push(this.mobiFile.loadTextBuffer(i))
    }
    const array = concatTypedArrays(buffers)
    const str = Array.from(
      array,
      val => String.fromCharCode(val),
    ).join('')

    // split chapters
    const chapters: MobiChapter[] = []
    const idToChapter = new Map<number, MobiChapter>()
    let id = 0
    const matches = Array.from(str.matchAll(mbpPagebreakRegex))
    matches.unshift({ index: 0, input: '', groups: undefined, 0: '' } as RegExpExecArray)

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]
      const start = match.index
      const matched = match[0]
      const end = matches[i + 1]?.index
      const section = str.slice(start + matched.length, end)
      const buffer = Uint8Array.from(section, c => c.charCodeAt(0))
      const text = this.mobiFile.decode(buffer.buffer)
      const chapter: MobiChapter = {
        id,
        text,
        start,
        end,
        size: buffer.length,
      }
      chapters.push(chapter)
      idToChapter.set(id, chapter)
      id++
    }
    // process last chapter. remove trailing </body></html>
    const lastChapterText = chapters[chapters.length - 1].text
    chapters[chapters.length - 1].text = lastChapterText.slice(0, lastChapterText.indexOf('</body>'))

    // process first chapter, remove beginning ...<body>
    const firstChapterText = chapters[0].text
    const bodyOpenTagIndex = firstChapterText.indexOf('<body>')
    chapters[0].text = firstChapterText.slice(bodyOpenTagIndex + '<body>'.length)

    this.chapters = chapters
    this.idToChapter = idToChapter

    // used for parsing toc
    const referenceStr = firstChapterText.slice(0, bodyOpenTagIndex)
    const tocChapterStr = this.findTocChapter(referenceStr)
    if (tocChapterStr) {
      const wrappedChapterStr = `<wrapper>${tocChapterStr.text.replace(/filepos=(\d+)/gi, 'filepos="$1"')
        }</wrapper>`

      const tocAst = await parsexml(wrappedChapterStr, {
        preserveChildrenOrder: true,
        explicitChildren: true,
        childkey: 'children',
      })
      const toc: MobiToc = []
      this.parseNavMap(tocAst.wrapper.children, toc)
      this.toc = toc
    }

    // TODO: fileposList for resolveHref selector
  }

  private findTocChapter(referenceStr: string): MobiChapter | undefined {
    const tocPosReg = /<reference.*\/>/g
    const refs = referenceStr.match(tocPosReg)
    const typeReg = /type="(.+?)"/
    const fileposReg = /filepos=(.*)/
    if (refs) {
      for (const ref of refs) {
        const type = ref.match(typeReg)?.[1].trim()
        const filepos = ref.match(fileposReg)?.[1].trim()
        if (type === 'toc' && filepos) {
          const tocPos = Number.parseInt(filepos, 10)
          const chapter = this.chapters.find(ch => ch.end > tocPos)
          return chapter
        }
      }
    }
    return undefined
  }

  private parseNavMap(children: any, toc: MobiToc) {
    for (const child of children) {
      const childName = child['#name']
      if (childName === 'p' || childName === 'blockquote') {
        let subItem: MobiTocItem = {
          title: '',
          href: '',
        }
        if (child.a) {
          const a = child.a[0]
          const title = a._
          const filepos = Number(a.$.filepos)
          subItem = {
            title,
            href: `filepos:${filepos}`,
          }
          toc.push(subItem)
        }
        if (child.p || child.blockquote) {
          subItem.children = []
          this.parseNavMap(child.children, subItem.children)
        }
      }
    }
  }

  private loadResource(index: number): string {
    if (this.resourceCache.has(String(index))) {
      return this.resourceCache.get(String(index))!
    }

    const { type, raw } = this.mobiFile.loadResource(index - 1)
    const resourceUrl = saveResource(raw, type, String(index), this.imageSaveDir)

    this.resourceCache.set(String(index), resourceUrl)
    return resourceUrl
  }

  // TODO: optimize the logic
  private recindexReg = /recindex=["']?(\d+)["']?/
  private mediarecindexReg = /mediarecindex=["']?(\d+)["']?/
  private fileposReg = /filepos=["']?(\d+)["']?/
  private replace(html: string): ProcessedChapter {
    // image
    html = html.replace(
      /<img[^>]*>/g,
      (matched: string) => {
        const recindex = matched.match(this.recindexReg)![1]
        const url = this.loadResource(Number.parseInt(recindex))
        return matched.replace(this.recindexReg, `src="${url}"`)
      },
    )

    // video
    html = html.replace(
      /<(video|audio)[^>]*>/g,
      (matched: string) => {
        // media src
        const mediarecindex = matched.match(this.recindexReg)![1]
        const mediaUrl = this.loadResource(Number.parseInt(mediarecindex))
        matched = matched.replace(this.mediarecindexReg, `src="${mediaUrl}"`)

        const recindex = matched.match(this.recindexReg)?.[1]
        // poster
        if (recindex) {
          const posterUrl = this.loadResource(Number.parseInt(recindex))
          matched = matched.replace(this.recindexReg, `poster="${posterUrl}"`)
        }

        return matched
      },
    )

    // a tag filepos
    html = html.replace(
      /<a[^>]*>/g,
      (matched: string) => {
        const filepos = matched.match(this.fileposReg)![1]
        return matched.replace(this.fileposReg, `href="filepos:${filepos}"`)
      },
    )

    return {
      html,
      css: [],
    }
  }

  resolveHref(href: string): ResolvedHref | undefined {
    const hrefmatch = href.match(/filepos:(\d+)/)
    if (!hrefmatch) {
      return undefined
    }
    const filepos = hrefmatch[1]
    const fileposNum = Number(filepos)
    const chapter = this.chapters.find(ch => ch.end > fileposNum)
    if (chapter) {
      return { id: chapter.id, selector: `[id="filepos:${filepos}"]` }
    }
    return undefined
  }

  destroy() {
    this.resourceCache.forEach((url) => {
      if (__BROWSER__) {
        URL.revokeObjectURL(url)
      }
      else {
        unlink(url, () => { })
      }
    })
  }
}
