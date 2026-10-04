/* Supabase bootstrap */
const supabaseUrl = "https://vxtefnajeqwwditdwwcs.supabase.co";
      const supabaseKey =
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4dGVmbmFqZXF3d2RpdGR3d2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0Mzc5MjEsImV4cCI6MjA4NDAxMzkyMX0.HFURBIenpBqaqkiF-CGsdBoTTqhdqFznDU8ntITnIWY";
      let supabaseClient;
      try {
          supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
      } catch (e) {
          console.warn("Supabase no disponible:", e);
      }

/* POS application */
const DOCK_DEFAULTS = [
  {name:'Reportes',   icon:'https://img.icons8.com/?size=80&id=tIA2ws1t2kbo&format=png&color=000000', url:'javascript:abrirReportes()'},
  {name:'Abrir Caja', icon:'https://img.icons8.com/?size=80&id=q7ZjJsoiJjH3&format=png&color=000000', url:'javascript:abrirCaja()'},
  {name:'Inventarios',icon:'https://img.icons8.com/?size=80&id=112521&format=png&color=000000',        url:'javascript:abrirInventarios()'},
  {name:'Órdenes',    icon:'https://img.icons8.com/?size=80&id=qOH8AEbMnHas&format=png&color=000000',  url:'javascript:abrirOrdenes()'},
];

function loadDock() {
  try {
    const s = JSON.parse(localStorage.getItem('sopglide_dock_v2'));
    if (Array.isArray(s) && s.length === DOCK_DEFAULTS.length && s[0].icon !== undefined) return s;
  } catch(_){}
  return DOCK_DEFAULTS.map(d => ({...d}));
}
function saveDock(apps) { localStorage.setItem('sopglide_dock_v2', JSON.stringify(apps)); }

let dockApps = loadDock();
let selectedIdx = null;
let editIdx = null;

// Variables de sesión y turno — declaradas aquí para evitar TDZ
let _sessionCache = null;
let _turnoCache   = null;

/* ========== TURNO DE CAJA ========== */
// Turno en memoria únicamente — nunca localStorage
// Así siempre refleja el estado real de Supabase al recargar
function getTurno()    { return _turnoCache; }
function setTurno(t)   { _turnoCache = t; }
function clearTurno()  { _turnoCache = null; }

/*
 * La tabla ventas no tiene una columna de número de orden.
 * Usamos el ID que Supabase ya genera como referencia estable de la
 * comanda. Así dos cajas nunca imprimen el mismo identificador por
 * competir con COUNT(*) o con localStorage.
 */
function getOrderReference(id) {
  const value = String(id ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  if (!value) return '—';
  return value.length > 6 ? value.slice(-6) : value.padStart(3, '0');
}

function cajaShowStep(id) {
  ['caja-step1','caja-step2','caja-step-cierre','caja-step-monitor','caja-step-cierre-remoto'].forEach(s => {
    document.getElementById(s).classList.toggle('active', s === id);
  });
}

async function abrirCaja() {
  const s = getCurrentSession();
  if (!s) { showToast('⚠️ Inicia sesión primero', 2500); return; }
  document.getElementById('caja-modal').classList.add('open');
  cajaShowStep('caja-step1');
  await renderOverviewCajas(s);
}

async function renderOverviewCajas(s) {
  const list = document.getElementById('overview-cajas-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;color:var(--text-dim);font-size:13px;padding:10px;">Cargando…</div>';

  // Sincronizar turno desde Supabase — consulta el turno MÁS RECIENTE sin filtrar estado
  // para detectar cierres remotos aunque el local diga 'abierta'
  let turno = getTurno();
  let cajasAbiertasSet = new Set();
  if (supabaseClient && s.usuario) {
    try {
      const { data: turnoSupa, error: turnoErr } = await supabaseClient
        .from('turnos_caja').select('*')
        .eq('cajero', s.usuario)
        .order('abierta_en', { ascending: false }).limit(1).maybeSingle();
      if (!turnoErr) {
        if (turnoSupa && turnoSupa.estado === 'abierta') {
          turno = turnoSupa; setTurno(turnoSupa);
        } else {
          // Turno cerrado o inexistente en Supabase → limpiar caché local
          turno = null; clearTurno();
        }
      }
    } catch(_) {}
  }

  // Admin: cargar qué cajas tienen turno abierto en Supabase
  const esAdmin = !!(s?.admin) || esCajaSupervisora(s);
  if (esAdmin && supabaseClient) {
    try {
      const { data: abiertos } = await supabaseClient
        .from('turnos_caja').select('caja').eq('estado', 'abierta');
      (abiertos || []).forEach(t => { if (t.caja) cajasAbiertasSet.add(t.caja); });
    } catch(_) {}
  }

  const miTurnoAbierto = turno && turno.cajero === s.usuario && turno.estado === 'abierta';
  let cajerasPorCaja = {};
  if (supabaseClient) {
    try {
      const { data } = await supabaseClient.from('cajeras').select('nombre,caja').eq('activo', true);
      (data||[]).forEach(c => { if (c.caja) cajerasPorCaja[c.caja] = c.nombre; });
    } catch(_){}
  }
  let cajas = Object.keys(cajerasPorCaja);
  if (!cajas.length) cajas = ['Caja 1','Caja 2','Caja 3','Caja 4'];
  cajas = cajas.sort();

  list.innerHTML = cajas.map(caja => {
    const nombre = cajerasPorCaja[caja] || '—';
    const esMia = caja === s.caja;
    const num = caja.replace(/[^0-9]/g,'') || caja;
    const barraNombre = caja === 'Caja 1' || caja === 'Caja 2'
      ? 'Barra Principal'
      : caja === 'Caja 3'
        ? 'Barra VIP'
        : caja === 'Caja 4'
          ? 'Barra Cholet'
          : '';
    const barraBadge = barraNombre
      ? `<span style="font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:rgba(180,210,255,0.80);background:rgba(100,140,255,0.10);border:1px solid rgba(140,170,255,0.22);border-radius:6px;padding:2px 7px;margin-top:5px;display:inline-block;">${barraNombre}</span>`
      : '';
    const icono = caja === 'Caja 3' || caja === 'Caja 4'
      ? '🍹'
      : `<img src="https://img.icons8.com/?size=100&id=w1h9Auk9h4W9&format=png&color=FFFFFF" style="width:24px;height:24px;">`;

    // Caja de otra cajera — solo admin puede interactuar
    if (!esMia && !esAdmin) {
      return `<div class="caja-card-horiz" style="opacity:.42;pointer-events:none;">
        <div class="caja-abrir-square" style="cursor:default;">
          <span style="font-size:26px;line-height:1;">${icono}</span>
          <span style="font-size:11px;opacity:.7;">Caja</span>
        </div>
        <div class="caja-card-right">
          <div class="caja-card-num">${num}</div>
          <div class="caja-card-cajera">${nombre}</div>
          ${barraBadge}
        </div>
      </div>`;
    }

    // Admin ve cajas ajenas: si está abierta → botón cerrar; si está cerrada → dimmed
    if (!esMia && esAdmin) {
      if (cajasAbiertasSet.has(caja)) {
        return `<div class="caja-card-horiz" style="border-color:rgba(220,80,80,0.4);">
          <button class="caja-abrir-square" style="background:linear-gradient(135deg,rgba(150,45,45,0.95),rgba(190,65,65,0.95));box-shadow:0 6px 22px rgba(150,45,45,0.42);border-color:rgba(220,80,80,0.5);" onclick="initCierreRemotoDesdeOverview('${caja}')">
            <img src="https://img.icons8.com/?size=100&id=w1h9Auk9h4W9&format=png&color=FFFFFF" style="width:26px;height:26px;">
            <span>Cerrar<br>Caja</span>
          </button>
          <div class="caja-card-right">
            <div class="caja-card-num">${num}</div>
            <div class="caja-card-cajera">${nombre}</div>
            ${barraBadge}
          </div>
        </div>`;
      }
      return `<div class="caja-card-horiz" style="opacity:.45;pointer-events:none;">
        <div class="caja-abrir-square" style="cursor:default;">
          <span style="font-size:26px;line-height:1;">${icono}</span>
          <span style="font-size:11px;opacity:.7;">Cerrada</span>
        </div>
        <div class="caja-card-right">
          <div class="caja-card-num">${num}</div>
          <div class="caja-card-cajera">${nombre}</div>
          ${barraBadge}
        </div>
      </div>`;
    }

    // Propia caja — turno abierto → cerrar
    if (miTurnoAbierto) {
      return `<div class="caja-card-horiz" style="border-color:rgba(220,80,80,0.5);">
        <button class="caja-abrir-square" style="background:linear-gradient(135deg,rgba(150,45,45,0.95),rgba(190,65,65,0.95));box-shadow:0 6px 22px rgba(150,45,45,0.42);border-color:rgba(220,80,80,0.5);" onclick="irACierre()">
          <img src="https://img.icons8.com/?size=100&id=w1h9Auk9h4W9&format=png&color=FFFFFF" style="width:26px;height:26px;">
          <span>Cerrar<br>Caja</span>
        </button>
        <div class="caja-card-right">
          <div class="caja-card-num">${num}</div>
          <div class="caja-card-cajera">${nombre}</div>
          ${barraBadge}
        </div>
      </div>`;
    }
    // Propia caja — cerrada → abrir
    return `<div class="caja-card-horiz">
      <button class="caja-abrir-square" onclick="irAApertura()">
        <span style="font-size:26px;line-height:1;">${icono}</span>
        <span>Abrir<br>Caja</span>
      </button>
      <div class="caja-card-right">
        <div class="caja-card-num">${num}</div>
        <div class="caja-card-cajera">${nombre}</div>
        ${barraBadge}
      </div>
    </div>`;
  }).join('');
}

function irAApertura() {
  const s = getCurrentSession();
  document.getElementById('caja-monto-apertura').value = '';
  const notaEl = document.getElementById('caja-apertura-nota');
  if (notaEl) notaEl.value = '';
  document.querySelectorAll('.caja-quick-btn').forEach(b => b.classList.remove('active'));
  const resEl = document.getElementById('caja-step2-resumen');
  if (resEl) resEl.style.display = 'none';
  if (s) {
    const num = s.caja ? s.caja.replace(/[^0-9]/g,'') || s.caja : '—';
    const el = document.getElementById('caja-step2-cajaname');
    const el2 = document.getElementById('caja-step2-cajero');
    const elF = document.getElementById('caja-step2-fecha');
    const elH = document.getElementById('caja-step2-hora');
    if (el) el.textContent = 'Caja ' + num;
    if (el2) el2.textContent = '👤 ' + (s.nombre || s.usuario);
    const now = new Date();
    if (elF) elF.textContent = now.toLocaleDateString('es-BO', {weekday:'long', day:'numeric', month:'long'});
    if (elH) elH.textContent = now.toLocaleTimeString('es-BO', {hour:'2-digit', minute:'2-digit'});
  }
  cajaShowStep('caja-step2');
  document.getElementById('caja-monto-apertura').focus();
}

function setCajaApertura(amount, btn) {
  document.getElementById('caja-monto-apertura').value = amount;
  document.querySelectorAll('.caja-quick-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const resEl = document.getElementById('caja-step2-resumen');
  const resMontoEl = document.getElementById('caja-step2-resumen-monto');
  if (resEl && resMontoEl) { resEl.style.display = 'block'; resMontoEl.textContent = 'Bs ' + fmt(amount); }
}

function previewCajaApertura() {
  const monto = parseFloat(document.getElementById('caja-monto-apertura').value) || 0;
  const resEl = document.getElementById('caja-step2-resumen');
  const resMontoEl = document.getElementById('caja-step2-resumen-monto');
  if (resEl && resMontoEl) { resEl.style.display = 'block'; resMontoEl.textContent = 'Bs ' + fmt(monto); }
}

function irACierre() {
  const s = getCurrentSession();
  const turno = getTurno();
  if (!s || !turno) return;
  const num = s.caja ? s.caja.replace(/[^0-9]/g,'') || s.caja : '—';
  document.getElementById('caja-cierre-num').textContent = num;
  document.getElementById('caja-cierre-name').textContent = s.nombre;
  document.getElementById('caja-cierre-desde').textContent =
    'Abierta desde ' + new Date(turno.abierta_en).toLocaleTimeString();
  document.getElementById('cierre-efectivo').value = '';
  document.getElementById('cierre-qr').value = '';
  document.getElementById('cierre-tarjeta').value = '';
  document.getElementById('caja-result-grid').style.display = 'none';
  document.getElementById('caja-btn-calcular').style.display = 'block';
  document.getElementById('caja-btn-confirmar-cierre').style.display = 'none';
  cajaShowStep('caja-step-cierre');
}

function updateDockCajaLabel() {
  const turno = getTurno();
  const s = getCurrentSession();
  const estaAbierta = turno && s && turno.cajero === s.usuario && turno.estado === 'abierta';
  const idx = DOCK_DEFAULTS.findIndex(d => d.url === 'javascript:abrirCaja()');
  if (idx >= 0) {
    dockApps[idx].name = estaAbierta ? 'Cerrar Caja' : 'Abrir Caja';
    renderDock();
  }
}

// Botones apertura
document.getElementById('caja-step1-cancel').addEventListener('click', () => {
  document.getElementById('caja-modal').classList.remove('open');
});
document.getElementById('caja-btn-abrir').addEventListener('click', () => {
  cajaShowStep('caja-step2');
  document.getElementById('caja-monto-apertura').focus();
});
document.getElementById('caja-step2-back').addEventListener('click', () => cajaShowStep('caja-step1'));

document.getElementById('caja-btn-confirmar-apertura').addEventListener('click', async () => {
  const s = getCurrentSession();
  if (!s) return;
  const btn = document.getElementById('caja-btn-confirmar-apertura');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'ABRIENDO…';

  const monto = parseFloat(document.getElementById('caja-monto-apertura').value) || 0;
  const ahora = new Date().toISOString();
  const turnoData = {
    cajero: s.usuario, cajero_nombre: s.nombre, caja: s.caja,
    monto_apertura: monto, estado: 'abierta', abierta_en: ahora
  };

  try {
    if (!supabaseClient) {
      throw new Error('No hay conexión con Supabase');
    }

    const { data, error } = await supabaseClient
      .from('turnos_caja')
      .insert([turnoData])
      .select('*')
      .single();

    if (error) {
      // Si otra pestaña/caja ganó la carrera, mostrar el turno real
      // en lugar de crear un turno local que no existe en Supabase.
      if (error.code === '23505') {
        const { data: turnoExistente } = await supabaseClient
          .from('turnos_caja')
          .select('*')
          .eq('caja', s.caja)
          .eq('estado', 'abierta')
          .order('abierta_en', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (turnoExistente) {
          setTurno(turnoExistente);
          showToast(`⚠️ ${s.caja} ya está abierta`, 3500, 'warning');
          document.getElementById('caja-modal').classList.remove('open');
          updateDockCajaLabel();
          return;
        }
      }
      throw error;
    }

    if (!data?.id) throw new Error('Supabase no devolvió el turno creado');

    setTurno(data);
    document.getElementById('caja-modal').classList.remove('open');
    updateDockCajaLabel();
    showToast(`✅ Caja abierta con Bs ${fmt(monto)} de fondo`, 3000);
  } catch (e) {
    console.error('Error guardando turno:', e);
    showToast(`⚠️ No se pudo abrir la caja: ${e.message || 'error de conexión'}`, 4500, 'warning');
    await renderOverviewCajas(s);
  } finally {
    btn.disabled = false;
    btn.textContent = 'CONFIRMAR APERTURA';
  }
});

// Botones cierre
document.getElementById('caja-cierre-cancel').addEventListener('click', async () => {
  const _scc = getCurrentSession();
  if (_scc) { cajaShowStep('caja-step1'); await renderOverviewCajas(_scc); }
  else document.getElementById('caja-modal').classList.remove('open');
});

document.getElementById('caja-btn-calcular').addEventListener('click', async () => {
  const s = getCurrentSession();
  const turno = getTurno();
  if (!s || !turno) return;

   const efReal  = Math.round(parseFloat(document.getElementById('cierre-efectivo').value) || 0);
   const qrReal  = Math.round(parseFloat(document.getElementById('cierre-qr').value)       || 0);
   const tarReal = Math.round(parseFloat(document.getElementById('cierre-tarjeta').value)  || 0);

  // Obtener ventas del turno desde Supabase
  let vEf = 0, vQr = 0, vTar = 0;

  if (supabaseClient && turno.id) {
    try {
      const { data, error } = await supabaseClient
        .from('ventas')
        .select('monto_efectivo,monto_qr,monto_tarjeta')
        .eq('turno_id', turno.id)
        .eq('anulado', false);

      if (error) throw error;

      if (data) data.forEach(v => {
        vEf  += parseFloat(v.monto_efectivo) || 0;
        vQr  += parseFloat(v.monto_qr)       || 0;
        vTar += parseFloat(v.monto_tarjeta)  || 0;
      });

    } catch(e) {
      console.warn('Error consultando ventas:', e);
    }
  }

   const apertura = Math.round(parseFloat(turno.monto_apertura) || 0);
   vEf = Math.round(vEf);
   vQr = Math.round(vQr);
   vTar = Math.round(vTar);
  const efEsp = apertura + vEf; // fondo inicial + ventas efectivo

  const difEf  = efReal  - efEsp;
  const difQr  = qrReal  - vQr;
  const difTar = tarReal - vTar;

  function fmtDif(d) {
     if (Math.abs(d) < 1) return { txt: '✓ Cuadra', cls: 'ok' };
     if (d > 0) return { txt: `+Bs ${fmt(d)} (sobra)`, cls: 'sobra' };
     return { txt: `-Bs ${fmt(Math.abs(d))} (falta)`, cls: 'falta' };
  }
  function setEl(id, txt, cls) {
    const el = document.getElementById(id);
    el.textContent = txt; el.className = 'val ' + (cls || '');
  }

   setEl('cr-ef-esp',  `Bs ${fmt(efEsp)}`);
   setEl('cr-ef-real', `Bs ${fmt(efReal)}`);
  const de = fmtDif(difEf);  setEl('cr-ef-dif',  de.txt, de.cls);

   setEl('cr-qr-esp',  `Bs ${fmt(vQr)}`);
   setEl('cr-qr-real', `Bs ${fmt(qrReal)}`);
  const dq = fmtDif(difQr);  setEl('cr-qr-dif',  dq.txt, dq.cls);

   setEl('cr-tar-esp',  `Bs ${fmt(vTar)}`);
   setEl('cr-tar-real', `Bs ${fmt(tarReal)}`);
  const dt = fmtDif(difTar); setEl('cr-tar-dif',  dt.txt, dt.cls);

   const todoCuadra = Math.abs(difEf) < 1 && Math.abs(difQr) < 1 && Math.abs(difTar) < 1;
  setEl('cr-estado', todoCuadra ? '✅ Cuadre perfecto' : '⚠️ Hay diferencias', todoCuadra ? 'ok' : 'falta');

  // Guardar los valores calculados para el confirm
  document.getElementById('caja-btn-calcular').dataset.efEsp  = efEsp;
  document.getElementById('caja-btn-calcular').dataset.vQr    = vQr;
  document.getElementById('caja-btn-calcular').dataset.vTar   = vTar;
  document.getElementById('caja-btn-calcular').dataset.difEf  = difEf;
  document.getElementById('caja-btn-calcular').dataset.difQr  = difQr;
  document.getElementById('caja-btn-calcular').dataset.difTar = difTar;

  document.getElementById('caja-result-grid').style.display = 'flex';
  document.getElementById('caja-btn-calcular').style.display = 'none';
  document.getElementById('caja-btn-confirmar-cierre').style.display = 'block';
});

document.getElementById('caja-btn-confirmar-cierre').addEventListener('click', async () => {
  const s = getCurrentSession();
  const turno = getTurno();
  if (!s || !turno) return;

  const btn = document.getElementById('caja-btn-calcular');
  const confirmBtn = document.getElementById('caja-btn-confirmar-cierre');
  if (confirmBtn.disabled) return;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'GUARDANDO CIERRE…';
  const efReal  = parseFloat(document.getElementById('cierre-efectivo').value) || 0;
  const qrReal  = parseFloat(document.getElementById('cierre-qr').value)       || 0;
  const tarReal = parseFloat(document.getElementById('cierre-tarjeta').value)  || 0;

  const cierreData = {
     monto_cierre_efectivo: Math.round(efReal),
     monto_cierre_qr:       Math.round(qrReal),
     monto_cierre_tarjeta:  Math.round(tarReal),
    ventas_efectivo:  parseFloat(btn.dataset.efEsp) - (parseFloat(turno.monto_apertura) || 0),
    ventas_qr:        parseFloat(btn.dataset.vQr),
    ventas_tarjeta:   parseFloat(btn.dataset.vTar),
    diferencia_efectivo: parseFloat(btn.dataset.difEf),
    diferencia_qr:       parseFloat(btn.dataset.difQr),
    diferencia_tarjeta:  parseFloat(btn.dataset.difTar),
    estado: 'cerrada',
    cerrada_en: new Date().toISOString(),
  };

  try {
    if (!supabaseClient || !turno.id) {
      throw new Error('No se encontró el turno en Supabase');
    }

    const { data: cierreGuardado, error } = await supabaseClient.rpc(
      'cerrar_turno_caja',
      {
        p_turno_id: turno.id,

        p_monto_cierre_efectivo:
          cierreData.monto_cierre_efectivo,

        p_monto_cierre_qr:
          cierreData.monto_cierre_qr,

        p_monto_cierre_tarjeta:
          cierreData.monto_cierre_tarjeta,

        p_ventas_efectivo:
          cierreData.ventas_efectivo,

        p_ventas_qr:
          cierreData.ventas_qr,

        p_ventas_tarjeta:
          cierreData.ventas_tarjeta,

        p_diferencia_efectivo:
          cierreData.diferencia_efectivo,

        p_diferencia_qr:
          cierreData.diferencia_qr,

        p_diferencia_tarjeta:
          cierreData.diferencia_tarjeta
      }
    );

    if (error) throw error;

    if (!cierreGuardado) {
      throw new Error('Supabase no confirmó el cierre');
    }

  } catch (e) {
    console.error('Error cerrando turno:', e);

    showToast(
      `⚠️ No se pudo confirmar el cierre: ${e.message || 'error de conexión'}`,
      4500,
      'warning'
    );

    confirmBtn.disabled = false;
    confirmBtn.textContent = 'CONFIRMAR CIERRE';
    return;
  }
  // Imprimir recibo de cierre
  const s2 = getCurrentSession();
  const apertura2 = parseFloat(turno.monto_apertura) || 0;
  const vEf2 = parseFloat(btn.dataset.efEsp) - apertura2;
  const vQr2 = parseFloat(btn.dataset.vQr);
  const vTar2 = parseFloat(btn.dataset.vTar);
  const totalVentas = vEf2 + vQr2 + vTar2;
  const difEf2  = parseFloat(btn.dataset.difEf);
  const difQr2  = parseFloat(btn.dataset.difQr);
  const difTar2 = parseFloat(btn.dataset.difTar);
  const todoCuadra2 = Math.abs(difEf2) < 0.01 && Math.abs(difQr2) < 0.01 && Math.abs(difTar2) < 0.01;
  const ahora = new Date();
  const fmtFecha = dt => dt ? new Date(dt).toLocaleString('es-BO', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

  // El cierre conserva su formato actual; el transporte físico se realiza
  // mediante WebUSB + ESC/POS, igual que las comandas.
  const fmtDif = d => d > 0
    ? `SOBRA Bs ${fmt(Math.abs(d))}`
    : `FALTA Bs ${fmt(Math.abs(d))}`;
  const difLine = d => Math.abs(d) < 0.01
    ? ''
    : `<div class="pc-dif"><span>DIFERENCIA</span><span>${fmtDif(d)}</span></div>`;

  const oldPA = document.getElementById('print-area');
  if (oldPA) oldPA.remove();
  const oldST = document.getElementById('print-style-tag');
  if (oldST) oldST.remove();

  const cierreStyle = document.createElement('style');
  cierreStyle.id = 'print-style-tag';
  cierreStyle.textContent = `
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html  { height: auto !important; width: 210mm !important; }
      body  {
        height: auto !important; min-height: 0 !important;
        overflow: visible !important; background: #fff !important;
        margin: 0 !important; padding: 0 !important;
        width: 210mm !important;
      }
      body::before { display: none !important; }
      body::after  { display: none !important; }
      body > * { display: none !important; }
      #print-area {
        display: block !important;
        width: 180mm !important;
        font-family: Arial, Helvetica, sans-serif;
        font-weight: 700;
        color: #000;
        background: #fff;
        margin: 12mm auto; padding: 0 8mm 12mm;
        box-sizing: border-box;
        text-transform: uppercase;
      }
      #print-area .pc-brand {
        text-align: center; font-size: 18pt; font-weight: 900;
        letter-spacing: .04em; margin-bottom: 2pt; padding-top: 2pt;
      }
      #print-area .pc-titulo {
        text-align: center; font-size: 11pt; font-weight: 900;
        border-top: 2.5px solid #000; border-bottom: 2.5px solid #000;
        padding: 3pt 0; margin-bottom: 4pt;
      }
      #print-area .pc-info {
        font-size: 10pt; font-weight: 900; margin: 2pt 0;
      }
      #print-area .pc-ticket-meta {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 2mm; width: 100%; margin: 2pt 0 4pt;
        font-size: 8pt; font-weight: 900; line-height: 1.1;
      }
      #print-area .pc-ticket-meta .pc-datetime {
        font-size: 8pt; font-weight: 700; white-space: nowrap;
        text-align: right;
      }
      #print-area .pc-divider {
        border: none; border-top: 1.5px dashed #000; margin: 4pt 0;
      }
      #print-area .pc-metodo {
        font-size: 11pt; font-weight: 900;
        border-bottom: 1px solid #ddd; padding: 3pt 0 2pt;
        margin-bottom: 1pt;
      }
      #print-area .pc-row {
        display: grid; grid-template-columns: minmax(0, 1fr) max-content;
        column-gap: 2mm; align-items: baseline;
        font-size: 11pt; font-weight: 700;
        padding: 1pt 0; width: 100%; min-width: 0;
      }
      #print-area .pc-row .pc-lbl {
        color: #000; min-width: 0; overflow-wrap: anywhere;
      }
      #print-area .pc-row .pc-val {
        font-weight: 900; white-space: nowrap; text-align: right;
      }
      #print-area .pc-dif {
        display: grid; grid-template-columns: minmax(0, 1fr) max-content;
        column-gap: 2mm; align-items: baseline;
        font-size: 11pt; font-weight: 700; padding: 2pt 0 4pt;
        width: 100%; min-width: 0;
      }
      #print-area .pc-dif > span:first-child {
        min-width: 0; overflow-wrap: anywhere;
      }
      #print-area .pc-dif > span:last-child {
        white-space: nowrap; text-align: right;
      }
      #print-area .pc-total-bloque {
        border-top: 2.5px solid #000; border-bottom: 2.5px solid #000;
        padding: 4pt 0; margin: 6pt 0;
      }
      #print-area .pc-total-row {
        display: grid; grid-template-columns: minmax(0, 1fr) max-content;
        column-gap: 2mm; align-items: baseline;
        font-size: 12pt; font-weight: 700; min-width: 0;
      }
      #print-area .pc-total-row > span:first-child {
        min-width: 0; overflow-wrap: anywhere;
      }
      #print-area .pc-total-row > span:last-child {
        white-space: nowrap; text-align: right;
      }
      #print-area .pc-estado {
        text-align: center; font-size: 13pt; font-weight: 900;
        border: 2.5px solid #000; padding: 5pt 0; margin-top: 4pt;
      }
    }
  `;
  document.head.appendChild(cierreStyle);

  const pa = document.createElement('div');
  pa.id = 'print-area';
  pa.dataset.printFormat = 'a4';
  pa.style.display = 'none';
  const totEsp = (parseFloat(btn.dataset.efEsp)||0) + vQr2 + vTar2;
  const totCont = efReal + qrReal + tarReal;
  pa.innerHTML = `
    <div class="pc-brand">MAMA POTOSI</div>
    <div class="pc-titulo">CIERRE DE CAJA</div>
    <div class="pc-ticket-meta">
      <span>CAJA: ${formatReceiptCaja(s2?.caja || turno?.caja)}</span>
      <span class="pc-datetime">${formatReceiptDateTime(ahora)}</span>
    </div>
    <hr class="pc-divider">
    <div class="pc-metodo">EFECTIVO</div>

    <div class="pc-row">
      <span class="pc-lbl">VENTAS</span>
      <span class="pc-val">Bs ${fmt(vEf2)}</span>
    </div>

    <div class="pc-row">
      <span class="pc-lbl">FONDO INICIAL</span>
      <span class="pc-val">Bs ${fmt(apertura2)}</span>
    </div>

    <div class="pc-row">
      <span class="pc-lbl">ESPERADO</span>
      <span class="pc-val">Bs ${fmt(parseFloat(btn.dataset.efEsp)||0)}</span>
    </div>

    <div class="pc-row">
      <span class="pc-lbl">CONTADO</span>
      <span class="pc-val">Bs ${fmt(efReal)}</span>
    </div>

    ${difLine(difEf2)}
    <hr class="pc-section-divider">
     <div class="pc-metodo">QR</div>
     <div class="pc-row"><span class="pc-lbl">ESPERADO</span><span class="pc-val">Bs ${fmt(vQr2)}</span></div>
     <div class="pc-row"><span class="pc-lbl">CONTADO</span><span class="pc-val">Bs ${fmt(qrReal)}</span></div>
    ${difLine(difQr2)}
    <hr class="pc-section-divider">
     <div class="pc-metodo">TARJETA</div>
     <div class="pc-row"><span class="pc-lbl">ESPERADO</span><span class="pc-val">Bs ${fmt(vTar2)}</span></div>
     <div class="pc-row"><span class="pc-lbl">CONTADO</span><span class="pc-val">Bs ${fmt(tarReal)}</span></div>
    ${difLine(difTar2)}
    <hr class="pc-divider">
    <div class="pc-total-bloque">
       <div class="pc-total-row"><span>TOTAL ESPERADO</span><span>Bs ${fmt(totEsp)}</span></div>
       <div class="pc-total-row" style="margin-top:2pt;"><span>TOTAL CONTADO</span><span>Bs ${fmt(totCont)}</span></div>
    </div>
  `;
  document.body.appendChild(pa);

   imprimirTicketCuandoEsteListo().catch(error => {
     console.warn('No se pudo imprimir el cierre:', error);
     showToast('El cierre se guardó, pero la impresión falló', 3500);
   });

  clearTurno();
  updateDockCajaLabel();
  showToast('🔒 Caja cerrada correctamente', 3000);
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'CONFIRMAR CIERRE';
  const _s3 = getCurrentSession();
  if (_s3) { cajaShowStep('caja-step1'); await renderOverviewCajas(_s3); }
  else document.getElementById('caja-modal').classList.remove('open');
});
function abrirInventarios() {
  document.getElementById('inventarios-modal').classList.add('open');
  loadInventarios('hoy');
}
function abrirReportes() {
  if (!esCajaSupervisora()) {
    showToast('🔒 Solo Caja 1 o Caja 5 pueden ver reportes', 3500, 'warning');
    return;
  }
  repResetUI();
  document.getElementById('reportes-modal').classList.add('open');
  loadReportes();
}

function renderDock() {
  const dockEl = document.getElementById('dock');
  dockEl.innerHTML = '';
  dockApps.forEach((app, i) => {
    const slot = document.createElement('div');
    slot.className = 'dock-slot' + (selectedIdx === i ? ' selected' : '');
    slot.dataset.i = i;
    slot.innerHTML = `
      <div class="dock-icon">
        <img src="${app.icon}" alt="${app.name}" onerror="this.style.display='none'">
      </div>
      <div class="dock-label">${app.name}</div>
      <div class="edit-btn" data-i="${i}">✏</div>`;
    slot.addEventListener('click', e => {
      if (e.target.closest('.edit-btn')) return;
      if (app.url && app.url.startsWith('javascript:')) {
        selectedIdx = i; renderDock();
        eval(app.url.replace('javascript:', ''));
      } else if (selectedIdx === i) {
        if (app.url && app.url !== '#') window.open(app.url, '_blank');
      } else { selectedIdx = i; renderDock(); }
    });
    slot.querySelector('.edit-btn').addEventListener('click', e => { e.stopPropagation(); openEdit(i); });
    dockEl.appendChild(slot);
  });
}

document.addEventListener('click', e => {
  if (!e.target.closest('#dock-wrap')) {
    if (selectedIdx !== null) { selectedIdx = null; renderDock(); }
  }
});

function openEdit(i) {
  editIdx = i;
  const app = dockApps[i];
  document.getElementById('ep-name').value = app.name;
  document.getElementById('ep-icon').value = app.icon;
  document.getElementById('ep-url').value  = app.url;
  document.getElementById('edit-modal').classList.add('open');
}
document.getElementById('ep-cancel').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.remove('open');
});
document.getElementById('ep-save').addEventListener('click', () => {
  dockApps[editIdx] = {
    name: document.getElementById('ep-name').value,
    icon: document.getElementById('ep-icon').value,
    url:  document.getElementById('ep-url').value,
  };
  saveDock(dockApps);
  document.getElementById('edit-modal').classList.remove('open');
  renderDock();
});

let PRODUCTS = [];
let cart = [];
let searchQ = '';

async function loadProductsFromSupabase() {
  try {
    if (!supabaseClient) { renderProducts(); return; }
    const { data, error } = await supabaseClient
      .from('MAMAPOTOSI').select('*').order('nombre', { ascending: true });
    if (error) { console.error("Error fetching products:", error); return; }
    if (data && data.length > 0) {
      PRODUCTS = data.map(item => ({
        id: item.id, name: item.nombre, emoji: '', image: item.imagen, price: item.precio
      }));
      renderProducts();
    }
  } catch (err) { console.error("Failed to load products:", err); }
}
loadProductsFromSupabase();
// ── ACTUALIZACIÓN AUTOMÁTICA DEL CATÁLOGO ─────────────────

// Cuando la tablet/app vuelve a estar visible,
// volver a consultar los productos actuales.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadProductsFromSupabase();
  }
});

