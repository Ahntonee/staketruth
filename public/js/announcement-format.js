(function (root) {
  'use strict';
  function escape(value) {
    return String(value || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function inline(value) {
    return escape(value)
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  }
  function render(value) {
    var list = false;
    var html = String(value || '').replace(/\r/g, '').split('\n').map(function (line) {
      var item = /^\s*[-*] (.*)$/.exec(line);
      if (item) { var start = list ? '' : '<ul>'; list = true; return start + '<li>' + inline(item[1]) + '</li>'; }
      var end = list ? '</ul>' : ''; list = false;
      return end + (line.trim() ? '<p>' + inline(line) + '</p>' : '<br>');
    }).join('');
    return html + (list ? '</ul>' : '');
  }
  var api = { render: render };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnnouncementFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
