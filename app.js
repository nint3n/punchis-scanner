(function () {
  'use strict';

  var DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxW9Uo55FJGwgRQPLWGSNhHU_I-8FnqSfitkmLQCEEDkFxoptmMKfUpv0RXTMUFBv9g/exec';

  var html5QrCode = null;
  var isScanning = false;
  var scanHistory = [];
  var scanCount = 0;
  var lastScannedId = '';
  var lastScanTime = 0;
  var DUPLICATE_COOLDOWN = 3000;

  // ── Storage helpers ──

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem('punchis_scanner_config')) || {};
    } catch (e) { return {}; }
  }

  function saveConfigData(cfg) {
    try { localStorage.setItem('punchis_scanner_config', JSON.stringify(cfg)); } catch (e) {}
  }

  function getApiUrl() {
    var cfg = loadConfig();
    return cfg.apiUrl || DEFAULT_API_URL;
  }

  function getStaffName() {
    var cfg = loadConfig();
    return cfg.staffName || 'Staff';
  }

  function loadHistory() {
    try {
      var stored = JSON.parse(localStorage.getItem('punchis_scan_history'));
      if (Array.isArray(stored)) {
        var today = new Date().toDateString();
        return stored.filter(function (h) { return new Date(h.time).toDateString() === today; });
      }
    } catch (e) {}
    return [];
  }

  function persistHistory() {
    try { localStorage.setItem('punchis_scan_history', JSON.stringify(scanHistory)); } catch (e) {}
  }

  // ── Init ──

  function init() {
    scanHistory = loadHistory();
    scanCount = scanHistory.length;
    updateScanCount();
    renderHistory();
    updateStats();
    startScanner();
    setupOfflineDetection();
  }

  // ── Scanner ──

  function startScanner() {
    if (html5QrCode) {
      try { html5QrCode.stop(); } catch (e) {}
    }

    html5QrCode = new Html5Qrcode('reader');
    var config = { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1.0 };

    html5QrCode.start(
      { facingMode: 'environment' },
      config,
      onScanSuccess,
      function () {}
    ).then(function () {
      isScanning = true;
    }).catch(function (err) {
      console.error('Camera error:', err);
      showToast('Error al abrir camara');
    });
  }

  function onScanSuccess(decodedText) {
    var ticketId = decodedText.trim();
    var now = Date.now();

    if (ticketId === lastScannedId && (now - lastScanTime) < DUPLICATE_COOLDOWN) {
      return;
    }

    lastScannedId = ticketId;
    lastScanTime = now;

    try { html5QrCode.pause(true); } catch (e) {}

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    verifyTicket(ticketId);
  }

  function verifyTicket(ticketId) {
    var url = getApiUrl() + '?id=' + encodeURIComponent(ticketId);

    fetch(url, { redirect: 'follow' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        handleResult(data, ticketId);
      })
      .catch(function () {
        handleResult({
          success: false,
          status: 'ERROR',
          id_ticket: ticketId,
          nombre: 'Sin conexion',
          cantidad: '?',
          nombre_evento: '',
          lugar_evento: ''
        }, ticketId);
      });
  }

  function handleResult(data, ticketId) {
    var status = (data.status || 'NOT_FOUND').toUpperCase();
    var entry = {
      ticketId: data.id_ticket || ticketId,
      nombre: data.nombre || 'Desconocido',
      status: status,
      cantidad: data.cantidad || '1',
      evento: data.nombre_evento || '',
      lugar: data.lugar_evento || '',
      time: new Date().toISOString(),
      staff: getStaffName()
    };

    scanHistory.unshift(entry);
    scanCount++;
    persistHistory();
    updateScanCount();
    renderHistory();
    updateStats();
    showResult(entry);
  }

  function showResult(entry) {
    var overlay = document.getElementById('result-overlay');
    var statusDiv = document.getElementById('result-status');
    var icon = document.getElementById('result-icon');
    var text = document.getElementById('result-text');
    var sub = document.getElementById('result-sub');

    var statusMap = {
      'APROBADO': { cls: 'approved', ico: '✅', txt: 'BOLETO VALIDO', sub: 'Acceso autorizado' },
      'PENDIENTE': { cls: 'pending', ico: '⏳', txt: 'PENDIENTE', sub: 'Pago no confirmado' },
      'RECHAZADO': { cls: 'rejected', ico: '❌', txt: 'RECHAZADO', sub: 'Boleto cancelado' },
      'NOT_FOUND': { cls: 'not-found', ico: '⚠️', txt: 'NO ENCONTRADO', sub: 'ID no existe en el sistema' },
      'CHECKED_IN': { cls: 'checked-in', ico: '🔄', txt: 'YA INGRESO', sub: 'Este boleto ya fue usado' },
      'ERROR': { cls: 'not-found', ico: '⚠️', txt: 'ERROR', sub: 'No se pudo verificar' }
    };

    var info = statusMap[entry.status] || statusMap['NOT_FOUND'];
    statusDiv.className = 'result-status ' + info.cls;
    icon.textContent = info.ico;
    text.textContent = info.txt;
    sub.textContent = info.sub;

    document.getElementById('result-name').textContent = entry.nombre;
    document.getElementById('r-ticket-id').textContent = entry.ticketId;
    document.getElementById('r-qty').textContent = entry.cantidad + ' entrada(s)';
    document.getElementById('r-event').textContent = entry.evento || 'PUNCHIS PUNCHIS';
    document.getElementById('r-venue').textContent = entry.lugar || 'N/A';

    overlay.classList.add('show');

    if (entry.status === 'APROBADO' && navigator.vibrate) {
      navigator.vibrate([50, 30, 50, 30, 50]);
    }
  }

  window.closeResult = function () {
    document.getElementById('result-overlay').classList.remove('show');
    try { html5QrCode.resume(); } catch (e) { startScanner(); }
  };

  // ── Tabs ──

  window.switchTab = function (tab) {
    var tabs = document.querySelectorAll('.tab');
    var views = document.querySelectorAll('.view');
    tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === tab); });
    views.forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + tab); });
  };

  // ── History ──

  function renderHistory() {
    var list = document.getElementById('history-list');
    var empty = document.getElementById('history-empty');

    if (scanHistory.length === 0) {
      empty.style.display = 'flex';
      var items = list.querySelectorAll('.history-item');
      items.forEach(function (el) { el.remove(); });
      return;
    }

    empty.style.display = 'none';
    var items = list.querySelectorAll('.history-item');
    items.forEach(function (el) { el.remove(); });

    scanHistory.forEach(function (h) {
      var statusClass = 's-' + (h.status === 'APROBADO' ? 'approved'
        : h.status === 'PENDIENTE' ? 'pending'
        : h.status === 'RECHAZADO' ? 'rejected'
        : h.status === 'CHECKED_IN' ? 'checked-in'
        : 'not-found');

      var time = new Date(h.time);
      var timeStr = time.getHours().toString().padStart(2, '0') + ':' + time.getMinutes().toString().padStart(2, '0');

      var div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML =
        '<div class="hi-status ' + statusClass + '"></div>' +
        '<div class="hi-info">' +
          '<div class="hi-name">' + escapeHtml(h.nombre) + '</div>' +
          '<div class="hi-meta">' + escapeHtml(h.ticketId) + ' &middot; ' + (h.cantidad || 1) + ' boleto(s)</div>' +
        '</div>' +
        '<div class="hi-time">' + timeStr + '</div>';
      list.appendChild(div);
    });
  }

  // ── Stats ──

  function updateStats() {
    var total = scanHistory.length;
    var approved = scanHistory.filter(function (h) { return h.status === 'APROBADO'; }).length;
    var pending = scanHistory.filter(function (h) { return h.status === 'PENDIENTE'; }).length;
    var rejected = scanHistory.filter(function (h) {
      return h.status === 'RECHAZADO' || h.status === 'NOT_FOUND' || h.status === 'ERROR';
    }).length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-approved').textContent = approved;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-rejected').textContent = rejected;

    var recentList = document.getElementById('recent-list');
    recentList.innerHTML = '';
    var recent = scanHistory.slice(0, 5);
    recent.forEach(function (h) {
      var statusClass = 's-' + (h.status === 'APROBADO' ? 'approved'
        : h.status === 'PENDIENTE' ? 'pending'
        : h.status === 'RECHAZADO' ? 'rejected'
        : 'not-found');

      var time = new Date(h.time);
      var timeStr = time.getHours().toString().padStart(2, '0') + ':' + time.getMinutes().toString().padStart(2, '0');

      var div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML =
        '<div class="hi-status ' + statusClass + '"></div>' +
        '<div class="hi-info"><div class="hi-name">' + escapeHtml(h.nombre) + '</div>' +
        '<div class="hi-meta">' + escapeHtml(h.ticketId) + '</div></div>' +
        '<div class="hi-time">' + timeStr + '</div>';
      recentList.appendChild(div);
    });
  }

  function updateScanCount() {
    document.getElementById('scan-count').textContent = scanCount;
  }

  // ── Config Modal ──

  window.openConfig = function () {
    var cfg = loadConfig();
    document.getElementById('cfg-url').value = cfg.apiUrl || DEFAULT_API_URL;
    document.getElementById('cfg-staff').value = cfg.staffName || '';
    document.getElementById('test-result').className = 'test-result';
    document.getElementById('test-result').textContent = '';
    document.getElementById('config-modal').classList.add('show');
  };

  window.closeConfig = function () {
    document.getElementById('config-modal').classList.remove('show');
  };

  window.saveConfig = function () {
    var url = document.getElementById('cfg-url').value.trim();
    var staff = document.getElementById('cfg-staff').value.trim();
    if (!url) {
      showToast('Ingresa la URL de la API');
      return;
    }
    saveConfigData({ apiUrl: url, staffName: staff });
    closeConfig();
    showToast('Configuracion guardada');
  };

  window.testConnection = function () {
    var url = document.getElementById('cfg-url').value.trim();
    var result = document.getElementById('test-result');
    if (!url) {
      result.className = 'test-result test-fail';
      result.textContent = 'Ingresa una URL primero';
      return;
    }

    result.className = 'test-result';
    result.style.display = 'block';
    result.style.background = 'rgba(0,229,255,0.1)';
    result.style.color = '#67F0FF';
    result.style.border = '1px solid rgba(0,229,255,0.3)';
    result.textContent = 'Conectando...';

    fetch(url + '?action=summary', { redirect: 'follow' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        result.className = 'test-result test-ok';
        var event = data.nombre_evento || data.evento || 'Conectado';
        result.textContent = 'Conexion exitosa: ' + event;
      })
      .catch(function () {
        result.className = 'test-result test-fail';
        result.textContent = 'Error de conexion. Verifica la URL.';
      });
  };

  // ── Offline detection ──

  function setupOfflineDetection() {
    var banner = document.getElementById('offline-banner');
    function update() {
      banner.classList.toggle('show', !navigator.onLine);
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  // ── Toast ──

  function showToast(msg) {
    var toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function () { toast.classList.remove('show'); }, 2500);
  }

  // ── Utils ──

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  // ── Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
