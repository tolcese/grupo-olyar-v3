// ══════════════════════════════════════════════════════════════
// CONTABILIDAD 2 — Etapas 1, 2 y 3 (v3.9.49)
// Etapa 1 (lectura): liquidación, parámetros, controles.
// Etapa 2: Caja y bancos (tablas c2_*). Los pagos de una operación también tildan la tabla contabilidad.
// Etapa 3: Cobrar y pagar (pendientes agrupados por agencia / gestor / banco).
// v3.9.42: montos calculados con % de Parámetros + ajustes manuales (tabla c2_ajustes) + SÍ/NO comisión gestor.
// v3.9.43: SÍ/NO retribución banco (campo retrib_aplica).
// v3.9.44: impuesto al crédito fijo 1,2 % (IMP_CREDITO_PCT).
// v3.9.49: COLUMBIA debita el impuesto 1,2 % al liquidar (IMP_EN_LIQ): la casilla del impuesto va en Registrar ingreso.
// v3.9.48: Caja y bancos → movimientos ordenables por columna (cliente, fecha, cuenta, concepto, montos…).
// v3.9.47: en el Recorrido del dinero no se muestran la retribución en NO ni el gestor sin nada para pagar.
// v3.9.46: botón Eliminar cuenta (sin movimientos activos; función SQL c2_eliminar_cuenta).
// v3.9.45: arranque de Caja = fecha de arranque más antigua de las cuentas activas (antes fijo 01/11).
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

  // v3.9.44: impuesto al crédito FIJO en 1,2 % (no se toma de Parámetros / coeficientes)
  const IMP_CREDITO_PCT = 1.2;

  // ── carga de datos (solo lectura) ──
  C2.cargar = async function (forzar) {
    if (C2.cargando) return;
    if (C2.cargado && !forzar) return;
    C2.cargando = true;
    C2.render();
    const pCaja = cargarCaja();
    const pAj = cargarAjustes();
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
    await pCaja;
    await pAj;
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

  // v3.9.42: los montos se CALCULAN con los % de Parámetros (banco en AVANZA). Lo guardado en la Contabilidad
  // vieja ya no se usa como monto (solo se compara en Controles). Los ajustes manuales van en c2_ajustes.
  // Gastos de gestoría, com. comercial/operativa y pagos extras son datos cargados en la vieja (base editable).
  C2.aj = {};       // solicitud_id -> { campo: fila de c2_ajustes }
  C2.ajOk = false;
  C2.calc = function (r) {
    const c = C2.cont[r.id] || null;
    const A = C2.aj[r.id] || {};
    const I = num(r.importe) || 0;
    const banco = bancoOperacion(r);
    const p = { bruta: pctBruta(banco), imp: IMP_CREDITO_PCT, retrib: C2.coef.retribBanco, gest: C2.coef.comGestor };
    const g = (campo) => c ? num(c[campo]) : null;
    const item = (calculado, campo) => {
      const a = A[campo]; const v = a ? num(a.valor) : null;
      return { calc: calculado, valor: v !== null ? v : calculado, ajuste: v !== null, campo, info: a || null };
    };
    const aplicaGest = !(A.gest_aplica && num(A.gest_aplica.valor) === 0);
    const aplicaRetrib = !(A.retrib_aplica && num(A.retrib_aplica.valor) === 0);
    const it = {
      bruta: item(r0(I * p.bruta / 100), 'bruta'),
      imp: item(r0(I * p.imp / 100), 'imp'),
      retrib: aplicaRetrib ? item(r0(I * p.retrib / 100), 'retrib') : { calc: 0, valor: 0, ajuste: false, campo: 'retrib', noAplica: true },
      gest: aplicaGest ? item(r0(I * p.gest / 100), 'gest') : { calc: 0, valor: 0, ajuste: false, campo: 'gest', noAplica: true },
      gestoria: item(g('gastos_gestoria') || 0, 'gestoria'),
      comCom: item((g('com_comercial') || 0) + (g('com_operativo') || 0), 'comcom'),
      extras: item(g('pagos_extras') || 0, 'extras')
    };
    it.comLuk = { calc: it.bruta.calc - it.imp.calc, valor: it.bruta.valor - it.imp.valor, ajuste: false, derivado: true };
    const gestoria = it.gestoria.valor, comCom = it.comCom.valor, extras = it.extras.valor;
    const bruta = it.bruta.valor;
    const aLiquidar = I - bruta - gestoria;
    const ganancia = it.comLuk.valor + it.retrib.valor - it.gest.valor - comCom - extras;
    const retribCobrada = !!(c && c.fecha_pago_banco);
    const gananciaCobrada = ganancia - (retribCobrada ? 0 : it.retrib.valor);
    let fLiq = fechaLiquidado(r) || (c && c.fecha_liq) || '';
    let fLiqEstimada = false;
    if (!fLiq && r.creditoEstado === 'Pagado') { fLiq = fechaPagadoCredito(r); fLiqEstimada = !!fLiq; }
    return {
      r, c, I, banco, p, it, gestoria, comCom, extras, bruta, aLiquidar, ganancia, gananciaCobrada, aplicaGest, aplicaRetrib,
      fechaLiq: fLiq, fLiqEstimada,
      agenciaPagada: !!(c && c.pagado), fechaAgencia: c && c.fecha_pagado,
      gestorPagado: !!(c && c.pago_gest), fechaGestor: c && c.fecha_pago_gest,
      retribCobrada, fechaRetrib: c && c.fecha_pago_banco,
      vieja: c ? { imp: g('imp_credito'), comLuk: g('com_lukaya'), retrib: g('retrib_banco'), gest: g('com_gestora'), aLiq: g('a_liquidar'), gan: g('ganancia') } : null
    };
  };

  // gestor sin nada para pagar (sin comisión y sin gastos de gestoría) cuenta como resuelto
  const gestorOk = x => x.gestorPagado || x.it.gest.valor + x.gestoria <= 0;
  // retribución que no corresponde (NO) cuenta como resuelta
  const retribOk = x => x.retribCobrada || x.it.retrib.valor <= 0;
  function estadoOp(x) {
    if (x.agenciaPagada && gestorOk(x) && retribOk(x)) return ['Cerrada', 'gr'];
    if (!x.agenciaPagada) return ['Falta pagar agencia', 'am'];
    if (!retribOk(x)) return ['Esperando retribución', 'am'];
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
#v-contabilidad2 .c2-tabs{display:flex;gap:6px;margin:14px 0}
#v-contabilidad2 .c2-tabs button{border:1.5px solid var(--line);background:#fff;border-radius:9px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer}
#v-contabilidad2 .c2-tabs button.on{background:#fff1e8;border-color:#fdba8c;color:#c2410c}
#v-contabilidad2 .c2-ctas{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:0 0 14px}
#v-contabilidad2 .c2-cta{background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer}
#v-contabilidad2 .c2-cta:hover{border-color:#fdba8c}
#v-contabilidad2 .c2-cta.on{border-color:#c2410c;box-shadow:0 0 0 2px #fde2cf}
#v-contabilidad2 .c2-cta.tot{background:#fff7f1;cursor:default}
#v-contabilidad2 .c2-cta .l{font-size:12px;color:var(--muted);font-weight:700}
#v-contabilidad2 .c2-cta .v{font-size:20px;font-weight:900;margin:3px 0 1px}
#v-contabilidad2 .c2-kpi-click{cursor:pointer}
#v-contabilidad2 .c2-kpi-click:hover{border-color:#fdba8c}
#v-contabilidad2 .c2-kpi-click.on{border-color:#c2410c;box-shadow:0 0 0 2px #fde2cf}
#v-contabilidad2 .c2-grp{border:1.5px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}
#v-contabilidad2 .c2-grp summary{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;background:#fafaf9;list-style:none}
#v-contabilidad2 .c2-grp summary::-webkit-details-marker{display:none}
#v-contabilidad2 .c2-grp summary::before{content:'▸';color:#a8a29e;font-size:12px}
#v-contabilidad2 .c2-grp[open] summary::before{content:'▾'}
#v-contabilidad2 .c2-grp summary .t{font-weight:800;font-size:14px}
#v-contabilidad2 .c2-grp summary .tot{margin-left:auto;font-weight:900;font-size:15px}
#v-contabilidad2 .c2-grp table.c2-t{margin:0;table-layout:fixed;min-width:640px}
#v-contabilidad2 .c2-grp th:nth-child(1){width:12%}#v-contabilidad2 .c2-grp th:nth-child(2){width:9%}#v-contabilidad2 .c2-grp th:nth-child(3){width:29%}#v-contabilidad2 .c2-grp th:nth-child(4){width:22%}#v-contabilidad2 .c2-grp th:nth-child(5){width:14%}#v-contabilidad2 .c2-grp th:nth-child(6){width:14%}
#v-contabilidad2 .c2-grp td{overflow:hidden;text-overflow:ellipsis}
#v-contabilidad2 .c2-grp table.c2-t td,#v-contabilidad2 .c2-grp table.c2-t th{padding-left:14px}
#v-contabilidad2 .c2-ed{border:none;background:none;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:6px;opacity:.55}
#v-contabilidad2 .c2-ed:hover{opacity:1;background:#fff1e8}
#v-contabilidad2 .c2-sw{display:inline-flex;border:1.5px solid var(--line);border-radius:7px;overflow:hidden;vertical-align:middle;margin-left:6px;cursor:pointer;user-select:none}
#v-contabilidad2 .c2-sw.ro{cursor:default;opacity:.8}
#v-contabilidad2 .c2-sw b{font-size:10.5px;padding:2px 7px;color:#a8a29e;background:#fff}
#v-contabilidad2 .c2-sw b.on{background:#15803d;color:#fff}
#v-contabilidad2 .c2-sw b.on.no{background:#b91c1c}
#c2-modal{position:fixed;inset:0;background:rgba(15,15,15,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px}
#c2-modal .c2m-box{background:#fff;border-radius:14px;width:100%;max-width:560px;max-height:92vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25)}
#c2-modal .c2m-h{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e7e5e4;font-size:15.5px}
#c2-modal .c2m-x{border:none;background:none;font-size:16px;cursor:pointer;color:#78716c}
#c2-modal .c2m-b{padding:16px 18px;font-size:13.5px}
#c2-modal .c2m-f{display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid #e7e5e4}
#c2-modal .c2m-g{display:grid;grid-template-columns:1fr 1fr;gap:12px}
#c2-modal label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:#57534e}
#c2-modal label.c2m-chk{flex-direction:row;align-items:center;gap:8px;font-weight:600;margin-top:12px}
#c2-modal input[type=text],#c2-modal input[type=date],#c2-modal input[type=number],#c2-modal select{border:1.5px solid #e7e5e4;border-radius:8px;padding:8px 10px;font-size:13.5px;font-weight:400;color:#1c1917;background:#fff}
#c2-modal .c2m-err{display:none;margin:0 18px 4px;padding:8px 10px;border-radius:8px;background:#fee2e2;color:#991b1b;font-size:12.5px;font-weight:600}
#c2-modal .c2-btn{border:1.5px solid #e7e5e4;background:#fff;border-radius:9px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
#c2-modal .c2-btn.pri{background:#c2410c;border-color:#c2410c;color:#fff}
#c2-modal .c2-btn[disabled]{opacity:.45;cursor:not-allowed}
#c2-modal .c2-sub{font-size:13px;color:#78716c}
#c2-modal .c2-f{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#57534e}
#c2-modal .c2-note{background:#f5f5f4;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#44403c}
@media (max-width:600px){#c2-modal .c2m-g{grid-template-columns:1fr}}
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
    if (sec === 'caja' && C2.seccion !== 'caja') C2.cajaTab = 'movimientos';
    C2.seccion = sec;
    C2.opId = opId || null;
    C2.render();
    try { document.getElementById('v-contabilidad2').scrollIntoView({ block: 'start' }); } catch (e) {}
  };

  C2.render = function () {
    const root = document.getElementById('v-contabilidad2');
    if (!root) return;
    css();
    const nav = SECCIONES.map(([k, t, etapa]) => etapa <= 3
      ? `<button class="${C2.seccion === k ? 'on' : ''}" onclick="C2.ir('${k}')">${t}</button>`
      : `<button disabled title="Próxima etapa">${t}<small>(etapa ${etapa})</small></button>`).join('');
    let body;
    if (!C2.cargado) body = `<div class="c2-card c2-empty">${C2.cargando ? '⏳ Cargando datos contables…' : 'Sin datos.'}</div>`;
    else if (C2.seccion === 'liquidacion' && C2.opId) body = vistaOperacion(C2.opId);
    else if (C2.seccion === 'liquidacion') body = vistaLista();
    else if (C2.seccion === 'caja') body = vistaCaja();
    else if (C2.seccion === 'cobrarpagar') body = vistaCobrarPagar();
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
      <div class="c2-kick">Contabilidad 2</div>
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
    const aj = i => i.ajuste ? `<span class="c2-aj" title="${esc('Ajustado por ' + (i.info && i.info.usuario || '—') + (i.info && i.info.motivo ? ': ' + i.info.motivo : ''))}">ajuste</span>` : '';
    const ajF = i => i.ajuste ? `<div class="c2-f" style="font-size:11px">calculado ${$(i.calc)}</div>` : '';
    const puedeAj = C2.puedeEscribir() && C2.ajOk;
    const ed = campo => puedeAj ? `<button class="c2-ed" title="Editar" onclick="C2.abrirAjuste('${esc(r.id)}','${campo}')">✏️</button>` : '';
    const ganVieja = x.vieja && x.vieja.gan !== null && Math.abs(x.vieja.gan - x.ganancia) > 1 ? x.vieja.gan : null;
    const sw = (campo, si, tit) => `<span class="c2-sw${puedeAj ? '' : ' ro'}"${puedeAj ? ` onclick="C2.toggleAplica('${esc(r.id)}','${campo}')" title="${tit}"` : ''}><b class="${si ? 'on' : ''}">SÍ</b><b class="${si ? '' : 'on no'}">NO</b></span>`;
    const swGest = sw('gest_aplica', x.aplicaGest, '¿Lleva comisión gestor?');
    const swRetrib = sw('retrib_aplica', x.aplicaRetrib, '¿Corresponde retribución del banco?');
    const dRet = dias(x.fechaLiq);
    const paso = (ok, titulo, sub, pend, extra) => `<li><span class="c2-dot" style="background:${ok ? '#15803d' : pend ? '#c2410c' : '#a8a29e'}"></span><div><div style="font-weight:700">${titulo}</div><div style="font-size:12.5px;color:var(--muted)">${sub}</div>${extra || ''}</div></li>`;
    const liqVieja = x.fechaLiq && String(x.fechaLiq).slice(0, 10) < arranque() && !movsOp(x.r.id, 'liquidacion').length;
    const extraLiq = !C2.caja.ok ? '' : liqVieja ? '<div class="c2-f" style="font-size:11.5px;margin-top:3px;color:#a8a29e">anterior al arranque de Caja (' + fD(arranque()) + ')</div>' : C2.pasoCaja(x, 'liquidacion', false);
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
            <span class="c2-b ${gestorOk(x) ? 'gr' : 'am'}">${x.gestorPagado ? 'Gestor pagado' : gestorOk(x) ? 'Sin pago a gestor' : 'Gestor pendiente'}</span>
            <span class="c2-b gy">Crédito: ${esc(r.creditoEstado || '—')}</span>
          </div>
        </div>
        <div style="display:flex;gap:10px">
          ${typeof editRec === 'function' && (typeof canEdit !== 'function' || canEdit()) ? `<button class="c2-btn" onclick="C2.verSolicitud('${esc(r.id)}')">Ver solicitud</button>` : ''}
        </div>
      </div>
      ${sinCont ? `<div class="c2-note" style="margin-top:14px;background:#fef3c7">Esta operación todavía no tiene fila en Contabilidad: todo lo que ves es calculado con los porcentajes de Parámetros.</div>` : ''}
      <div class="c2-grid2" style="margin-top:16px">
        <div>
          <div class="c2-card">
            <h3>1 · Cuánto se le transfiere a la agencia</h3>
            <div class="c2-sub">Se calcula con los % de Parámetros. Si un valor se corrige a mano con ✏️ queda marcado como <span class="c2-aj" style="margin:0">ajuste</span></div>
            <table class="c2-t" style="margin-top:10px"><thead><tr><th>Concepto</th><th>Fórmula</th><th class="n">Monto</th><th style="width:34px"></th></tr></thead><tbody>
              <tr><td>Importe del crédito (I)</td><td class="c2-f">dato de la solicitud</td><td class="n">${$(x.I)}</td><td></td></tr>
              <tr><td>Comisión bruta ${aj(x.it.bruta)}</td><td class="c2-f">I × ${pct(x.p.bruta)} (${esc(bancoDisplay(x.banco))})</td><td class="n">${$(x.it.bruta.valor)}${ajF(x.it.bruta)}</td><td>${ed('bruta')}</td></tr>
              <tr><td>Impuesto al crédito ${aj(x.it.imp)}</td><td class="c2-f">I × ${pct(x.p.imp)}</td><td class="n neg">${$(-x.it.imp.valor)}${ajF(x.it.imp)}</td><td>${ed('imp')}</td></tr>
              <tr><td>Comisión LUKAYA</td><td class="c2-f">bruta − imp. crédito</td><td class="n">${$(x.it.comLuk.valor)}</td><td>${ed('comLuk')}</td></tr>
              <tr><td>Gastos de gestoría ${aj(x.it.gestoria)}</td><td class="c2-f">dato cargado</td><td class="n">${$(x.gestoria)}${ajF(x.it.gestoria)}</td><td>${ed('gestoria')}</td></tr>
              <tr class="tot"><td>A liquidar a la agencia</td><td class="c2-f">I − bruta − gestoría</td><td class="n">${$(x.aLiquidar)}</td><td>${ed('aLiq')}</td></tr>
            </tbody></table>
          </div>
          <div class="c2-card">
            <h3>2 · Cuánto gana LUKAYA en esta operación</h3>
            <div class="c2-sub">La ganancia nunca se escribe a mano: siempre sale de esta suma</div>
            <table class="c2-t" style="margin-top:10px"><thead><tr><th>Concepto</th><th>Fórmula</th><th class="n">Monto</th><th style="width:34px"></th></tr></thead><tbody>
              <tr><td>Comisión LUKAYA</td><td class="c2-f">de la sección 1</td><td class="n">${$(x.it.comLuk.valor)}</td><td></td></tr>
              <tr><td>Retribución banco ${swRetrib} ${aj(x.it.retrib)}</td><td class="c2-f">${x.aplicaRetrib ? 'I × ' + pct(x.p.retrib) : 'no corresponde'}</td><td class="n ${x.it.retrib.valor ? 'pos' : ''}">${x.it.retrib.valor ? '+' : ''}${$(x.it.retrib.valor)}${ajF(x.it.retrib)}</td><td>${x.aplicaRetrib ? ed('retrib') : ''}</td></tr>
              <tr><td>Comisión gestor ${swGest} ${aj(x.it.gest)}</td><td class="c2-f">${x.aplicaGest ? 'I × ' + pct(x.p.gest) : 'no lleva comisión'}</td><td class="n ${x.it.gest.valor ? 'neg' : ''}">${$(-x.it.gest.valor)}${ajF(x.it.gest)}</td><td>${x.aplicaGest ? ed('gest') : ''}</td></tr>
              <tr><td>Comisión comercial / operativa ${aj(x.it.comCom)}</td><td class="c2-f">dato cargado</td><td class="n ${x.comCom ? 'neg' : ''}">${$(-x.comCom)}${ajF(x.it.comCom)}</td><td>${ed('comcom')}</td></tr>
              <tr><td>Pagos extras ${aj(x.it.extras)}</td><td class="c2-f">dato cargado</td><td class="n ${x.extras ? 'neg' : ''}">${$(-x.extras)}${ajF(x.it.extras)}</td><td>${ed('extras')}</td></tr>
              <tr class="tot"><td>Ganancia devengada</td><td class="c2-f">suma de arriba</td><td class="n">${$(x.ganancia)}</td><td></td></tr>
              <tr><td>Ganancia cobrada</td><td class="c2-f">${!x.aplicaRetrib ? 'sin retribución (no corresponde)' : x.retribCobrada ? 'retribución ya cobrada' : 'sin retribución hasta que pague el banco'}</td><td class="n">${$(x.gananciaCobrada)}</td><td></td></tr>
            </tbody></table>
            ${ganVieja !== null ? `<div class="c2-note" style="margin-top:10px;background:#dbeafe">En la Contabilidad vieja esta operación tiene ganancia <b>${$(ganVieja)}</b> (guardada con otros valores). Contabilidad 2 usa la calculada acá. Ver Controles.</div>` : ''}
            ${!C2.ajOk && C2.puedeEscribir() ? '<div class="c2-note" style="margin-top:10px;background:#fef3c7">Para poder editar montos hay que correr <b>c2_ajustes.sql</b> en Supabase.</div>' : ''}
          </div>
        </div>
        <div>
        <div class="c2-card">
          <h3>Recorrido del dinero</h3>
          <ul class="c2-tl">
            ${paso(!!x.fechaLiq, 'Liquidada por el banco', x.fechaLiq ? fD(x.fechaLiq) + (x.fLiqEstimada ? ' (estimada: fecha de Pagado)' : '') : 'Sin fecha de Liquidado', !x.fechaLiq, extraLiq)}
            ${paso(x.agenciaPagada, 'Agencia pagada · ' + esc(r.concesionaria || '—'), x.agenciaPagada ? fD(x.fechaAgencia) : 'Pendiente · ' + $(x.aLiquidar), !x.agenciaPagada, C2.pasoCaja(x, 'agencia', x.agenciaPagada))}
            ${!x.retribCobrada && retribOk(x) ? ''
              : paso(x.retribCobrada, 'Retribución del banco', x.retribCobrada ? 'Cobrada ' + fD(x.fechaRetrib) : 'Pendiente' + (dRet !== null ? ' hace ' + dRet + ' días' : '') + ' · ' + $(x.it.retrib.valor), !x.retribCobrada, C2.pasoCaja(x, 'retribucion', x.retribCobrada))}
            ${!x.gestorPagado && gestorOk(x) ? ''
              : paso(x.gestorPagado, 'Comisión y gastos al gestor · ' + esc(r.gestorAsignado || '—'), x.gestorPagado ? fD(x.fechaGestor) : 'Pendiente · ' + $(x.it.gest.valor + x.gestoria), !x.gestorPagado, C2.pasoCaja(x, 'gestor', x.gestorPagado))}
            ${paso(x.agenciaPagada && retribOk(x) && gestorOk(x), 'Cerrada', 'Cuando todo lo anterior esté hecho', false)}
          </ul>
          <div class="c2-note">${C2.caja.ok ? 'Al registrar un pago o cobro acá se crea el movimiento en Caja y bancos y se tilda también en la Contabilidad vieja.' : 'Caja y bancos no está disponible: los pagos se siguen registrando en la Contabilidad vieja.'}</div>
        </div>
        ${C2.movsOperacionHTML(x)}
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
          <tr><td>Impuesto al crédito <span class="c2-b gy" style="font-size:10px;padding:1px 6px">fijo</span></td><td class="n">${pct(IMP_CREDITO_PCT)}</td></tr>
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
      Object.keys(x.it).forEach(k => { const i = x.it[k]; if (i.ajuste) probs.push(['am', `Ajuste ${AJN[i.campo]}: ${$(i.valor)} (calculado ${$(i.calc)})`]); });
      if (!x.aplicaGest) probs.push(['gy', 'Sin comisión gestor']);
      if (!x.aplicaRetrib) probs.push(['gy', 'Sin retribución banco']);
      if (x.vieja) {
        const vv = [['comLuk', 'Com. LUKAYA', x.it.comLuk.valor], ['imp', 'Imp. crédito', x.it.imp.valor], ['retrib', 'Retribución', x.it.retrib.valor], ['gest', 'Com. gestor', x.it.gest.valor], ['aLiq', 'A liquidar', x.aLiquidar], ['gan', 'Ganancia', x.ganancia]];
        vv.forEach(([k, t, v]) => { const o = x.vieja[k]; if (o !== null && Math.abs(o - v) > 1) probs.push(['bl', `${t}: vieja ${$(o)} · C2 ${$(v)}`]); });
      }
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
      <div class="c2-sub">En amarillo: ajustes manuales hechos en Contabilidad 2. En azul: diferencias con lo guardado en la Contabilidad vieja (por ejemplo, operaciones guardadas con otro %).</div>
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


  // ══════════════════════════════════════════════════════════════
  // ETAPA 2 — CAJA Y BANCOS (v3.9.38)
  // Tablas: c2_cuentas, c2_conceptos, c2_movimientos (ver c2_etapa2.sql)
  // Los movimientos nunca se borran: se anulan con motivo.
  // Pagos de una operación (agencia / retribución / gestor) también tildan la Contabilidad vieja.
  // ══════════════════════════════════════════════════════════════
  const FECHA_ARRANQUE = '2026-11-01';   // por defecto, si todavía no hay cuentas
  // v3.9.45: el arranque de Caja es la fecha de arranque MÁS ANTIGUA de las cuentas activas (editable en cada cuenta).
  // Si una cuenta arranca el 01/08 con su saldo a esa fecha, se pueden cargar operaciones desde el 01/08.
  const arranque = () => { const fs = C2.caja.cuentas.filter(c => c.activa && c.fecha_inicio).map(c => String(c.fecha_inicio).slice(0, 10)).sort(); return fs[0] || FECHA_ARRANQUE; };
  // pesos con centavos solo si los hay
  const $c = v => { v = Math.round((v || 0) * 100) / 100; const d = Math.abs(v % 1) > 0.004 ? 2 : 0; return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  const _C2_ESCRIBEN = ['admin', 'claudionieva'];
  const IMP_DET = 'Impuesto débitos/créditos · pago agencia';
  const IMP_DET_LIQ = 'Impuesto débitos/créditos · liquidación';
  // v3.9.49: bancos que debitan el impuesto (1,2 %) al LIQUIDAR en vez de al pagar a la agencia
  const IMP_EN_LIQ = ['COLUMBIA'];
  const impEnLiq = x => IMP_EN_LIQ.some(b => String(x.banco || '').toUpperCase().includes(b));
  // ¿en qué paso se registra el impuesto de esta operación?
  const vincImp = x => impEnLiq(x) ? 'liquidacion' : 'agencia';
  // movimiento de impuesto creado junto con un pago a agencia o un ingreso de liquidación (misma operación, fecha y cuenta)
  const impDePago = m => {
    const det = m.vinculo === 'agencia' ? IMP_DET : m.vinculo === 'liquidacion' ? IMP_DET_LIQ : null;
    if (!det) return null;
    return C2.caja.movs.find(i => !i.anulado && !i.vinculo && i.tipo === 'egreso' && String(i.solicitud_id) === String(m.solicitud_id) && String(i.fecha) === String(m.fecha) && String(i.cuenta_id) === String(m.cuenta_id) && i.detalle === det) || null;
  };
  C2.caja = { cuentas: [], conceptos: [], movs: [], ok: false, err: null };
  C2.cajaF = { cuenta: '', desde: '', hasta: '', concepto: '', q: '', anulados: false };
  C2.cajaTab = 'movimientos';
  // v3.9.48: orden de la tabla de movimientos (clic en el encabezado)
  C2.cajaOrden = { k: 'fecha', dir: 'desc' };
  C2.cajaOrdenar = function (k) {
    const o = C2.cajaOrden;
    if (o.k === k) o.dir = o.dir === 'asc' ? 'desc' : 'asc';
    else { o.k = k; o.dir = ['fecha', 'ingreso', 'egreso'].includes(k) ? 'desc' : 'asc'; }
    C2.render();
  };

  C2.puedeEscribir = () => C2.puede() && (typeof canEdit !== 'function' || canEdit()) &&
    _C2_ESCRIBEN.includes(String(ME?.usr || '').toLowerCase());

  const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const quien = () => ME?.nom || ME?.usr || '—';
  // Monto escrito a mano: "1.234.567", "1234567,50", "1.234.567,50", "1234567.5"
  const numIn = v => {
    let s = String(v ?? '').replace(/[$\s]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  const fmtIn = v => (v ? Math.round(v).toLocaleString('es-AR') : '');
  const VINC = {
    liquidacion: { t: 'Ingreso de la liquidación del banco', tipo: 'ingreso' },
    agencia: { t: 'Pago a la agencia', tipo: 'egreso' },
    retribucion: { t: 'Cobro de la retribución del banco', tipo: 'ingreso' },
    gestor: { t: 'Pago al gestor', tipo: 'egreso' }
  };

  async function cargarCaja() {
    const k = C2.caja;
    try {
      const [a, b, c] = await Promise.all([
        SB.from('c2_cuentas').select('*').order('orden').order('id'),
        SB.from('c2_conceptos').select('*').order('tipo').order('nombre'),
        _sbAll(() => SB.from('c2_movimientos').select('*').order('id'))
      ]);
      const e = a.error || b.error || c.error;
      if (e) throw e;
      k.cuentas = a.data || []; k.conceptos = b.data || []; k.movs = c.data || [];
      k.ok = true; k.err = null;
    } catch (e) {
      k.ok = false;
      const m = String(e.message || e);
      k.err = /does not exist|relation|schema cache|Could not find/i.test(m) ? 'faltaSQL' : m;
      console.warn('C2 caja:', m);
    }
  }
  C2.recargarCaja = async function () { await cargarCaja(); C2.render(); };

  const cuenta = id => C2.caja.cuentas.find(c => String(c.id) === String(id));
  const concepto = id => C2.caja.conceptos.find(c => String(c.id) === String(id));
  // efecto de un movimiento sobre una cuenta (con signo)
  function efecto(m, ctaId) {
    if (m.anulado) return 0;
    const v = num(m.monto) || 0, id = String(ctaId);
    if (m.tipo === 'ingreso') return String(m.cuenta_id) === id ? v : 0;
    if (m.tipo === 'egreso') return String(m.cuenta_id) === id ? -v : 0;
    if (String(m.cuenta_id) === id) return -v;
    if (String(m.cuenta_destino_id) === id) return v;
    return 0;
  }
  C2.saldoCuenta = function (cta, hasta) {
    let s = num(cta.saldo_inicial) || 0;
    C2.caja.movs.forEach(m => { if (!hasta || String(m.fecha) <= hasta) s += efecto(m, cta.id); });
    return Math.round(s * 100) / 100;
  };
  // fecha del pago registrada en la Contabilidad vieja ('' si no hay)
  const fechaVieja = (x, vinculo) => String((vinculo === 'agencia' ? x.fechaAgencia : vinculo === 'gestor' ? x.fechaGestor : vinculo === 'retribucion' ? x.fechaRetrib : '') || '').slice(0, 10);
  const movsOp = (id, vinculo) => C2.caja.movs.filter(m => !m.anulado && String(m.solicitud_id) === String(id) && (!vinculo || m.vinculo === vinculo));

  // ── modal propio (no usar confirm() en PWA) ──
  C2.modal = function (titulo, html, botones) {
    C2.cerrarModal();
    const ov = document.createElement('div');
    ov.id = 'c2-modal';
    ov.innerHTML = `<div class="c2m-box"><div class="c2m-h"><b>${titulo}</b><button class="c2m-x" onclick="C2.cerrarModal()">✕</button></div>
      <div class="c2m-b">${html}</div><div class="c2m-err" id="c2m-err"></div>
      <div class="c2m-f"><button class="c2-btn" onclick="C2.cerrarModal()">Cancelar</button>${botones || ''}</div></div>`;
    ov.addEventListener('mousedown', e => { if (e.target === ov) C2.cerrarModal(); });
    document.body.appendChild(ov);
    const f = ov.querySelector('input:not([type=hidden]):not([readonly]),select,textarea'); if (f) setTimeout(() => f.focus(), 30);
  };
  C2.cerrarModal = function () { const m = document.getElementById('c2-modal'); if (m) m.remove(); };
  const mErr = t => { const e = document.getElementById('c2m-err'); if (e) { e.textContent = t; e.style.display = t ? 'block' : 'none'; } };
  const val = id => { const e = document.getElementById(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : null; };
  function bloquear(b) { document.querySelectorAll('#c2-modal .c2m-f button').forEach(x => { x.disabled = b; }); }
  const optCuentas = (sel, excluir) => C2.caja.cuentas.filter(c => c.activa && String(c.id) !== String(excluir || ''))
    .map(c => `<option value="${c.id}"${String(c.id) === String(sel) ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('');
  function validarFechaCuenta(fecha, ctaId) {
    const c = cuenta(ctaId);
    if (!c) return 'Elegí una cuenta';
    if (!fecha) return 'Poné la fecha';
    if (fecha > hoy()) return 'La fecha no puede ser futura';
    if (fecha < String(c.fecha_inicio)) return `La cuenta ${c.nombre} arranca el ${fD(c.fecha_inicio)}: la fecha no puede ser anterior`;
    return '';
  }

  // ── Sincronización con la Contabilidad vieja ──
  const SYNC = {
    agencia: f => ({ pagado: !!f, fecha_pagado: f || null }),
    gestor: f => ({ pago_gest: !!f, fecha_pago_gest: f || null }),
    retribucion: f => ({ fecha_pago_banco: f || null })
  };
  async function syncContabilidad(id, vinculo, fecha) {
    if (!SYNC[vinculo]) return true;
    const campos = SYNC[vinculo](fecha);
    const prev = C2.cont[id] ? { ...C2.cont[id] } : null;
    const igual = (a, b) => String(a ?? '').slice(0, 10) === String(b ?? '').slice(0, 10) || (typeof b === 'boolean' && !!a === b);
    if (prev && Object.keys(campos).every(k => igual(prev[k], campos[k]))) return true; // ya estaba así (p.ej. "Pasar a caja")
    let res;
    if (prev) res = await SB.from('contabilidad').update(campos).eq('solicitud_id', id);
    else {
      const r = (RECORDS || []).find(x => String(x.id) === String(id));
      const x = C2.calc(r);
      res = await SB.from('contabilidad').upsert({
        solicitud_id: id, a_liquidar: x.aLiquidar, imp_credito: x.it.imp.valor, gastos_gestoria: null,
        com_lukaya: x.it.comLuk.valor, fecha_liq: x.fechaLiq ? String(x.fechaLiq).slice(0, 10) : null,
        com_comercial: null, com_operativo: null, com_gestora: x.it.gest.valor, retrib_banco: x.it.retrib.valor,
        ganancia: x.ganancia, pagos_extras: null, pagado: false, fecha_pagado: null, pago_gest: false,
        fecha_pago_gest: null, fecha_pago_banco: null, obs: null, ...campos
      }, { onConflict: 'solicitud_id' });
    }
    if (res.error) { console.error('C2 sync contabilidad:', res.error); return false; }
    C2.cont[id] = { ...(prev || { solicitud_id: id }), ...campos };
    // memoria de la Contabilidad vieja
    const cam = {};
    if ('pagado' in campos) { cam.pagado = campos.pagado; cam.fechaPagado = campos.fecha_pagado; }
    if ('pago_gest' in campos) { cam.pagoGest = campos.pago_gest; cam.fechaPagoGest = campos.fecha_pago_gest; }
    if ('fecha_pago_banco' in campos) cam.fechaPagoBanco = campos.fecha_pago_banco;
    try { if (typeof CONT_DATA !== 'undefined' && CONT_DATA) CONT_DATA[id] = { ...(CONT_DATA[id] || {}), ...cam }; } catch (e) {}
    try { if (typeof LT_DATA !== 'undefined' && LT_DATA && LT_DATA[id]) LT_DATA[id] = { ...LT_DATA[id], ...cam }; } catch (e) {}
    if (typeof registrarHistorial === 'function') {
      const ant = prev || {};
      registrarHistorial('contabilidad', id, Object.keys(campos).map(k => ({ campo: k, ant: ant[k] ?? null, nuevo: campos[k] })).concat([{ campo: 'origen', ant: null, nuevo: 'Contabilidad 2 · ' + (fecha ? '' : 'anulación de ') + VINC[vinculo].t.toLowerCase() }]));
    }
    return true;
  }

  // ── Pagos / cobros de una operación ──
  function montoSugerido(x, vinculo) {
    if (vinculo === 'liquidacion') return x.I;
    if (vinculo === 'agencia') return x.aLiquidar;
    if (vinculo === 'retribucion') return x.it.retrib.valor;
    if (vinculo === 'gestor') return x.it.gest.valor + x.gestoria;
    return 0;
  }
  C2.abrirPago = function (id, vinculo, desdeVieja) {
    if (!C2.puedeEscribir()) { toast('Solo admin y claudionieva registran movimientos', 'warn'); return; }
    if (!C2.caja.ok) { toast('Caja y bancos no está disponible', 'er'); return; }
    if (!C2.caja.cuentas.some(c => c.activa)) { toast('Primero cargá una cuenta en Caja y bancos → Cuentas y conceptos', 'warn'); return; }
    const r = (RECORDS || []).find(x => String(x.id) === String(id)); if (!r) return;
    const x = C2.calc(r);
    const v = VINC[vinculo];
    const fv = desdeVieja ? fechaVieja(x, vinculo) : '';
    const fechaDef = fv && fv >= arranque() ? fv
      : vinculo === 'liquidacion' && x.fechaLiq && String(x.fechaLiq).slice(0, 10) >= arranque() ? String(x.fechaLiq).slice(0, 10) : hoy();
    const quienRecibe = vinculo === 'agencia' ? esc(r.concesionaria || '—') : vinculo === 'gestor' ? esc(r.gestorAsignado || '—') : esc(bancoDisplay(x.banco));
    C2.modal((desdeVieja ? 'Pasar a caja · ' : '') + v.t, `
      <div class="c2-sub" style="margin-bottom:12px">${esc(r.nombrecliente || '—')} · ${v.tipo === 'egreso' ? 'a' : 'de'} <b>${quienRecibe}</b></div>
      <div class="c2m-g">
        <label>Fecha<input type="date" id="c2p-fecha" value="${fechaDef}" min="${arranque()}" max="${hoy()}"></label>
        <label>Cuenta<select id="c2p-cuenta">${optCuentas(C2._ultCuenta)}</select></label>
        <label>Monto<input type="text" inputmode="decimal" id="c2p-monto" value="${fmtIn(montoSugerido(x, vinculo))}"></label>
        <label style="grid-column:1/-1">Detalle (opcional)<input type="text" id="c2p-det" placeholder="N° de transferencia, observación…"></label>
      </div>
      <div class="c2-f" style="margin-top:8px">Sugerido: ${$c(montoSugerido(x, vinculo))}${vinculo === 'gestor' ? ' (comisión ' + $c(x.it.gest.valor) + ' + gastos de gestoría ' + $c(x.gestoria) + ')' : ''}</div>
      ${vinculo === vincImp(x) && x.it.imp.valor > 0 ? `<label class="c2m-chk"><input type="checkbox" id="c2p-imp" checked> ${vinculo === 'liquidacion'
        ? `${esc(bancoDisplay(x.banco))} debita el impuesto débitos/créditos al liquidar: registrarlo como egreso (${$c(x.it.imp.valor)}), misma fecha y cuenta`
        : `Registrar también el impuesto débitos/créditos que debita el banco al transferir (${$c(x.it.imp.valor)}), misma fecha y cuenta`}</label>` : ''}
      ${vinculo === 'agencia' && impEnLiq(x) && x.it.imp.valor > 0 ? `<div class="c2-f" style="margin-top:8px">En ${esc(bancoDisplay(x.banco))} el impuesto (${$c(x.it.imp.valor)}) se registra al liquidar, no acá.</div>` : ''}
      ${desdeVieja ? `<div class="c2-note" style="margin-top:12px">En la Contabilidad vieja ya figura ${vinculo === 'retribucion' ? 'cobrada' : 'pagado'}${fv ? ' el ' + fD(fv) : ' (sin fecha)'}. Acá solo se crea el movimiento en caja; si cambiás la fecha, también se corrige en la vieja.</div>`
        : SYNC[vinculo] ? '<div class="c2-note" style="margin-top:12px">También se tilda en la Contabilidad vieja con esta fecha.</div>' : ''}`,
      `<button class="c2-btn pri" onclick="C2.confirmarPago('${esc(id)}','${vinculo}')">Registrar</button>`);
  };
  C2.confirmarPago = async function (id, vinculo) {
    const fecha = val('c2p-fecha'), cta = val('c2p-cuenta'), monto = numIn(val('c2p-monto')), det = String(val('c2p-det') || '').trim();
    const e = validarFechaCuenta(fecha, cta); if (e) return mErr(e);
    if (!monto || monto <= 0) return mErr('El monto tiene que ser mayor a cero');
    const con = C2.caja.conceptos.find(c => c.vinculo === vinculo && c.activo);
    if (!con) return mErr('No existe el concepto de sistema para "' + VINC[vinculo].t + '". Revisá Cuentas y conceptos.');
    bloquear(true); mErr('');
    try {
      // anti-duplicado contra la base (por si otro usuario lo cargó recién)
      const chk = await SB.from('c2_movimientos').select('id').eq('solicitud_id', id).eq('vinculo', vinculo).eq('anulado', false).limit(1);
      if (chk.error) throw chk.error;
      if ((chk.data || []).length) { bloquear(false); await cargarCaja(); C2.render(); return mErr('Ya hay un movimiento registrado para esto. Actualicé la pantalla.'); }
      const ins = await SB.from('c2_movimientos').insert({
        fecha, tipo: VINC[vinculo].tipo, cuenta_id: Number(cta), monto, concepto_id: con.id,
        vinculo, solicitud_id: id, detalle: det || null, creado_por: quien()
      }).select().single();
      if (ins.error) throw ins.error;
      if ((vinculo === 'agencia' || vinculo === 'liquidacion') && val('c2p-imp')) {
        const r = (RECORDS || []).find(x => String(x.id) === String(id));
        const x = C2.calc(r);
        const ci = C2.caja.conceptos.find(c => c.activo && !c.vinculo && c.tipo === 'egreso' && /impuesto/i.test(c.nombre));
        if (x.it.imp.valor > 0) {
          const i2 = await SB.from('c2_movimientos').insert({ fecha, tipo: 'egreso', cuenta_id: Number(cta), monto: x.it.imp.valor, concepto_id: ci ? ci.id : null, solicitud_id: id, detalle: vinculo === 'liquidacion' ? IMP_DET_LIQ : IMP_DET, creado_por: quien() });
          if (i2.error) toast('Se registró el movimiento pero no el impuesto: ' + i2.error.message, 'warn');
        }
      }
      C2._ultCuenta = cta;
      const ok = await syncContabilidad(id, vinculo, fecha);
      C2.cerrarModal();
      toast(ok ? 'Registrado ✓' : 'Movimiento registrado, pero NO se pudo tildar en la Contabilidad vieja. Tildalo a mano.', ok ? 'ok' : 'warn');
      await cargarCaja(); C2.render();
    } catch (err) { bloquear(false); mErr('Error: ' + (err.message || err)); }
  };

  // ── Movimiento manual (ingreso / egreso / transferencia) ──
  C2.abrirMov = function (tipo) {
    if (!C2.puedeEscribir()) return;
    if (!C2.caja.cuentas.some(c => c.activa)) { toast('Primero cargá una cuenta', 'warn'); C2.cajaTab = 'config'; C2.render(); return; }
    const conOpts = C2.caja.conceptos.filter(c => c.activo && !c.vinculo && c.tipo === tipo).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    const tit = tipo === 'ingreso' ? '➕ Nuevo ingreso' : tipo === 'egreso' ? '➖ Nuevo egreso' : '⇄ Transferencia entre cuentas';
    const ctaDef = C2.cajaF.cuenta || C2._ultCuenta;
    C2.modal(tit, `<div class="c2m-g">
        <label>Fecha<input type="date" id="c2m-fecha" value="${hoy()}" min="${arranque()}" max="${hoy()}"></label>
        <label>${tipo === 'transferencia' ? 'Desde la cuenta' : 'Cuenta'}<select id="c2m-cuenta">${optCuentas(ctaDef)}</select></label>
        ${tipo === 'transferencia' ? `<label>Hacia la cuenta<select id="c2m-dest"><option value="">— elegí —</option>${optCuentas('')}</select></label>`
        : `<label>Concepto<select id="c2m-con">${conOpts ? '<option value="">— elegí —</option>' + conOpts : '<option value="">(no hay conceptos de ' + tipo + ')</option>'}</select></label>`}
        <label>Monto<input type="text" inputmode="decimal" id="c2m-monto" placeholder="0"></label>
        <label style="grid-column:1/-1">Detalle${tipo === 'transferencia' ? ' (opcional)' : ''}<input type="text" id="c2m-det" placeholder="Descripción del movimiento"></label>
      </div>
      ${tipo !== 'transferencia' ? '<div class="c2-f" style="margin-top:8px">Los pagos de agencias, gestores, retribuciones y liquidaciones se registran desde cada operación (Liquidación por operación).</div>' : ''}`,
      `<button class="c2-btn pri" onclick="C2.guardarMov('${tipo}')">Guardar</button>`);
  };
  C2.guardarMov = async function (tipo) {
    const fecha = val('c2m-fecha'), cta = val('c2m-cuenta'), monto = numIn(val('c2m-monto')), det = String(val('c2m-det') || '').trim();
    let e = validarFechaCuenta(fecha, cta); if (e) return mErr(e);
    const row = { fecha, tipo, cuenta_id: Number(cta), monto, detalle: det || null, creado_por: quien() };
    if (tipo === 'transferencia') {
      const d = val('c2m-dest');
      if (!d) return mErr('Elegí la cuenta destino');
      if (d === cta) return mErr('Origen y destino no pueden ser la misma cuenta');
      e = validarFechaCuenta(fecha, d); if (e) return mErr(e);
      row.cuenta_destino_id = Number(d);
    } else {
      const c = val('c2m-con');
      if (!c) return mErr('Elegí el concepto');
      if (!det) return mErr('Escribí un detalle');
      row.concepto_id = Number(c);
    }
    if (!monto || monto <= 0) return mErr('El monto tiene que ser mayor a cero');
    bloquear(true); mErr('');
    const res = await SB.from('c2_movimientos').insert(row);
    if (res.error) { bloquear(false); return mErr('Error: ' + res.error.message); }
    C2._ultCuenta = cta;
    C2.cerrarModal(); toast('Movimiento guardado ✓', 'ok');
    await cargarCaja(); C2.render();
  };

  // ── Anular ──
  C2.abrirAnular = function (movId) {
    if (!C2.puedeEscribir()) return;
    const m = C2.caja.movs.find(x => String(x.id) === String(movId)); if (!m) return;
    const c = cuenta(m.cuenta_id);
    C2.modal('Anular movimiento', `
      <div style="font-size:13.5px;margin-bottom:10px">${fD(m.fecha)} · ${esc(c ? c.nombre : '—')} · <b>${$c(num(m.monto))}</b><br>${esc(descMov(m))}</div>

      <label class="c2m-l">Motivo (obligatorio)<input type="text" id="c2a-mot" placeholder="Ej.: monto mal cargado"></label>
      ${SYNC[m.vinculo] ? `<label class="c2m-chk"><input type="checkbox" id="c2a-dest"> ${m.vinculo === 'retribucion' ? 'El cobro' : 'El pago'} no se hizo: destildarlo también en la Contabilidad vieja</label>
        <div class="c2-f" style="font-size:11px;margin:4px 0 0 24px">Dejalo sin marcar si solo corregís un dato (monto, cuenta, fecha): después lo volvés a cargar con "Pasar a caja".</div>` : ''}
      ${impDePago(m) ? `<label class="c2m-chk"><input type="checkbox" id="c2a-imp" checked> Anular también el impuesto débitos/créditos de este ${m.vinculo === 'liquidacion' ? 'ingreso' : 'pago'} (${$c(num(impDePago(m).monto))})</label>` : ''}`,
      `<button class="c2-btn" style="background:#b91c1c;border-color:#b91c1c;color:#fff" onclick="C2.confirmarAnular('${esc(movId)}')">Anular</button>`);
  };
  C2.confirmarAnular = async function (movId) {
    const mot = String(val('c2a-mot') || '').trim();
    if (mot.length < 3) return mErr('Escribí el motivo');
    const m = C2.caja.movs.find(x => String(x.id) === String(movId)); if (!m) return;
    bloquear(true); mErr('');
    const res = await SB.from('c2_movimientos').update({ anulado: true, anulado_por: quien(), anulado_at: new Date().toISOString(), motivo_anulacion: mot }).eq('id', m.id).eq('anulado', false);
    if (res.error) { bloquear(false); return mErr('Error: ' + res.error.message); }
    let ok = true;
    const imp = impDePago(m);
    if (imp && val('c2a-imp')) {
      const ri = await SB.from('c2_movimientos').update({ anulado: true, anulado_por: quien(), anulado_at: new Date().toISOString(), motivo_anulacion: 'Anulado junto con ' + (m.vinculo === 'liquidacion' ? 'el ingreso de liquidación' : 'el pago a agencia') + ': ' + mot }).eq('id', imp.id).eq('anulado', false);
      if (ri.error) toast('No se pudo anular el impuesto: ' + ri.error.message, 'warn');
    }
    if (SYNC[m.vinculo] && m.solicitud_id && val('c2a-dest')) {
      const quedan = C2.caja.movs.some(x => x.id !== m.id && !x.anulado && x.vinculo === m.vinculo && String(x.solicitud_id) === String(m.solicitud_id));
      if (!quedan) ok = await syncContabilidad(m.solicitud_id, m.vinculo, null);
    }
    if (typeof registrarHistorial === 'function') registrarHistorial('c2_movimientos', m.id, [{ campo: 'anulado', ant: 'false', nuevo: 'true · ' + mot }]);
    C2.cerrarModal();
    toast(ok ? 'Movimiento anulado' : 'Anulado, pero NO se pudo destildar en la Contabilidad vieja. Hacelo a mano.', ok ? 'ok' : 'warn');
    await cargarCaja(); C2.render();
  };

  // ── ABM cuentas ──
  C2.abrirCuenta = function (id) {
    if (!C2.puedeEscribir()) return;
    const c = id ? cuenta(id) : null;
    const tipos = [['banco', 'Banco'], ['efectivo', 'Efectivo'], ['billetera', 'Billetera virtual']];
    C2.modal(c ? 'Editar cuenta' : 'Nueva cuenta', `<div class="c2m-g">
        <label style="grid-column:1/-1">Nombre<input type="text" id="c2c-nom" value="${esc(c ? c.nombre : '')}" placeholder="Ej.: Galicia cta. cte."></label>
        <label>Tipo<select id="c2c-tipo">${tipos.map(([k, t]) => `<option value="${k}"${(c ? c.tipo : 'banco') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Orden<input type="number" id="c2c-orden" value="${c ? c.orden : C2.caja.cuentas.length + 1}"></label>
        <label>Fecha de arranque<input type="date" id="c2c-fini" value="${c ? c.fecha_inicio : arranque()}"></label>
        <label>Saldo inicial a esa fecha (del extracto)<input type="text" inputmode="decimal" id="c2c-saldo" value="${c ? String(num(c.saldo_inicial) || 0).replace('.', ',') : ''}" placeholder="0"></label>
        ${c ? `<label class="c2m-chk" style="grid-column:1/-1"><input type="checkbox" id="c2c-act"${c.activa ? ' checked' : ''}> Cuenta activa (si la desactivás no aparece para cargar movimientos)</label>` : ''}
      </div>`,
      `<button class="c2-btn pri" onclick="C2.guardarCuenta(${c ? c.id : 'null'})">Guardar</button>`);
  };
  C2.guardarCuenta = async function (id) {
    const nombre = String(val('c2c-nom') || '').trim();
    const fini = val('c2c-fini');
    const sTxt = String(val('c2c-saldo') || '').trim();
    const saldo = sTxt === '' ? 0 : numIn(sTxt.replace(/^-/, ''));
    if (!nombre) return mErr('Poné el nombre');
    if (C2.caja.cuentas.some(c => c.nombre.trim().toLowerCase() === nombre.toLowerCase() && String(c.id) !== String(id))) return mErr('Ya existe una cuenta con ese nombre');
    if (!fini) return mErr('Poné la fecha de arranque');
    if (saldo === null) return mErr('Saldo inicial inválido');
    const row = { nombre, tipo: val('c2c-tipo'), orden: parseInt(val('c2c-orden'), 10) || 0, fecha_inicio: fini, saldo_inicial: sTxt.startsWith('-') ? -saldo : saldo };
    if (id) {
      row.activa = !!val('c2c-act');
      const prim = C2.caja.movs.filter(m => !m.anulado && (String(m.cuenta_id) === String(id) || String(m.cuenta_destino_id) === String(id))).map(m => String(m.fecha)).sort()[0];
      if (prim && fini > prim) return mErr('Hay movimientos desde el ' + fD(prim) + ': la fecha de arranque no puede ser posterior');
    } else row.creado_por = quien();
    bloquear(true); mErr('');
    const ant = id ? { ...cuenta(id) } : null;
    const res = id ? await SB.from('c2_cuentas').update(row).eq('id', id).select().single() : await SB.from('c2_cuentas').insert(row).select().single();
    if (res.error) { bloquear(false); return mErr('Error: ' + res.error.message); }
    if (typeof registrarHistorial === 'function') {
      const campos = ['nombre', 'tipo', 'fecha_inicio', 'saldo_inicial', 'activa'];
      const cambios = ant ? campos.filter(k => k in row && String(ant[k] ?? '') !== String(row[k] ?? '') && !(k === 'saldo_inicial' && num(ant[k]) === num(row[k]))).map(k => ({ campo: k, ant: ant[k], nuevo: row[k] }))
        : [{ campo: 'alta', ant: null, nuevo: nombre + ' · saldo inicial ' + row.saldo_inicial + ' al ' + fini }];
      registrarHistorial('c2_cuentas', res.data.id, cambios);
    }
    C2.cerrarModal(); toast('Cuenta guardada ✓', 'ok');
    await cargarCaja(); C2.render();
  };

  // ── Eliminar cuenta (v3.9.46) — solo sin movimientos activos; usa la función c2_eliminar_cuenta ──
  C2.abrirEliminarCuenta = function (id) {
    if (!C2.puedeEscribir()) return;
    const c = cuenta(id); if (!c) return;
    const activos = C2.caja.movs.filter(m => !m.anulado && (String(m.cuenta_id) === String(id) || String(m.cuenta_destino_id) === String(id))).length;
    if (activos) { toast('La cuenta tiene ' + activos + ' movimiento(s) activo(s): anulalos primero', 'warn'); return; }
    const anulados = C2.caja.movs.filter(m => m.anulado && (String(m.cuenta_id) === String(id) || String(m.cuenta_destino_id) === String(id))).length;
    C2.modal('Eliminar cuenta', `
      <div style="font-size:13.5px;margin-bottom:10px">Vas a eliminar la cuenta <b>${esc(c.nombre)}</b> (saldo inicial ${$c(num(c.saldo_inicial))}). No se puede deshacer.</div>
      ${anulados ? `<div class="c2-note" style="margin-bottom:10px;background:#fef3c7">También se borran sus <b>${anulados}</b> movimiento(s) anulado(s).</div>` : ''}
      <label class="c2m-l">Para confirmar, escribí el nombre de la cuenta<input type="text" id="c2e-nom" placeholder="${esc(c.nombre)}" autocomplete="off"></label>`,
      `<button class="c2-btn" style="background:#b91c1c;border-color:#b91c1c;color:#fff" onclick="C2.confirmarEliminarCuenta(${c.id})">Eliminar</button>`);
  };
  C2.confirmarEliminarCuenta = async function (id) {
    const c = cuenta(id); if (!c) return;
    if (String(val('c2e-nom') || '').trim().toLowerCase() !== c.nombre.trim().toLowerCase()) return mErr('El nombre no coincide');
    bloquear(true); mErr('');
    let res = await SB.rpc('c2_eliminar_cuenta', { p_id: Number(id) });
    if (res.error && /c2_eliminar_cuenta|function|schema cache/i.test(res.error.message || '')) {
      // sin la función (falta SQL): solo se puede si la cuenta no tiene NINGÚN movimiento
      const tiene = C2.caja.movs.some(m => String(m.cuenta_id) === String(id) || String(m.cuenta_destino_id) === String(id));
      if (tiene) { bloquear(false); return mErr('Para eliminar cuentas con movimientos anulados falta correr c2_eliminar_cuenta.sql en Supabase'); }
      res = await SB.from('c2_cuentas').delete().eq('id', id);
    }
    if (res.error) { bloquear(false); return mErr('Error: ' + res.error.message); }
    if (C2.cajaF.cuenta && String(C2.cajaF.cuenta) === String(id)) C2.cajaF.cuenta = '';
    if (String(C2._ultCuenta) === String(id)) C2._ultCuenta = '';
    if (typeof registrarHistorial === 'function') registrarHistorial('c2_cuentas', id, [{ campo: 'eliminada', ant: c.nombre + ' · saldo inicial ' + c.saldo_inicial, nuevo: null }]);
    C2.cerrarModal(); toast('Cuenta eliminada', 'ok');
    await cargarCaja(); C2.render();
  };

  // ── ABM conceptos ──
  C2.abrirConcepto = function (id) {
    if (!C2.puedeEscribir()) return;
    const c = id ? concepto(id) : null;
    const sis = !!(c && c.sistema);
    C2.modal(c ? 'Editar concepto' : 'Nuevo concepto', `<div class="c2m-g">
        <label style="grid-column:1/-1">Nombre<input type="text" id="c2k-nom" value="${esc(c ? c.nombre : '')}" placeholder="Ej.: Alquiler oficina"></label>
        <label>Tipo<select id="c2k-tipo"${sis ? ' disabled' : ''}><option value="egreso"${c && c.tipo === 'egreso' ? ' selected' : ''}>Egreso</option><option value="ingreso"${c && c.tipo === 'ingreso' ? ' selected' : ''}>Ingreso</option></select></label>
        ${c ? `<label class="c2m-chk"${sis ? ' style="opacity:.5"' : ''}><input type="checkbox" id="c2k-act"${c.activo ? ' checked' : ''}${sis ? ' disabled' : ''}> Activo</label>` : ''}
      </div>${sis ? '<div class="c2-note" style="margin-top:10px">Concepto de sistema: lo usan los botones de cada operación. Solo se puede cambiar el nombre.</div>' : ''}`,
      `<button class="c2-btn pri" onclick="C2.guardarConcepto(${c ? c.id : 'null'})">Guardar</button>`);
  };
  C2.guardarConcepto = async function (id) {
    const c = id ? concepto(id) : null;
    const nombre = String(val('c2k-nom') || '').trim();
    if (!nombre) return mErr('Poné el nombre');
    const row = { nombre };
    if (!c || !c.sistema) { row.tipo = val('c2k-tipo'); if (c) row.activo = !!val('c2k-act'); }
    if (C2.caja.conceptos.some(k => k.nombre.trim().toLowerCase() === nombre.toLowerCase() && k.tipo === (row.tipo || c.tipo) && String(k.id) !== String(id))) return mErr('Ya existe ese concepto');
    bloquear(true); mErr('');
    const res = id ? await SB.from('c2_conceptos').update(row).eq('id', id) : await SB.from('c2_conceptos').insert(row);
    if (res.error) { bloquear(false); return mErr('Error: ' + res.error.message); }
    C2.cerrarModal(); toast('Concepto guardado ✓', 'ok');
    await cargarCaja(); C2.render();
  };

  // ── Vista ──
  function descMov(m) {
    if (m.tipo === 'transferencia') { const d = cuenta(m.cuenta_destino_id); const o = cuenta(m.cuenta_id); return 'Transferencia ' + (o ? o.nombre : '—') + ' → ' + (d ? d.nombre : '—'); }
    const k = concepto(m.concepto_id);
    return k ? k.nombre : (m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso');
  }
  C2.cajaFiltrar = function (k, v) { C2.cajaF[k] = v; C2.render(); };

  function vistaCaja() {
    const k = C2.caja, w = C2.puedeEscribir();
    const head = `<div class="c2-kick">Contabilidad 2 · etapa 2</div><div class="c2-h1">Caja y bancos</div>
      <div class="c2-sub">Saldos y movimientos de cada cuenta desde el ${fD(arranque())}.${w ? '' : ' Solo lectura: registran movimientos admin y claudionieva.'}</div>`;
    if (k.err === 'faltaSQL') return head + `<div class="c2-card c2-empty" style="margin-top:16px">⚠️ Todavía no están creadas las tablas de Caja y bancos.<br><small>Hay que correr <b>c2_etapa2.sql</b> en el SQL Editor de Supabase y después tocar 🔄 Actualizar datos.</small></div>`;
    if (k.err) return head + `<div class="c2-card c2-empty" style="margin-top:16px">Error al cargar Caja y bancos: ${esc(k.err)}</div>`;
    const tabs = `<div class="c2-tabs"><button class="${C2.cajaTab === 'movimientos' ? 'on' : ''}" onclick="C2.cajaTab='movimientos';C2.render()">Movimientos</button><button class="${C2.cajaTab === 'config' ? 'on' : ''}" onclick="C2.cajaTab='config';C2.render()">Cuentas y conceptos</button></div>`;
    return head + tabs + (C2.cajaTab === 'config' ? vistaCajaConfig(w) : vistaCajaMovs(w));
  }

  function vistaCajaMovs(w) {
    const k = C2.caja, f = C2.cajaF;
    if (!k.cuentas.length) return `<div class="c2-card c2-empty">Todavía no hay cuentas cargadas.${w ? `<br><br><button class="c2-btn pri" onclick="C2.cajaTab='config';C2.render();C2.abrirCuenta()">+ Cargar la primera cuenta</button>` : ''}</div>`;
    const activas = k.cuentas.filter(c => c.activa || C2.saldoCuenta(c) !== 0);
    const total = activas.reduce((s, c) => s + C2.saldoCuenta(c), 0);
    const tarjetas = activas.map(c => {
      const s = C2.saldoCuenta(c);
      const on = String(f.cuenta) === String(c.id);
      return `<div class="c2-cta${on ? ' on' : ''}" onclick="C2.cajaFiltrar('cuenta','${on ? '' : c.id}')" title="${on ? 'Ver todas' : 'Ver solo esta cuenta'}">
        <div class="l">${esc(c.nombre)} <span class="c2-b gy" style="font-size:10px;padding:1px 6px">${esc(c.tipo)}</span>${c.activa ? '' : ' <span class="c2-b re" style="font-size:10px;padding:1px 6px">inactiva</span>'}</div>
        <div class="v ${s < 0 ? 'neg' : ''}">${$c(s)}</div>
        <div class="c2-f" style="font-size:11px">inicial ${$c(num(c.saldo_inicial))} al ${fD(c.fecha_inicio)}</div></div>`;
    }).join('');
    let lista = k.movs.filter(m => {
      if (!f.anulados && m.anulado) return false;
      if (f.cuenta && String(m.cuenta_id) !== String(f.cuenta) && String(m.cuenta_destino_id) !== String(f.cuenta)) return false;
      if (f.desde && String(m.fecha) < f.desde) return false;
      if (f.hasta && String(m.fecha) > f.hasta) return false;
      if (f.concepto === 'transferencia' && m.tipo !== 'transferencia') return false;
      if (f.concepto && f.concepto !== 'transferencia' && String(m.concepto_id) !== String(f.concepto)) return false;
      if (f.q) {
        const r = m.solicitud_id ? (RECORDS || []).find(x => String(x.id) === String(m.solicitud_id)) : null;
        const t = [m.detalle, descMov(m), m.creado_por, r && r.nombrecliente, r && r.concesionaria, r && r.gestorAsignado, m.monto].join(' ').toLowerCase();
        if (!t.includes(f.q.toLowerCase())) return false;
      }
      return true;
    });
    // saldo corrido (solo con una cuenta elegida)
    const saldoTras = {};
    if (f.cuenta) {
      const c = cuenta(f.cuenta);
      let s = num(c.saldo_inicial) || 0;
      k.movs.filter(m => efecto(m, c.id) !== 0).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id)
        .forEach(m => { s += efecto(m, c.id); saldoTras[m.id] = s; });
    }
    // orden elegido; desempate por fecha y carga (más nuevo primero). Sin dato (p.ej. sin operación) va siempre al final.
    const cliente = m => { if (!m.solicitud_id) return ''; const r = (RECORDS || []).find(x => String(x.id) === String(m.solicitud_id)); return String((r && r.nombrecliente) || '').trim().toUpperCase(); };
    const montoCol = (m, lado) => {
      const v = num(m.monto) || 0;
      if (m.tipo === 'ingreso') return lado === 'ingreso' ? v : null;
      if (m.tipo === 'egreso') return lado === 'egreso' ? v : null;
      if (f.cuenta) return (String(m.cuenta_destino_id) === String(f.cuenta)) === (lado === 'ingreso') ? v : null;
      return lado === 'ingreso' ? v : null;
    };
    const claveOrden = {
      fecha: m => String(m.fecha),
      cuenta: m => { const c = cuenta(m.cuenta_id); return c ? c.nombre.toUpperCase() : ''; },
      concepto: m => descMov(m).toUpperCase(),
      detalle: m => String(m.detalle || '').trim().toUpperCase(),
      operacion: cliente,
      ingreso: m => montoCol(m, 'ingreso'),
      egreso: m => montoCol(m, 'egreso'),
      usuario: m => String(m.creado_por || '').toUpperCase()
    };
    const ko = claveOrden[C2.cajaOrden.k] || claveOrden.fecha, sg = C2.cajaOrden.dir === 'asc' ? 1 : -1;
    const vacio = v => v === null || v === '';
    lista.sort((a, b) => {
      const va = ko(a), vb = ko(b);
      if (vacio(va) !== vacio(vb)) return vacio(va) ? 1 : -1;
      if (!vacio(va)) {
        const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es');
        if (c) return c * sg;
      }
      return String(b.fecha).localeCompare(String(a.fecha)) || b.id - a.id;
    });
    const th = (k, t, cls) => { const on = C2.cajaOrden.k === k; return `<th${cls ? ' class="' + cls + '"' : ''} style="cursor:pointer;user-select:none${on ? ';color:#c2410c' : ''}" onclick="C2.cajaOrdenar('${k}')" title="Ordenar">${t}${on ? (C2.cajaOrden.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`; };
    let ing = 0, egr = 0;
    lista.forEach(m => {
      if (m.anulado || m.tipo === 'transferencia' && !f.cuenta) return;
      const v = f.cuenta ? efecto(m, f.cuenta) : (m.tipo === 'ingreso' ? num(m.monto) : -num(m.monto));
      if (v > 0) ing += v; else egr -= v;
    });
    const filas = lista.map(m => {
      const c = cuenta(m.cuenta_id);
      const r = m.solicitud_id ? (RECORDS || []).find(x => String(x.id) === String(m.solicitud_id)) : null;
      const v = num(m.monto) || 0;
      let colI = '', colE = '';
      if (m.tipo === 'ingreso') colI = $c(v);
      else if (m.tipo === 'egreso') colE = $c(v);
      else if (f.cuenta) { if (String(m.cuenta_destino_id) === String(f.cuenta)) colI = $c(v); else colE = $c(v); }
      else colI = '<span style="color:var(--muted)">⇄ ' + $c(v) + '</span>';
      const st = m.anulado ? ' style="opacity:.5;text-decoration:line-through"' : '';
      return `<tr${m.anulado ? ` title="Anulado por ${esc(m.anulado_por || '—')}: ${esc(m.motivo_anulacion || '')}"` : ''}>
        <td style="white-space:nowrap"${st}>${fD(m.fecha)}</td>
        <td${st}>${esc(c ? c.nombre : '—')}${m.tipo === 'transferencia' && cuenta(m.cuenta_destino_id) ? ' → ' + esc(cuenta(m.cuenta_destino_id).nombre) : ''}</td>
        <td${st}>${esc(descMov(m))}${m.anulado ? ' <span class="c2-b re" style="text-decoration:none">anulado</span>' : ''}</td>
        <td${st}>${esc(m.detalle || '')}${m.anulado ? `<div class="c2-f" style="font-size:11px;text-decoration:none">Motivo: ${esc(m.motivo_anulacion || '—')}</div>` : ''}</td>
        <td>${r ? `<a href="#" onclick="C2.ir('liquidacion','${esc(r.id)}');return false">${esc(r.nombrecliente || r.id)}</a>` : ''}</td>
        <td class="n pos"${st}>${colI}</td>
        <td class="n neg"${st}>${colE}</td>
        ${f.cuenta ? `<td class="n" style="font-weight:700">${m.anulado ? '' : $c(saldoTras[m.id])}</td>` : ''}
        <td style="font-size:12px;color:var(--muted)">${esc(m.creado_por || '—')}</td>
        <td>${w && !m.anulado ? `<button class="c2-btn" style="padding:3px 9px;font-size:12px" onclick="C2.abrirAnular('${m.id}')">Anular</button>` : ''}</td>
      </tr>`;
    }).join('');
    const conOpts = k.conceptos.map(c => `<option value="${c.id}"${String(f.concepto) === String(c.id) ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('');
    return `
      <div class="c2-ctas">${tarjetas}<div class="c2-cta tot"><div class="l">Total en cuentas</div><div class="v ${total < 0 ? 'neg' : ''}">${$c(total)}</div><div class="c2-f" style="font-size:11px">${activas.length} cuenta${activas.length !== 1 ? 's' : ''}</div></div></div>
      ${w ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 14px">
        <button class="c2-btn pri" onclick="C2.abrirMov('ingreso')">➕ Ingreso</button>
        <button class="c2-btn pri" onclick="C2.abrirMov('egreso')">➖ Egreso</button>
        <button class="c2-btn" onclick="C2.abrirMov('transferencia')">⇄ Transferencia</button></div>` : ''}
      <div class="c2-card">
        <div class="c2-fil" style="margin-top:0">
          <select onchange="C2.cajaFiltrar('cuenta',this.value)"><option value="">Todas las cuentas</option>${k.cuentas.map(c => `<option value="${c.id}"${String(f.cuenta) === String(c.id) ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
          <select onchange="C2.cajaFiltrar('concepto',this.value)"><option value="">Todos los conceptos</option><option value="transferencia"${f.concepto === 'transferencia' ? ' selected' : ''}>Transferencias</option>${conOpts}</select>
          <span class="c2-kick">desde</span><input type="date" value="${f.desde}" onchange="C2.cajaFiltrar('desde',this.value)">
          <span class="c2-kick">hasta</span><input type="date" value="${f.hasta}" onchange="C2.cajaFiltrar('hasta',this.value)">
          <input id="c2-cq" placeholder="🔍 Detalle, cliente, agencia…" value="${esc(f.q)}" oninput="C2.cajaF.q=this.value;clearTimeout(C2._t);C2._t=setTimeout(()=>{C2.render();const i=document.getElementById('c2-cq');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},250)" style="min-width:200px">
          <label class="c2-kick" style="display:flex;gap:5px;align-items:center"><input type="checkbox"${f.anulados ? ' checked' : ''} onchange="C2.cajaFiltrar('anulados',this.checked)"> ver anulados</label>
          <button class="c2-btn" onclick="C2.cajaF={cuenta:'',desde:'',hasta:'',concepto:'',q:'',anulados:false};C2.render()">✕ Limpiar</button>
        </div>
        <div class="c2-sub" style="margin-bottom:8px">Tocá un encabezado para ordenar${C2.cajaOrden.k !== 'fecha' ? ` · <a href="#" onclick="C2.cajaOrden={k:'fecha',dir:'desc'};C2.render();return false">volver a ordenar por fecha</a>` : ''} · ${lista.length} movimiento${lista.length !== 1 ? 's' : ''} · Ingresos <b class="pos">${$c(ing)}</b> · Egresos <b class="neg">${$c(egr)}</b>${f.cuenta ? '' : ' · (las transferencias no suman: con todas las cuentas se compensan)'}</div>
        <div style="overflow-x:auto">
        ${lista.length ? `<table class="c2-t ancha"><thead><tr>${th('fecha', 'Fecha')}${th('cuenta', 'Cuenta')}${th('concepto', 'Concepto')}${th('detalle', 'Detalle')}${th('operacion', 'Operación (cliente)')}${th('ingreso', 'Ingreso', 'n')}${th('egreso', 'Egreso', 'n')}${f.cuenta ? '<th class="n">Saldo</th>' : ''}${th('usuario', 'Cargó')}<th></th></tr></thead><tbody>${filas}</tbody></table>`
        : '<div class="c2-empty">No hay movimientos con estos filtros.</div>'}
        </div>
      </div>`;
  }

  function vistaCajaConfig(w) {
    const k = C2.caja;
    const usos = id => k.movs.filter(m => !m.anulado && (String(m.cuenta_id) === String(id) || String(m.cuenta_destino_id) === String(id))).length;
    const fC = k.cuentas.map(c => `<tr>
        <td style="font-weight:700">${esc(c.nombre)}</td><td>${esc(c.tipo)}</td><td>${fD(c.fecha_inicio)}</td>
        <td class="n">${$c(num(c.saldo_inicial))}</td><td class="n" style="font-weight:700">${$c(C2.saldoCuenta(c))}</td>
        <td class="n">${usos(c.id)}</td>
        <td><span class="c2-b ${c.activa ? 'gr' : 'gy'}">${c.activa ? 'activa' : 'inactiva'}</span></td>
        <td style="white-space:nowrap">${w ? `<button class="c2-btn" style="padding:3px 9px;font-size:12px" onclick="C2.abrirCuenta(${c.id})">Editar</button>` : ''}${w && !usos(c.id) ? ` <button class="c2-btn" style="padding:3px 9px;font-size:12px;color:#b91c1c;border-color:#fca5a5" onclick="C2.abrirEliminarCuenta(${c.id})" title="Solo cuentas sin movimientos activos">Eliminar</button>` : ''}</td></tr>`).join('');
    const vin = { liquidacion: 'Liquidación del banco', agencia: 'Pago agencia', retribucion: 'Retribución banco', gestor: 'Pago gestor' };
    const fK = k.conceptos.map(c => `<tr>
        <td style="font-weight:700">${esc(c.nombre)}</td>
        <td><span class="c2-b ${c.tipo === 'ingreso' ? 'gr' : 're'}">${c.tipo}</span></td>
        <td>${c.vinculo ? '<span class="c2-b bl">' + vin[c.vinculo] + '</span>' : '<span style="color:var(--muted)">manual</span>'}</td>
        <td><span class="c2-b ${c.activo ? 'gr' : 'gy'}">${c.activo ? 'activo' : 'inactivo'}</span></td>
        <td>${w ? `<button class="c2-btn" style="padding:3px 9px;font-size:12px" onclick="C2.abrirConcepto(${c.id})">Editar</button>` : ''}</td></tr>`).join('');
    return `
      <div class="c2-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><h3>Cuentas</h3><div class="c2-sub">Cada cuenta arranca con su saldo inicial a su fecha de arranque. Caja arranca el <b>${fD(arranque())}</b> (la fecha más antigua de las cuentas activas).<br>Para cargar operaciones anteriores, editá la cuenta: poné una fecha de arranque más vieja y el saldo que tenía <b>ese día</b> según el extracto.</div></div>
        ${w ? '<button class="c2-btn pri" onclick="C2.abrirCuenta()">+ Nueva cuenta</button>' : ''}</div>
        <div style="overflow-x:auto;margin-top:10px">${k.cuentas.length ? `<table class="c2-t"><thead><tr><th>Nombre</th><th>Tipo</th><th>Arranque</th><th class="n">Saldo inicial</th><th class="n">Saldo actual</th><th class="n">Movs.</th><th>Estado</th><th></th></tr></thead><tbody>${fC}</tbody></table>` : '<div class="c2-empty">Sin cuentas</div>'}</div>
      </div>
      <div class="c2-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><h3>Conceptos</h3><div class="c2-sub">Los de sistema (en azul) los usan los botones de cada operación.</div></div>
        ${w ? '<button class="c2-btn pri" onclick="C2.abrirConcepto()">+ Nuevo concepto</button>' : ''}</div>
        <div style="overflow-x:auto;margin-top:10px"><table class="c2-t"><thead><tr><th>Concepto</th><th>Tipo</th><th>Uso</th><th>Estado</th><th></th></tr></thead><tbody>${fK || '<tr><td colspan="5" class="c2-empty">Sin conceptos</td></tr>'}</tbody></table></div>
      </div>`;
  }

  // Bloque "en caja" de cada paso del recorrido de una operación
  C2.pasoCaja = function (x, vinculo, yaHecho) {
    if (!C2.caja.ok) return '';
    const m = movsOp(x.r.id, vinculo)[0];
    if (m) { const c = cuenta(m.cuenta_id), im = impDePago(m); return `<div class="c2-f" style="font-size:11.5px;margin-top:3px">💰 en caja: ${esc(c ? c.nombre : '—')} · ${fD(m.fecha)} · ${$c(num(m.monto))}${im ? '<br>🧾 impuesto 1,2 %: −' + $c(num(im.monto)) : ''}</div>`; }
    if (yaHecho) {
      const fv = fechaVieja(x, vinculo);
      const nota = '<div class="c2-f" style="font-size:11.5px;margin-top:3px;color:#a8a29e">' + (fv && fv < arranque() ? 'anterior al arranque de Caja (' + fD(arranque()) + ')' : 'sin movimiento en caja (registrado en la Contabilidad vieja)') + '</div>';
      if (fv && fv < arranque() || !C2.puedeEscribir()) return nota;
      return nota + `<button class="c2-btn" style="padding:4px 10px;font-size:12px;margin-top:6px;border-color:#c2410c;color:#c2410c" onclick="C2.abrirPago('${esc(x.r.id)}','${vinculo}',true)">Pasar a caja</button>`;
    }
    if (!C2.puedeEscribir()) return '';
    const lbl = { liquidacion: 'Registrar ingreso', agencia: 'Pagar agencia', retribucion: 'Registrar cobro', gestor: 'Pagar gestor' }[vinculo];
    return `<button class="c2-btn pri" style="padding:4px 10px;font-size:12px;margin-top:6px" onclick="C2.abrirPago('${esc(x.r.id)}','${vinculo}')">${lbl}</button>`;
  };
  C2.movsOperacionHTML = function (x) {
    if (!C2.caja.ok) return '';
    const ms = C2.caja.movs.filter(m => String(m.solicitud_id) === String(x.r.id)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);
    if (!ms.length) return '';
    return `<div class="c2-card"><h3>Movimientos en Caja y bancos</h3><table class="c2-t" style="margin-top:8px"><tbody>${ms.map(m => {
      const c = cuenta(m.cuenta_id);
      return `<tr${m.anulado ? ' style="opacity:.5"' : ''}><td style="white-space:nowrap">${fD(m.fecha)}</td><td>${esc(descMov(m))}${m.anulado ? ' <span class="c2-b re">anulado</span>' : ''}<div class="c2-f" style="font-size:11px">${esc(c ? c.nombre : '—')}</div></td><td class="n ${m.tipo === 'ingreso' ? 'pos' : 'neg'}">${m.tipo === 'ingreso' ? '+' : '−'}${$c(num(m.monto))}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  };


  // ══════════════════════════════════════════════════════════════
  // ETAPA 3 — COBRAR Y PAGAR (v3.9.41)
  // Pendientes de operaciones Liquidado/Pagado, agrupados por agencia / gestor / banco.
  // Los botones usan C2.abrirPago (mismo flujo que el detalle de la operación).
  // ══════════════════════════════════════════════════════════════
  C2.cpTab = 'agencia';
  C2.cpQ = '';
  C2.cpAbiertos = {};
  const CP_TABS = [
    ['agencia', 'Agencias a pagar', 'pagar'],
    ['gestor', 'Gestores a pagar', 'pagar'],
    ['retribucion', 'Retribuciones a cobrar', 'cobrar'],
    ['liquidacion', 'Liquidaciones a ingresar en caja', 'caja'],
    ['pasar', 'Para pasar a caja', 'caja']
  ];

  // Devuelve [{vinculo, x, monto, desde, dias, grupo, accion:'pagar'|'pasar'}]
  C2.pendientes = function () {
    const out = [];
    const ops = (RECORDS || []).filter(r => r.creditoEstado === 'Liquidado' || r.creditoEstado === 'Pagado').map(C2.calc);
    const fl = x => x.fechaLiq ? String(x.fechaLiq).slice(0, 10) : '';
    const add = (tab, vinculo, x, monto, grupo, accion, desde) => {
      const d = desde || fl(x);
      out.push({ tab, vinculo, x, monto, grupo: String(grupo || '').trim() || '(sin dato)', accion, desde: d, dias: dias(d) });
    };
    ops.forEach(x => {
      if (!x.agenciaPagada) add('agencia', 'agencia', x, x.aLiquidar, x.r.concesionaria, 'pagar');
      if (!x.gestorPagado && x.it.gest.valor + x.gestoria > 0) add('gestor', 'gestor', x, x.it.gest.valor + x.gestoria, x.r.gestorAsignado, 'pagar');
      if (!x.retribCobrada && x.it.retrib.valor > 0) add('retribucion', 'retribucion', x, x.it.retrib.valor, bancoDisplay(x.banco), 'pagar');
      if (C2.caja.ok) {
        if (fl(x) && fl(x) >= arranque() && !movsOp(x.r.id, 'liquidacion').length) add('liquidacion', 'liquidacion', x, x.I, bancoDisplay(x.banco), 'pagar');
        [['agencia', x.agenciaPagada, x.aLiquidar, x.r.concesionaria], ['gestor', x.gestorPagado, x.it.gest.valor + x.gestoria, x.r.gestorAsignado], ['retribucion', x.retribCobrada, x.it.retrib.valor, bancoDisplay(x.banco)]]
          .forEach(([v, hecho, monto]) => {
            const fv = fechaVieja(x, v);
            if (hecho && fv && fv >= arranque() && !movsOp(x.r.id, v).length) out.push({ tab: 'pasar', vinculo: v, x, monto, grupo: VINC[v].t, accion: 'pasar', desde: fv, dias: dias(fv) });
          });
      }
    });
    return out;
  };

  C2.cpToggle = function (key, open) { C2.cpAbiertos[key] = open; };

  function vistaCobrarPagar() {
    const w = C2.puedeEscribir() && C2.caja.ok;
    const todos = C2.pendientes();
    const q = C2.cpQ.toLowerCase();
    const filtrados = !q ? todos : todos.filter(p => [p.x.r.nombrecliente, p.x.r.dni, p.x.r.dominio, p.x.r.concesionaria, p.x.r.gestorAsignado, p.x.banco, p.grupo].some(v => String(v || '').toLowerCase().includes(q)));
    const tot = t => filtrados.filter(p => p.tab === t).reduce((s, p) => s + (p.monto || 0), 0);
    const cnt = t => filtrados.filter(p => p.tab === t).length;
    const tabsVis = CP_TABS.filter(([k]) => C2.caja.ok || ['agencia', 'gestor', 'retribucion'].includes(k));
    if (!tabsVis.some(([k]) => k === C2.cpTab)) C2.cpTab = 'agencia';
    const kpis = tabsVis.map(([k, t, tipo]) => `<div class="c2-kpi c2-kpi-click${C2.cpTab === k ? ' on' : ''}" onclick="C2.cpTab='${k}';C2.render()">
        <div class="l">${t}</div><div class="v ${tipo === 'pagar' ? 'neg' : tipo === 'cobrar' ? 'pos' : ''}">${$c(tot(k))}</div><div class="c2-f" style="font-size:11px">${cnt(k)} ${cnt(k) === 1 ? 'operación' : 'operaciones'}</div></div>`).join('');

    const lista = filtrados.filter(p => p.tab === C2.cpTab);
    const grupos = {};
    lista.forEach(p => { (grupos[p.grupo] = grupos[p.grupo] || []).push(p); });
    const gs = Object.entries(grupos).map(([g, items]) => ({ g, items: items.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1)), total: items.reduce((s, p) => s + (p.monto || 0), 0), max: Math.max(...items.map(p => p.dias ?? -1)) }))
      .sort((a, b) => b.total - a.total);
    const colDias = d => d === null || d < 0 ? '<span style="color:var(--muted)">—</span>' : `<span class="c2-b ${d > 30 ? 're' : d > 10 ? 'am' : 'gy'}">${d} d</span>`;
    const lblBtn = { agencia: 'Pagar', gestor: 'Pagar', retribucion: 'Registrar cobro', liquidacion: 'Registrar ingreso' };
    const filasGrupo = items => items.map(p => `<tr>
        <td style="white-space:nowrap">${fD(p.desde)}</td>
        <td>${colDias(p.dias)}</td>
        <td><a href="#" onclick="C2.ir('liquidacion','${esc(p.x.r.id)}');return false" style="font-weight:700">${esc(p.x.r.nombrecliente || '—')}</a></td>
        <td>${C2.cpTab === 'pasar' ? esc(p.vinculo === 'agencia' ? p.x.r.concesionaria || '—' : p.vinculo === 'gestor' ? p.x.r.gestorAsignado || '—' : bancoDisplay(p.x.banco)) : C2.cpTab === 'retribucion' || C2.cpTab === 'liquidacion' ? esc(p.x.r.concesionaria || '—') : colorBanco(p.x.banco)}</td>
        <td class="n" style="font-weight:700">${$c(p.monto)}</td>
        <td style="text-align:right">${w ? (p.accion === 'pasar'
          ? `<button class="c2-btn" style="padding:3px 10px;font-size:12px;border-color:#c2410c;color:#c2410c" onclick="C2.abrirPago('${esc(p.x.r.id)}','${p.vinculo}',true)">Pasar a caja</button>`
          : `<button class="c2-btn pri" style="padding:3px 10px;font-size:12px" onclick="C2.abrirPago('${esc(p.x.r.id)}','${p.vinculo}')">${lblBtn[p.vinculo]}</button>`) : ''}</td>
      </tr>`).join('');
    const colTit = C2.cpTab === 'pasar' ? 'Agencia / gestor / banco' : C2.cpTab === 'retribucion' || C2.cpTab === 'liquidacion' ? 'Agencia' : 'Banco';
    const bloques = gs.map(o => {
      const key = C2.cpTab + '|' + o.g;
      const abierto = C2.cpAbiertos[key] ?? (gs.length <= 3 || !!q);
      return `<details class="c2-grp"${abierto ? ' open' : ''} ontoggle="C2.cpToggle(${esc(JSON.stringify(key))},this.open)">
        <summary><span class="t">${esc(o.g)}</span><span class="c2-b gy">${o.items.length}</span>${o.max >= 0 ? `<span class="c2-f" style="font-size:11.5px">más antigua ${o.max} d</span>` : ''}<span class="tot">${$c(o.total)}</span></summary>
        <div style="overflow-x:auto"><table class="c2-t"><thead><tr><th>${C2.cpTab === 'pasar' ? 'Fecha vieja' : 'Liquidado'}</th><th>Días</th><th>Cliente</th><th>${colTit}</th><th class="n">Monto</th><th></th></tr></thead><tbody>${filasGrupo(o.items)}</tbody></table></div>
      </details>`;
    }).join('');
    const ayuda = {
      agencia: 'Operaciones con el pago a la agencia pendiente (A liquidar = I − bruta − gestoría). Agrupado por agencia.',
      gestor: 'Comisión del gestor + gastos de gestoría pendientes. Agrupado por gestor.',
      retribucion: 'Retribución (I × ' + pct(C2.coef.retribBanco) + ') que todavía no pagó el banco. Agrupado por banco.',
      liquidacion: 'Liquidadas desde el ' + fD(arranque()) + ' cuyo ingreso del banco todavía no se cargó en caja.',
      pasar: 'Pagos y cobros tildados en la Contabilidad vieja (desde el ' + fD(arranque()) + ') que todavía no tienen movimiento en caja.'
    }[C2.cpTab];
    return `
      <div class="c2-kick">Contabilidad 2 · etapa 3</div>
      <div class="c2-h1">Cobrar y pagar</div>
      <div class="c2-sub">Lo pendiente de las operaciones en Liquidado o Pagado. Días = desde la fecha de Liquidado.${w ? '' : C2.caja.ok ? ' Solo lectura: registran admin y claudionieva.' : ''}</div>
      <div class="c2-kpis" style="grid-template-columns:repeat(${tabsVis.length},1fr)">${kpis}</div>
      <div class="c2-card">
        <div class="c2-fil" style="margin-top:0">
          <input id="c2-cpq" placeholder="🔍 Cliente, agencia, gestor, banco, DNI…" value="${esc(C2.cpQ)}" oninput="C2.cpQ=this.value;clearTimeout(C2._t);C2._t=setTimeout(()=>{C2.render();const i=document.getElementById('c2-cpq');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},250)" style="min-width:260px">
          ${gs.length > 1 ? `<button class="c2-btn" onclick="${gs.map(o => `C2.cpAbiertos[${esc(JSON.stringify(C2.cpTab + '|' + o.g))}]=true;`).join('')}C2.render()">Abrir todos</button><button class="c2-btn" onclick="${gs.map(o => `C2.cpAbiertos[${esc(JSON.stringify(C2.cpTab + '|' + o.g))}]=false;`).join('')}C2.render()">Cerrar todos</button>` : ''}
          <span class="c2-kick">${gs.length} grupo${gs.length !== 1 ? 's' : ''} · ${lista.length} ${lista.length === 1 ? 'operación' : 'operaciones'} · ${$c(lista.reduce((s, p) => s + (p.monto || 0), 0))}</span>
        </div>
        <div class="c2-sub" style="margin-bottom:10px">${ayuda}</div>
        ${bloques || '<div class="c2-empty">✅ No hay nada pendiente acá.</div>'}
      </div>`;
  }


  // ══════════════════════════════════════════════════════════════
  // AJUSTES MANUALES POR OPERACIÓN (v3.9.42) — tabla c2_ajustes
  // Un ajuste reemplaza el valor calculado de un concepto. "Volver al calculado" lo borra.
  // Com. LUKAYA y A liquidar no se guardan: se editan como ajuste de la comisión bruta.
  // ══════════════════════════════════════════════════════════════
  const AJN = { bruta: 'comisión bruta', imp: 'impuesto al crédito', retrib: 'retribución banco', gest: 'comisión gestor', gestoria: 'gastos de gestoría', comcom: 'comisión comercial / operativa', extras: 'pagos extras', gest_aplica: 'lleva comisión gestor', retrib_aplica: 'corresponde retribución' };
  const AJ_EDIT = {
    bruta: { t: 'Comisión bruta', pct: true },
    imp: { t: 'Impuesto al crédito', pct: true },
    retrib: { t: 'Retribución banco', pct: true },
    gest: { t: 'Comisión gestor', pct: true },
    gestoria: { t: 'Gastos de gestoría' },
    comcom: { t: 'Comisión comercial / operativa' },
    extras: { t: 'Pagos extras' },
    comLuk: { t: 'Comisión LUKAYA', target: 'bruta' },
    aLiq: { t: 'A liquidar a la agencia', target: 'bruta' }
  };

  async function cargarAjustes() {
    try {
      const res = await _sbAll(() => SB.from('c2_ajustes').select('*').order('id'));
      if (res.error) throw res.error;
      C2.aj = {};
      (res.data || []).forEach(a => { (C2.aj[a.solicitud_id] = C2.aj[a.solicitud_id] || {})[a.campo] = a; });
      C2.ajOk = true;
    } catch (e) {
      C2.ajOk = false; C2.aj = {};
      console.warn('C2 ajustes:', e.message || e);
    }
  }

  // valor actual / calculado de un campo editable
  function ajValores(x, k) {
    if (k === 'comLuk') return { actual: x.it.comLuk.valor, calc: x.it.bruta.calc - x.it.imp.valor };
    if (k === 'aLiq') return { actual: x.aLiquidar, calc: x.I - x.it.bruta.calc - x.gestoria };
    const m = { bruta: 'bruta', imp: 'imp', retrib: 'retrib', gest: 'gest', gestoria: 'gestoria', comcom: 'comCom', extras: 'extras' }[k];
    return { actual: x.it[m].valor, calc: x.it[m].calc };
  }

  C2.abrirAjuste = function (id, k) {
    if (!C2.puedeEscribir() || !C2.ajOk) return;
    const r = (RECORDS || []).find(o => String(o.id) === String(id)); if (!r) return;
    const x = C2.calc(r), d = AJ_EDIT[k], v = ajValores(x, k);
    const campoReal = d.target || k;
    const existe = (C2.aj[id] || {})[campoReal];
    C2.modal('Editar · ' + d.t, `
      <div class="c2-sub" style="margin-bottom:12px">${esc(r.nombrecliente || '—')} · ${esc(bancoDisplay(x.banco))} · importe ${$c(x.I)}</div>
      <table style="width:100%;font-size:13px;margin-bottom:12px"><tbody>
        <tr><td style="color:#78716c">Calculado</td><td style="text-align:right">${$c(v.calc)}</td></tr>
        <tr><td style="color:#78716c">Actual</td><td style="text-align:right;font-weight:700">${$c(v.actual)}${existe ? ' <span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:5px;font-weight:800">ajuste</span>' : ''}</td></tr>
      </tbody></table>
      <div class="c2m-g">
        <label>Nuevo valor<input type="text" inputmode="decimal" id="c2j-val" value="${fmtIn(v.actual)}"></label>
        <label>Motivo (obligatorio)<input type="text" id="c2j-mot" value="" placeholder="Ej.: acuerdo con la agencia"></label>
      </div>
      ${d.pct ? '<div class="c2-f" style="margin-top:8px">Podés escribir un porcentaje del importe, por ejemplo <b>5%</b> o <b>4,5%</b>.</div>' : ''}
      ${d.target ? `<div class="c2-note" style="margin-top:10px">${d.t} no se guarda sola: se calcula de la comisión bruta. Al guardar se ajusta la <b>comisión bruta</b> para que dé este valor.</div>` : ''}
      ${existe ? `<div class="c2-f" style="margin-top:10px;font-size:11.5px">Ajuste actual de ${esc(AJN[campoReal])}: ${$c(num(existe.valor))} · ${esc(existe.usuario || '—')}${existe.motivo ? ' · ' + esc(existe.motivo) : ''}</div>` : ''}`,
      (existe ? `<button class="c2-btn" onclick="C2.quitarAjuste('${esc(id)}','${campoReal}')">Volver al calculado</button>` : '') +
      `<button class="c2-btn pri" onclick="C2.guardarAjuste('${esc(id)}','${k}')">Guardar</button>`);
  };

  C2.guardarAjuste = async function (id, k) {
    const r = (RECORDS || []).find(o => String(o.id) === String(id)); if (!r) return;
    const x = C2.calc(r), d = AJ_EDIT[k];
    const txt = String(val('c2j-val') || '').trim();
    const mot = String(val('c2j-mot') || '').trim();
    let nuevo;
    if (/%$/.test(txt)) {
      if (!d.pct) return mErr('Acá no se puede usar porcentaje');
      const pc = numIn(txt.replace('%', ''));
      if (pc === null || pc < 0 || pc > 100) return mErr('Porcentaje inválido');
      nuevo = r0(x.I * pc / 100);
    } else {
      const neg = txt.startsWith('-');
      nuevo = numIn(txt.replace(/^-/, ''));
      if (nuevo === null) return mErr('Valor inválido');
      if (neg) nuevo = -nuevo;
    }
    if (mot.length < 3) return mErr('Escribí el motivo');
    let campo = k, valor = nuevo;
    if (k === 'comLuk') { campo = 'bruta'; valor = nuevo + x.it.imp.valor; }
    if (k === 'aLiq') { campo = 'bruta'; valor = x.I - nuevo - x.gestoria; }
    if (['bruta', 'imp', 'retrib', 'gest'].includes(campo) && valor < 0) return mErr('El resultado no puede ser negativo');
    const ant = (C2.aj[id] || {})[campo];
    const antVal = ajValores(x, campo === 'bruta' ? 'bruta' : k).actual;
    bloquear(true); mErr('');
    const res = await SB.from('c2_ajustes').upsert({ solicitud_id: id, campo, valor, motivo: mot, usuario: quien(), updated_at: new Date().toISOString() }, { onConflict: 'solicitud_id,campo' });
    if (res.error) { bloquear(false); return mErr('Error: ' + res.error.message); }
    if (typeof registrarHistorial === 'function') registrarHistorial('c2_ajustes', id, [{ campo: 'ajuste ' + AJN[campo], ant: ant ? num(ant.valor) : antVal, nuevo: valor + ' · ' + mot }]);
    C2.cerrarModal(); toast('Ajuste guardado ✓', 'ok');
    await cargarAjustes(); C2.render();
  };

  C2.quitarAjuste = async function (id, campo) {
    const ant = (C2.aj[id] || {})[campo]; if (!ant) return;
    bloquear(true); mErr('');
    const res = await SB.from('c2_ajustes').delete().eq('solicitud_id', id).eq('campo', campo);
    if (res.error) { bloquear(false); return mErr('Error: ' + res.error.message); }
    if (typeof registrarHistorial === 'function') registrarHistorial('c2_ajustes', id, [{ campo: 'ajuste ' + AJN[campo], ant: num(ant.valor), nuevo: 'vuelve al calculado' }]);
    C2.cerrarModal(); toast('Volvió al valor calculado', 'ok');
    await cargarAjustes(); C2.render();
  };

  // SÍ / NO: comisión gestor (gest_aplica) y retribución banco (retrib_aplica)
  const APLICA = {
    gest_aplica: { k: 'aplicaGest', no: 'No lleva comisión gestor', t: 'comisión gestor', hecho: 'gestorPagado', aviso: 'Ojo: el gestor ya figura pagado' },
    retrib_aplica: { k: 'aplicaRetrib', no: 'No corresponde retribución', t: 'retribución banco', hecho: 'retribCobrada', aviso: 'Ojo: la retribución ya figura cobrada' }
  };
  C2.toggleAplica = async function (id, campo) {
    if (!C2.puedeEscribir() || !C2.ajOk || !APLICA[campo]) return;
    const r = (RECORDS || []).find(o => String(o.id) === String(id)); if (!r) return;
    const x = C2.calc(r), d = APLICA[campo], si = x[d.k];
    const res = si
      ? await SB.from('c2_ajustes').upsert({ solicitud_id: id, campo, valor: 0, motivo: d.no, usuario: quien(), updated_at: new Date().toISOString() }, { onConflict: 'solicitud_id,campo' })
      : await SB.from('c2_ajustes').delete().eq('solicitud_id', id).eq('campo', campo);
    if (res.error) {
      toast(/check constraint|violates/i.test(res.error.message) ? 'Falta correr c2_ajustes_v2.sql en Supabase' : 'Error: ' + res.error.message, 'er');
      return;
    }
    if (typeof registrarHistorial === 'function') registrarHistorial('c2_ajustes', id, [{ campo: d.t, ant: si ? 'SÍ' : 'NO', nuevo: si ? 'NO' : 'SÍ' }]);
    await cargarAjustes(); C2.render();
    toast((si ? 'Sin ' : 'Con ') + d.t, 'ok');
    if (x[d.hecho]) toast(d.aviso, 'warn');
  };
  C2.toggleGest = id => C2.toggleAplica(id, 'gest_aplica');

  // ── entrada ──
  C2.init = function () {
    if (!C2.puede()) { toast('No tenés permisos para acceder a esta sección', 'warn'); return; }
    C2.render();
    C2.cargar(true);
  };
})();
