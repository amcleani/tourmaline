// jsdom does not implement layout APIs the UI calls. (Skipped in files that
// opt into `// @vitest-environment node`, where there is no DOM.)
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = function () {};
}
