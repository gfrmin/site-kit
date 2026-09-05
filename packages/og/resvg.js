// Rasterise an SVG string to PNG bytes in a Worker, via @resvg/resvg-wasm.
//
// Merged from two independent implementations that had each solved a different
// half of this problem and were missing the other's half:
//
//   blazon  functions/_lib/resvg.js  — lazy dynamic import, so `node --test`
//     can import a module that transitively reaches this one without needing
//     Node's own WASM-as-ESM support (which does not work for this
//     wasm-bindgen module regardless). Had no rejection handling: a transient
//     init failure poisoned the isolate permanently.
//
//   kaomoji functions/og/maker.js    — clears the memo on rejection, so a
//     transient failure does not poison the isolate. Used a static import,
//     which is fine in the bundler but makes the importing module unloadable
//     under plain Node, so its OG route has no tests.
//
// This keeps both: the caller supplies the loaders (so the literal import
// specifiers stay where the bundler can statically see them), and this module
// owns the once-per-isolate lifecycle, the rejection clearing, and the
// render/free discipline.
//
// Both pinned @resvg/resvg-wasm@2.6.2. Keep that pin in step across sites.

import { Resvg, initWasm } from '@resvg/resvg-wasm'

/**
 * Build a rasteriser bound to one site's wasm binary and fonts.
 *
 * @param {object} deps
 * @param {() => Promise<WebAssembly.Module|BufferSource>} deps.loadWasm
 *   Must contain a *literal* import specifier so the bundler can find the
 *   binary, e.g. `() => import('../../node_modules/@resvg/resvg-wasm/index_bg.wasm').then(m => m.default)`.
 * @param {() => Promise<Uint8Array[]>} [deps.loadFonts]
 *   resvg-wasm ships no fonts and the Workers runtime has no OS font store, so
 *   text renders as *nothing* — silently, with no error — unless fonts are fed
 *   in. blazon lost a whole motto to this before noticing.
 * @param {string} [deps.fontFamily]
 *   Set as both `serifFamily` and `defaultFontFamily`. An SVG whose
 *   `font-family` ends in a generic keyword (`serif`) resolves through to this.
 * @returns {{svgToPng: (svg: string, opts: {width: number}) => Promise<Uint8Array>}}
 */
export function createRasteriser({ loadWasm, loadFonts, fontFamily } = {}) {
  if (typeof loadWasm !== 'function') {
    throw new TypeError('createRasteriser: loadWasm must be a function returning the wasm module')
  }

  // Workers reuse a warm isolate across requests and initWasm throws if called
  // twice, so this is memoised — but cleared on rejection, so one bad init does
  // not permanently break every later request on the same isolate.
  let ready = null
  const ensureReady = () => {
    if (!ready) {
      ready = Promise.all([
        Promise.resolve(loadWasm()).then((mod) => initWasm(mod)),
        loadFonts ? Promise.resolve(loadFonts()) : Promise.resolve([]),
      ])
        .then(([, fonts]) => fonts)
        .catch((err) => {
          ready = null
          throw err
        })
    }
    return ready
  }

  /**
   * @param {string} svg  A complete SVG document with explicit pixel width and
   *   height on the root element — `fitTo` locks output width, and height then
   *   follows from the document's own aspect ratio.
   * @param {{width: number}} opts
   * @returns {Promise<Uint8Array>}
   */
  const svgToPng = async (svg, { width }) => {
    const fontBuffers = await ensureReady()
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: {
        fontBuffers,
        loadSystemFonts: false, // there is no OS font store in this runtime
        ...(fontFamily ? { serifFamily: fontFamily, defaultFontFamily: fontFamily } : {}),
      },
    })
    const rendered = resvg.render()
    const png = rendered.asPng()
    // Both frees matter: these are wasm-heap handles, not GC'd objects, and a
    // warm isolate serving many requests will otherwise grow until it is evicted.
    rendered.free()
    resvg.free()
    return png
  }

  return { svgToPng }
}

/** Decode an array of base64 font subsets, as shipped by a generated _fonts.js. */
export const decodeFontsB64 = (fontsB64) =>
  fontsB64.map((b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))

/** Escape a string for interpolation into SVG/XML text content or an attribute. */
export const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
