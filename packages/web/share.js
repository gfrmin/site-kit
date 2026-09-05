// Native share with a four-state result.
//
// From kaomoji's src/lib/share.js. The state that matters is "dismissed": a
// user who opens the share sheet and backs out produces an AbortError, which is
// not a failure and must not show an error. blazon's useShareActions catches
// everything in one branch and cannot tell those apart.

import { copyText } from './clipboard.js'

/**
 * @param {{title?: string, text?: string, url: string}} data
 * @returns {Promise<'shared'|'copied'|'dismissed'|'failed'>}
 */
export const shareOrCopy = async (data) => {
  if (navigator.share) {
    try {
      await navigator.share(data)
      return 'shared'
    } catch (err) {
      // The user opened the sheet and cancelled. Not an error; say nothing.
      if (err?.name === 'AbortError') return 'dismissed'
      // Anything else (no permission, unsupported payload) falls through to copy.
    }
  }
  return (await copyText(data.url)) ? 'copied' : 'failed'
}
