import { readFileSync } from 'node:fs'
import { parsexml } from '@blingo-reader/shared'
import { saveResource } from './utils'
import {
  concatTypedArrays,
  mbpPagebreakRegex,
  toArrayBuffer,
} from './book'
import { MobiFile } from './mobiFile'
import type { Chapter, TocItem } from './types'

interface Options {
  imageSaveDir?: string
}

export async function initMobiFile(file: string | File, options?: Options) {
  const mobi = new Mobi(file, options)
  await mobi.load()
  await mobi.init()

  return mobi
}

export class Mobi {
  private fileArrayBuffer!: ArrayBuffer
  private mobiFile!: MobiFile

  // chapter
  private chapters: Chapter[] = []
  private idToChapter = new Map<number, Chapter>()
  private toc: TocItem[] = []

  private imageSaveDir = './images'

  public getSpine() {
    return this.chapters
  }

  public getChapterById(id: number) {
    return this.replace(this.idToChapter.get(id)!.text)
  }

  public getNavMap() {
    return this.toc
  }

  public getCoverImage() {
    const coverImage = this.mobiFile.getCoverImage()
    if (coverImage) {
      return saveResource(coverImage.raw, coverImage.type, 'cover', this.imageSaveDir)
    }
    return undefined
  }

  public getMetadata() {
    return this.mobiFile.getMetadata()
  }

  constructor(private file: string | File, options: Options = {}) {
    this.imageSaveDir = options.imageSaveDir ?? './images'
  }

  async load() {
    this.fileArrayBuffer = await toArrayBuffer(
      __BROWSER__
        ? this.file as File
        : readFileSync(this.file as string),
    )
    this.mobiFile = new MobiFile(this.fileArrayBuffer)
  }

  async init() {
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
    const chapters: Chapter[] = []
    const idToChapter = new Map<number, Chapter>()
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
      const chapter: Chapter = {
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
      const toc: TocItem[] = []
      this.parseNavMap(tocAst.wrapper.children, toc)
      this.toc = toc
    }

    // TODO: fileposList for resolveHref selector
  }

  private findTocChapter(referenceStr: string): Chapter | undefined {
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

  private parseNavMap(children: any, toc: TocItem[]) {
    for (const child of children) {
      const childName = child['#name']
      if (childName === 'p' || childName === 'blockquote') {
        let subItem: TocItem = {
          title: '',
          id: -1,
        }
        if (child.a) {
          const a = child.a[0]
          const title = a._
          const filepos = Number(a.$.filepos)
          const chapter = this.chapters.find(ch => ch.end > filepos)
          subItem = {
            title,
            id: chapter?.id ?? -1,
          }
        }
        toc.push(subItem)
        if (child.p || child.blockquote) {
          subItem.children = []
          this.parseNavMap(child.children, subItem.children)
        }
      }
    }
  }

  loadResource(index: number): string {
    const { type, raw } = this.mobiFile.loadResource(index - 1)
    return saveResource(raw, type, String(index), this.imageSaveDir)
  }

  // TODO: optimize the logic
  private recindexReg = /recindex=["']?(\d+)["']?/
  private mediarecindexReg = /mediarecindex=["']?(\d+)["']?/
  private fileposReg = /filepos=["']?(\d+)["']?/
  private replace(str: string) {
    // image
    str = str.replace(
      /<img[^>]*>/g,
      (matched: string) => {
        const recindex = matched.match(this.recindexReg)![1]
        const url = this.loadResource(Number.parseInt(recindex))
        return matched.replace(this.recindexReg, `src="${url}"`)
      },
    )

    // video
    str = str.replace(
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
          matched = matched.replace(this.recindexReg, `poster=${posterUrl}`)
        }

        return matched
      },
    )

    // a tag filepos
    str = str.replace(
      /<a[^>]*>/g,
      (matched: string) => {
        const filepos = matched.match(this.fileposReg)![1]
        return matched.replace(this.fileposReg, `href="filepos:${filepos}"`)
      },
    )

    return str
  }

  resolveHref(href: string) {
    const filepos = href.match(/filepos:(\d+)/)![1]
    const fileposNum = Number(filepos)
    const chapter = this.chapters.find(ch => ch.end > fileposNum)
    return { id: chapter?.id, selector: `[id="filepos:${filepos}]` }
  }
}
