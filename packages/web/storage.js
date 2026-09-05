// localStorage that cannot throw.
//
// blazon learned this twice in one repo — library.js:49 and unlock.js:38 both
// carry the same comment about sandboxed contexts throwing on *merely accessing*
// localStorage. That is why the guard is around the access, not just the call:
// `typeof localStorage` itself is enough to raise in some embedded webviews and
// in a browser configured to block site data.

/** @template T @param {string} key @param {T} fallback @returns {T} */
export const readJson = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** @returns {boolean} whether the write actually landed */
export const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Quota exceeded, private mode, or blocked site data.
    return false
  }
}

export const remove = (key) => {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/** Prepend, dedupe, cap — the recents/favourites pattern. Pure. */
export const prependCapped = (list, value, cap = 30) =>
  [value, ...list.filter((x) => x !== value)].slice(0, cap)

/** Toggle membership. Pure. */
export const toggleInList = (list, value) =>
  list.includes(value) ? list.filter((x) => x !== value) : [value, ...list]
