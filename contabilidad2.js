// ══════════════════════════════════════════════════════════════
// CONTABILIDAD 2 — Etapa 1 (v3.9.36)
// Solo LECTURA: no escribe nada en Supabase.
//  - Liquidación por operación (lista + detalle)
//  - Parámetros (porcentajes actuales; se editan en Contabilidad → Cambio de coeficientes)
//  - Controles (diferencias entre lo guardado en Contabilidad y lo calculado)
// Usa globales de index.html: SB, ME, RECORDS, getBancos, bancoDisplay, colorBanco, toast, _sbAll, editRec
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const C2 = window.C2 = {
    seccion: 'liquidacion',
    opId: null,
    cont: {},            // solicitud_id -> fila de tabla contabilidad
    coef: { impCredito: 1.2, comLukaya: 3.2, comGestor: 0.5, retribBanco: 4.0 },
    coefBanco: [],       // [{banco, com_lukaya}]
    cargado: false,
    cargando: false,
    filtro: { alcance: 'liquidadas', desde: '', hasta: '', q: '' }
  };

  // ── utilidades ──
  const num = v => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).replace(/[$\s]/g, '');
    // "1.234.567,89" (AR) o "1234567.89"
    const n = /,\d{1,2}$/.test(s) ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s.replace(/,/g, ''));
    return isFinite(n) ? n : null;
  };
  const r0 = v => Math.round(v || 0);
  const $ = v => (v < 0 ? '−$' : '$') + Math.abs(r0(v)).toLocaleString('es-AR');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fD = v => { if (!v) return '—'; const p = String(v).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : v; };
  const pct = v => String(v).replace('.', ',') + ' %';
  const dias = f => { if (!f) return null; const d = new Date(String(f).slice(0, 10) + 'T00:00:00'); if (isNaN(d)) return null; const h = new Date(); h.setHours(0, 0, 0, 0); return Math.floor((h - d) / 86400000); };

  C2.puede = () => (typeof _bloqContab !== 'function' || !_bloqContab()) && (typeof canEdit !== 'function' || canEdit()) &&
    (ME?.rol === 'admin' || ['claudionieva', 'golcese', 'tolcese', 'Invitado'].includes(ME?.usr));

  // ── carga de datos (solo lectura) ──
  C2.cargar = async function (forzar) {
    if (C2.cargando) return;
    if (C2.cargado && !forzar) return;
    C2.cargando = true;
    C2.render();
    try {
      const [rc, rk, rb] = await Promise.all([
        _sbAll(() => SB.from('contabilidad').select('*').order('solicitud_id')),
        SB.from('coeficientes').select('*').eq('id', 1).single(),
        SB.from('coeficientes_banco').select('*').order('banco')
      ]);
      if (rc.error) throw rc.error;
      C2.cont = {};
      (rc.data || []).forEach(c => { C2.cont[c.solicitud_id] = c; });
      const k = rk && rk.data;
      if (k) C2.coef = { impCredito: num(k.imp_credito) ?? 1.2, comLukaya: num(k.com_lukaya) ?? 3.2, comGestor: num(k.com_gestor) ?? 0.5, retribBanco: num(k.retrib_banco) ?? 4.0 };
      C2.coefBanco = (rb && rb.data) || [];
      C2.cargado = true;
    } catch (e) {
      console.error('Contabilidad 2:', e);
      toast('Contabilidad 2: error al cargar datos (' + (e.message || e) + ')', 'er');
    }
    C2.cargando = false;
    C2.render();
  };

  // ── modelo de una operación ──
  function bancoOperacion(r) {
    const bs = (typeof getBancos === 'function' ? getBancos(r) : []) || [];
    const av = bs.find(b => String(b.estado || '').toUpperCase() === 'AVANZA');
    return String((av && av.banco) || r.banco || '').toUpperCase().trim();
  }
  function pctBruta(banco) {
    const e = C2.coefBanco.find(c => String(c.banco || '').toUpperCase().trim() === banco);
    return e ? (num(e.com_lukaya) ?? C2.coef.comLukaya) : C2.coef.comLukaya;
  }
  function fechasCredito(r) {
    try { return r.creditoEstadoFechas ? JSON.parse(r.creditoEstadoFechas) || {} : {}; } catch (e) { return {}; }
  }
  function fechaLiquidado(r) {
    const m = fechasCredito(r);
    if (m.Liquidado) return m.Liquidado;
    if (r.creditoEstado === 'Liquidado' && r.creditoEstadoFecha) return r.creditoEstadoFecha;
    return '';
  }
  // v3.9.34: si está Pagado sin fecha de Liquidado, se usa la de Pagado como estimada (se paga después de liquidar)
  function fechaPagadoCredito(r) {
    const m = fechasCredito(r);
    if (m.Pagado) return m.Pagado;
    if (r.creditoEstado === 'Pagado' && r.creditoEstadoFecha) return r.creditoEstadoFecha;
    return '';
  }

  // Devuelve el cálculo completo. "usado" = valor guardado si existe (ajuste manual), si no el calculado.
  C2.calc = function (r) {
    const c = C2.cont[r.id] || null;
    const I = num(r.importe) || 0;
    const banco = bancoOperacion(r);
    const p = { bruta: pctBruta(banco), imp: C2.coef.impCredito, retrib: C2.coef.retribBanco, gest: C2.coef.comGestor };
    const calc = {
      imp: r0(I * p.imp / 100),
      bruta: r0(I * p.bruta / 100),
      retrib: r0(I * p.retrib / 100),
      gest: r0(I * p.gest / 100)
    };
    calc.comLuk = calc.bruta - calc.imp;
    const g = (campo) => c ? num(c[campo]) : null;
    const item = (calculado, guardado) => {
      const aj = guardado !== null && Math.abs(guardado - calculado) > 1;
      return { calc: calculado, guardado, valor: guardado !== null ? guardado : calculado, ajuste: aj };
    };
    const it = {
      imp: item(calc.imp, g('imp_credito')),
      comLuk: item(calc.comLuk, g('com_lukaya')),
      retrib: item(calc.retrib, g('retrib_banco')),
      gest: item(calc.gest, g('com_gestora'))
    };
    const gestoria = g('gastos_gestoria') || 0;
    const comCom = (g('com_comercial') || 0) + (g('com_operativo') || 0);
    const extras = g('pagos_extras') || 0;
    const bruta = it.comLuk.valor + it.imp.valor; // comisión bruta efectiva
    const aLiquidar = I - bruta - gestoria;
    const ganancia = it.comLuk.valor + it.retrib.valor - it.gest.valor - comCom - extras;
    const retribCobrada = !!(c && c.fecha_pago_banco);
    const gananciaCobrada = ganancia - (retribCobrada ? 0 : it.retrib.valor);
    let fLiq = fechaLiquidado(r) || (c && c.fecha_liq) || '';
    let fLiqEstimada = false;
    if (!fLiq && r.creditoEstado === 'Pagado') { fLiq = fechaPagadoCredito(r); fLiqEstimada = !!fLiq; }
    return {
      r, c, I, banco, p, it, gestoria, comCom, extras, bruta, aLiquidar, ganancia, gananciaCobrada,
      fechaLiq: fLiq, fLiqEstimada,
      agenciaPagada: !!(c && c.pagado), fechaAgencia: c && c.fecha_pagado,
      gestorPagado: !!(c && c.pago_gest), fechaGestor: c && c.fecha_pago_gest,
      retribCobrada, fechaRetrib: c && c.fecha_pago_banco,
      aLiqGuardado: g('a_liquidar'), ganGuardada: g('ganancia')
    };
  };

  function estadoOp(x) {
    if (x.agenciaPagada && x.gestorPagado && x.retribCobrada) return ['Cerrada', 'gr'];
    if (!x.agenciaPagada) return ['Falta pagar agencia', 'am'];
    if (!x.retribCobrada) return ['Esperando retribución', 'am'];
    return ['Falta pagar gestor', 'am'];
  }

  // ── selección de operaciones ──
  C2.operaciones = function () {
    const f = C2.filtro;
    let data = (RECORDS || []).filter(r => {
      if (f.alcance === 'avanza') return String(r.estado || '').toUpperCase() === 'AVANZA' && !['Cancelado', 'Reversado'].includes(r.creditoEstado);
      return r.creditoEstado === 'Liquidado' || r.creditoEstado === 'Pagado';
    }).map(C2.calc);
    if (f.desde) data = data.filter(x => x.fechaLiq && x.fechaLiq.slice(0, 10) >= f.desde);
    if (f.hasta) data = data.filter(x => x.fechaLiq && x.fechaLiq.slice(0, 10) <= f.hasta);
    if (f.q) {
      const q = f.q.toLowerCase();
      data = data.filter(x => [x.r.nombrecliente, x.banco, x.r.dni, x.r.concesionaria, x.r.gestorAsignado, x.r.dominio].some(v => String(v || '').toLowerCase().includes(q)));
    }
    data.sort((a, b) => String(b.fechaLiq || b.r.fecha || '').localeCompare(String(a.fechaLiq || a.r.fecha || '')));
    return data;
  };

  // ── estilos ──
  function css() {
    if (document.getElementById('c2-css')) return;
    const s = document.createElement('style');
    s.id = 'c2-css';
    s.textContent = `
#v-contabilidad2 .c2{display:grid;grid-template-columns:220px 1fr;gap:22px;align-items:start}
#v-contabilidad2 .c2>div,#v-contabilidad2 .c2-grid2>div,#v-contabilidad2 .c2-kpis>div{min-width:0}
#v-contabilidad2 .c2-nav{background:#fff;border:1.5px solid var(--line);border-radius:14px;padding:14px 10px;position:sticky;top:10px}
#v-contabilidad2 .c2-brand{display:flex;gap:10px;align-items:center;padding:4px 8px 14px}
#v-contabilidad2 .c2-logo{width:34px;height:34px;border-radius:9px;background:#111;color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:14px}
#v-contabilidad2 .c2-nav button{display:block;width:100%;text-align:left;border:none;background:none;padding:9px 12px;border-radius:9px;font-size:13.5px;color:var(--ink);cursor:pointer;margin-bottom:2px}
#v-contabilidad2 .c2-nav button:hover{background:var(--surface,#f4f4f2)}
#v-contabilidad2 .c2-nav button.on{background:#fff1e8;color:#c2410c;font-weight:700}
#v-contabilidad2 .c2-nav button[disabled]{color:#a8a29e;cursor:default;background:none}
#v-contabilidad2 .c2-nav button small{font-size:10px;margin-left:4px}
#v-contabilidad2 .c2-kick{font-size:12px;color:var(--muted);font-weight:600}
#v-contabilidad2 .c2-h1{font-size:24px;font-weight:900;color:var(--ink);margin:2px 0 4px}
#v-contabilidad2 .c2-sub{font-size:13px;color:var(--muted)}
#v-contabilidad2 .c2-card{background:#fff;border:1.5px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px}
#v-contabilidad2 .c2-card h3{font-size:16px;font-weight:800;margin:0 0 2px}
#v-contabilidad2 .c2-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0}
#v-contabilidad2 .c2-kpi{background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px}
#v-contabilidad2 .c2-kpi .l{font-size:11.5px;color:var(--muted);font-weight:600}
#v-contabilidad2 .c2-kpi .v{font-size:19px;font-weight:900;margin-top:2px}
#v-contabilidad2 table.c2-t{width:100%;border-collapse:collapse;font-size:13px;min-width:0}
#v-contabilidad2 table.c2-t.ancha{min-width:900px}
#v-contabilidad2 table.c2-t th:first-child,#v-contabilidad2 table.c2-t td:first-child{position:static;transform:none;will-change:auto;background:transparent}
#v-contabilidad2 table.c2-t thead tr{background:transparent}
#v-contabilidad2 table.c2-t tbody tr:hover td{background:transparent}
#v-contabilidad2 table.c2-t th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:9px 10px;border-bottom:1.5px solid var(--line);white-space:nowrap}
#v-contabilidad2 table.c2-t td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
#v-contabilidad2 table.c2-t td.n,#v-contabilidad2 table.c2-t th.n{text-align:right;white-space:nowrap}
#v-contabilidad2 table.c2-t tr.click{cursor:pointer}
#v-contabilidad2 table.c2-t tr.click:hover td{background:#fafaf9 !important}
#v-contabilidad2 table.c2-t tr.tot td,#v-contabilidad2 table.c2-t tr.tot td:first-child{background:#fff7f1;font-weight:800}
#v-contabilidad2 .c2-f{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#57534e}
#v-contabilidad2 .neg{color:#b91c1c}
#v-contabilidad2 .pos{color:#15803d}
#v-contabilidad2 .c2-b{display:inline-block;padding:3px 9px;border-radius:7px;font-size:11.5px;font-weight:700;white-space:nowrap}
#v-contabilidad2 .c2-b.am{background:#fef3c7;color:#92400e}
#v-contabilidad2 .c2-b.gr{background:#dcfce7;color:#166534}
#v-contabilidad2 .c2-b.re{background:#fee2e2;color:#991b1b}
#v-contabilidad2 .c2-b.bl{background:#dbeafe;color:#1e40af}
#v-contabilidad2 .c2-b.gy{background:#f1f5f9;color:#475569}
#v-contabilidad2 .c2-aj{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:5px;background:#fef3c7;color:#92400e;font-size:10px;font-weight:800;vertical-align:middle}
#v-contabilidad2 .c2-fil{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0}
#v-contabilidad2 .c2-fil input,#v-contabilidad2 .c2-fil select{border:1.5px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;background:#fff}
#v-contabilidad2 .c2-btn{border:1.5px solid var(--line);background:#fff;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
#v-contabilidad2 .c2-btn.pri{background:#c2410c;border-color:#c2410c;color:#fff}
#v-contabilidad2 .c2-btn[disabled]{opacity:.45;cursor:not-allowed}
#v-contabilidad2 .c2-grid2{display:grid;grid-template-columns:1fr 360px;gap:16px;align-items:start}
#v-contabilidad2 .c2-tl{list-style:none;margin:12px 0 0;padding:0}
#v-contabilidad2 .c2-tl li{display:flex;gap:12px;margin-bottom:16px}
#v-contabilidad2 .c2-dot{width:13px;height:13px;border-radius:50%;margin-top:4px;flex:none}
#v-contabilidad2 .c2-note{background:#f5f5f4;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#44403c}
#v-contabilidad2 .c2-empty{text-align:center;color:var(--muted);padding:40px 10px}
@media (max-width:1100px){#v-contabilidad2 .c2{grid-template-columns:1fr}#v-contabilidad2 .c2-nav{position:static}#v-contabilidad2 .c2-grid2{grid-template-columns:1fr}#v-contabilidad2 .c2-kpis{grid-template-columns:repeat(2,1fr)}}
`;
    document.head.appendChild(s);
  }

  // ── navegación ──
  const SECCIONES = [
    ['resumen', 'Resumen del mes', 5],
    ['liquidacion', 'Liquidación por operación', 1],
    ['cobrarpagar', 'Cobrar y pagar', 3],
    ['caja', 'Caja y bancos', 2],
    ['gastos', 'Gastos', 4],
    ['tramites', 'Trámites', 4],
    ['cierres', 'Cierres de mes', 5],
    ['parametros', 'Parámetros', 1],
    ['controles', 'Controles', 1]
  ];
  C2.ir = function (sec, opId) {
    C2.seccion = sec;
    C2.opId = opId || null;
    C2.render();
    try { document.getElementById('v-contabilidad2').scrollIntoView({ block: 'start' }); } catch (e) {}
  };

  C2.render = function () {
    const root = document.getElementById('v-contabilidad2');
    if (!root) return;
    css();
    const nav = SECCIONES.map(([k, t, etapa]) => etapa === 1
      ? `<button class="${C2.seccion === k ? 'on' : ''}" onclick="C2.ir('${k}')">${t}</button>`
      : `<button disabled title="Próxima etapa">${t}<small>(etapa ${etapa})</small></button>`).join('');
    let body;
    if (!C2.cargado) body = `<div class="c2-card c2-empty">${C2.cargando ? '⏳ Cargando datos contables…' : 'Sin datos.'}</div>`;
    else if (C2.seccion === 'liquidacion' && C2.opId) body = vistaOperacion(C2.opId);
    else if (C2.seccion === 'liquidacion') body = vistaLista();
    else if (C2.seccion === 'parametros') body = vistaParametros();
    else if (C2.seccion === 'controles') body = vistaControles();
    else body = '<div class="c2-card c2-empty">Próxima etapa</div>';
    root.innerHTML = `<div class="c2">
      <div class="c2-nav">
        <div class="c2-brand"><div class="c2-logo">L!</div><div><div style="font-weight:900;font-size:14px">LUKAYA!</div><div style="font-size:11.5px;color:var(--muted)">Contabilidad 2</div></div></div>
        ${nav}
        <div style="border-top:1px solid var(--line);margin:10px 4px 0;padding-top:10px"><button onclick="C2.cargar(true)">🔄 Actualizar datos</button></div>
      </div>
      <div>${body}</div>
    </div>`;
  };

  // ── LISTA ──
  function vistaLista() {
    const f = C2.filtro;
    const ops = C2.operaciones();
    const sum = k => ops.reduce((s, x) => s + (x[k] || 0), 0);
    const filas = ops.map(x => {
      const [et, col] = estadoOp(x);
      const aj = Object.values(x.it).some(i => i.ajuste);
      return `<tr class="click" onclick="C2.ir('liquidacion','${esc(x.r.id)}')">
        <td style="white-space:nowrap">${fD(x.fechaLiq)}${x.fLiqEstimada ? ' <span class="c2-aj" title="No tiene fecha de Liquidado: se usa la de Pagado">estimada</span>' : ''}</td>
        <td style="font-weight:700">${esc(x.r.nombrecliente || '—')}</td>
        <td>${colorBanco(x.banco)}</td>
        <td>${esc(x.r.concesionaria || '—')}</td>
        <td>${esc(x.r.gestorAsignado || '—')}</td>
        <td class="n">${$(x.I)}</td>
        <td class="n">${$(x.aLiquidar)}</td>
        <td class="n" style="font-weight:700">${$(x.ganancia)}${aj ? '<span class="c2-aj">ajuste</span>' : ''}</td>
        <td><span class="c2-b ${col}">${et}</span></td>
      </tr>`;
    }).join('');
    return `
      <div class="c2-kick">Contabilidad 2 · etapa 1 (solo lectura)</div>
      <div class="c2-h1">Liquidación por operación</div>
      <div class="c2-sub">${f.alcance === 'avanza' ? 'Todas las solicitudes en AVANZA' : 'Créditos en estado Liquidado o Pagado (Prendas → Crédito)'} · Fechas = fecha de Liquidado</div>
      <div class="c2-kpis">
        <div class="c2-kpi"><div class="l">Operaciones</div><div class="v">${ops.length}</div></div>
        <div class="c2-kpi"><div class="l">Volumen</div><div class="v">${$(sum('I'))}</div></div>
        <div class="c2-kpi"><div class="l">A liquidar agencias</div><div class="v">${$(sum('aLiquidar'))}</div></div>
        <div class="c2-kpi"><div class="l">Ganancia devengada</div><div class="v pos">${$(sum('ganancia'))}</div></div>
        <div class="c2-kpi"><div class="l">Ganancia cobrada</div><div class="v">${$(sum('gananciaCobrada'))}</div></div>
      </div>
      <div class="c2-card">
        <div class="c2-fil" style="margin-top:0">
          <select onchange="C2.filtro.alcance=this.value;C2.render()">
            <option value="liquidadas"${f.alcance === 'liquidadas' ? ' selected' : ''}>Liquidadas (Liquidado / Pagado)</option>
            <option value="avanza"${f.alcance === 'avanza' ? ' selected' : ''}>Todas en AVANZA</option>
          </select>
          <span class="c2-kick">Liquidado desde</span><input type="date" value="${f.desde}" onchange="C2.filtro.desde=this.value;C2.render()">
          <span class="c2-kick">hasta</span><input type="date" value="${f.hasta}" onchange="C2.filtro.hasta=this.value;C2.render()">
          <input id="c2-q" placeholder="🔍 Cliente, banco, DNI, agencia, gestor…" value="${esc(f.q)}" oninput="C2.filtro.q=this.value;clearTimeout(C2._t);C2._t=setTimeout(()=>{C2.render();const i=document.getElementById('c2-q');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},250)" style="min-width:240px">
          <button class="c2-btn" onclick="C2.filtro={alcance:C2.filtro.alcance,desde:'',hasta:'',q:''};C2.render()">✕ Limpiar</button>
        </div>
        <div style="overflow-x:auto">
        ${ops.length ? `<table class="c2-t ancha"><thead><tr><th>Liquidado</th><th>Cliente</th><th>Banco</th><th>Agencia</th><th>Gestor</th><th class="n">Importe</th><th class="n">A liquidar agencia</th><th class="n">Ganancia</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table>`
        : `<div class="c2-empty">No hay operaciones con estos filtros.${f.alcance === 'liquidadas' ? '<br><small>Las operaciones entran cuando el crédito pasa a <b>Liquidado</b> en Prendas → Editar → Crédito.</small>' : ''}</div>`}
        </div>
      </div>`;
  }

  // ── DETALLE DE UNA OPERACIÓN ──
  function vistaOperacion(id) {
    const r = (RECORDS || []).find(x => String(x.id) === String(id));
    if (!r) return `<div class="c2-card c2-empty">No se encontró la operación. <button class="c2-btn" onclick="C2.ir('liquidacion')">← Volver</button></div>`;
    const x = C2.calc(r);
    const [et, col] = estadoOp(x);
    const aj = i => i.ajuste ? `<span class="c2-aj" title="Calculado: ${$(i.calc)}">ajuste</span>` : '';
    const ajF = i => i.ajuste ? `<div class="c2-f" style="font-size:11px">calculado ${$(i.calc)}</div>` : '';
    const ganAj = x.ganGuardada !== null && Math.abs(x.ganGuardada - x.ganancia) > 1;
    const dRet = dias(x.fechaLiq);
    const paso = (ok, titulo, sub, pend) => `<li><span class="c2-dot" style="background:${ok ? '#15803d' : pend ? '#c2410c' : '#a8a29e'}"></span><div><div style="font-weight:700">${titulo}</div><div style="font-size:12.5px;color:var(--muted)">${sub}</div></div></li>`;
    const sinCont = !x.c;
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div class="c2-kick"><a href="#" onclick="C2.ir('liquidacion');return false" style="color:inherit">← Liquidación por operación</a></div>
          <div class="c2-h1">${esc(r.nombrecliente || '—')} · ${esc(bancoDisplay(x.banco))}</div>
          <div class="c2-sub">Solicitud del ${fD(r.fecha)} · ${esc(r.concesionaria || '—')} · Gestor: ${esc(r.gestorAsignado || '—')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <span class="c2-b ${col}">Estado: ${et}</span>
            <span class="c2-b ${x.agenciaPagada ? 'gr' : 'am'}">${x.agenciaPagada ? 'Agencia pagada' : 'Agencia pendiente'}</span>
            <span class="c2-b ${x.gestorPagado ? 'gr' : 'am'}">${x.gestorPagado ? 'Gestor pagado' : 'Gestor pendiente'}</span>
            <span class="c2-b gy">Crédito: ${esc(r.creditoEstado || '—')}</span>
          </div>
        </div>
        <div style="display:flex;gap:10px">
          ${typeof editRec === 'function' && (typeof canEdit !== 'function' || canEdit()) ? `<button class="c2-btn" onclick="C2.verSolicitud('${esc(r.id)}')">Ver solicitud</button>` : ''}
          <button class="c2-btn pri" disabled title="Etapa 2">Registrar cobro de retribución</button>
        </div>
      </div>
      ${sinCont ? `<div class="c2-note" style="margin-top:14px;background:#fef3c7">Esta operación todavía no tiene fila en Contabilidad: todo lo que ves es calculado con los porcentajes de Parámetros.</div>` : ''}
      <div class="c2-grid2" style="margin-top:16px">
        <div>
          <div class="c2-card">
            <h3>1 · Cuánto se le transfiere a la agencia</h3>
            <div class="c2-sub">Se calcula solo. Si un valor se corrigió a mano en Contabilidad queda marcado como <span class="c2-aj" style="margin:0">ajuste</span></div>
            <table class="c2-t" style="margin-top:10px"><thead><tr><th>Concepto</th><th>Fórmula</th><th class="n">Monto</th></tr></thead><tbody>
              <tr><td>Importe del crédito (I)</td><td class="c2-f">dato de la solicitud</td><td class="n">${$(x.I)}</td></tr>
              <tr><td>Comisión bruta</td><td class="c2-f">I × ${pct(x.p.bruta)} (${esc(bancoDisplay(x.banco))})</td><td class="n">${$(x.bruta)}</td></tr>
              <tr><td>Impuesto al crédito ${aj(x.it.imp)}</td><td class="c2-f">I × ${pct(x.p.imp)}</td><td class="n neg">${$(-x.it.imp.valor)}${ajF(x.it.imp)}</td></tr>
              <tr><td>Comisión LUKAYA ${aj(x.it.comLuk)}</td><td class="c2-f">bruta − imp. crédito</td><td class="n">${$(x.it.comLuk.valor)}${ajF(x.it.comLuk)}</td></tr>
              <tr><td>Gastos de gestoría</td><td class="c2-f">dato cargado</td><td class="n">${$(x.gestoria)}</td></tr>
              <tr class="tot"><td>A liquidar a la agencia</td><td class="c2-f">I − bruta − gestoría</td><td class="n">${$(x.aLiquidar)}</td></tr>
            </tbody></table>
          </div>
          <div class="c2-card">
            <h3>2 · Cuánto gana LUKAYA en esta operación</h3>
            <div class="c2-sub">La ganancia nunca se escribe a mano: siempre sale de esta suma</div>
            <table class="c2-t" style="margin-top:10px"><thead><tr><th>Concepto</th><th>Fórmula</th><th class="n">Monto</th></tr></thead><tbody>
              <tr><td>Comisión LUKAYA</td><td></td><td class="n">${$(x.it.comLuk.valor)}</td></tr>
              <tr><td>Retribución banco ${aj(x.it.retrib)}</td><td class="c2-f">I × ${pct(x.p.retrib)}</td><td class="n pos">+${$(x.it.retrib.valor)}${ajF(x.it.retrib)}</td></tr>
              <tr><td>Comisión gestor ${aj(x.it.gest)}</td><td class="c2-f">I × ${pct(x.p.gest)}</td><td class="n neg">${$(-x.it.gest.valor)}${ajF(x.it.gest)}</td></tr>
              <tr><td>Comisión comercial / operativa</td><td class="c2-f">dato cargado</td><td class="n ${x.comCom ? 'neg' : ''}">${$(-x.comCom)}</td></tr>
              <tr><td>Pagos extras</td><td class="c2-f">dato cargado</td><td class="n ${x.extras ? 'neg' : ''}">${$(-x.extras)}</td></tr>
              <tr class="tot"><td>Ganancia devengada</td><td class="c2-f">suma de arriba</td><td class="n">${$(x.ganancia)}</td></tr>
              <tr><td>Ganancia cobrada</td><td class="c2-f">${x.retribCobrada ? 'retribución ya cobrada' : 'sin retribución hasta que pague el banco'}</td><td class="n">${$(x.gananciaCobrada)}</td></tr>
            </tbody></table>
            ${ganAj ? `<div class="c2-note" style="margin-top:10px;background:#fef3c7">En Contabilidad la ganancia guardada es <b>${$(x.ganGuardada)}</b>, distinta de la calculada (${$(x.ganancia)}). Revisalo en Controles.</div>` : ''}
          </div>
        </div>
        <div class="c2-card">
          <h3>Recorrido del dinero</h3>
          <ul class="c2-tl">
            ${paso(!!x.fechaLiq, 'Liquidada por el banco', x.fechaLiq ? fD(x.fechaLiq) + (x.fLiqEstimada ? ' (estimada: fecha de Pagado)' : '') : 'Sin fecha de Liquidado', !x.fechaLiq)}
            ${paso(x.agenciaPagada, 'Agencia pagada · ' + esc(r.concesionaria || '—'), x.agenciaPagada ? fD(x.fechaAgencia) : 'Pendiente · ' + $(x.aLiquidar), !x.agenciaPagada)}
            ${paso(x.retribCobrada, 'Retribución del banco', x.retribCobrada ? 'Cobrada ' + fD(x.fechaRetrib) : 'Pendiente' + (dRet !== null ? ' hace ' + dRet + ' días' : '') + ' · ' + $(x.it.retrib.valor), !x.retribCobrada)}
            ${paso(x.gestorPagado, 'Comisión y gastos al gestor · ' + esc(r.gestorAsignado || '—'), x.gestorPagado ? fD(x.fechaGestor) : 'Pendiente · ' + $(x.it.gest.valor + x.gestoria), !x.gestorPagado)}
            ${paso(x.agenciaPagada && x.retribCobrada && x.gestorPagado, 'Cerrada', 'Cuando todo lo anterior esté hecho', false)}
          </ul>
          <div class="c2-note">Etapa 1: los pagos se ven pero todavía se registran en la Contabilidad actual. En la etapa 2, al tildar un pago acá se va a crear el movimiento en Caja y bancos.</div>
        </div>
      </div>`;
  }

  // ── PARÁMETROS ──
  function vistaParametros() {
    const bancos = [...new Set((RECORDS || []).map(bancoOperacion).filter(Boolean))].sort();
    const filas = bancos.map(b => {
      const e = C2.coefBanco.find(c => String(c.banco || '').toUpperCase().trim() === b);
      return `<tr><td>${colorBanco(b)}</td><td class="n">${pct(pctBruta(b))}</td><td>${e ? '<span class="c2-b bl">propio del banco</span>' : '<span class="c2-b gy">general</span>'}</td></tr>`;
    }).join('');
    return `
      <div class="c2-kick">Contabilidad 2 · etapa 1</div>
      <div class="c2-h1">Parámetros</div>
      <div class="c2-sub">Porcentajes que usa Contabilidad 2. Son los mismos de la Contabilidad actual: se editan en Contabilidad → ⚙️ Cambio de Coeficientes.</div>
      <div class="c2-card" style="margin-top:16px">
        <h3>Generales</h3>
        <table class="c2-t" style="margin-top:8px"><tbody>
          <tr><td>Comisión bruta (si el banco no tiene uno propio)</td><td class="n">${pct(C2.coef.comLukaya)}</td></tr>
          <tr><td>Impuesto al crédito</td><td class="n">${pct(C2.coef.impCredito)}</td></tr>
          <tr><td>Retribución banco</td><td class="n">${pct(C2.coef.retribBanco)}</td></tr>
          <tr><td>Comisión gestor</td><td class="n">${pct(C2.coef.comGestor)}</td></tr>
          <tr><td>IIBB (alícuota)</td><td class="n" style="color:var(--muted)">etapa 5</td></tr>
        </tbody></table>
      </div>
      <div class="c2-card">
        <h3>Comisión bruta por banco</h3>
        <table class="c2-t" style="margin-top:8px"><thead><tr><th>Banco</th><th class="n">Comisión bruta</th><th>Origen</th></tr></thead><tbody>${filas || '<tr><td colspan="3" class="c2-empty">Sin bancos</td></tr>'}</tbody></table>
      </div>`;
  }

  // ── CONTROLES ──
  C2.controles = function () {
    const out = [];
    (RECORDS || []).forEach(r => {
      const liq = r.creditoEstado === 'Liquidado' || r.creditoEstado === 'Pagado';
      const av = String(r.estado || '').toUpperCase() === 'AVANZA';
      if (!liq && !av) return;
      const x = C2.calc(r);
      const probs = [];
      if (liq && !x.fechaLiq) probs.push(['re', 'Sin fecha de Liquidado ni de Pagado']);
      if (x.fLiqEstimada) probs.push(['bl', 'Sin fecha de Liquidado: se usa la de Pagado (' + fD(x.fechaLiq) + ')']);
      if (liq && !x.c) probs.push(['am', 'Sin fila en Contabilidad']);
      if (!x.I) probs.push(['re', 'Sin importe']);
      const nombres = { imp: 'Impuesto al crédito', comLuk: 'Comisión LUKAYA', retrib: 'Retribución banco', gest: 'Comisión gestor' };
      Object.keys(x.it).forEach(k => { const i = x.it[k]; if (i.ajuste) probs.push(['am', `${nombres[k]}: guardado ${$(i.guardado)} · calculado ${$(i.calc)}`]); });
      if (x.ganGuardada !== null && Math.abs(x.ganGuardada - x.ganancia) > 1) probs.push(['am', `Ganancia guardada ${$(x.ganGuardada)} ≠ calculada ${$(x.ganancia)}`]);
      if (x.aLiqGuardado !== null && Math.abs(x.aLiqGuardado - x.aLiquidar) > 1) probs.push(['am', `A liquidar guardado ${$(x.aLiqGuardado)} ≠ calculado ${$(x.aLiquidar)}`]);
      const bLegacy = String(r.banco || '').toUpperCase().trim();
      if (bLegacy && bLegacy !== x.banco) probs.push(['bl', `Banco de la solicitud ${bLegacy} ≠ banco en AVANZA ${x.banco}`]);
      if (probs.length) out.push({ x, probs, liq });
    });
    return out;
  };
  function vistaControles() {
    const f = C2.filtro;
    let lista = C2.controles();
    if (f.alcance !== 'avanza') lista = lista.filter(o => o.liq);
    const filas = lista.map(o => `<tr class="click" onclick="C2.ir('liquidacion','${esc(o.x.r.id)}')">
        <td style="font-weight:700;white-space:nowrap">${esc(o.x.r.nombrecliente || '—')}</td>
        <td>${colorBanco(o.x.banco)}</td>
        <td><span class="c2-b gy">${esc(o.x.r.creditoEstado || o.x.r.estado || '—')}</span></td>
        <td>${o.probs.map(p => `<span class="c2-b ${p[0]}" style="margin:2px 4px 2px 0">${esc(p[1])}</span>`).join('')}</td>
      </tr>`).join('');
    return `
      <div class="c2-kick">Contabilidad 2 · etapa 1</div>
      <div class="c2-h1">Controles</div>
      <div class="c2-sub">Diferencias entre lo guardado en la Contabilidad actual y lo que calcula Contabilidad 2. Sirve para validar las fórmulas antes de seguir.</div>
      <div class="c2-fil">
        <select onchange="C2.filtro.alcance=this.value;C2.render()">
          <option value="liquidadas"${f.alcance === 'liquidadas' ? ' selected' : ''}>Solo liquidadas</option>
          <option value="avanza"${f.alcance === 'avanza' ? ' selected' : ''}>Liquidadas + todas en AVANZA</option>
        </select>
        <span class="c2-kick">${lista.length} ${lista.length !== 1 ? 'operaciones' : 'operación'} con observaciones</span>
      </div>
      <div class="c2-card" style="overflow-x:auto">
        ${lista.length ? `<table class="c2-t ancha"><thead><tr><th>Cliente</th><th>Banco</th><th>Estado</th><th>Observaciones</th></tr></thead><tbody>${filas}</tbody></table>` : '<div class="c2-empty">✅ Sin diferencias</div>'}
      </div>`;
  }

  // Abre la solicitud en Comercializadora; al volver (o guardar) regresa a esta operación (ver showV en index)
  C2.verSolicitud = function (id) {
    window._volverC2 = id;
    editRec(id);
  };

  // ── entrada ──
  C2.init = function () {
    if (!C2.puede()) { toast('No tenés permisos para acceder a esta sección', 'warn'); return; }
    C2.render();
    C2.cargar(true);
  };
})();
