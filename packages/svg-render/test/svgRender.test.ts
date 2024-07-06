import { describe, expect, it } from 'vitest'
import { SvgRender } from '../src/svgRender'

describe('svgRender', () => {
  const renderer = new SvgRender({
    padding: '10 10 10 10',
  })
  it('options.padding', () => {
    const {
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
    } = renderer.options
    expect(paddingTop).toBe(10)
    expect(paddingRight).toBe(10)
    expect(paddingBottom).toBe(10)
    expect(paddingLeft).toBe(10)
  })

  it('generateRect', () => {
    const { width, height, backgroundColor } = renderer.options
    expect(renderer.background).toBe(
      `<rect width="${width}" height="${height}"`
      + ` fill="${backgroundColor}" pointer-events="none"/>`,
    )
  })

  it('genarateSvg', () => {
    expect(renderer.generateSvg('<text x="100" y="100">hello</text>'))
      .toBe(
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '
        + 'viewBox="0 0 500 500" width="500px" height="500px">'
        + '<rect width="500" height="500" fill="#f0f0f0" pointer-events="none"/>'
        + '<text x="100" y="100">hello</text></svg>',
      )
  })
})
