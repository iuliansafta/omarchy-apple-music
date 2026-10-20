// Re-applies the last Omarchy theme stylesheet before first paint. The bridge
// daemon only reaches the page about a second after load; duration-bridge.js's
// applyTheme() takes over this element from then on.
;(function() {
  try {
    var css = localStorage.getItem("omarchy-apple-music-theme")
    if (!css) return
    var style = document.createElement("style")
    style.id = "omarchy-apple-music-theme"
    style.textContent = css
    document.documentElement.appendChild(style)
  } catch (_) {}
})()
