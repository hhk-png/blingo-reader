import path from 'node:path'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createZipFile } from '../src/utils.ts'

const aliceEpubNames = [
  '19033/toc.ncx',
  'META-INF/',
  '19033/content.opf',
  '19033/',
  'mimetype',
  'META-INF/container.xml',
  '19033/www.gutenberg.org@files@19033@19033-h@images@cover_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@title.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@plate01_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i001_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i002_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i003_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i004_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i005_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i006_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@plate02_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i007_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i008_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i009_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i010_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i011_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i012_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@plate03_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i013_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i014_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i015_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i016_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i017_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@plate04_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i018_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i019_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i020_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i021_th.jpg',
  '19033/www.gutenberg.org@files@19033@19033-h@images@i022_th.jpg',
  '19033/pgepub.css',
  '19033/0.css',
  '19033/1.css',
  '19033/www.gutenberg.org@files@19033@19033-h@19033-h-0.htm',
]

describe('createZipFile in Node', async () => {
  // @ts-expect-error __BROWSER__ is for build process
  globalThis.__BROWSER__ = false

  const epubPath = path.resolve('./example/alice.epub')
  const epubFile = await createZipFile(epubPath)

  it('names in epub', () => {
    expect(epubFile.getNames()).toEqual(aliceEpubNames)
  })

  it('readFile', async () => {
    const fileContent = await epubFile.readFile('mimetype')
    expect(fileContent).toEqual('application/epub+zip')
  })

  it('readFile if file not exit', async () => {
    await expect(epubFile.readFile('not-exist')).rejects.toThrow()
  })

  it('readImage', async () => {
    const imageContent = await epubFile.readResource(
      '19033/www.gutenberg.org@files@19033@19033-h@images@i022_th.jpg',
    )
    expect(imageContent.length).toBeGreaterThan(0)
  })

  it('readImage if file not exit', async () => {
    await expect(epubFile.readResource('not-exist')).rejects.toThrow()
  })
})

describe('createZipFile in Browser', async () => {
  // @ts-expect-error __BROWSER__ is for build process
  globalThis.__BROWSER__ = true

  const epubPath = path.resolve('./example/alice.epub')
  const fileReaderResult = fs.readFileSync(epubPath)

  // simulate FileReader in browser
  class FileReader {
    result: any
    onload = () => { }
    onerror = () => { }
    readAsArrayBuffer = () => { }
    constructor() {
      this.result = fileReaderResult
      setTimeout(() => {
        this.onload()
      }, 10)
    }
  }
  // @ts-expect-error simulate FileReader in browser
  globalThis.FileReader = FileReader

  it('can parse .zip file through FileReader', async () => {
    const epubFile = await createZipFile(epubPath)
    expect(epubFile.getNames()).toEqual(aliceEpubNames)
  })
})
