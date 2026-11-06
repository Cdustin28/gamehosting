// Settings for coi-serviceworker.js, which lets the emulator run its
// multithreaded cores on GitHub Pages. Threads need the page to be
// "cross-origin isolated", which normally requires server headers that
// GitHub Pages can't send; the service worker adds them instead.
//
// We use COEP "credentialless" so images, fonts and the EmulatorJS CDN
// keep loading. Safari and every iPhone/iPad browser don't support it, so
// the worker isn't registered there and games run single-threaded.
(function () {
  var ua = navigator.userAgent;
  var isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var chrome = /(?:Chrome|Chromium|Edg)\/(\d+)/.exec(ua);
  var firefox = /Firefox\/(\d+)/.exec(ua);
  var supported = !isIOS && ((chrome && +chrome[1] >= 96) || (firefox && +firefox[1] >= 119));
  window.coi = {
    shouldRegister: function () { return supported; },
    // Remove a previously installed worker if this browser can't use it.
    shouldDeregister: function () { return !supported; },
    coepCredentialless: function () { return true; },
    quiet: true,
  };
})();
