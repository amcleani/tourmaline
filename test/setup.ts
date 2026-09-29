// jsdom does not implement layout APIs the UI calls.
Element.prototype.scrollIntoView = function () {};
