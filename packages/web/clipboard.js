// Copy to clipboard, honestly.
//
// Taken from kaomoji's src/lib/store.js, which is the only complete version in
// the fleet: it has the execCommand fallback and it returns whether the copy
// actually happened. blazon has three partial copies (SharePopover.jsx,
// ShareView.jsx, Studio.jsx), all `navigator.clipboard?.writeText(v).catch(()=>{})`
// — which shows a "Copied!" toast on browsers where nothing was copied.

const fallbackCopy = (value) => {
  const el = document.createElement('textarea')
  el.value = value
  el.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {}
  document.body.removeChild(el)
  return ok
}

/**
 * @param {string} value
 * @returns {Promise<boolean>} true only if the text really reached the clipboard.
 */
export const copyText = async (value) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Permission denied, insecure context, or a browser that rejects a write
      // outside a user gesture — fall through rather than reporting success.
    }
  }
  return fallbackCopy(value)
}