// Mientras la app esté abierta,
// actualizar catálogo cada 2 minutos.
setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadProductsFromSupabase();
  }
}, 120000);
async function validarCarritoContraSupabase() {
  if (!supabaseClient) {
    throw new Error('No hay conexión con Supabase');
  }

  if (!cart.length) {
    throw new Error('El carrito está vacío');
  }

  const ids = [...new Set(
    cart
      .map(item => Number(item.id))
      .filter(Number.isFinite)
  )];

  if (ids.length !== cart.length) {
    throw new Error('Hay un producto del carrito sin ID válido');
  }

  const { data, error } = await supabaseClient
    .from('MAMAPOTOSI')
    .select('id,nombre,precio,imagen')
    .in('id', ids);

  if (error) {
    throw new Error('No se pudo verificar el catálogo: ' + error.message);
  }

  const productosActuales = new Map(
    (data || []).map(p => [Number(p.id), p])
  );

  // Ningún producto del carrito puede haber desaparecido del catálogo.
  for (const item of cart) {
    const actual = productosActuales.get(Number(item.id));

    if (!actual) {
      throw new Error(
        `El producto "${item.name}" ya no existe en el catálogo. Elimínalo del carrito y vuelve a intentarlo.`
      );
    }
  }

  let huboCambios = false;

  cart = cart.map(item => {
    const actual = productosActuales.get(Number(item.id));

    const nombreActual = String(actual.nombre || '').trim();
    const precioActual = Number(actual.precio) || 0;
    const nombreAnterior = String(item.name || '').trim();
    const precioAnterior = Number(item.price) || 0;

    if (
      nombreActual !== nombreAnterior ||
      precioActual !== precioAnterior
    ) {
      huboCambios = true;
    }

    return {
      ...item,

      // SIEMPRE usamos los datos actuales de Supabase
      id: Number(actual.id),
      name: nombreActual,
      price: precioActual,
      image: actual.imagen || item.image || '',
      qty: item.qty
    };
  });

  if (huboCambios) {
    renderCart();
    await loadProductsFromSupabase();
  }

  return {
    huboCambios
  };
}
function renderProducts() {
  const q = searchQ.toLowerCase().trim();
  const words = q ? q.split(/\s+/).filter(Boolean) : [];
  const list = !words.length ? PRODUCTS : PRODUCTS.filter(p => {
    const name = p.name.toLowerCase();
    return words.some(w => name.includes(w));
  });
  const grid = document.getElementById('product-grid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim);font-size:13px">
      Sin resultados para "<b style="color:var(--text-secondary)">${searchQ}</b>"</div>`;
    return;
  }
  list.forEach(p => {
    const card = document.createElement('div');
    card.className = 'prod-card';
    const imgHtml = p.image
      ? `<img class="prod-img" src="${p.image}" alt="${p.name}" loading="lazy">`
      : `<div class="prod-emoji">${p.emoji || '📦'}</div>`;
    card.innerHTML = `
      ${imgHtml}
      <div class="prod-name">${p.name}</div>
      <div class="prod-price">Bs ${p.price}</div>`;
    card.addEventListener('click', () => addToCart(p));
    grid.appendChild(card);
  });
}

function cajaEstaAbierta() {
  const turno = getTurno();
  const s = getCurrentSession();
  return !!(turno && s && turno.cajero === s.usuario && turno.estado === 'abierta');
}

function addToCart(p) {
  if (!cajaEstaAbierta()) {
    showToast('🔒 Abre la caja primero para agregar productos', 3500);
    return;
  }
  const ex = cart.find(i => i.id === p.id);
  if (ex) ex.qty++; else cart.push({...p, qty:1});
  showToast(`${p.emoji || '📦'} ${p.name} agregado`);
  renderCart();
  // Limpiar buscador para buscar el siguiente producto de inmediato
  const _se = document.getElementById('search');
  const _cb = document.getElementById('search-clear');
  if (_se) {
    _se.value = '';
    searchQ = '';
    if (_cb) _cb.style.display = 'none';
    renderProducts();
  }
}
function removeFromCart(id) { cart = cart.filter(i => i.id !== id); renderCart(); }
function changeQty(id, d) {
  const it = cart.find(i => i.id === id);
  if (!it) return;
  it.qty += d;
  if (it.qty <= 0) cart = cart.filter(i => i.id !== id);
  renderCart();
}
function clearCart() { cart = []; renderCart(); }

function renderCart() {
  const totalQty = cart.reduce((s,i) => s+i.qty, 0);

  const {
    subtotal: sub,
    descuentoMonto,
    total
  } = getSaleTotals();
  document.getElementById('order-count').textContent = totalQty;
  document.getElementById('items-ct').textContent = totalQty;
  document.getElementById('total-val').textContent = `Bs ${fmt(total)}`;
  const discountResult =
    document.getElementById('order-discount-result');

  if (discountResult) {
    if (descuentoMonto > 0) {
      discountResult.textContent =
        `Descuento - Bs ${fmt(descuentoMonto)}`;
    } else {
      discountResult.textContent = '';
    }
  }
  document.getElementById('btn-checkout').disabled = cart.length === 0;

  const list = document.getElementById('order-list');
  [...list.querySelectorAll('.order-item')].forEach(el => el.remove());
  const empty = document.getElementById('order-empty');
  if (!cart.length) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';

  cart.forEach(it => {
    const el = document.createElement('div');
    el.className = 'order-item';
    el.innerHTML = `
      <div class="oi-em">${it.image ? `<img src="${it.image}" alt="${it.name}" loading="lazy">` : (it.emoji || '📦')}</div>
      <div class="oi-info">
        <div class="oi-name">${it.name}</div>
        <div class="oi-price-row">
          <div class="oi-unit">Bs ${fmt(it.price)} c/u</div>
          <div class="oi-tot">Bs ${fmt(it.price*it.qty)}</div>
        </div>
      </div>
      <div class="oi-ctrl">
        <button type="button" class="qty-btn rm" data-id="${it.id}" data-a="rm" title="Eliminar" aria-label="Eliminar ${it.name}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
        <button type="button" class="qty-btn" data-id="${it.id}" data-a="dec" aria-label="Disminuir cantidad">−</button>
        <div class="oi-qty" aria-live="polite">${it.qty}</div>
        <button type="button" class="qty-btn" data-id="${it.id}" data-a="inc" aria-label="Aumentar cantidad">+</button>
      </div>`;
    list.insertBefore(el, empty);
  });
}

document.getElementById('order-list').addEventListener('click', e => {
  const b = e.target.closest('.qty-btn');
  if (!b) return;
  const id = parseInt(b.dataset.id), a = b.dataset.a;
  if (a==='inc') changeQty(id,1);
  if (a==='dec') changeQty(id,-1);
  if (a==='rm')  removeFromCart(id);
});
document.getElementById('order-clear').addEventListener('click', clearCart);

let discountType = 'bs';
let discountValue = 0;
let selectedPaymentMethod = null;
let pendingVentaTimestamp = null;
let pendingSavedVenta = null;
const checkoutModal = document.getElementById('checkout-modal');
let checkoutViewportRaf = 0;

function syncCheckoutViewport() {
  if (!checkoutModal) return;

  const viewport = window.visualViewport;
  const height = Math.max(1, Math.round(viewport?.height || window.innerHeight));
  // iOS puede cambiar offsetTop al pasar entre inputs. No lo usamos para
  // mover el modal: el checkout debe permanecer fijo arriba de la pantalla.
  const top = 0;
  const keyboardOpen = Boolean(
    viewport &&
    (window.innerHeight - viewport.height > 120 ||
      viewport.height < window.innerHeight * 0.78)
  );

  checkoutModal.style.setProperty('--checkout-viewport-height', `${height}px`);
  checkoutModal.style.setProperty('--checkout-viewport-top', `${top}px`);
  checkoutModal.classList.toggle('keyboard-open', keyboardOpen);

  const focusedField = document.activeElement;
  if (
    checkoutModal.classList.contains('open') &&
    keyboardOpen &&
    focusedField &&
    checkoutModal.contains(focusedField) &&
    focusedField.matches('input, textarea, select')
  ) {
    requestAnimationFrame(() => {
      const panel = checkoutModal.querySelector('.co-panel');
      if (!panel) return;

      const panelRect = panel.getBoundingClientRect();
      const fieldRect = focusedField.getBoundingClientRect();
      const visibleTop = Math.max(panelRect.top, top + 12);
      const visibleBottom = Math.min(panelRect.bottom, top + height - 12);

      // Desplazar solo el contenido del panel evita que Safari panee toda la
      // página y haga parecer que el modal bajó al cambiar de campo.
      if (fieldRect.bottom > visibleBottom) {
        panel.scrollTop += fieldRect.bottom - visibleBottom;
      } else if (fieldRect.top < visibleTop) {
        panel.scrollTop -= visibleTop - fieldRect.top;
      }
    });
  }
}

function queueCheckoutViewportSync() {
  if (checkoutViewportRaf) cancelAnimationFrame(checkoutViewportRaf);
  checkoutViewportRaf = requestAnimationFrame(() => {
    checkoutViewportRaf = 0;
    syncCheckoutViewport();
  });
}

function openCheckoutModal() {
  checkoutModal.classList.add('open');
  syncCheckoutViewport();
  queueCheckoutViewportSync();
}

function closeCheckoutModal() {
  const focusedField = document.activeElement;
  if (focusedField && checkoutModal.contains(focusedField) && typeof focusedField.blur === 'function') {
    focusedField.blur();
  }
  checkoutModal.classList.remove('open', 'keyboard-open');
  checkoutModal.style.removeProperty('--checkout-viewport-height');
  checkoutModal.style.removeProperty('--checkout-viewport-top');
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', queueCheckoutViewportSync);
  window.visualViewport.addEventListener('scroll', queueCheckoutViewportSync);
}
window.addEventListener('resize', queueCheckoutViewportSync);
checkoutModal.addEventListener('focusin', queueCheckoutViewportSync);
checkoutModal.addEventListener('focusout', () => setTimeout(queueCheckoutViewportSync, 50));

function getSaleTotals() {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  let descuentoMonto = 0;

  if (discountType === 'porcentaje') {
    const porcentaje = Math.min(Math.max(discountValue, 0), 100);
    descuentoMonto = subtotal * (porcentaje / 100);
  } else {
    descuentoMonto = Math.min(Math.max(discountValue, 0), subtotal);
  }

  const total = Math.max(0, subtotal - descuentoMonto);

  return {
    subtotal,
    descuentoMonto,
    total
  };
}
document.querySelectorAll('.discount-type').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.discount-type')
      .forEach(b => b.classList.remove('active'));

    btn.classList.add('active');

    discountType = btn.dataset.discountType;

    const input = document.getElementById('order-discount-value');
    discountValue = parseFloat(input?.value) || 0;

    renderCart();
  });
});
document.getElementById('order-discount-value')
.addEventListener('input', e => {
  discountValue = parseFloat(e.target.value) || 0;
  renderCart();
});
function updateMixto() {
  const { total } = getSaleTotals();
  const qr       = parseFloat(document.getElementById('mixto-qr').value)       || 0;
  const efectivo = parseFloat(document.getElementById('mixto-efectivo').value) || 0;
  const tarjeta  = parseFloat(document.getElementById('mixto-tarjeta').value)  || 0;
  const ingresado = qr + efectivo + tarjeta;
  const left = total - ingresado;
  const statusEl = document.getElementById('mixto-status');
  if (ingresado === 0) {
    statusEl.textContent = '';
    statusEl.className = 'mixto-status';
    document.getElementById('co-confirm').disabled = true;
  } else if (left > 0) {
    statusEl.textContent = `Falta Bs ${fmt(left)}`;
    statusEl.className = 'mixto-status falta';
    document.getElementById('co-confirm').disabled = true;
  } else {
    statusEl.textContent = left < -1 ? `Cambio: Bs ${fmt(Math.abs(left))}` : '✓ Monto completo';
    statusEl.className = 'mixto-status ok';
    document.getElementById('co-confirm').disabled = false;
  }
}

document.querySelectorAll('.mixto-input').forEach(input => input.addEventListener('input', updateMixto));

document.getElementById('btn-checkout').addEventListener('click', () => {
  if (!cajaEstaAbierta()) {
    showToast('🔒 Abre la caja primero para cobrar', 3500);
    return;
  }
  pendingVentaTimestamp = null;
  pendingSavedVenta = null;
  document.getElementById('post-sale-print').classList.remove('show');
  pendingComandaData = null;
  const printBtn = document.getElementById('print-comanda-btn');
  printBtn.disabled = false;
  printBtn.textContent = 'IMPRIMIR COMANDA';
  const { total } = getSaleTotals();
  document.getElementById('co-total').textContent = `Bs ${fmt(total)}`;
  selectedPaymentMethod = null;
  document.querySelectorAll('.pay-btn').forEach(btn => btn.classList.remove('selected'));
  document.getElementById('co-confirm').disabled = true;
  document.getElementById('cash-input-area').style.display = 'none';
  document.getElementById('mixto-input-area').style.display = 'none';
  document.querySelectorAll('.mixto-input').forEach(i => i.value = '');
  document.getElementById('cash-received').value = '';
  document.getElementById('cash-feedback').textContent = '';
  document.getElementById('cash-feedback').className = 'cash-feedback';
  document.getElementById('mixto-status').textContent = '';
  document.getElementById('mixto-status').className = 'mixto-status';
  openCheckoutModal();
});

document.querySelectorAll('.pay-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedPaymentMethod = btn.dataset.method;
    document.getElementById('cash-input-area').style.display = 'none';
    document.getElementById('mixto-input-area').style.display = 'none';
    document.getElementById('co-confirm').disabled = false;
    if (selectedPaymentMethod === 'efectivo') {
      document.getElementById('cash-input-area').style.display = 'block';
      document.getElementById('cash-received').value = '';
      document.getElementById('cash-feedback').textContent = '';
      document.getElementById('cash-feedback').className = 'cash-feedback';
      document.getElementById('cash-received').focus();
      document.getElementById('co-confirm').disabled = true;
    } else if (selectedPaymentMethod === 'mixto') {
      document.getElementById('mixto-input-area').style.display = 'block';
      document.getElementById('co-confirm').disabled = true;
      updateMixto();
    }
  });
});

document.getElementById('cash-received').addEventListener('input', (e) => {
  const { total } = getSaleTotals();
  const received = parseFloat(e.target.value) || 0;
  const fb       = document.getElementById('cash-feedback');
  const diff     = total - received;
  if (received === 0) {
    fb.textContent = '';
    fb.className = 'cash-feedback';
    document.getElementById('co-confirm').disabled = true;
  } else if (diff > 0) {
    fb.textContent = `Falta Bs ${fmt(diff)}`;
    fb.className = 'cash-feedback falta';
    document.getElementById('co-confirm').disabled = true;
  } else if (diff < 0) {
    fb.textContent = `Cambio: Bs ${fmt(Math.abs(diff))}`;
    fb.className = 'cash-feedback ok';
    document.getElementById('co-confirm').disabled = false;
  } else {
    fb.textContent = '✓ Monto exacto';
    fb.className = 'cash-feedback ok';
    document.getElementById('co-confirm').disabled = false;
  }
});

document.getElementById('co-cancel').addEventListener('click', () => {
  pendingVentaTimestamp = null;
  pendingSavedVenta = null;
  closeCheckoutModal();
});

function fmt(n) {
  return String(Math.round(Number(n) || 0));
}

function formatReceiptCaja(caja) {
  const value = String(caja || '').trim().replace(/^caja\s*/i, '');
  return value || '—';
}

function formatReceiptDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hours24 = date.getHours();
  const hours12 = String(hours24 % 12 || 12).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  return `${dd}-${mm}-${yyyy} ${hours12}:${minutes}${suffix}`;
}

let lastOrderReference = null;

function updateOrderNumberDisplay(orderReference = lastOrderReference) {
  document.getElementById('order-number-display').textContent =
    orderReference ? '#' + orderReference : '#—';
}

let impresora = null;
let pendingComandaData = null;

function usbText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

function wrapUsbText(value, width = 32) {
  const words = usbText(value).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) {
      if (word.length <= width) line = word;
      else {
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      }
    } else if ((line + ' ' + word).length <= width) {
      line += ' ' + word;
    } else {
      lines.push(line);
      line = word.length <= width ? word : '';
      if (!line) {
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escPosTextLine(value, width = 32) {
  // Algunas Epson no reinician la columna con LF solo. CRLF garantiza que
  // cada línea vuelva al inicio antes de avanzar al siguiente renglón.
  return wrapUsbText(value, width)
    .map(line => usbText(line) + '\r\n')
    .join('');
}

function buildEscPosFromComanda(printArea) {
  if (!printArea || !printArea.textContent.trim()) {
    throw new Error('La comanda no tiene contenido para imprimir');
  }

  const encoder = new TextEncoder();
  const ESC = 0x1b;
  const GS = 0x1d;
  const chunks = [];
  const push = (...bytes) => chunks.push(Uint8Array.from(bytes));
  const pushText = value => chunks.push(encoder.encode(usbText(value)));
  const pushLine = value => chunks.push(encoder.encode(escPosTextLine(value)));
  const pushBlock = value => {
    const lines = String(value || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    lines.forEach(line => pushLine(line));
  };
  let productSectionStarted = false;

  /*
   * ESC/POS no recibe HTML/CSS. Para no perder nada, recorremos el DOM real
   * de la comanda en el mismo orden en que está construido. Las filas de
   * productos conservan cantidad + nombre; cualquier otro bloque, incluido
   * lo que esté debajo de los productos, también se convierte en líneas.
   */
  const addTextLines = value => {
    String(value || '')
      .split(/\r?\n/)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .forEach(line => pushLine(line));
  };
  const walkComanda = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      addTextLines(node.nodeValue);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
   if (node.tagName === 'HR') {
     push(ESC, 0x61, 0x01); // centrar
     pushText('------------------------------------------');
     push(0x0A);
     push(ESC, 0x61, 0x00); // volver a izquierda
     return;
   }
    if (node.classList.contains('p-item-row')) {
      const qty = node.querySelector('.p-item-qty')?.textContent.trim() || '';
      const name = node.querySelector('.p-item-name')?.textContent.trim() || '';
      if (qty || name) {
        // El encabezado puede ir centrado, pero las filas deben empezar en
        // la misma columna para que "|" y todos los nombres queden alineados.
        if (!productSectionStarted) {
          push(ESC, 0x61, 0x00);
          productSectionStarted = true;
        }
        // Columna fija: 4 posiciones para cantidad, luego el separador.
        // Así el producto siempre empieza exactamente después de "|".
        const wrapped = wrapUsbText(name, 27);

        // Mueve TODO el bloque de productos hacia la derecha
        const indent = ' ';

        // CANTIDAD SIEMPRE ocupa exactamente 4 caracteres
        const quantity = usbText(qty).padStart(2, ' ').padEnd(4, ' ');

        // Producto
        pushText(`${indent}${quantity}| ${wrapped[0]}`);
        push(0x0A);

        // Si el nombre es largo, continúa debajo
        wrapped.slice(1).forEach(line => {
          pushText(`${indent}    | ${line}`);
          push(0x0A);
        });
      }
      return;
    }
    if (node.classList.contains('p-delivery-label')) {
      push(ESC, 0x61, 0x01);
      addTextLines(node.textContent);
      return;
    }
    const childElements = [...node.children];
    if (!childElements.length) {
      addTextLines(node.textContent);
      return;
    }
    childElements.forEach(walkComanda);
  };

  push(ESC, 0x40); // initialize
  // El cierre se imprime compacto y legible: centrado y con peso fuerte.
  push(ESC, 0x61, 0x01);
  push(ESC, 0x45, 0x01);
  push(GS, 0x21, 0x09);
  walkComanda(printArea);

  push(GS, 0x21, 0x00);
  push(ESC, 0x45, 0x00);
  push(ESC, 0x61, 0x00);
  pushText('\r\n');
  push(ESC, 0x64, 0x03); // feed
  push(GS, 0x56, 0x00); // full cut
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.length; });
  return bytes;
}

async function buscarImpresoraUsb() {
  if (!navigator.usb) {
    throw new Error('WebUSB no está disponible en este navegador');
  }
  const dispositivos = await navigator.usb.getDevices();
  if (dispositivos.length > 0) {
    impresora = dispositivos[0];
  } else {
    impresora = await navigator.usb.requestDevice({ filters: [] });
  }
  if (!impresora) throw new Error('No se encontró la impresora');
  return impresora;
}

async function enviarEscPosPorUsb(bytes) {
  const device = await buscarImpresoraUsb();
  let claimedInterface = null;
  try {
    if (!device.opened) await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    let selectedInterface = null;
    let selectedAlternate = null;
    for (const iface of device.configuration.interfaces) {
      for (const alternate of iface.alternates) {
        if (alternate.endpoints.some(endpoint => endpoint.direction === 'out')) {
          selectedInterface = iface;
          selectedAlternate = alternate;
          break;
        }
      }
      if (selectedInterface) break;
    }
    if (!selectedInterface || !selectedAlternate) {
      throw new Error('No se encontró salida USB en la Epson');
    }

    await device.claimInterface(selectedInterface.interfaceNumber);
    claimedInterface = selectedInterface.interfaceNumber;
    if (selectedAlternate.alternateSetting !== 0) {
      await device.selectAlternateInterface(
        selectedInterface.interfaceNumber,
        selectedAlternate.alternateSetting
      );
    }
    const endpointOut = selectedAlternate.endpoints.find(endpoint => endpoint.direction === 'out');
    if (!endpointOut) throw new Error('No se encontró USB OUT en la Epson');

    /*
     * Android puede truncar una transferencia grande al adaptador USB de la
     * Epson. Enviar paquetes de tamaño de endpoint y esperar entre ellos
     * evita que falte la parte inferior de la comanda.
     */
    const packetSize = Math.max(8, Math.min(endpointOut.packetSize || 64, 64));
    for (let offset = 0; offset < bytes.length; offset += packetSize) {
      const packet = bytes.slice(offset, offset + packetSize);
      const result = await device.transferOut(endpointOut.endpointNumber, packet);
      if (result.status && result.status !== 'ok') {
        throw new Error(`La Epson rechazó los datos USB (${result.status})`);
      }
      await new Promise(resolve => setTimeout(resolve, 12));
    }
    // Dar tiempo al buffer USB/impresora antes de liberar la interfaz.
    await new Promise(resolve => setTimeout(resolve, Math.max(800, bytes.length * 2)));
  } finally {
    if (claimedInterface !== null) {
      try { await device.releaseInterface(claimedInterface); } catch (_) {}
    }
    try { if (device.opened) await device.close(); } catch (_) {}
  }
}

function crearDatosComanda(metodoPago, ordenNumero, productos, sesion, fecha = new Date(), nota = '') {
  const caja = sesion?.caja || 'Sin caja';
  return {
    barra: (() => {
      const numeroCaja = String(caja).toLowerCase().replace(/[^0-9]/g, '');
      if (numeroCaja === '3') return 'BARRA VIP';
      if (numeroCaja === '4') return 'BARRA CHOLET';
      return 'BARRA PRINCIPAL';
    })(),
    orden: ordenNumero ? `#${String(ordenNumero).padStart(2, '0')}` : '',
    pago: metodoPago || '—',
    caja: formatReceiptCaja(caja),
    fecha: formatReceiptDateTime(fecha),
    nota: String(nota || '').trim(),

    productos: (Array.isArray(productos) ? productos : [])
      .map(item => ({
        cantidad: item.qty ?? item.cantidad ?? 0,
        nombre: item.name ?? item.nombre ?? 'Producto'
      }))
      .filter(item => item.nombre && Number(item.cantidad) > 0)
  };
}

