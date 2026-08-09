// Extraido del inline de analisis.html (CSP: script-src sin unsafe-inline).

    (function () {
      var P = window.FORMULA_API_PREFIX || '';
      if (!P) return;
      var o = window.fetch;
      window.fetch = function (input, init) {
        if (typeof input === 'string' && input.indexOf('/api/') === 0) input = P + input;
        return o.call(this, input, init);
      };
    })();
  