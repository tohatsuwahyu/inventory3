/* qrlib.js — loader ringan untuk qrcodejs
   Dipakai oleh ensureQRCode() di app.js. */
(function () {
  if (window.QRCode) return;
  function load(u, cb) {
    var s = document.createElement("script");
    s.src = u; s.async = true; s.crossOrigin = "anonymous";
    s.onload = cb; s.onerror = cb;
    document.head.appendChild(s);
  }
  load("https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js", function () {
    if (!window.QRCode) {
      load("https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js", function(){});
    }
  });
})();