function productNameLines(name, width = 27) {
  return wrapUsbText(name, width);
}

function buildEscPosVentaComanda(comanda) {
  if (!comanda || !comanda.productos?.length) {
    throw new Error('La comanda no tiene productos para imprimir');
  }

  /*
   * IMPORTANTE: las comandas de productos deben usar exactamente el mismo
   * generador que el cierre de caja. Antes tenían un segundo generador con
   * otro tamaño, feed y corte; por eso la Epson cortaba a los pocos
   * centímetros y el resto aparecía como otra comanda.
   */
  const printArea = document.createElement('div');
  printArea.id = 'comanda-escpos-source';
  printArea.style.display = 'none';

  const addLine = (value, className = '') => {
    const element = document.createElement('div');
    if (className) element.className = className;
    element.textContent = String(value ?? '');
    printArea.appendChild(element);
  };
  const addSeparator = () => printArea.appendChild(document.createElement('hr'));

  addLine(comanda.barra);
  addSeparator();
  if (comanda.orden) addLine(`ORDEN: ${comanda.orden}`);
  addLine(`CAJA: ${comanda.caja}`);
  addLine(`PAGO: ${comanda.pago}`);
  addLine(`FECHA: ${comanda.fecha}`);
  addSeparator();
  addLine('CANT  | PRODUCTO');

  comanda.productos.forEach(producto => {
    const row = document.createElement('div');
    row.className = 'p-item-row';

    const qty = document.createElement('span');
    qty.className = 'p-item-qty';
    qty.textContent = String(producto.cantidad ?? '');

    const name = document.createElement('span');
    name.className = 'p-item-name';
    name.textContent = String(producto.nombre ?? '');

    row.append(qty, name);
    printArea.appendChild(row);
  });

  if (comanda.nota) {
    addSeparator();
    addLine(`NOTA: ${comanda.nota}`);
  }
  addSeparator();
  addLine('PRODUCTO A ENTREGAR', 'p-delivery-label');

  // Un solo initialize, un solo feed y un solo corte: el mismo camino del cierre.
  return buildEscPosFromComanda(printArea);
}

