// The visually-hidden rule, once.
//
// The same eight declarations exist three times in the fleet under three names:
// `.visually-hidden` (kaomoji global.css:199), `.sr-only` (docavivplus
// global.css:31), and a JS object `srOnly` (blazon ui.jsx:13, which cannot use a
// class because that repo styles everything inline on purpose).
//
// Both shapes are exported so a repo can keep its own styling doctrine.

/** For inline-style repos. Numeric values; React/DOM adds the px. */
export const srOnly = Object.freeze({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
})

/** For stylesheet repos. Pass the class name you already use. */
export const srOnlyCss = (className = 'sr-only') => `.${className} {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}`
