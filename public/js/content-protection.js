/* StakeTruth — light content protection.
   Scope is intentionally narrow: locked/gated prediction content should not be
   selectable or right-click-copyable (it's blurred anyway, this is defense in
   depth). We deliberately do NOT disable browser devtools, global right-click,
   or text selection site-wide — that breaks accessibility and normal use for
   zero real security benefit against a determined visitor. */
(function () {
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest && e.target.closest('.locked-card__content')) e.preventDefault();
  });
  document.addEventListener('copy', function (e) {
    if (window.getSelection && window.getSelection().anchorNode) {
      var node = window.getSelection().anchorNode;
      var el = node.nodeType === 3 ? node.parentElement : node;
      if (el && el.closest && el.closest('.locked-card__content')) e.preventDefault();
    }
  });
})();