async function imprimirComandaUsb(comanda) {
  const bytes = buildEscPosVentaComanda(comanda);
  await enviarEscPosPorUsb(bytes);
}

async function imprimirTicketCuandoEsteListo() {
  const printArea = document.getElementById('print-area');
  if (!printArea) {
    throw new Error('No se encontró la comanda para imprimir');
  }
  const bytes = buildEscPosFromComanda(printArea);
  await enviarEscPosPorUsb(bytes);
  return true;

  // Código histórico de impresión del navegador. Se conserva debajo de
  // este return solo como referencia durante la migración a WebUSB.

  /*
   * Android/Chrome puede ignorar el body > * { display:none } cuando se
   * imprime el documento principal. En ese caso termina imprimiendo la
   * pantalla completa del POS. La tablet debe recibir un documento aislado
   * que contenga únicamente el ticket.
   */
  const printFormat = printArea.dataset.printFormat || 'receipt';
  const oldSafeStyle = document.getElementById('receipt-safe-print-style');
  if (oldSafeStyle) oldSafeStyle.remove();
  const safeStyle = document.createElement('style');
  safeStyle.id = 'receipt-safe-print-style';
  safeStyle.textContent = printFormat === 'receipt' ? `
    @media print {
      @page { size: 80mm auto; margin: 0 !important; }
      html {
        width: 80mm !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      body {
        width: 80mm !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        background: #fff !important;
      }
      body > * { display: none !important; }
      #print-area {
        display: block !important;
        width: 72mm !important;
        max-width: 72mm !important;
        min-width: 72mm !important;
        margin: 0 auto !important;
        padding: 0 1mm 3mm !important;
        box-sizing: border-box !important;
        color: #000 !important;
        background: #fff !important;
        overflow: visible !important;
        font-family: Arial, Helvetica, sans-serif !important;
        text-transform: uppercase;
      }
      #print-area * { box-sizing: border-box; }
      #print-area table {
        width: 100% !important;
        max-width: 100% !important;
        table-layout: fixed !important;
        border-collapse: collapse !important;
      }
      #print-area .p-name {
        min-width: 0 !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
        line-height: 1.12 !important;
      }
      #print-area .p-qty {
        width: 17% !important;
        min-width: 17% !important;
      }
      #print-area .pc-row,
      #print-area .pc-dif,
      #print-area .pc-total-row {
        width: 100% !important;
        min-width: 0 !important;
        grid-template-columns: minmax(0, 1fr) max-content !important;
        column-gap: 1.5mm !important;
      }
      #print-area .pc-row > span:first-child,
      #print-area .pc-dif > span:first-child,
      #print-area .pc-total-row > span:first-child {
        min-width: 0 !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
      }
      #print-area .pc-row > span:last-child,
      #print-area .pc-dif > span:last-child,
      #print-area .pc-total-row > span:last-child {
        white-space: nowrap !important;
        text-align: right !important;
      }
      #print-area .p-title,
      #print-area .p-date,
      #print-area .p-pago,
      #print-area .pc-brand,
      #print-area .pc-titulo,
      #print-area .pc-info,
      #print-area .pc-metodo,
      #print-area .pc-estado {
        max-width: 100% !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
      }
      #print-area .p-divider,
      #print-area .pc-divider {
        width: 100% !important;
        max-width: 100% !important;
      }
      #print-area .pc-total-bloque {
        width: 100% !important;
        max-width: 100% !important;
      }
      #print-area tr,
      #print-area .pc-metodo,
      #print-area .pc-total-bloque {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      #print-area .p-header-row {
        display: flex !important;
        align-items: baseline !important;
        justify-content: space-between !important;
        gap: 2mm !important;
        width: 100% !important;
        margin: 0 0 2pt !important;
      }
      #print-area .p-header-row .p-title {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        margin: 0 !important;
        text-align: left !important;
        font-size: 12pt !important;
        font-weight: 900 !important;
        line-height: 1.05 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: clip !important;
      }
      #print-area .p-header-row .p-pago {
        flex: 0 0 auto !important;
        margin: 0 !important;
        padding: 0 !important;
        font-size: 7pt !important;
        font-weight: 900 !important;
        line-height: 1.05 !important;
        white-space: nowrap !important;
        text-align: right !important;
      }
      #print-area .p-order {
        display: block !important;
        width: 100% !important;
        margin: 0 0 2pt !important;
        font-size: 8pt !important;
        font-weight: 900 !important;
        line-height: 1.1 !important;
        white-space: nowrap !important;
        text-align: left !important;
      }
      #print-area .p-meta-row {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 2mm !important;
        width: 100% !important;
        margin: 0 0 1pt !important;
      }
      #print-area .p-ticket-meta {
        display: flex !important;
        align-items: baseline !important;
        justify-content: space-between !important;
        gap: 2mm !important;
        width: 100% !important;
        margin: 0 0 2pt !important;
      }
      #print-area .p-caja {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        font-size: 8pt !important;
        font-weight: 900 !important;
        line-height: 1.1 !important;
      }
      #print-area .p-datetime {
        flex: 0 0 auto !important;
        font-size: 8pt !important;
        font-weight: 700 !important;
        line-height: 1.1 !important;
        white-space: nowrap !important;
        text-align: right !important;
      }
      #print-area .p-cajera {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        font-size: 8pt !important;
        font-weight: 900 !important;
        line-height: 1.1 !important;
        overflow-wrap: anywhere !important;
      }
      #print-area .p-hora {
        flex: 0 0 auto !important;
        font-size: 10pt !important;
        font-weight: 900 !important;
        line-height: 1.1 !important;
        white-space: nowrap !important;
        text-align: right !important;
      }
      #print-area .p-fecha {
        display: none !important;
      }
      #print-area .pc-section-divider {
        border: none !important;
        border-top: 1.5px solid #000 !important;
        width: 100% !important;
        margin: 5pt 0 3pt !important;
      }
    }
  ` : '';
  if (safeStyle.textContent) document.head.appendChild(safeStyle);

  let cleaned = false;
  let fallbackTimer = null;
  let printFrame = null;
  let printStarted = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    window.removeEventListener('afterprint', cleanup);
    if (printFrame?.contentWindow) {
      printFrame.contentWindow.removeEventListener('afterprint', cleanup);
    }
    if (printFrame) printFrame.remove();
    const el = document.getElementById('print-area');
    if (el) el.remove();
    const style = document.getElementById('print-style-tag');
    if (style) style.remove();
    const safe = document.getElementById('receipt-safe-print-style');
    if (safe) safe.remove();
  };

  window.addEventListener('afterprint', cleanup);

  const printNow = () => {
    if (cleaned || printStarted || !printFrame?.contentWindow) return;
    printStarted = true;
    try {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.addEventListener('afterprint', cleanup, { once: true });
       // Transporte de impresión reemplazado por WebUSB + ESC/POS.
    } catch (error) {
      console.warn('No se pudo abrir la impresión:', error);
      cleanup();
      showToast('No se pudo abrir la ventana de impresión', 3500);
    }
  };

  const clonedTicket = printArea.cloneNode(true);
  clonedTicket.style.display = 'block';
  clonedTicket.style.position = 'static';
  clonedTicket.style.left = '';
  clonedTicket.style.top = '';
  clonedTicket.removeAttribute('aria-hidden');

  const dynamicStyle = document.getElementById('print-style-tag')?.textContent || '';
  const isolatedStyle = safeStyle.textContent || '';
  printFrame = document.createElement('iframe');
  printFrame.setAttribute('title', 'Comanda para imprimir');
  printFrame.setAttribute('aria-hidden', 'true');
  const frameWidth = printFormat === 'a4' ? '210mm' : '80mm';
  printFrame.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${frameWidth};height:1000px;border:0;opacity:0;`;
  document.body.appendChild(printFrame);

  const frameDocument = printFrame.contentDocument;
  if (!frameDocument) {
    cleanup();
    showToast('No se pudo preparar la comanda para imprimir', 3500);
    return;
  }
  frameDocument.open();
  frameDocument.write(`<!doctype html>
    <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>${dynamicStyle}</style>
        <style>${isolatedStyle}</style>
      </head>
      <body>${clonedTicket.outerHTML}</body>
    </html>`);
  frameDocument.close();

  const printWhenLoaded = () => {
    requestAnimationFrame(() => requestAnimationFrame(printNow));
  };
  printFrame.addEventListener('load', printWhenLoaded, { once: true });
  // Algunos servicios de impresión Android no reportan load para srcdoc/
  // documentos escritos; este respaldo solo intenta imprimir, no imprime
  // la página principal.
  setTimeout(printWhenLoaded, 120);
  fallbackTimer = setTimeout(cleanup, 30000);
}

  document.getElementById('co-confirm').addEventListener('click', async (e) => {
    const btn = e.currentTarget;

    if (btn.disabled) return;
  if (pendingSavedVenta) {
    showToast('La venta ya está guardada. Reintenta solamente la impresión.', 3500, 'warning');
    return;
  }

    // Evita doble clic mientras se procesa la venta
    btn.disabled = true;
    btn.textContent = 'PROCESANDO…';

    // ── VALIDAR PRODUCTOS CONTRA SUPABASE ─────────────────────
    try {
      const { huboCambios } = await validarCarritoContraSupabase();

      if (huboCambios) {
        const { total: totalActualizado } = getSaleTotals();

        document.getElementById('co-total').textContent =
          `Bs ${fmt(totalActualizado)}`;

        btn.disabled = false;
        btn.textContent = '✓ Confirmar';

        showToast(
          '⚠️ El catálogo cambió. Se actualizaron los productos. Revisa y confirma nuevamente.',
          4500,
          'warning'
        );

        return;
      }

    } catch (error) {
      console.error('Error validando productos:', error);

      btn.disabled = false;
      btn.textContent = '✓ Confirmar';

      showToast(
        `⚠️ ${error.message || 'No se pudieron verificar los productos'}`,
        5000,
        'warning'
      );

      return;
    }

    // ── CALCULAR VENTA DESPUÉS DE VALIDAR ─────────────────────
    const {
      subtotal,
      descuentoMonto,
      total
    } = getSaleTotals();
    if (!selectedPaymentMethod) {
      showToast('⚠️ Selecciona un método de pago', 3000);
      btn.disabled = false;
      btn.textContent = '✓ Confirmar';
      return;
    }

    let monto_qr = 0;
    let monto_ef = 0;
    let monto_tar = 0;

    let pagoDetalle = selectedPaymentMethod.toUpperCase();

    // ── PAGO MIXTO ──────────────────────────────────────────
    if (selectedPaymentMethod === 'mixto') {

      monto_qr =
        parseFloat(document.getElementById('mixto-qr').value) || 0;

      monto_ef =
        parseFloat(document.getElementById('mixto-efectivo').value) || 0;

      monto_tar =
        parseFloat(document.getElementById('mixto-tarjeta').value) || 0;

      const partes = [];

      if (monto_ef > 0)
        partes.push(`Efec. ${fmt(monto_ef)}`);

      if (monto_qr > 0)
        partes.push(`QR ${fmt(monto_qr)}`);

      if (monto_tar > 0)
        partes.push(`Tarj. ${fmt(monto_tar)}`);

      pagoDetalle = partes.join(' - ');

    } else if (selectedPaymentMethod === 'qr') {

      monto_qr = total;

    } else if (selectedPaymentMethod === 'efectivo') {

      monto_ef = total;

    } else if (selectedPaymentMethod === 'tarjeta') {

      monto_tar = total;
    }

    const session = getCurrentSession();
    /*
     * Mantener la misma marca de tiempo si el primer intento queda
     * incierto por red. Esto permite reconciliarlo sin crear otra venta.
     */
    // ── VALIDAR QUE EL TURNO SIGA ABIERTO EN SUPABASE ─────────
    const turnoActual = getTurno();

    if (!turnoActual?.id) {
      btn.disabled = false;
      btn.textContent = '✓ Confirmar';

      showToast(
        '🔒 No hay un turno de caja abierto',
        4000,
        'warning'
      );

      return;
    }

    try {
      const { data: turnoRemoto, error: turnoError } = await supabaseClient
        .from('turnos_caja')
        .select('id,estado,cajero,caja')
        .eq('id', turnoActual.id)
        .maybeSingle();

      if (turnoError) {
        throw turnoError;
      }

      if (!turnoRemoto || turnoRemoto.estado !== 'abierta') {
        clearTurno();
        updateDockCajaLabel();

        btn.disabled = false;
        btn.textContent = '✓ Confirmar';

        closeCheckoutModal();

        showToast(
          '🔒 Esta caja ya fue cerrada. No se puede registrar la venta.',
          5000,
          'warning'
        );

        return;
      }

    } catch (error) {
      console.error('Error verificando turno:', error);

      btn.disabled = false;
      btn.textContent = '✓ Confirmar';

      showToast(
        '⚠️ No se pudo verificar el estado de la caja. La venta no fue guardada.',
        5000,
        'warning'
      );

      return;
    }
    const now = new Date(pendingVentaTimestamp || new Date().toISOString());
    pendingVentaTimestamp = now.toISOString();

    // ── DATOS DE LA VENTA ───────────────────────────────────
    const ventaObj = {
      cajero: session ? session.usuario : 'invitado',
      cajero_nombre: session ? session.nombre : 'Invitado',
      caja: session ? session.caja : 'Sin caja',
      turno_id: getTurno()?.id || null,

      productos: cart.map(i => ({
        id: i.id,
        nombre: i.name,
        qty: i.qty,
        precio: i.price
      })),

      nota: document.getElementById('order-note')?.value.trim() || null,

      subtotal: parseFloat(subtotal.toFixed(2)),
      descuento_tipo: discountValue > 0 ? discountType : null,
      descuento_valor: parseFloat(discountValue.toFixed(2)),
      descuento_monto: parseFloat(descuentoMonto.toFixed(2)),

      total: parseFloat(total.toFixed(2)),
      metodo_pago: selectedPaymentMethod,
      monto_qr: parseFloat(monto_qr.toFixed(2)),
      monto_efectivo: parseFloat(monto_ef.toFixed(2)),
      monto_tarjeta: parseFloat(monto_tar.toFixed(2)),

      creado_en: now.toISOString(),
      registrado: false,
      anulado: false
    };

    let savedId = null;
    let ordenNumero = null;

    // ── GUARDAR EN SUPABASE ─────────────────────────────────
    // Una venta no se considera exitosa si Supabase no confirmó el insert.
    // El carrito queda intacto para poder reintentar sin perder la comanda.
    try {
      if (!supabaseClient) {
        throw new Error('No hay conexión con Supabase');
      }

      const insertResult = await supabaseClient
        .from('ventas')
        .insert([{
          ...ventaObj,
          registrado: true
        }])
        .select('id')
        .single();

      let savedRow = insertResult.data;
      if (insertResult.error) {
        /*
         * Si el servidor guardó la venta pero la respuesta se perdió,
         * buscamos exactamente la misma venta antes de permitir reintentar.
         * No usamos COUNT(*) ni localStorage para decidir si se guardó.
         */
        const { data: existingRow, error: reconcileError } = await supabaseClient
          .from('ventas')
          .select('id')
          .eq('cajero', ventaObj.cajero)
          .eq('caja', ventaObj.caja)
          .eq('creado_en', ventaObj.creado_en)
          .maybeSingle();

        if (reconcileError || !existingRow) throw insertResult.error;
        savedRow = existingRow;
      }

      if (!savedRow?.id) {
        throw new Error('Supabase no devolvió el ID de la venta');
      }

      savedId = savedRow.id;
      ventaObj.registrado = true;
      ordenNumero = getOrderReference(savedId);
      lastOrderReference = ordenNumero;
      updateOrderNumberDisplay(ordenNumero);
    } catch (error) {
      console.error('Error guardando venta:', error);
      pendingComandaData = null;
      btn.disabled = false;
      btn.textContent = '✓ Confirmar';
      showToast(
        `⚠️ No se guardó la venta: ${error.message || 'error de conexión'}`,
        5000,
        'warning'
      );
      return;
    }

    ventaObj.id = savedId;

    showToast(
      ventaObj.registrado
        ? '✅ Venta registrada'
        : '⚠️ Venta no registrada en Supabase',
      3000
    );

    // ── CREAR DATOS DE COMANDA ───────────────────────────────
    pendingComandaData = crearDatosComanda(
      pagoDetalle,
      ordenNumero,
      cart,
      session,
      now,
      ventaObj.nota
    );
    pendingSavedVenta = {
      id: savedId,
      referencia: ordenNumero,
      creado_en: ventaObj.creado_en
    };

    // ── VENTA GUARDADA; IMPRESIÓN MANUAL ─────────────────────
    // La impresora nunca participa en la confirmación de la venta. Primero
    // se confirma Supabase y después el cajero decide si imprime la comanda.
    const printPanel = document.getElementById('post-sale-print');
    const printMessage = document.getElementById('post-sale-print-msg');
    const printBtn = document.getElementById('print-comanda-btn');
    printMessage.textContent = 'Venta guardada. Puedes imprimir la comanda.';
    printBtn.disabled = false;
    printBtn.textContent = 'IMPRIMIR COMANDA';
    printPanel.classList.add('show');

    // Evita guardar una segunda venta mientras esta comanda siga pendiente.
    btn.disabled = true;
    btn.textContent = 'VENTA GUARDADA';
    document.querySelectorAll('.pay-btn').forEach(paymentBtn => {
      paymentBtn.disabled = true;
    });
  });



document.getElementById('print-comanda-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'ENVIANDO A EPSON…';
  try {
    await imprimirComandaUsb(pendingComandaData);
    btn.textContent = 'COMANDA IMPRESA';
    document.getElementById('post-sale-print-msg').textContent =
      'Comanda enviada correctamente a la Epson';
    showToast('✅ Comanda impresa', 2500);
     closeCheckoutModal();
    document.getElementById('post-sale-print').classList.remove('show');
    document.getElementById('co-confirm').textContent = '✓ Confirmar';
    document.getElementById('co-confirm').disabled = true;
    document.querySelectorAll('.pay-btn').forEach(paymentBtn => {
      paymentBtn.disabled = false;
    });
    clearCart();
    selectedPaymentMethod = null;
    pendingComandaData = null;
    pendingVentaTimestamp = null;
    pendingSavedVenta = null;
  } catch (error) {
    console.error('Error de impresión WebUSB:', error);
    btn.disabled = false;
    btn.textContent = 'IMPRIMIR COMANDA';
    document.getElementById('post-sale-print-msg').textContent =
      'Pedido guardado correctamente, pero la impresión falló';
    showToast(`⚠️ ${error.message || 'La impresión falló'}`, 4500);
  }
});

document.getElementById('checkout-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('checkout-modal'))
    closeCheckoutModal();
});

const searchEl = document.getElementById('search');
const clearBtn = document.getElementById('search-clear');
const doneBtn = document.getElementById('search-done');
// Click on the icon button focuses the input to expand the search bar
document.getElementById('search-icon-btn').addEventListener('click', () => searchEl.focus());
// Prevent Chrome from showing saved credentials in the search field
searchEl.addEventListener('focus', () => {
  searchEl.setAttribute('name', 'q-' + Math.random().toString(36).slice(2));
  searchEl.setAttribute('autocomplete', 'off');
});
searchEl.addEventListener('mousedown', () => {
  searchEl.setAttribute('name', 'q-' + Math.random().toString(36).slice(2));
});
searchEl.addEventListener('input', e => {
  searchQ = e.target.value;
  clearBtn.style.display = searchQ ? 'flex' : 'none';
  renderProducts();
});
clearBtn.addEventListener('click', () => {
  searchEl.value = ''; searchQ = '';
  clearBtn.style.display = 'none';
  renderProducts();
});
doneBtn.addEventListener('click', () => {
  // Terminar la selección: algunos navegadores de tabletas necesitan readonly
  // temporal para cerrar completamente el teclado virtual.
  searchEl.setAttribute('readonly', 'readonly');
  searchEl.blur();
  doneBtn.blur();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  setTimeout(() => {
    searchEl.removeAttribute('readonly');
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, 180);
});

let toastTimer;
const toastEl = document.getElementById('toast');
function showToast(msg, dur=3000, variant='success') {
  toastEl.textContent = msg;
  toastEl.classList.toggle('warning', variant === 'warning');
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show', 'warning');
  }, dur);
}

/* ========== CONFIRM TOAST ========== */
let _confirmResolve = null;
const confirmToastEl = document.getElementById('confirm-toast');
const ctConfirmBtn   = document.getElementById('ct-confirm');
const ctCancelBtn    = document.getElementById('ct-cancel');

ctConfirmBtn.addEventListener('click', () => {
  confirmToastEl.classList.remove('show');
  if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
});
ctCancelBtn.addEventListener('click', () => {
  confirmToastEl.classList.remove('show');
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
});

function showConfirm({ msg, icon = '⚠️', confirmText = 'Confirmar', confirmCls = 'danger' }) {
  return new Promise(resolve => {
    if (_confirmResolve) { _confirmResolve(false); }
    _confirmResolve = resolve;
    document.getElementById('ct-icon').textContent    = icon;
    document.getElementById('ct-msg').textContent     = msg;
    ctConfirmBtn.textContent  = confirmText;
    ctConfirmBtn.className    = `ct-btn ${confirmCls}`;
    confirmToastEl.classList.add('show');
  });
}

renderDock();
renderProducts();
renderCart();
updateDockCajaLabel();

/* ========== SESSION (Supabase-backed) ========== */
// localStorage solo guarda el token (UUID). Los datos reales viven en pos_sessions en Supabase.
// Sesión expira tras 1 hora sin actividad.

const SESSION_TOKEN_KEY = 'pos_session_token';
const SESSION_TTL_MS    = 60 * 60 * 1000; // 1 hora

function _getToken() {
  let t = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(SESSION_TOKEN_KEY, t); }
  return t;
}

function getCurrentSession() { return _sessionCache; }

function sessionCaja(s = getCurrentSession()) {
  return String(s?.caja || '').toLowerCase().trim();
}

function esCajaSupervisora(s = getCurrentSession()) {
  const numeroCaja = sessionCaja(s).replace(/[^0-9]/g, '');
  return numeroCaja === '1' || numeroCaja === '5';
}

function actualizarPermisosDeCaja(s = getCurrentSession()) {
  const filtroTodas = document.getElementById('ord-filter-todas');
  const reportePorCaja = document.querySelector('.rep-option-btn[data-tipo="cajas"]');
  const puedeVerGeneral = esCajaSupervisora(s);

  if (filtroTodas) {
    filtroTodas.style.display = puedeVerGeneral ? '' : 'none';
    if (!puedeVerGeneral) filtroTodas.classList.remove('active');
  }
  if (reportePorCaja) {
    reportePorCaja.style.display = puedeVerGeneral ? '' : 'none';
    if (!puedeVerGeneral && repTipo === 'cajas') {
      repTipo = null;
      reportePorCaja.classList.remove('active');
    }
  }
}

async function setSession(data) {
  _sessionCache = data;
  if (!supabaseClient) return;
  try {
    await supabaseClient.from('pos_sessions').upsert({
      token: _getToken(),
      usuario: data.usuario,
      nombre:  data.nombre,
      caja:    data.caja,
      admin:   !!data.admin,
      activo_en: new Date().toISOString()
    });
  } catch(e) { console.warn('Error guardando sesión en Supabase:', e); }
}

async function clearSession() {
  _sessionCache = null;
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_TOKEN_KEY);
  if (!supabaseClient || !token) return;
  try { await supabaseClient.from('pos_sessions').delete().eq('token', token); } catch(_) {}
}

// Actualiza activo_en cada 10 min para mantener sesión viva
setInterval(async () => {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (!supabaseClient || !token || !_sessionCache) return;
  try { await supabaseClient.from('pos_sessions').update({ activo_en: new Date().toISOString() }).eq('token', token); } catch(_) {}
}, 10 * 60 * 1000);

function applySession(s) {
  document.getElementById('badge-nombre').textContent = s.nombre;
  document.getElementById('badge-caja').textContent   = s.caja;
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('top-user').style.display = 'flex';
  actualizarPermisosDeCaja(s);
}

function calcEsAdmin(s) {
  if (!s) return false;
  return !!(s.admin)
    || s.usuario?.toLowerCase().includes('daniel')
    || s.nombre?.toLowerCase().includes('daniel');
}

async function initSession() {
  // Verifica sesión en Supabase y espera mínimo 6s en paralelo
  let sessionFound = false;

  const supabaseCheck = async () => {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (!token || !supabaseClient) return;
    try {
      const { data } = await supabaseClient
        .from('pos_sessions').select('*').eq('token', token).maybeSingle();
      if (data) {
        const elapsed = Date.now() - new Date(data.activo_en).getTime();
        if (elapsed < SESSION_TTL_MS) {
          _sessionCache = { usuario: data.usuario, nombre: data.nombre, caja: data.caja, admin: !!data.admin };
          applySession(_sessionCache);
          await supabaseClient.from('pos_sessions').update({ activo_en: new Date().toISOString() }).eq('token', token);
          try {
            const { data: turno } = await supabaseClient
              .from('turnos_caja').select('*')
              .eq('cajero', data.usuario).eq('estado', 'abierta')
              .order('abierta_en', { ascending: false }).limit(1).maybeSingle();
            if (turno) setTurno(turno);
          } catch(_) {}
          updateDockCajaLabel();
          startTurnoSync();
          sessionFound = true;
        } else {
          await clearSession();
        }
      }
    } catch(e) { console.warn('Error restaurando sesión:', e); }
  };

  // La consulta remota no debe bloquear el arranque si la red queda esperando.
  // Tras 3s se continúa con el login local y el POS sigue siendo utilizable.
  const boundedSessionCheck = Promise.race([
    supabaseCheck(),
    new Promise(resolve => setTimeout(resolve, 3000))
  ]);

  // Corre verificación y timer de 6s en paralelo
  await Promise.all([boundedSessionCheck, new Promise(r => setTimeout(r, 6000))]);

  // Mostrar checkmark animado
  const icon   = document.getElementById('il-icon');
  const check  = document.getElementById('il-check');
  const circle = check.querySelector('circle:nth-child(2)');
  const mark   = document.getElementById('il-check-mark');
  const sub    = document.getElementById('il-sub');

  icon.style.opacity  = '0';
  icon.style.animation = 'none';
  setTimeout(() => {
    check.style.opacity = '1';
    sub.textContent = '¡Listo!';
    sub.style.color = '#4ade80';
    circle.style.strokeDashoffset = '0';
    mark.style.strokeDashoffset   = '0';
  }, 350);

  // Espera que se vea el check (~1.5s) y luego procede
  await new Promise(r => setTimeout(r, 1800));

  document.getElementById('init-loading').classList.add('hidden');
  if (!sessionFound) {
    document.getElementById('login-overlay').classList.remove('hidden');
  }
}

/* ========== LOGIN ========== */
document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('login-usuario').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('login-pass').focus(); });

async function doLogin() {
  const btn   = document.getElementById('login-btn');
  const user  = document.getElementById('login-usuario').value.trim().toLowerCase();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  if (!user || !pass) { errEl.textContent = 'Completa usuario y contraseña'; return; }
  btn.disabled = true; btn.textContent = 'Verificando…';
  errEl.textContent = '';
  try {
    if (!supabaseClient) {
      throw new Error('SUPABASE_NOT_CONNECTED');
    }
    const { data, error } = await supabaseClient
      .from('cajeras')
      .select('*')
      .eq('usuario', user)
      .eq('contrasena', pass)
      .eq('activo', true)
      .maybeSingle();
    if (error) {
      console.error('Error de Supabase al iniciar sesión:', error);
      if (error.code === '42501' || error.code === 'PGRST301') {
        errEl.textContent = 'Supabase bloqueó el acceso a la tabla cajeras. Revisa las políticas RLS.';
      } else if (error.code === '42703' || error.code === 'PGRST204') {
        errEl.textContent = 'La tabla cajeras no tiene una columna requerida por la aplicación.';
      } else {
        errEl.textContent = 'Error de Supabase: ' + (error.message || 'no se pudo consultar cajeras');
      }
      btn.disabled = false; btn.textContent = 'Ingresar →'; return;
    }
    if (!data) {
      errEl.textContent = 'No existe un usuario activo con esos datos. Revisa tu usuario y contraseña.';
      btn.disabled = false; btn.textContent = 'Ingresar →'; return;
    }
    const tempS = { usuario: data.usuario, nombre: data.nombre, caja: data.caja };
    const session = { ...tempS, admin: calcEsAdmin(tempS) || !!(data.admin) || data.rol === 'admin' };
    await setSession(session);
    applySession(session);
    startTurnoSync();
  } catch(e) {
    console.error('Error iniciando sesión:', e);
    errEl.textContent = e.message === 'SUPABASE_NOT_CONNECTED'
      ? 'Supabase no está conectado. Recarga la página e inténtalo de nuevo.'
      : 'Error de conexión con Supabase. Revisa tu conexión a internet.';
    btn.disabled = false; btn.textContent = 'Ingresar →';
  }
}

/* ========== LOGOUT ========== */
document.getElementById('logout-btn').addEventListener('click', async () => {
  const ok = await showConfirm({ msg: '¿Cerrar sesión?', icon: '🔒', confirmText: 'Sí, salir', confirmCls: 'warn' });
  if (!ok) return;
  stopTurnoSync();
  await clearSession();
  document.getElementById('badge-nombre').textContent = '—';
  document.getElementById('badge-caja').textContent   = 'Sin sesión';
  document.getElementById('login-usuario').value = '';
  document.getElementById('login-pass').value    = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-btn').disabled = false;
  document.getElementById('login-btn').textContent = 'Ingresar →';
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('top-user').style.display = 'none';
  actualizarPermisosDeCaja(null);
  clearCart();
});

/* ========== INVENTARIOS ========== */
let invFilter = 'hoy';
document.getElementById('inv-close').addEventListener('click', () => document.getElementById('inventarios-modal').classList.remove('open'));
document.getElementById('inv-filter-hoy').addEventListener('click', () => { invFilter='hoy'; setFilterActive('inv',invFilter); loadInventarios(invFilter); });
document.getElementById('inv-filter-todo').addEventListener('click', () => { invFilter='todo'; setFilterActive('inv',invFilter); loadInventarios(invFilter); });

function setFilterActive(prefix, val) {
  document.querySelectorAll(`#${prefix}-filter-hoy, #${prefix}-filter-todo`).forEach(b => b.classList.toggle('active', b.dataset.filter===val));
}
// =========================================================
// NOTA DEL PEDIDO — MODAL
// =========================================================

