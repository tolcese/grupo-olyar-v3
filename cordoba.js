// ══════════════════════════════════════════════════════════════
// CÓRDOBA — seguimiento de trámites de registro (v3.9.56 / v3.9.57)
// v3.9.57: Nuevo ingreso y edición en pantalla propia (no ventana); sin botón actualizar: se refresca al instante
//          (aviso Broadcast 'cba' en el canal olyar-sync, ver _olyarFetch en index).
// Tablas: cba_tramites, cba_listas (SQL cba_tramites.sql)
// Ven, cargan y editan: admin, claudionieva y yohanavarro (_puedeCordoba en index). Borra solo admin.
// Usa globales de index.html: SB, ME, toast, showV, registrarHistorial, _sbAll, _puedeCordoba
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const CBA = window.CBA = {
    rows: [], listas: [], ok: false, err: null, cargando: false, cargado: false,
    modo: 'lista', formId: null,   // v3.9.57: 'lista' = vista general, 'form' = pantalla de ingreso / edición
    f: { q: '', tramite: '', registro: '', desde: '', hasta: '' },
    orden: { k: 'ingreso_oficina', dir: 'desc' }
  };

  // ── utilidades ──
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fD = v => { if (!v) return ''; const p = String(v).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0].slice(2) : v; };
  const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const quien = () => ME?.nom || ME?.usr || '—';
  const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return isFinite(n) ? n : null; };
  const $ = v => '$' + Math.round(v || 0).toLocaleString('es-AR');
  const numIn = v => {
    let s = String(v ?? '').replace(/[$\s]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const puede = () => typeof _puedeCordoba === 'function' ? _puedeCordoba() : !!ME;
  const puedeBorrar = () => ME?.rol === 'admin';

  // Columnas de la vista general (mismo orden que el Excel, sin Número de trámite)
  const COLS = [
    ['ingreso_oficina', 'Ingreso oficina', 'fecha'],
    ['dominio', 'Dominio', 'txt'],
    ['agencia', 'Agencia', 'txt'],
    ['comprador', 'Comprador', 'txt'],
    ['dni', 'DNI', 'txt'],
    ['vehiculo', 'Vehículo', 'txt'],
    ['ef', 'EF entregado', 'ef'],
    ['tramite', 'Trámite', 'txt'],
    ['registro', 'Registro', 'txt'],
    ['escribania', 'Escribanía', 'esc'],
    ['control', 'Control', 'fecha'],
    ['entrega', 'Entrega', 'fecha'],
    ['a_quien', 'A quién', 'txt'],
    ['ingreso_registro', 'Fecha ingreso registro', 'fecha'],
    ['retiro_prenda', 'Retiro prenda', 'fecha'],
    ['retiro_doc', 'Retiro doc', 'fecha'],
    ['entrega_prenda_agencia', 'Entrega de prenda agencia', 'fecha'],
    ['entrega_doc_cliente', 'Entrega doc a cliente', 'fecha'],
    ['obs', 'Obs', 'obs']
  ];
  const NOMBRE = Object.fromEntries(COLS.map(c => [c[0], c[1]]));
  NOMBRE.ef_monto = 'EF entregado'; NOMBRE.ef_no = 'EF entregado (NO)'; NOMBRE.escribania_txt = 'Escribanía (texto)';
  const efTxt = r => r.ef_no ? 'NO' : (num(r.ef_monto) !== null ? $(num(r.ef_monto)) : '');
  const escTxt = r => [fD(r.escribania), r.escribania_txt || ''].filter(Boolean).join(' · ');

  // ── carga ──
  CBA.cargar = async function (silencioso) {
    CBA.cargando = true; if (!silencioso) CBA.render();
    try {
      const all = typeof _sbAll === 'function' ? _sbAll : (f => f());
      const [a, b] = await Promise.all([
        all(() => SB.from('cba_tramites').select('*').order('ingreso_oficina', { ascending: false }).order('id', { ascending: false })),
        SB.from('cba_listas').select('*').order('orden').order('valor')
      ]);
      const e = a.error || b.error; if (e) throw e;
      CBA.rows = a.data || []; CBA.listas = b.data || [];
      CBA.ok = true; CBA.err = null;
    } catch (e) {
      const m = String(e.message || e);
      CBA.ok = false; CBA.err = /does not exist|relation|schema cache|Could not find/i.test(m) ? 'faltaSQL' : m;
      console.warn('Córdoba:', m);
    }
    CBA.cargando = false; CBA.cargado = true;
    // con el formulario abierto no se redibuja (no se pierde lo que se está escribiendo)
    if (!(silencioso && CBA.modo === 'form')) CBA.render();
  };
  // v3.9.57: aviso de otro usuario (Broadcast 'cba'): recarga al instante si la sección está abierta
  CBA.alAviso = function () {
    const v = document.getElementById('v-cordoba');
    if (!v || v.style.display === 'none' || !CBA.ok) { CBA.cargado = false; return; }
    clearTimeout(CBA._av); CBA._av = setTimeout(() => CBA.cargar(true), 300);
  };

  // ── estilos ──
  function css() {
    if (document.getElementById('cba-css')) return;
    const s = document.createElement('style'); s.id = 'cba-css';
    s.textContent = `
#v-cordoba .cba-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:14px 0}
#v-cordoba .cba-kpi{background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px}
#v-cordoba .cba-kpi .l{font-size:11.5px;color:var(--muted);font-weight:600}
#v-cordoba .cba-kpi .v{font-size:20px;font-weight:900;margin-top:2px}
#v-cordoba .cba-card{background:#fff;border:1.5px solid var(--line);border-radius:14px;padding:14px 16px}
#v-cordoba .cba-fil{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}
#v-cordoba .cba-fil input,#v-cordoba .cba-fil select{border:1.5px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;background:#fff}
#v-cordoba .cba-k{font-size:12px;color:var(--muted);font-weight:600}
#v-cordoba .cba-wrap{overflow:auto;max-height:calc(100vh - 290px);border:1px solid var(--line);border-radius:10px}
#v-cordoba table.cba-t{border-collapse:separate;border-spacing:0;font-size:12.5px;width:max-content;min-width:100%}
#v-cordoba table.cba-t th{position:sticky;top:0;z-index:2;background:#f8fafc;text-align:left;font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--muted);padding:8px 9px;border-bottom:1.5px solid var(--line);white-space:nowrap;cursor:pointer;user-select:none}
#v-cordoba table.cba-t th.on{color:#1d6fce}
#v-cordoba table.cba-t td{padding:7px 9px;border-bottom:1px solid var(--line);white-space:nowrap;background:#fff}
#v-cordoba table.cba-t tr:hover td{background:#f5f9ff;cursor:pointer}
#v-cordoba table.cba-t td.obs{max-width:260px;overflow:hidden;text-overflow:ellipsis}
#v-cordoba table.cba-t td.dom{font-weight:800;letter-spacing:.03em}
#v-cordoba table.cba-t th:nth-child(2),#v-cordoba table.cba-t td:nth-child(2){position:sticky;left:0;z-index:1;box-shadow:1px 0 0 var(--line)}
#v-cordoba table.cba-t th:nth-child(2){z-index:3}
#v-cordoba .cba-no{display:inline-block;padding:1px 7px;border-radius:6px;background:#f1f5f9;color:#475569;font-weight:700;font-size:11px}
#v-cordoba .cba-empty{text-align:center;color:var(--muted);padding:40px 10px}
#v-cordoba .cba-form{background:#fff;border:1.5px solid var(--line);border-radius:14px;padding:18px 20px;max-width:1000px;margin-top:14px}
#v-cordoba .cba-form .ft{display:flex;gap:10px;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid var(--line)}
#v-cordoba .cba-form .err{margin:12px 0 0}
#cba-modal{position:fixed;inset:0;background:rgba(15,15,15,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:14px}
#cba-modal .b{background:#fff;border-radius:14px;width:100%;max-width:760px;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.25)}
#cba-modal .h{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e7e5e4;font-size:15.5px}
#cba-modal .x{border:none;background:none;font-size:16px;cursor:pointer;color:#78716c}
#cba-modal .c{padding:14px 18px;overflow:auto;font-size:13.5px}
#cba-modal .ft{display:flex;gap:10px;align-items:center;padding:12px 18px;border-top:1px solid #e7e5e4}
/*f*/.cba-f .sec{font-size:10.5px;font-weight:800;color:#78716c;text-transform:uppercase;letter-spacing:.07em;margin:14px 0 8px;padding-bottom:5px;border-bottom:1px solid #e7e5e4}
/*f*/.cba-f .sec:first-child{margin-top:0}
.cba-f .g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 12px}
.cba-f label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:#57534e}
.cba-f input,.cba-f select,.cba-f textarea{border:1.5px solid #e7e5e4;border-radius:8px;padding:7px 9px;font-size:13.5px;font-weight:400;color:#1c1917;background:#fff;font-family:inherit;min-width:0}
.cba-f input:disabled{background:#f5f5f4;color:#a8a29e}
.cba-f .chk{flex-direction:row;align-items:center;gap:6px;font-weight:600;white-space:nowrap}
.cba-f .row2{display:flex;gap:6px;align-items:center}
.cba-f .row2>*{flex:1}
.cba-f .row2>.chk{flex:none}
.cba-f .err{display:none;margin:0 18px 6px;padding:8px 10px;border-radius:8px;background:#fee2e2;color:#991b1b;font-size:12.5px;font-weight:600}
.cba-f .meta{font-size:11.5px;color:#78716c;margin-right:auto}
.cba-f .btn2{border:1.5px solid #e7e5e4;background:#fff;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.cba-f .btn2.pri{background:#1d6fce;border-color:#1d6fce;color:#fff}
.cba-f .btn2.del{color:#b91c1c;border-color:#fca5a5}
.cba-f .btn2[disabled]{opacity:.45;cursor:not-allowed}
@media (max-width:700px){.cba-f .g{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
    document.head.appendChild(s);
  }

  // ── vista general ──
  CBA.render = function () {
    const root = document.getElementById('v-cordoba'); if (!root) return;
    css();
    if (CBA.modo === 'form' && CBA.ok) { root.innerHTML = vistaForm(); return; }
    const head = `<div class="ph">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn btn-s" onclick="showV('panel-principal')" style="padding:6px 12px">← Volver</button>
          <div><div class="ph-t">📍 Córdoba</div><div class="ph-s">Seguimiento de trámites de registro</div></div>
        </div>
        <div style="display:flex;gap:8px">
          ${CBA.ok && puede() ? '<button class="btn btn-p" onclick="CBA.abrir()">➕ Nuevo ingreso</button>' : ''}
        </div>
      </div>`;
    let body;
    if (!CBA.cargado || CBA.cargando && !CBA.ok) body = '<div class="cba-card cba-empty">⏳ Cargando trámites…</div>';
    else if (CBA.err === 'faltaSQL') body = '<div class="cba-card cba-empty">⚠️ Todavía no están creadas las tablas de Córdoba.<br><small>Hay que correr <b>cba_tramites.sql</b> en el SQL Editor de Supabase y volver a entrar a Córdoba.</small></div>';
    else if (CBA.err) body = `<div class="cba-card cba-empty">Error al cargar: ${esc(CBA.err)}</div>`;
    else body = vistaGeneral();
    root.innerHTML = head + body;
  };

  function filtrados() {
    const f = CBA.f, q = f.q.trim().toLowerCase();
    let l = CBA.rows.filter(r => {
      if (f.tramite && r.tramite !== f.tramite) return false;
      if (f.registro && r.registro !== f.registro) return false;
      if (f.desde && String(r.ingreso_oficina) < f.desde) return false;
      if (f.hasta && String(r.ingreso_oficina) > f.hasta) return false;
      if (q && ![r.dominio, r.agencia, r.comprador, r.dni, r.vehiculo, r.tramite, r.registro, r.a_quien, r.obs, r.escribania_txt].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    const k = CBA.orden.k, sg = CBA.orden.dir === 'asc' ? 1 : -1;
    const val = r => k === 'ef' ? (r.ef_no ? -1 : num(r.ef_monto)) : k === 'escribania' ? (r.escribania || r.escribania_txt || '') : r[k];
    const vacio = v => v === null || v === undefined || v === '';
    l.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (vacio(va) !== vacio(vb)) return vacio(va) ? 1 : -1;
      if (!vacio(va)) { const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es'); if (c) return c * sg; }
      return b.id - a.id;
    });
    return l;
  }

  CBA.ordenar = function (k) {
    const o = CBA.orden;
    if (o.k === k) o.dir = o.dir === 'asc' ? 'desc' : 'asc'; else { o.k = k; o.dir = 'asc'; }
    CBA.render();
  };
  CBA.filtrar = function (k, v) { CBA.f[k] = v; CBA.render(); };

  function vistaGeneral() {
    const f = CBA.f, l = filtrados();
    const mes = hoy().slice(0, 7);
    const delMes = CBA.rows.filter(r => String(r.ingreso_oficina).slice(0, 7) === mes).length;
    const sinEntregar = CBA.rows.filter(r => !r.entrega_doc_cliente).length;
    const ops = tipo => CBA.listas.filter(x => x.tipo === tipo && (x.activo || CBA.rows.some(r => r[tipo] === x.valor)))
      .map(x => `<option${f[tipo] === x.valor ? ' selected' : ''}>${esc(x.valor)}</option>`).join('');
    const th = CBA_th;
    const filas = l.map(r => `<tr onclick="CBA.abrir(${r.id})" title="Tocá para editar">
        <td>${fD(r.ingreso_oficina)}</td>
        <td class="dom">${esc(r.dominio)}</td>
        <td>${esc(r.agencia || '')}</td>
        <td>${esc(r.comprador || '')}</td>
        <td>${esc(r.dni || '')}</td>
        <td>${esc(r.vehiculo || '')}</td>
        <td style="text-align:right">${r.ef_no ? '<span class="cba-no">NO</span>' : esc(efTxt(r))}</td>
        <td>${esc(r.tramite || '')}</td>
        <td>${esc(r.registro || '')}</td>
        <td>${esc(escTxt(r))}</td>
        <td>${fD(r.control)}</td>
        <td>${fD(r.entrega)}</td>
        <td>${esc(r.a_quien || '')}</td>
        <td>${fD(r.ingreso_registro)}</td>
        <td>${fD(r.retiro_prenda)}</td>
        <td>${fD(r.retiro_doc)}</td>
        <td>${fD(r.entrega_prenda_agencia)}</td>
        <td>${fD(r.entrega_doc_cliente)}</td>
        <td class="obs" title="${esc(r.obs || '')}">${esc(r.obs || '')}</td>
      </tr>`).join('');
    const filtrando = f.q || f.tramite || f.registro || f.desde || f.hasta;
    return `
      <div class="cba-kpis">
        <div class="cba-kpi"><div class="l">Trámites</div><div class="v">${CBA.rows.length}</div></div>
        <div class="cba-kpi"><div class="l">Ingresados este mes</div><div class="v">${delMes}</div></div>
        <div class="cba-kpi"><div class="l">Sin entrega de doc a cliente</div><div class="v">${sinEntregar}</div></div>
      </div>
      <div class="cba-card">
        <div class="cba-fil">
          <input id="cba-q" placeholder="🔍 Dominio, comprador, DNI, agencia, obs…" value="${esc(f.q)}" style="min-width:250px"
            oninput="CBA.f.q=this.value;clearTimeout(CBA._t);CBA._t=setTimeout(()=>{CBA.render();const i=document.getElementById('cba-q');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},250)">
          <select onchange="CBA.filtrar('tramite',this.value)"><option value="">Todos los trámites</option>${ops('tramite')}</select>
          <select onchange="CBA.filtrar('registro',this.value)"><option value="">Todos los registros</option>${ops('registro')}</select>
          <span class="cba-k">Ingreso desde</span><input type="date" value="${f.desde}" onchange="CBA.filtrar('desde',this.value)">
          <span class="cba-k">hasta</span><input type="date" value="${f.hasta}" onchange="CBA.filtrar('hasta',this.value)">
          ${filtrando ? `<button class="btn btn-s" onclick="CBA.f={q:'',tramite:'',registro:'',desde:'',hasta:''};CBA.render()">✕ Limpiar</button>` : ''}
          <span class="cba-k" style="margin-left:auto">${l.length} de ${CBA.rows.length} · tocá una fila para editar</span>
        </div>
        ${l.length ? `<div class="cba-wrap"><table class="cba-t"><thead><tr>${COLS.map(c => th(c[0], c[1])).join('')}</tr></thead><tbody>${filas}</tbody></table></div>`
        : `<div class="cba-empty">${CBA.rows.length ? 'No hay trámites con estos filtros.' : 'Todavía no hay trámites cargados.' + (puede() ? '<br><br><button class="btn btn-p" onclick="CBA.abrir()">➕ Nuevo ingreso</button>' : '')}</div>`}
      </div>`;
  }
  function CBA_th(k, t) {
    const on = CBA.orden.k === k;
    return `<th class="${on ? 'on' : ''}" onclick="CBA.ordenar('${k}')">${t}${on ? (CBA.orden.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  }

  // ── modal ──
  function modal(titulo, html, pie) {
    cerrar();
    const ov = document.createElement('div'); ov.id = 'cba-modal'; ov.className = 'cba-f';
    ov.innerHTML = `<div class="b"><div class="h"><b>${titulo}</b><button class="x" onclick="CBA.cerrar()">✕</button></div>
      <div class="c">${html}</div><div class="err" id="cba-err"></div><div class="ft">${pie}</div></div>`;
    ov.addEventListener('mousedown', e => { if (e.target === ov) cerrar(); });
    document.body.appendChild(ov);
  }
  function cerrar() { const m = document.getElementById('cba-modal'); if (m) m.remove(); }
  CBA.cerrar = cerrar;
  const err = t => { const e = document.getElementById('cba-err'); if (e) { e.textContent = t; e.style.display = t ? 'block' : 'none'; } };
  const v = id => { const e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : null; };
  const bloquear = b => document.querySelectorAll('#cba-modal .ft button, #v-cordoba .cba-form .ft button').forEach(x => { x.disabled = b; });

  // desplegable con opción "➕ Agregar nuevo…"
  function lista(tipo, actual) {
    const vals = CBA.listas.filter(x => x.tipo === tipo && x.activo).map(x => x.valor);
    if (actual && !vals.includes(actual)) vals.unshift(actual);
    return `<select id="cba-${tipo}" onchange="var w=document.getElementById('cba-${tipo}-nw');w.style.display=this.value==='__nuevo'?'':'none';if(this.value==='__nuevo')document.getElementById('cba-${tipo}-nv').focus()">
        <option value="">—</option>${vals.map(x => `<option${x === actual ? ' selected' : ''}>${esc(x)}</option>`).join('')}<option value="__nuevo">➕ Agregar nuevo…</option></select>
      <span id="cba-${tipo}-nw" style="display:none"><input id="cba-${tipo}-nv" placeholder="Nuevo ${tipo === 'tramite' ? 'trámite' : 'registro'}" style="margin-top:4px;width:100%"></span>`;
  }

  CBA.abrir = function (id) {
    if (!puede()) { toast('No tenés permisos para esta sección', 'warn'); return; }
    if (id && !CBA.rows.find(x => String(x.id) === String(id))) { toast('No se encontró el trámite', 'warn'); return; }
    cerrar();
    CBA.modo = 'form'; CBA.formId = id || null;
    CBA.render();
    try { document.getElementById('v-cordoba').scrollIntoView({ block: 'start' }); } catch (e) {}
    setTimeout(() => { const i = document.getElementById('cba-dominio'); if (i && !id) i.focus(); }, 30);
  };
  CBA.volver = function () { cerrar(); CBA.modo = 'lista'; CBA.formId = null; CBA.render(); };

  function vistaForm() {
    const id = CBA.formId;
    const r = id ? CBA.rows.find(x => String(x.id) === String(id)) : null;
    const d = r || { ingreso_oficina: hoy() };
    const fe = (k, t) => `<label>${t}<input type="date" id="cba-${k}" value="${d[k] ? String(d[k]).slice(0, 10) : ''}" max="${hoy()}"></label>`;
    const tx = (k, t, extra) => `<label>${t}<input type="text" id="cba-${k}" value="${esc(d[k] || '')}" ${extra || ''}></label>`;
    const html = `
      <div class="sec">Datos del ingreso</div>
      <div class="g">
        ${fe('ingreso_oficina', 'Ingreso oficina *')}
        ${tx('dominio', 'Dominio *', 'style="text-transform:uppercase" autocomplete="off"')}
        ${tx('agencia', 'Agencia')}
        ${tx('comprador', 'Comprador')}
        ${tx('dni', 'DNI / CUIT', 'inputmode="numeric"')}
        ${tx('vehiculo', 'Vehículo')}
        <label>EF entregado<span class="row2"><input type="text" inputmode="decimal" id="cba-ef_monto" placeholder="$ 0" value="${!d.ef_no && num(d.ef_monto) !== null ? Math.round(num(d.ef_monto)).toLocaleString('es-AR') : ''}"${d.ef_no ? ' disabled' : ''}>
          <label class="chk"><input type="checkbox" id="cba-ef_no"${d.ef_no ? ' checked' : ''} onchange="var m=document.getElementById('cba-ef_monto');m.disabled=this.checked;if(this.checked)m.value=''"> NO</label></span></label>
        <label>Trámite${lista('tramite', d.tramite)}</label>
        <label>Registro${lista('registro', d.registro)}</label>
      </div>
      <div class="sec">Seguimiento</div>
      <div class="g">
        <label>Escribanía<span class="row2"><input type="date" id="cba-escribania" value="${d.escribania ? String(d.escribania).slice(0, 10) : ''}" max="${hoy()}">
          <input type="text" id="cba-escribania_txt" list="cba-esc-ops" placeholder="o texto" value="${esc(d.escribania_txt || '')}"></span>
          <datalist id="cba-esc-ops"><option value="NO"><option value="CERT"><option value="REGISTRO"><option value="SI"></datalist></label>
        ${fe('control', 'Control')}
        ${fe('entrega', 'Entrega')}
        ${tx('a_quien', 'A quién')}
        ${fe('ingreso_registro', 'Fecha ingreso registro')}
        ${fe('retiro_prenda', 'Retiro prenda')}
        ${fe('retiro_doc', 'Retiro doc')}
        ${fe('entrega_prenda_agencia', 'Entrega de prenda agencia')}
        ${fe('entrega_doc_cliente', 'Entrega doc a cliente')}
      </div>
      <div class="sec">Observaciones</div>
      <textarea id="cba-obs" rows="3" style="width:100%;box-sizing:border-box">${esc(d.obs || '')}</textarea>`;
    const meta = r ? `<span class="meta">Cargó ${esc(r.creado_por || '—')} el ${fD(String(r.created_at).slice(0, 10))}${r.actualizado_por ? ` · última edición: ${esc(r.actualizado_por)} ${fD(String(r.updated_at).slice(0, 10))}` : ''}</span>` : '<span class="meta">* obligatorio</span>';
    const titulo = r ? `✏️ ${esc(r.dominio)} · ${esc(r.tramite || 'Trámite')}` : '➕ Nuevo ingreso';
    return `<div class="ph">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn btn-s" onclick="CBA.volver()" style="padding:6px 12px">← Volver</button>
          <div><div class="ph-t">${titulo}</div><div class="ph-s">📍 Córdoba · ${r ? 'completá o corregí los datos del trámite' : 'cargá los datos del nuevo trámite'}</div></div>
        </div>
      </div>
      <div class="cba-form cba-f">${html}
        <div class="err" id="cba-err"></div>
        <div class="ft">${meta}${r && puedeBorrar() ? `<button class="btn2 del" onclick="CBA.borrar(${r.id})">🗑 Borrar</button>` : ''}<button class="btn2" onclick="CBA.volver()">Cancelar</button><button class="btn2 pri" onclick="CBA.guardar(${r ? r.id : 'null'})">Guardar</button></div>
      </div>`;
  }

  // valor de un desplegable (crea el ítem en cba_listas si es nuevo)
  async function valorLista(tipo) {
    const s = v('cba-' + tipo);
    if (s !== '__nuevo') return s || null;
    const nuevo = String(v('cba-' + tipo + '-nv') || '').trim().replace(/\s+/g, ' ');
    if (nuevo.length < 2) throw new Error('Escribí el nuevo ' + (tipo === 'tramite' ? 'trámite' : 'registro'));
    const ex = CBA.listas.find(x => x.tipo === tipo && x.valor.trim().toLowerCase() === nuevo.toLowerCase());
    if (ex) {
      if (!ex.activo) { await SB.from('cba_listas').update({ activo: true }).eq('id', ex.id); ex.activo = true; }
      return ex.valor;
    }
    const orden = CBA.listas.filter(x => x.tipo === tipo).reduce((m, x) => Math.max(m, x.orden || 0), 0) + 1;
    const res = await SB.from('cba_listas').insert({ tipo, valor: nuevo, orden, creado_por: quien() }).select().single();
    if (res.error) throw res.error;
    CBA.listas.push(res.data);
    return res.data.valor;
  }

  CBA.guardar = async function (id) {
    const t = k => { const x = String(v('cba-' + k) || '').trim().replace(/\s+/g, ' '); return x || null; };
    const fe = k => v('cba-' + k) || null;
    const row = {
      ingreso_oficina: fe('ingreso_oficina'), dominio: (t('dominio') || '').toUpperCase().replace(/\s/g, '') || null,
      agencia: t('agencia'), comprador: t('comprador'), dni: (t('dni') || '').replace(/[.\-\s]/g, '') || null, vehiculo: t('vehiculo'),
      ef_no: !!v('cba-ef_no'), ef_monto: null,
      escribania: fe('escribania'), escribania_txt: t('escribania_txt'), control: fe('control'), entrega: fe('entrega'), a_quien: t('a_quien'),
      ingreso_registro: fe('ingreso_registro'), retiro_prenda: fe('retiro_prenda'), retiro_doc: fe('retiro_doc'),
      entrega_prenda_agencia: fe('entrega_prenda_agencia'), entrega_doc_cliente: fe('entrega_doc_cliente'),
      obs: String(v('cba-obs') || '').trim() || null
    };
    if (!row.ingreso_oficina) return err('Poné la fecha de ingreso a la oficina');
    if (!row.dominio) return err('Poné el dominio');
    if (!row.ef_no) {
      const txt = String(v('cba-ef_monto') || '').trim();
      if (txt) { row.ef_monto = numIn(txt); if (row.ef_monto === null || row.ef_monto < 0) return err('El monto de EF entregado no es válido'); }
    }
    const fechas = COLS.filter(c => c[2] === 'fecha').map(c => c[0]).concat(['escribania']);
    const fut = fechas.find(k => row[k] && row[k] > hoy());
    if (fut) return err('La fecha de "' + NOMBRE[fut] + '" no puede ser futura');
    bloquear(true); err('');
    try {
      row.tramite = await valorLista('tramite');
      row.registro = await valorLista('registro');
      if (id) {
        const ant = CBA.rows.find(x => String(x.id) === String(id)) || {};
        const norm = (k, x) => x === null || x === undefined || x === '' ? '' : (k === 'ef_monto' ? String(num(x)) : String(x).slice(0, k === 'obs' ? 99999 : 500));
        const cambios = Object.keys(row).filter(k => norm(k, ant[k]) !== norm(k, row[k]) && !(k === 'ef_no' && !!ant[k] === row[k]))
          .map(k => ({ campo: NOMBRE[k] || k, ant: ant[k] ?? null, nuevo: row[k] }));
        if (!cambios.length) { CBA.volver(); return; }
        const res = await SB.from('cba_tramites').update({ ...row, actualizado_por: quien(), updated_at: new Date().toISOString() }).eq('id', id).select();
        if (res.error) throw res.error;
        if (!(res.data || []).length) throw new Error('el trámite ya no existe (puede que lo hayan borrado)');
        if (typeof registrarHistorial === 'function') registrarHistorial('cba_tramites', id, cambios);
        toast('Trámite actualizado ✓', 'ok');
      } else {
        const res = await SB.from('cba_tramites').insert({ ...row, creado_por: quien() }).select().single();
        if (res.error) throw res.error;
        if (typeof registrarHistorial === 'function') registrarHistorial('cba_tramites', res.data.id, [{ campo: 'alta', ant: null, nuevo: row.dominio + ' · ' + (row.tramite || '') }]);
        toast('Ingreso cargado ✓', 'ok');
      }
      CBA.modo = 'lista'; CBA.formId = null;
      await CBA.cargar(true);
    } catch (e) { bloquear(false); err('Error: ' + (e.message || e)); }
  };

  CBA.borrar = function (id) {
    if (!puedeBorrar()) return;
    const r = CBA.rows.find(x => String(x.id) === String(id)); if (!r) return;
    modal('🗑 Borrar trámite', `<div>Vas a borrar el trámite <b>${esc(r.dominio)}</b> · ${esc(r.tramite || '—')} · ${esc(r.comprador || '')} (ingreso ${fD(r.ingreso_oficina)}).<br><br>No se puede deshacer.</div>`,
      `<span class="meta"></span><button class="btn2" onclick="CBA.cerrar()">Volver</button><button class="btn2 pri" style="background:#b91c1c;border-color:#b91c1c" onclick="CBA.confirmarBorrar(${r.id})">Borrar</button>`);
  };
  CBA.confirmarBorrar = async function (id) {
    if (!puedeBorrar()) return;
    const r = CBA.rows.find(x => String(x.id) === String(id)); if (!r) return;
    bloquear(true); err('');
    const res = await SB.from('cba_tramites').delete().eq('id', id);
    if (res.error) { bloquear(false); return err('Error: ' + res.error.message); }
    if (typeof registrarHistorial === 'function') registrarHistorial('cba_tramites', id, [{ campo: 'borrado', ant: JSON.stringify(r), nuevo: null }]);
    cerrar(); toast('Trámite borrado', 'ok');
    CBA.modo = 'lista'; CBA.formId = null;
    await CBA.cargar(true);
  };

  CBA.init = function () {
    if (!puede()) { toast('No tenés permisos para acceder a esta sección', 'warn'); return; }
    cerrar(); CBA.modo = 'lista'; CBA.formId = null;
    CBA.render();
    CBA.cargar(CBA.cargado && CBA.ok);
  };
})();
