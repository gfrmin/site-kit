import { createAnalytics } from './analytics.js'

document.getElementById('app').textContent = '{{NAME}}'

const analytics = createAnalytics({
  key: import.meta.env?.VITE_POSTHOG_KEY,
  host: import.meta.env?.VITE_POSTHOG_HOST,
  dnt: navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true
})

analytics.capture('$pageview', { $current_url: location.href, $pathname: location.pathname })