const orderNoteBtn =
  document.getElementById('order-note-btn');

const orderNoteModal =
  document.getElementById('order-note-modal');

const orderNoteClose =
  document.getElementById('order-note-close');

const orderNoteSave =
  document.getElementById('order-note-save');

const orderNoteModalInput =
  document.getElementById('order-note-modal-input');

const orderNoteOriginal =
  document.getElementById('order-note');


orderNoteBtn?.addEventListener('click', () => {

  if (orderNoteModalInput && orderNoteOriginal) {
    orderNoteModalInput.value =
      orderNoteOriginal.value || '';
  }

  orderNoteModal?.classList.add('open');

  setTimeout(() => {
    orderNoteModalInput?.focus();
  }, 80);

});


orderNoteClose?.addEventListener('click', () => {
  orderNoteModal?.classList.remove('open');
});


orderNoteSave?.addEventListener('click', () => {

  if (orderNoteModalInput && orderNoteOriginal) {
    orderNoteOriginal.value =
      orderNoteModalInput.value.trim();
  }

  orderNoteModal?.classList.remove('open');
});


orderNoteModal?.addEventListener('click', (e) => {

  if (e.target === orderNoteModal) {
    orderNoteModal.classList.remove('open');
  }

});
async function loadInventarios(filtro) {
  const grid    = document.getElementById('inv-cajas-grid');
  const summary = document.getElementById('inv-summary');
  grid.innerHTML    = '<div class="inv-empty" style="color:var(--text-dim);padding:30px;text-align:center;">Cargando…</div>';
  summary.innerHTML = '';
  try {
    const _invSess = getCurrentSession();
    const _invCaja = (_invSess?.caja || '').toLowerCase().trim();
    const _invCanSeeAll = esCajaSupervisora(_invSess);
    let q = supabaseClient.from('ventas').select('*').eq('anulado', false);
    if (filtro === 'hoy') {
      const hoy = new Date().toISOString().slice(0,10);
      q = q.gte('creado_en', hoy + 'T00:00:00').lte('creado_en', hoy + 'T23:59:59');
    }
    if (!_invCanSeeAll && _invSess) q = q.eq('caja', _invSess.caja);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];

    let totalQr=0, totalEf=0, totalTar=0, totalGen=0, totalCnt=0;
    rows.forEach(r => {
      totalQr  += +r.monto_qr       || 0;
      totalEf  += +r.monto_efectivo || 0;
      totalTar += +r.monto_tarjeta  || 0;
      totalGen += +r.total          || 0;
      totalCnt++;
    });

    summary.innerHTML = `
       <div class="sum-card sum-card-qr">
         <div class="sum-card-icon">QR</div>
        <div class="sum-card-label">QR</div>
         <div class="sum-card-value">${fmt(totalQr)} Bs</div>
      </div>
       <div class="sum-card sum-card-ef">
         <div class="sum-card-icon">EF</div>
        <div class="sum-card-label">Efectivo</div>
         <div class="sum-card-value">${fmt(totalEf)} Bs</div>
      </div>
       <div class="sum-card sum-card-tar">
         <div class="sum-card-icon">TC</div>
        <div class="sum-card-label">Tarjeta</div>
         <div class="sum-card-value">${fmt(totalTar)} Bs</div>
      </div>
       <div class="sum-card sum-card-total">
         <div class="sum-card-icon">TOTAL</div>
        <div class="sum-card-label">Total General</div>
         <div class="sum-card-value">${fmt(totalGen)} Bs</div>
      </div>`;

    const porCaja = {};
    rows.forEach(r => {
      const k = r.caja || 'Sin caja';
      if (!porCaja[k]) porCaja[k] = { cajero: r.cajero_nombre||r.cajero||'—', qr:0, ef:0, tar:0, total:0, cnt:0 };
      porCaja[k].qr    += +r.monto_qr       || 0;
      porCaja[k].ef    += +r.monto_efectivo  || 0;
      porCaja[k].tar   += +r.monto_tarjeta   || 0;
      porCaja[k].total += +r.total           || 0;
      porCaja[k].cnt++;
    });

    const cajas = Object.keys(porCaja).sort();
    if (!cajas.length) {
      grid.innerHTML = '<div class="inv-empty">Sin ventas registradas</div>';
      return;
    }

    grid.innerHTML = cajas.map(caja => {
      const d = porCaja[caja];
      const num = caja.replace(/[^0-9]/g,'') || caja;
      return `
      <div class="inv-caja-card">
        <div class="inv-caja-header">
          <div>
            <div class="inv-caja-name"><span class="inv-caja-badge" aria-label="Caja ${num}">C${num}</span></div>
            <div class="inv-caja-cajero">${d.cajero}</div>
          </div>
          <div class="inv-caja-cnt">${d.cnt} venta${d.cnt!==1?'s':''}</div>
        </div>
        <div class="inv-caja-methods">
          <div class="inv-method-item inv-method-qr">
            <div class="inv-method-label">QR</div>
            <div class="inv-method-val">${fmt(d.qr)} Bs</div>
          </div>
          <div class="inv-method-item inv-method-ef">
            <div class="inv-method-label">Efectivo</div>
            <div class="inv-method-val">${fmt(d.ef)} Bs</div>
          </div>
          <div class="inv-method-item inv-method-tar">
            <div class="inv-method-label">Tarjeta</div>
            <div class="inv-method-val">${fmt(d.tar)} Bs</div>
          </div>
        </div>
        <div class="inv-caja-total">
          <span class="inv-caja-total-lbl">Total Caja</span>
          <span class="inv-caja-total-val">${fmt(d.total)} Bs</span>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    grid.innerHTML = `<div class="inv-empty" style="color:#ff6b6b;">Error: ${e.message}</div>`;
  }
}

/* ========== REPORTES ========== */
let repVentas = [];

async function loadReportes() {
  try {
    const s = getCurrentSession();
    let q = supabaseClient
      .from('ventas').select('*')
      .eq('anulado', false)
      .order('creado_en', { ascending: false })
      .limit(5000);
    if (!esCajaSupervisora(s)) q = q.eq('caja', s?.caja || '');
    const { data, error } = await q;
    if (error) throw error;
    repVentas = data || [];
  } catch(e) {
    console.warn('Error cargando ventas para reportes:', e);
    repVentas = [];
  }
}

/* ========== REPORTES: interacción tipo/rango ========== */
let repTipo  = null;
let repRango = 'personalizado';
let repFechaInicio = null;
let repFechaFin = null;
let repFechasAplicadas = false;

let repCajaSeleccionada = 'todas';

let repCalendarioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function repFechaKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function repFechaDesdeKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function repFormatoFecha(key) {
  if (!key) return '';
  return repFechaDesdeKey(key).toLocaleDateString('es-BO', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

function repFechaHoy() {
  return repFechaKey(new Date());
}

function repSeleccionarRango(inicio, fin = inicio, rango = 'personalizado') {
  repFechaInicio = inicio;
  repFechaFin = fin;
  repRango = rango;
  repFechasAplicadas = false;
  repRenderCalendario();
  repUpdateDateSummary();
  repUpdateDownloadBtn();
}

function repUpdateDateSummary() {
  const els = [
    document.getElementById('rep-date-summary'),
    document.getElementById('rep-date-dialog-summary')
  ].filter(Boolean);
  if (!els.length) return;
  let text;
  if (repRango === 'todo') {
    text = 'Todas las fechas disponibles';
  } else if (!repFechaInicio) {
    text = 'Selecciona una fecha o un rango';
  } else if (!repFechaFin || repFechaInicio === repFechaFin) {
    text = `Fecha exacta: ${repFormatoFecha(repFechaInicio)}`;
  } else {
    text = `${repFormatoFecha(repFechaInicio)} — ${repFormatoFecha(repFechaFin)}`;
  }
  els.forEach(el => { el.textContent = text; });
}

function repRenderCalendario() {
  const grid = document.getElementById('rep-calendar-grid');
  const title = document.getElementById('rep-cal-month');
  if (!grid || !title) return;

  const year = repCalendarioMes.getFullYear();
  const month = repCalendarioMes.getMonth();
  title.textContent = repCalendarioMes.toLocaleDateString('es-BO', {
    month: 'long', year: 'numeric'
  }).replace(/^./, char => char.toUpperCase());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const todayKey = repFechaHoy();
  const cells = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const date = new Date(year, month - 1, previousMonthDays - i);
    cells.push({ date, otherMonth: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: new Date(year, month, day), otherMonth: false });
  }
  while (cells.length < 42) {
    const date = new Date(year, month, cells.length - firstDay + 1);
    cells.push({ date, otherMonth: true });
  }

  grid.innerHTML = cells.map(({ date, otherMonth }) => {
    const key = repFechaKey(date);
    const selected = key === repFechaInicio || key === repFechaFin;
    const inRange = repFechaInicio && repFechaFin &&
      key >= repFechaInicio && key <= repFechaFin;
    return `<button type="button"
      class="${otherMonth ? 'other-month ' : ''}${key === todayKey ? 'today ' : ''}${selected ? 'selected ' : ''}${inRange ? 'in-range' : ''}"
      data-date="${key}" aria-label="${repFormatoFecha(key)}">${date.getDate()}</button>`;
  }).join('');
}

function repOpenDatePicker() {
  const popover = document.getElementById('rep-calendar-popover');
  if (!popover) return;
  repRenderCalendario();
  repUpdateDateSummary();
  popover.classList.add('open');
  popover.setAttribute('aria-hidden', 'false');
}

function repCloseDatePicker() {
  const popover = document.getElementById('rep-calendar-popover');
  if (!popover) return;
  popover.classList.remove('open');
  popover.setAttribute('aria-hidden', 'true');
}

document.getElementById('rep-calendar-grid').addEventListener('click', e => {
  const btn = e.target.closest('button[data-date]');
  if (!btn) return;
  const key = btn.dataset.date;
  const clickedDate = repFechaDesdeKey(key);
  repCalendarioMes = new Date(clickedDate.getFullYear(), clickedDate.getMonth(), 1);
  if (!repFechaInicio || (repFechaInicio && repFechaFin)) {
    repSeleccionarRango(key, null);
    return;
  }
  if (key < repFechaInicio) repSeleccionarRango(key, repFechaInicio);
  else repSeleccionarRango(repFechaInicio, key);
});

document.getElementById('rep-cal-prev').addEventListener('click', () => {
  repCalendarioMes = new Date(repCalendarioMes.getFullYear(), repCalendarioMes.getMonth() - 1, 1);
  repRenderCalendario();
});

document.getElementById('rep-cal-next').addEventListener('click', () => {
  repCalendarioMes = new Date(repCalendarioMes.getFullYear(), repCalendarioMes.getMonth() + 1, 1);
  repRenderCalendario();
});

document.getElementById('rep-date-clear').addEventListener('click', () => {
  repFechaInicio = null;
  repFechaFin = null;
  repRango = 'personalizado';
  repFechasAplicadas = false;
  repRenderCalendario();
  repUpdateDateSummary();
  repUpdateDownloadBtn();
});

function repOpenCajaModal() {
  const modal = document.getElementById('rep-caja-modal');

  if (!modal) return;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}


function repCloseCajaModal() {
  const modal = document.getElementById('rep-caja-modal');

  if (!modal) return;

  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}


document.getElementById('rep-date-apply').addEventListener('click', () => {

  if (!repFechaInicio) {
    showToast('Selecciona una fecha', 2500);
    return;
  }

  // Confirmar fecha seleccionada
  repFechasAplicadas = true;

  // Cerrar calendario
  repCloseDatePicker();

  // Actualizar fecha internamente
  repUpdateDateSummary();

  // Abrir selección de caja
  repOpenCajaModal();
});
document
.getElementById('rep-caja-close')
?.addEventListener('click', repCloseCajaModal);
document
.getElementById('rep-caja-modal')
?.addEventListener('click', e => {

  if (e.target.id === 'rep-caja-modal') {
    repCloseCajaModal();
  }

});
document.getElementById('rep-date-trigger').addEventListener('click', repOpenDatePicker);
document.getElementById('rep-date-close').addEventListener('click', repCloseDatePicker);
document.getElementById('rep-calendar-popover').addEventListener('click', e => {
  if (e.target.id === 'rep-calendar-popover') repCloseDatePicker();
});
document.querySelectorAll('.rep-caja-option').forEach(btn => {

  btn.addEventListener('click', () => {

    // Guardar caja seleccionada
    repCajaSeleccionada = btn.dataset.caja;

    // Mantener sincronizado el select oculto
    const cajaSelect =
      document.getElementById('rep-caja-select');

    if (cajaSelect) {
      cajaSelect.value = repCajaSeleccionada;
    }

    // Cerrar mini modal de caja
    repCloseCajaModal();

    // Descargar automáticamente usando
    // la lógica de descarga que ya existe
    document
      .getElementById('rep-download-btn')
      ?.click();

    // Cerrar modal principal de reportes
    document
      .getElementById('reportes-modal')
      ?.classList.remove('open');

  });

});
function repNormalizarCaja(caja) {
  return String(caja || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^0-9]/g, '');
}

function repGetFiltradas() {
  if (!repFechaInicio || !repFechasAplicadas) return [];

  const [year, month, day] = repFechaInicio.split('-').map(Number);

  const inicioEvento = new Date(
    year,
    month - 1,
    day,
    20, 0, 0, 0
  );

  const finEvento = new Date(
    year,
    month - 1,
    day + 1,
    6, 0, 0, 0
  );

  return repVentas.filter(v => {
    if (!v.creado_en) return false;

    const fechaVenta = new Date(v.creado_en);

    const perteneceEvento =
      fechaVenta >= inicioEvento &&
      fechaVenta < finEvento;

    if (!perteneceEvento) return false;

    if (repCajaSeleccionada === 'todas') {
      return true;
    }

    const cajaVenta = repNormalizarCaja(v.caja);
    const cajaFiltro = repNormalizarCaja(repCajaSeleccionada);

    return cajaVenta === cajaFiltro;
  });
}
function repUpdateDownloadBtn() {
  const wrap = document.getElementById('rep-download-wrap');
  const lbl  = document.getElementById('rep-download-lbl');
  if (!wrap || !lbl) return;
  if (repTipo && repFechasAplicadas && repFechaInicio) {
    wrap.style.display = 'block';
    const labels = { productos:'Ventas por Producto', cajas:'Total por Caja', detalle:'Detalle de Ventas' };
    lbl.textContent = 'Descargar — ' + (labels[repTipo] || 'Reporte');
  } else {
    wrap.style.display = 'none';
  }
}

function repResetUI() {
  repTipo = null;
  repCajaSeleccionada = 'todas';
  document
    .querySelectorAll('.rep-main-option')
    .forEach(btn => btn.classList.remove('active'));

  document
    .querySelectorAll('.rep-caja-option')
    .forEach(btn => btn.classList.remove('active'));

  repCloseDatePicker();

  if (typeof repCloseCajaModal === 'function') {
    repCloseCajaModal();
  }
  const cajaSelect = document.getElementById('rep-caja-select');

  if (cajaSelect) {
    cajaSelect.value = 'todas';
  }
  document
  .querySelectorAll('.rep-main-option')
  .forEach(b => b.classList.remove('active'));
  repRango = 'personalizado';
  repFechaInicio = null;
  repFechaFin = null;
  repFechasAplicadas = false;
  const now = new Date();
  repCalendarioMes = new Date(now.getFullYear(), now.getMonth(), 1);
  const rangoWrap = document.getElementById('rep-rango-wrap');
  if (rangoWrap) { rangoWrap.style.opacity = '.32'; rangoWrap.style.pointerEvents = 'none'; }
  repCloseDatePicker();
  repRenderCalendario();
  repUpdateDateSummary();
  repUpdateDownloadBtn();
}

document.querySelectorAll('.rep-main-option').forEach(btn => {
  btn.addEventListener('click', () => {

    // Limpiar selección visual anterior
    document
      .querySelectorAll('.rep-main-option')
      .forEach(b => b.classList.remove('active'));

    // Marcar reporte seleccionado
    btn.classList.add('active');

    // Guardar tipo de reporte
    repTipo = btn.dataset.tipo;

    // Reiniciar fecha anterior
    repFechaInicio = null;
    repFechaFin = null;
    repFechasAplicadas = false;
    repRango = 'personalizado';

    // Mostrar el mes actual
    const ahora = new Date();

    repCalendarioMes = new Date(
      ahora.getFullYear(),
      ahora.getMonth(),
      1
    );

    // Actualizar y abrir calendario
    repRenderCalendario();
    repUpdateDateSummary();
    repOpenDatePicker();
  });
});

document.getElementById('rep-close').removeEventListener && null;
document.getElementById('rep-close').addEventListener('click', () => {
  document.getElementById('reportes-modal').classList.remove('open');
  repResetUI();
});

document.getElementById('rep-download-btn').addEventListener('click', () => {
  if (!repVentas.length) { showToast('Sin ventas para exportar', 2500); return; }
  const data = repGetFiltradas();
  if (!data.length) { showToast('Sin ventas en el período seleccionado', 2500); return; }
  window._repExportData = data;
  if (repTipo === 'productos') document.getElementById('export-productos-btn').click();
  else if (repTipo === 'cajas') document.getElementById('export-cajas-btn').click();
  else if (repTipo === 'detalle') exportDetalleVentas(data);
  window._repExportData = null;
});

/* ========== EXCEL PROFESIONAL — función base ========== */
async function crearExcelProfesional({ titulo, subtitulo, columnas, filas, filaTotales, nombreArchivo }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PlideBiz POS';
  wb.created = new Date();
  const ws = wb.addWorksheet(subtitulo, {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
  });
  const now = new Date();

  // Fecha del evento seleccionada en Reportes
  let fechaReporte = repFechaInicio || new Date().toISOString().slice(0, 10);

  const [yearReporte, monthReporte, dayReporte] = fechaReporte
    .split('-')
    .map(Number);

  const fechaEvento = new Date(
    yearReporte,
    monthReporte - 1,
    dayReporte
  );

  const fecha = fechaEvento.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  const hora = now.toLocaleTimeString('es-BO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const nc    = columnas.length;

  const estiloFila = (row, { bg, fg = 'FFFFFFFF', bold = false, size = 12, alto = 28, hAlign = 'center' }) => {
    row.height = alto;
    ws.mergeCells(row.number, 1, row.number, nc);
    const c = row.getCell(1);
    c.value     = typeof bg === 'object' ? bg.value : c.value;
    c.font      = { name: 'Calibri', bold, size, color: { argb: fg } };
    c.alignment = { horizontal: hAlign, vertical: 'middle' };
    c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  };

  /* — Fila 1: Empresa — */
  const r1 = ws.addRow(['PlideBiz POS']);
  estiloFila(r1, { bg: 'FF0D5C2E', fg: 'FFFFFFFF', bold: true, size: 22, alto: 48 });

  /* — Fila 2: Título del reporte — */
  const r2 = ws.addRow([subtitulo.toUpperCase()]);
  estiloFila(r2, { bg: 'FF1B8040', fg: 'FFFFFFFF', bold: true, size: 14, alto: 32 });

  /* — Fila 3: Fecha y hora — */
  const r3 = ws.addRow([`Fecha: ${fecha}     Hora: ${hora}`]);
  estiloFila(r3, { bg: 'FFD6F0E2', fg: 'FF0D5C2E', bold: false, size: 11, alto: 22 });

  /* — Fila 4: separador vacío — */
  ws.addRow([]).height = 6;

  /* — Fila 5: Encabezados de columna — */
  const hRow = ws.addRow(columnas.map(c => c.label));
  hRow.height = 30;
  hRow.eachCell((cell, ci) => {
    cell.value     = columnas[ci - 1].label;
    cell.font      = { name: 'Calibri', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D5C2E' } };
    cell.border    = {
      top:    { style: 'medium', color: { argb: 'FF095028' } },
      left:   { style: 'medium', color: { argb: 'FF095028' } },
      bottom: { style: 'medium', color: { argb: 'FF095028' } },
      right:  { style: 'medium', color: { argb: 'FF095028' } },
    };
    ws.getColumn(ci).width = columnas[ci - 1].ancho || 18;
  });

  /* — Filas de datos — */
  filas.forEach((fila, ri) => {
    const dRow = ws.addRow(fila);
    dRow.height = 22;
    const bgBase = ri % 2 === 0 ? 'FFE8F5EE' : 'FFFFFFFF';
    dRow.eachCell((cell, ci) => {
      const col = columnas[ci - 1];
      cell.font      = { name: 'Calibri', size: 11 };
      cell.alignment = { horizontal: col.align || 'left', vertical: 'middle' };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgBase } };
      cell.border    = {
        top:    { style: 'thin', color: { argb: 'FFBBDDC8' } },
        left:   { style: 'thin', color: { argb: 'FFBBDDC8' } },
        bottom: { style: 'thin', color: { argb: 'FFBBDDC8' } },
        right:  { style: 'thin', color: { argb: 'FFBBDDC8' } },
      };
      if (col.formato === 'moneda') {
        cell.numFmt = '"Bs "#,##0';
        cell.font   = { name: 'Calibri', size: 11, color: { argb: 'FF0D5C2E' }, bold: true };
      }
      if (col.formato === 'numero') {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });
  });

  /* — Fila de totales — */
  if (filaTotales) {
    const tRow = ws.addRow(filaTotales);
    tRow.height = 28;
    tRow.eachCell((cell, ci) => {
      const col = columnas[ci - 1];
      cell.font      = { name: 'Calibri', bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: col.align || 'right', vertical: 'middle' };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D5C2E' } };
      cell.border    = {
        top:    { style: 'medium', color: { argb: 'FF095028' } },
        left:   { style: 'medium', color: { argb: 'FF095028' } },
        bottom: { style: 'medium', color: { argb: 'FF095028' } },
        right:  { style: 'medium', color: { argb: 'FF095028' } },
      };
      if (col.formato === 'moneda') cell.numFmt = '"Bs "#,##0';
      if (col.formato === 'numero') cell.numFmt = '#,##0';
    });
  }

  /* — Descargar — */
  const buf      = await wb.xlsx.writeBuffer();
  const blob     = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  const ts = repFechaInicio || new Date().toISOString().slice(0, 10);

  a.href = url;
  a.download = `${nombreArchivo}_${ts}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportDetalleVentas(data) {
  const rows = data || repVentas;

  if (!rows.length) {
    showToast('Sin ventas para exportar', 2000);
    return;
  }

  const columnas = [
    { label: 'Fecha',              ancho: 14, align: 'center' },
    { label: 'Hora',               ancho: 10, align: 'center' },
    { label: 'N° Orden',           ancho: 12, align: 'center' },
    { label: 'Caja',               ancho: 14, align: 'left'   },
    { label: 'Cajero',             ancho: 18, align: 'left'   },
    { label: 'Producto',           ancho: 38, align: 'left'   },
    { label: 'Cantidad',           ancho: 12, align: 'center', formato: 'numero' },
    { label: 'Total Producto Bs',  ancho: 18, align: 'right', formato: 'moneda' },

    { label: 'Tipo Descuento',     ancho: 18, align: 'center' },
    { label: 'Valor Descuento',    ancho: 16, align: 'center' },
    { label: 'Descuento Bs',       ancho: 16, align: 'right', formato: 'moneda' },

    { label: 'QR Bs',              ancho: 12, align: 'right', formato: 'moneda' },
    { label: 'Efectivo Bs',        ancho: 14, align: 'right', formato: 'moneda' },
    { label: 'Tarjeta Bs',         ancho: 14, align: 'right', formato: 'moneda' },
    { label: 'Total Venta Bs',     ancho: 16, align: 'right', formato: 'moneda' },
  ];

  let totQR = 0;
  let totEfectivo = 0;
  let totTarjeta = 0;
  let totTotal = 0;
  let totProductos = 0;
  let totDescuentos = 0;

  const filas = [];

  rows.forEach(r => {
    const dt = r.creado_en ? new Date(r.creado_en) : null;

    const fecha = dt
      ? dt.toLocaleDateString('es-BO')
      : '';

    const hora = dt
      ? dt.toLocaleTimeString('es-BO', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '';

    const qr = parseFloat(r.monto_qr) || 0;
    const ef = parseFloat(r.monto_efectivo) || 0;
    const tar = parseFloat(r.monto_tarjeta) || 0;
    const totalVenta = parseFloat(r.total) || 0;

    const descuentoMonto =
      parseFloat(r.descuento_monto) || 0;

    const descuentoValor =
      parseFloat(r.descuento_valor) || 0;

    const descuentoTipo =
      r.descuento_tipo || '';

    totQR += qr;
    totEfectivo += ef;
    totTarjeta += tar;
    totTotal += totalVenta;
    totDescuentos += descuentoMonto;

    const productos =
      Array.isArray(r.productos) && r.productos.length
        ? r.productos
        : [{
            nombre: '(sin producto)',
            qty: 1,
            precio: 0
          }];

    productos.forEach((p, index) => {
      const cantidad =
        parseFloat(p.qty) ||
        parseFloat(p.cantidad) ||
        1;

      const precio =
        parseFloat(p.precio) ||
        parseFloat(p.price) ||
        0;

      const totalProducto = precio * cantidad;

      totProductos += totalProducto;

      const primeraFila = index === 0;

      let valorDescuentoMostrar = '';

      if (primeraFila && descuentoMonto > 0) {
        if (descuentoTipo === 'porcentaje') {
          valorDescuentoMostrar = `${descuentoValor}%`;
        } else {
          valorDescuentoMostrar = `Bs ${descuentoValor}`;
        }
      }

      filas.push([
        fecha,
        hora,
        r.numero_orden || getOrderReference(r.id),
        r.caja || '',
        r.cajero_nombre || r.cajero || '',
        p.nombre || '(sin nombre)',
        cantidad,
        totalProducto,

        primeraFila && descuentoMonto > 0
          ? descuentoTipo
          : '',

        valorDescuentoMostrar,

        primeraFila && descuentoMonto > 0
          ? descuentoMonto
          : '',

        primeraFila ? qr : '',
        primeraFila ? ef : '',
        primeraFila ? tar : '',
        primeraFila ? totalVenta : ''
      ]);
    });
  });

  await crearExcelProfesional({
    subtitulo: 'Detalle de Ventas',
    columnas,
    filas,

    filaTotales: [
      '',
      '',
      '',
      '',
      '',
      'TOTAL GENERAL',
      '',
      totProductos,

      '',
      'DESCUENTOS',
      totDescuentos,

      totQR,
      totEfectivo,
      totTarjeta,
      totTotal
    ],

    nombreArchivo: 'detalle_ventas'
  });
}
/* ========== EXPORT: VENTAS POR PRODUCTO ========== */
document.getElementById('export-productos-btn').addEventListener('click', async () => {
  const rows = window._repExportData || repVentas;

  if (!rows.length) {
    showToast('Sin ventas para exportar', 2000);
    return;
  }

  const porProducto = {};

  rows.forEach(r => {
    if (!Array.isArray(r.productos) || !r.productos.length) return;

    const descuentoVenta = parseFloat(r.descuento_monto) || 0;

    // Subtotal original de todos los productos de esta venta
    const subtotalVenta = r.productos.reduce((sum, p) => {
      const cantidad =
        parseFloat(p.qty) ||
        parseFloat(p.cantidad) ||
        1;

      const precio =
        parseFloat(p.precio) ||
        parseFloat(p.price) ||
        0;

      return sum + (precio * cantidad);
    }, 0);

    r.productos.forEach(p => {
      const nombre = p.nombre || '(sin nombre)';

      const cantidad =
        parseFloat(p.qty) ||
        parseFloat(p.cantidad) ||
        1;

      const precio =
        parseFloat(p.precio) ||
        parseFloat(p.price) ||
        0;

      const subtotalProducto = precio * cantidad;

      // Repartir proporcionalmente el descuento de la venta
      let descuentoProducto = 0;

      if (descuentoVenta > 0 && subtotalVenta > 0) {
        descuentoProducto =
          descuentoVenta * (subtotalProducto / subtotalVenta);
      }

      const totalNeto =
        Math.max(0, subtotalProducto - descuentoProducto);

      if (!porProducto[nombre]) {
        porProducto[nombre] = {
          qty: 0,
          subtotal: 0,
          descuento: 0,
          totalNeto: 0
        };
      }

      porProducto[nombre].qty += cantidad;
      porProducto[nombre].subtotal += subtotalProducto;
      porProducto[nombre].descuento += descuentoProducto;
      porProducto[nombre].totalNeto += totalNeto;
    });
  });

  const columnas = [
    { label: '#',             ancho: 6,  align: 'center' },
    { label: 'Producto',      ancho: 36, align: 'left'   },
    { label: 'Cantidad',      ancho: 12, align: 'center', formato: 'numero' },
    { label: 'Subtotal Bs',   ancho: 16, align: 'right',  formato: 'moneda' },
    { label: '¿Descuento?',   ancho: 15, align: 'center' },
    { label: 'Descuento Bs',  ancho: 16, align: 'right',  formato: 'moneda' },
    { label: 'Total Neto Bs', ancho: 18, align: 'right',  formato: 'moneda' }
  ];

  let idx = 1;
  let totalCantidad = 0;
  let totalSubtotal = 0;
  let totalDescuento = 0;
  let totalNeto = 0;

  const filas = Object.entries(porProducto)
    .sort((a, b) => b[1].totalNeto - a[1].totalNeto)
    .map(([nombre, d]) => {

      totalCantidad += d.qty;
      totalSubtotal += d.subtotal;
      totalDescuento += d.descuento;
      totalNeto += d.totalNeto;

      return [
        idx++,
        nombre,
        d.qty,
        d.subtotal,
        d.descuento > 0 ? 'SÍ' : 'NO',
        d.descuento,
        d.totalNeto
      ];
    });

  await crearExcelProfesional({
    subtitulo: 'Ventas por Producto',

    columnas,

    filas,

    filaTotales: [
      '',
      'TOTAL GENERAL',
      totalCantidad,
      totalSubtotal,
      '',
      totalDescuento,
      totalNeto
    ],

    nombreArchivo: 'ventas_por_producto'
  });
});
/* ========== EXPORT: TOTAL POR CAJA ========== */
document.getElementById('export-cajas-btn').addEventListener('click', async () => {
  const rows = window._repExportData || repVentas;
  if (!rows.length) { showToast('Sin ventas para exportar', 2000); return; }

  const porCaja = {};
  rows.forEach(r => {
    const k = r.caja || 'Sin caja';
    if (!porCaja[k]) porCaja[k] = { qr: 0, efectivo: 0, tarjeta: 0, total: 0, ventas: 0 };
    porCaja[k].qr       += parseFloat(r.monto_qr)       || 0;
    porCaja[k].efectivo += parseFloat(r.monto_efectivo) || 0;
    porCaja[k].tarjeta  += parseFloat(r.monto_tarjeta)  || 0;
    porCaja[k].total    += parseFloat(r.total)           || 0;
    porCaja[k].ventas++;
  });

  const columnas = [
    { label: 'Caja',               ancho: 20, align: 'left'   },
    { label: 'QR Bs',              ancho: 14, align: 'right',  formato: 'moneda' },
    { label: 'Efectivo Bs',        ancho: 14, align: 'right',  formato: 'moneda' },
    { label: 'Tarjeta Bs',         ancho: 14, align: 'right',  formato: 'moneda' },
    { label: 'Total General Bs',   ancho: 18, align: 'right',  formato: 'moneda' },
    { label: 'N° Ventas',          ancho: 12, align: 'center', formato: 'numero' },
  ];

  let totQR = 0, totEf = 0, totTar = 0, totTot = 0, totVentas = 0;
  const filas = Object.entries(porCaja).map(([caja, d]) => {
    totQR += d.qr; totEf += d.efectivo; totTar += d.tarjeta; totTot += d.total; totVentas += d.ventas;
    return [caja, d.qr, d.efectivo, d.tarjeta, d.total, d.ventas];
  });

  await crearExcelProfesional({
    subtitulo:    'Total por Caja',
    columnas,
    filas,
    filaTotales:  ['TOTAL GENERAL', totQR, totEf, totTar, totTot, totVentas],
    nombreArchivo: 'total_por_caja'
  });
});

/* ========== ÓRDENES ========== */
let ordFiltroCaja   = 'mia';
let ordVentas       = [];

function abrirOrdenes() {
  document.getElementById('ordenes-modal').classList.add('open');
  loadOrdenes();
}
document.getElementById('ord-close').addEventListener('click', () =>
  document.getElementById('ordenes-modal').classList.remove('open'));


document.getElementById('ord-filter-mia').addEventListener('click',    () => { ordFiltroCaja='mia';    syncOrdFilters(); loadOrdenes(); });
document.getElementById('ord-filter-todas').addEventListener('click',  () => {
  if (!esCajaSupervisora()) return;
  ordFiltroCaja='todas'; syncOrdFilters(); loadOrdenes();
});
document.getElementById('ord-search').addEventListener('input', renderOrdenes);

function syncOrdFilters() {
  document
    .getElementById('ord-filter-mia')
    .classList.toggle('active', ordFiltroCaja === 'mia');

  document
    .getElementById('ord-filter-todas')
    .classList.toggle('active', ordFiltroCaja === 'todas');
}
async function loadOrdenes() {
  const listEl = document.getElementById('ord-list');
  listEl.innerHTML = '<div class="ord-empty">Cargando órdenes…</div>';
  try {
    const s = getCurrentSession();
    let q = supabaseClient.from('ventas').select('*').order('creado_en', { ascending: false });

    if (!esCajaSupervisora(s)) {
      ordFiltroCaja = 'mia';
      q = q.eq('caja', s?.caja || '');
    }
    // Always load ALL orders so global numbering is correct; caja filter is client-side
    const { data, error } = await q.limit(500);
    if (error) throw error;
    ordVentas = data || [];
    renderOrdenes();
  } catch(e) {
    listEl.innerHTML = `<div class="ord-empty" style="color:#ff6b6b;">Error: ${e.message}</div>`;
  }
}

function renderOrdenes() {
  const listEl    = document.getElementById('ord-list');
  const countEl   = document.getElementById('ord-count-label');
  const q         = document.getElementById('ord-search').value.toLowerCase().trim();
  // Client-side caja filter. La referencia estable sale del ID de Supabase,
  // no de la posición de la fila ni del total de ventas cargadas.
  let rows = ordVentas;
  if (ordFiltroCaja === 'mia') {
    const _s = getCurrentSession();
    if (_s) rows = rows.filter(r => r.caja === _s.caja);
  }
  if (q) {
    const qLimpio = q.replace('#', '').trim();

    rows = rows.filter(r => {
      const numeroComanda = String(getOrderReference(r.id));

      return (
        numeroComanda === qLimpio ||
        (r.cajero_nombre || '').toLowerCase().includes(q) ||
        (r.caja || '').toLowerCase().includes(q) ||
        (r.metodo_pago || '').toLowerCase().includes(q) ||
        JSON.stringify(r.productos || []).toLowerCase().includes(q)
      );
    });
  }
  const total   = rows.length;
  const activas = rows.filter(r => !r.anulado).length;
  countEl.textContent = `${total} orden${total!==1?'es':''} — ${activas} activa${activas!==1?'s':''}`;

  if (!rows.length) {
    listEl.innerHTML = '<div class="ord-empty">Sin órdenes para mostrar</div>';
    return;
  }

  // Determine which cajas can anular
  const _sess = getCurrentSession();
  const _canAnular = esCajaSupervisora(_sess);

  listEl.innerHTML = rows.map((r, i) => {
    const num       = getOrderReference(r.id);
    const dt     = new Date(r.creado_en);
    const hora   = dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const fecha  = dt.toLocaleDateString([], {day:'2-digit', month:'2-digit'});
    const prods = Array.isArray(r.productos)
    ? r.productos.map(p => `
        <div class="ord-product-row">
          <span class="ord-product-qty">${p.qty}</span>
          <span class="ord-product-name">${p.nombre}</span>
        </div>
      `).join('')
    : '—';
    const estadoCls   = r.anulado ? 'fail' : 'ok';
    const estadoLabel = r.anulado ? 'ANULADA' : 'ACTIVA';
    const anulaBtnHtml = !_canAnular
      ? ''
      : r.anulado
        ? `<button class="ord-btn void" disabled>Anulada</button>`
        : `<button class="ord-btn void" onclick="anularOrden('${r.id}', this)">ANULAR</button>`;
    return `
      <div class="ord-card ${r.anulado ? 'anulada' : ''}">
        <div class="ord-left">
        <div class="ord-top">
          <div class="ord-id-block">
            <span class="ord-id-label">COMANDA</span>
            <span class="ord-num">#${num}</span>
          </div>

          <span class="ord-estado-badge ${estadoCls}">
            ${estadoLabel}
          </span>

          <div class="ord-order-meta">
            <span>${r.caja || '—'}</span>
            <span>${fecha} · ${hora}</span>
          </div>
        </div>
         <div class="ord-meta">
           CAJERO: ${r.cajero_nombre || r.cajero || '—'}
         </div>
          <div class="ord-prods">${prods}</div>
          <div class="ord-total-row">
            <span class="ord-metodo">${(r.metodo_pago||'—').toUpperCase()}</span>
            <span class="ord-total">Bs ${fmt(r.total)}</span>
          </div>
        </div>
        <div class="ord-right">
         <button class="ord-btn print" onclick="reimprimirOrden('${r.id}')">
           IMPRIMIR
         </button>
          ${anulaBtnHtml}
        </div>
      </div>`;
  }).join('');
}

async function anularOrden(id, btn) {
  if (!esCajaSupervisora()) {
    showToast('Solo Caja 1 o Caja 5 pueden anular órdenes', 2500);
    return;
  }
  if (!id || id === 'null' || id === 'undefined') {
    showToast('⚠️ Esta orden no tiene ID en Supabase'); return;
  }
  const ok = await showConfirm({ msg: '¿Anular esta orden?\nEsta acción no se puede deshacer.', icon: '🗑', confirmText: 'Sí, anular', confirmCls: 'danger' });
  if (!ok) return;
  btn.disabled = true; btn.textContent = '…';
  try {
    const { error } = await supabaseClient.from('ventas').update({ anulado: true }).eq('id', id);
    if (error) throw error;
    showToast('🗑 Orden anulada correctamente', 2200);
    loadOrdenes();
  } catch(e) {
    btn.disabled = false; btn.innerHTML = '🗑 Anular';
    showToast('Error al anular: ' + e.message, 3000);
  }
}

function reimprimirOrden(id) {
  const r = ordVentas.find(o => String(o.id) === String(id));
  if (!r) { showToast('Orden no encontrada', 2000); return; }

  const num       = getOrderReference(r.id);
  const dt        = new Date(r.creado_en);
  const comanda = crearDatosComanda(
    String(r.metodo_pago || '—').toUpperCase(),
    num,
    r.productos,
    { caja: r.caja },
    dt
  );
  // La reimpresión usa exactamente el mismo generador ESC/POS que una venta
  // nueva. No se crea un HTML alternativo: así nunca reaparece el diseño viejo.
  imprimirComandaUsb(comanda).then(() => {
    showToast('✅ Comanda reimpresa', 2500);
  }).catch(error => {
    console.warn('No se pudo reimprimir la orden:', error);
    showToast(`⚠️ ${error.message || 'La reimpresión falló'}`, 4500);
  });
}

/* ========== MONITOR DE CAJAS ========== */
let monitorInterval = null;
let monitorTurnos   = [];
let crTurnoActivo   = null;

function abrirMonitor() {
  const _ms = getCurrentSession();
  if (!esCajaSupervisora(_ms)) {
    showToast('⚠️ Solo Caja 1 o Caja 5 pueden ver el monitor', 2500); return;
  }
  if (monitorInterval) clearInterval(monitorInterval);
  cajaShowStep('caja-step-monitor');
  document.getElementById('caja-modal').classList.add('open');
  loadCajasAbiertas();
  monitorInterval = setInterval(loadCajasAbiertas, 15000);
}

function cerrarMonitorStep() {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
  document.getElementById('caja-modal').classList.remove('open');
}

async function loadCajasAbiertas() {
  const list = document.getElementById('monitor-list');
  if (!supabaseClient) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:20px;font-size:13px;">Sin conexión a Supabase</div>';
    return;
  }
  try {
    const { data, error } = await supabaseClient
      .from('turnos_caja')
      .select('*')
      .eq('estado', 'abierta')
      .order('abierta_en', { ascending: true });
    if (error) throw error;
    monitorTurnos = data || [];
    renderMonitorList(monitorTurnos);
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;color:#ff6b6b;padding:20px;font-size:13px;">Error al cargar cajas</div>';
  }
}

function renderMonitorList(turnos) {
  const list = document.getElementById('monitor-list');
  const s = getCurrentSession();
  if (!turnos.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:30px;font-size:13px;">🔒 No hay cajas abiertas</div>';
    return;
  }
  list.innerHTML = turnos.map((t, i) => {
    const desde = t.abierta_en
      ? new Date(t.abierta_en).toLocaleTimeString('es-BO', {hour:'2-digit', minute:'2-digit'})
      : '—';
    const esMia = s && t.cajero === s.usuario;
    const esAdminMonitor = esCajaSupervisora(s) || !!(s?.admin);
    return `<div class="monitor-card">
      <div class="monitor-card-left">
        <div class="monitor-card-caja">${t.caja || '—'}</div>
        <div class="monitor-card-meta">${t.nombre || t.cajero} · desde ${desde}</div>
        <div class="monitor-card-ap">Apertura: Bs ${fmt(t.monto_apertura)}</div>
      </div>
      <div>${(esMia && !esAdminMonitor)
        ? '<span class="monitor-card-badge">Mi caja</span>'
        : `<button class="monitor-card-btn" onclick="initCierreRemoto(${i})">Cerrar →</button>`
      }</div>
    </div>`;
  }).join('');
}

async function initCierreRemotoDesdeOverview(caja) {
  if (!supabaseClient) { showToast('⚠️ Sin conexión a base de datos', 2000); return; }
  try {
    const { data: t } = await supabaseClient
      .from('turnos_caja').select('*').eq('caja', caja).eq('estado', 'abierta')
      .order('abierta_en', { ascending: false }).limit(1).maybeSingle();
    if (!t) { showToast('⚠️ No hay turno abierto para esa caja', 2500); return; }
    let idx = monitorTurnos.findIndex(mt => mt.id === t.id);
    if (idx < 0) { monitorTurnos.push(t); idx = monitorTurnos.length - 1; }
    initCierreRemoto(idx);
  } catch(e) { showToast('⚠️ Error al cargar turno', 2000); }
}

async function initCierreRemoto(idx) {
  const t = monitorTurnos[idx];
  if (!t) return;
  crTurnoActivo = t;
  // Buscar nombre de la cajera en la tabla cajeras por usuario
  let cajeroNombre = t.cajero_nombre || t.nombre || t.cajero || '—';
  if (supabaseClient && t.cajero && !t.cajero_nombre && !t.nombre) {
    try {
      const { data: cajData } = await supabaseClient.from('cajeras').select('nombre').eq('usuario', t.cajero).single();
      if (cajData?.nombre) cajeroNombre = cajData.nombre;
    } catch(_){}
  }
  crTurnoActivo.cajeroNombre = cajeroNombre;
  document.getElementById('cr-caja-titulo').textContent = t.caja || 'Caja';
  document.getElementById('cr-caja-nombre').textContent = `${cajeroNombre} — ${t.caja}`;
  const desde = t.abierta_en
    ? new Date(t.abierta_en).toLocaleString('es-BO', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
    : '—';
  document.getElementById('cr-caja-desde').textContent = `Abierta desde ${desde}`;
  document.getElementById('cr-ef').value = '';
  document.getElementById('cr-qr2').value = '';
  document.getElementById('cr-tar2').value = '';
  document.getElementById('cr-result-grid').style.display = 'none';
  document.getElementById('cr-btn-confirmar').style.display = 'none';
  cajaShowStep('caja-step-cierre-remoto');
}

document.getElementById('cr-btn-calcular').addEventListener('click', async () => {
  if (!crTurnoActivo) return;
  const t = crTurnoActivo;
  const efReal  = Math.round(parseFloat(document.getElementById('cr-ef').value)   || 0);
  const qrReal  = Math.round(parseFloat(document.getElementById('cr-qr2').value)  || 0);
  const tarReal = Math.round(parseFloat(document.getElementById('cr-tar2').value) || 0);
  const apertura = Math.round(parseFloat(t.monto_apertura) || 0);
  let vEf = 0, vQr = 0, vTar = 0;
  if (supabaseClient && t.id) {
    try {
      const { data, error } = await supabaseClient
        .from('ventas')
        .select('monto_efectivo,monto_qr,monto_tarjeta')
        .eq('turno_id', t.id)
        .eq('anulado', false);

      if (error) throw error;

      (data || []).forEach(v => {
        vEf  += parseFloat(v.monto_efectivo) || 0;
        vQr  += parseFloat(v.monto_qr) || 0;
        vTar += parseFloat(v.monto_tarjeta) || 0;
      });

    } catch (e) {
      console.warn('Error consultando ventas del cierre remoto:', e);
    }
  }
  vEf = Math.round(vEf);
  vQr = Math.round(vQr);
  vTar = Math.round(vTar);
  const efEsp = apertura + vEf;
  const difEf  = efReal - efEsp;
  const difQr  = qrReal - vQr;
  const difTar = tarReal - vTar;
  const ok = d => Math.abs(d) < 1;
  const todoCuadra = ok(difEf) && ok(difQr) && ok(difTar);
  const fmtD = d => ok(d)
    ? '<span class="val ok">✓ Cuadra</span>'
    : (d > 0 ? `<span class="val sobra">+Bs ${fmt(Math.abs(d))} SOBRA</span>`
             : `<span class="val falta">-Bs ${fmt(Math.abs(d))} FALTA</span>`);
  const grid = document.getElementById('cr-result-grid');
  grid.innerHTML = `
    <div class="caja-result-row"><span class="lbl">💵 Ef. esperado</span><span class="val">Bs ${fmt(efEsp)}</span></div>
    <div class="caja-result-row"><span class="lbl">💵 Ef. contado</span><span class="val">Bs ${fmt(efReal)}</span></div>
    <div class="caja-result-row"><span class="lbl">Diferencia</span>${fmtD(difEf)}</div>
    <hr style="border:none;border-top:1px solid rgba(160,140,255,0.15);">
    <div class="caja-result-row"><span class="lbl">📱 QR esperado</span><span class="val">Bs ${fmt(vQr)}</span></div>
    <div class="caja-result-row"><span class="lbl">📱 QR contado</span><span class="val">Bs ${fmt(qrReal)}</span></div>
    <div class="caja-result-row"><span class="lbl">Diferencia</span>${fmtD(difQr)}</div>
    <hr style="border:none;border-top:1px solid rgba(160,140,255,0.15);">
    <div class="caja-result-row"><span class="lbl">💳 Tarjeta esp.</span><span class="val">Bs ${fmt(vTar)}</span></div>
    <div class="caja-result-row"><span class="lbl">💳 Tarjeta cont.</span><span class="val">Bs ${fmt(tarReal)}</span></div>
    <div class="caja-result-row"><span class="lbl">Diferencia</span>${fmtD(difTar)}</div>
    <div class="caja-result-row caja-result-total">
      <span class="lbl">Estado</span>
      <span class="val ${todoCuadra ? 'ok' : 'falta'}">${todoCuadra ? '✓ Cuadra' : '⚠ Revisar'}</span>
    </div>`;
  grid.style.display = 'flex';
  const btn = document.getElementById('cr-btn-confirmar');
  btn.dataset.efEsp  = efEsp;
  btn.dataset.vQr    = vQr;
  btn.dataset.vTar   = vTar;
  btn.dataset.difEf  = difEf;
  btn.dataset.difQr  = difQr;
  btn.dataset.difTar = difTar;
  btn.style.display  = 'block';
});
document.getElementById('cr-btn-confirmar').addEventListener('click', async () => {
  if (!crTurnoActivo) return;

  const t = crTurnoActivo;
  const btn = document.getElementById('cr-btn-confirmar');

  btn.disabled = true;

  const efReal  = Math.round(
    parseFloat(document.getElementById('cr-ef').value) || 0
  );

  const qrReal  = Math.round(
    parseFloat(document.getElementById('cr-qr2').value) || 0
  );

  const tarReal = Math.round(
    parseFloat(document.getElementById('cr-tar2').value) || 0
  );

  const cerradaPor =
    getCurrentSession()?.usuario || '—';

  const efEsp  =
    Math.round(parseFloat(btn.dataset.efEsp) || 0);

  const vQr =
    Math.round(parseFloat(btn.dataset.vQr) || 0);

  const vTar =
    Math.round(parseFloat(btn.dataset.vTar) || 0);

  const difEf =
    Math.round(parseFloat(btn.dataset.difEf) || 0);

  const difQr =
    Math.round(parseFloat(btn.dataset.difQr) || 0);

  const difTar =
    Math.round(parseFloat(btn.dataset.difTar) || 0);

  const todoCuadra =
    Math.abs(difEf) < 1 &&
    Math.abs(difQr) < 1 &&
    Math.abs(difTar) < 1;

  if (!supabaseClient || !t.id) {
    showToast(
      '⚠️ No se pudo cerrar: sin ID de turno',
      3000
    );

    btn.disabled = false;
    return;
  }

  try {
    const ventasEfectivo =
      efEsp - parseFloat(t.monto_apertura || 0);

    const { data: cierreGuardado, error } =
      await supabaseClient.rpc(
        'cerrar_turno_caja',
        {
          p_turno_id: t.id,

          p_monto_cierre_efectivo: efReal,
          p_monto_cierre_qr: qrReal,
          p_monto_cierre_tarjeta: tarReal,

          p_ventas_efectivo: ventasEfectivo,
          p_ventas_qr: vQr,
          p_ventas_tarjeta: vTar,

          p_diferencia_efectivo: difEf,
          p_diferencia_qr: difQr,
          p_diferencia_tarjeta: difTar
        }
      );

    if (error) throw error;

    if (!cierreGuardado) {
      throw new Error(
        'Supabase no confirmó el cierre remoto'
      );
    }

  } catch (e) {
    console.error('Error cierre remoto:', e);

    showToast(
      '⚠️ No se pudo confirmar el cierre remoto: ' +
      (e.message || 'error de conexión'),
      4500
    );

    btn.disabled = false;
    return;
  }


  // Imprimir cierre remoto
  const fmtDifP = d => d > 0
    ? `SOBRA Bs ${fmt(Math.abs(d))}`
    : `FALTA Bs ${fmt(Math.abs(d))}`;
  const difLineP = d => Math.abs(d) < 1
    ? ''
    : `<div class="pc-dif"><span>DIFERENCIA</span><span>${fmtDifP(d)}</span></div>`;
  const totEsp  = Math.round(efEsp + vQr + vTar);
  const totCont = Math.round(efReal + qrReal + tarReal);
  const ahora   = new Date();
  const oldPA = document.getElementById('print-area'); if (oldPA) oldPA.remove();
  const oldST = document.getElementById('print-style-tag'); if (oldST) oldST.remove();
  const pStyle = document.createElement('style');
  pStyle.id = 'print-style-tag';
  pStyle.textContent = `@media print {
    @page{size:A4 portrait;margin:0;}
    html{height:auto!important;width:210mm!important;}
    body{height:auto!important;min-height:0!important;overflow:visible!important;background:#fff!important;margin:0!important;padding:0!important;width:210mm!important;}
    body::after{display:none!important;}
    body > *{display:none!important;}
    #print-area{display:block!important;width:180mm!important;font-family:Arial,Helvetica,sans-serif;font-weight:700;color:#000;background:#fff;margin:12mm auto;padding:0 8mm 12mm;box-sizing:border-box;text-transform:uppercase;}
    #print-area .pc-brand{text-align:center;font-size:18pt;font-weight:900;letter-spacing:.04em;margin-bottom:2pt;padding-top:2pt;}
    #print-area .pc-titulo{text-align:center;font-size:11pt;font-weight:900;border-top:2.5px solid #000;border-bottom:2.5px solid #000;padding:3pt 0;margin-bottom:4pt;}
    #print-area .pc-info{font-size:10pt;font-weight:900;margin:2pt 0;}
    #print-area .pc-ticket-meta{display:flex;align-items:baseline;justify-content:space-between;gap:2mm;width:100%;margin:2pt 0 4pt;font-size:8pt;font-weight:900;line-height:1.1;}
    #print-area .pc-ticket-meta .pc-datetime{font-size:8pt;font-weight:700;white-space:nowrap;text-align:right;}
    #print-area .pc-divider{border:none;border-top:1.5px dashed #000;margin:4pt 0;}
    #print-area .pc-metodo{font-size:11pt;font-weight:900;border-bottom:1px solid #ddd;padding:3pt 0 2pt;margin-bottom:1pt;}
    #print-area .pc-row{display:grid;grid-template-columns:minmax(0,1fr) max-content;column-gap:2mm;align-items:baseline;font-size:10pt;font-weight:900;padding:1pt 0;width:100%;min-width:0;}
    #print-area .pc-row>span:first-child{min-width:0;overflow-wrap:anywhere;}
    #print-area .pc-row>span:last-child{white-space:nowrap;text-align:right;}
    #print-area .pc-dif{display:grid;grid-template-columns:minmax(0,1fr) max-content;column-gap:2mm;align-items:baseline;font-size:11pt;font-weight:900;padding:2pt 0 4pt;width:100%;min-width:0;}
    #print-area .pc-dif>span:first-child{min-width:0;overflow-wrap:anywhere;}
    #print-area .pc-dif>span:last-child{white-space:nowrap;text-align:right;}
    #print-area .pc-total-bloque{border-top:2.5px solid #000;border-bottom:2.5px solid #000;padding:4pt 0;margin:6pt 0;}
    #print-area .pc-total-row{display:grid;grid-template-columns:minmax(0,1fr) max-content;column-gap:2mm;align-items:baseline;font-size:11pt;font-weight:900;min-width:0;}
    #print-area .pc-total-row>span:first-child{min-width:0;overflow-wrap:anywhere;}
    #print-area .pc-total-row>span:last-child{white-space:nowrap;text-align:right;}
  }`;
  document.head.appendChild(pStyle);
  const pa = document.createElement('div');
  pa.id = 'print-area';
  pa.dataset.printFormat = 'a4';
  pa.style.display = 'none';
  pa.innerHTML = `
    <div class="pc-brand">MAMA POTOSI</div>
    <div class="pc-titulo">CIERRE DE CAJA</div>
    <div class="pc-ticket-meta">
      <span>CAJA: ${formatReceiptCaja(t.caja)}</span>
      <span class="pc-datetime">${formatReceiptDateTime(ahora)}</span>
    </div>
    <hr class="pc-divider">
     <div class="pc-metodo">EFECTIVO</div>
    <div class="pc-row"><span>ESPERADO</span><span>Bs ${fmt(efEsp)}</span></div>
    <div class="pc-row"><span>CONTADO</span><span>Bs ${fmt(efReal)}</span></div>
    ${difLineP(difEf)}
    <hr class="pc-section-divider">
     <div class="pc-metodo">QR</div>
    <div class="pc-row"><span>ESPERADO</span><span>Bs ${fmt(vQr)}</span></div>
    <div class="pc-row"><span>CONTADO</span><span>Bs ${fmt(qrReal)}</span></div>
    ${difLineP(difQr)}
    <hr class="pc-section-divider">
     <div class="pc-metodo">TARJETA</div>
    <div class="pc-row"><span>ESPERADO</span><span>Bs ${fmt(vTar)}</span></div>
    <div class="pc-row"><span>CONTADO</span><span>Bs ${fmt(tarReal)}</span></div>
    ${difLineP(difTar)}
    <hr class="pc-divider">
    <div class="pc-total-bloque">
      <div class="pc-total-row"><span>TOTAL ESPERADO</span><span>Bs ${fmt(totEsp)}</span></div>
      <div class="pc-total-row" style="margin-top:2pt;"><span>TOTAL CONTADO</span><span>Bs ${fmt(totCont)}</span></div>
    </div>`;
  document.body.appendChild(pa);
  imprimirTicketCuandoEsteListo().catch(error => {
    console.warn('No se pudo imprimir el cierre remoto:', error);
    showToast('El cierre se guardó, pero la impresión falló', 3500);
  });

  btn.disabled = false;
  crTurnoActivo = null;
  showToast(`🔒 ${t.caja} cerrada correctamente`, 3000);
  setTimeout(() => { cajaShowStep('caja-step-monitor'); loadCajasAbiertas(); }, 400);
});

document.getElementById('cr-btn-volver').addEventListener('click', () => cajaShowStep('caja-step-monitor'));
document.getElementById('monitor-close-btn').addEventListener('click', cerrarMonitorStep);
document.getElementById('monitor-refresh-btn').addEventListener('click', loadCajasAbiertas);

// Detener polling cuando el modal de caja se cierra por otros medios
document.getElementById('caja-step1-cancel').addEventListener('click', () => {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
});
document.getElementById('caja-cierre-cancel').addEventListener('click', () => {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
});

/* ========== SYNC TURNO EN TIEMPO REAL ========== */
// Cada 5 seg verifica en Supabase si el turno sigue abierto.
// Si otra persona lo cerró remotamente, limpia el caché local y actualiza el dock.
let _turnoSyncInterval = null;

async function syncTurnoEstado() {
  if (!supabaseClient) return;
  const s = getCurrentSession();
  const turno = getTurno();
  if (!s || !turno || turno.estado !== 'abierta') return;
  try {
    const { data, error } = await supabaseClient
      .from('turnos_caja')
      .select('estado')
      .eq('id', turno.id)
      .maybeSingle();
    if (error) return;
    // Si Supabase dice cerrado (o no existe) pero local dice abierto → corregir
    if (!data || data.estado !== 'abierta') {
      clearTurno();
      updateDockCajaLabel();
      showToast('🔒 Caja cerrada por otro usuario', 3000);
    }
  } catch(_) {}
}

function startTurnoSync() {
  if (_turnoSyncInterval) clearInterval(_turnoSyncInterval);
  _turnoSyncInterval = setInterval(syncTurnoEstado, 5000);
}

function stopTurnoSync() {
  if (_turnoSyncInterval) { clearInterval(_turnoSyncInterval); _turnoSyncInterval = null; }
}

/* ========== INIT ========== */
initSession();
updateOrderNumberDisplay();
startTurnoSync();
