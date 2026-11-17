import {
  DATA_CLASSES,
  LOCATIONS,
  SEVERITY_ORDER,
  severityRank,
  type DataClass,
  type Finding,
  type Location,
  type ScanResult,
  type Severity,
  type SourceKind,
} from '../core/types.js';
import { DATA_CLASS_LABEL, LOCATION_LABEL, SEVERITY_LABEL, SOURCE_LABEL, STATUS_LABEL, TAG_LABEL } from './labels.js';

/**
 * Dashboard HTML autocontenido: un solo archivo, sin CDN ni recursos externos.
 *
 * Estructura (de lo general a lo particular):
 *   1. Veredicto del build y KPIs
 *   2. Mapa de exposición: familia del dato × dónde apareció (la misma matriz que define la severidad)
 *   3. Dónde se concentra el riesgo: endpoints y pruebas con más fugas
 *   4. Hallazgos, filtrables
 *
 * Todo se renderiza en el servidor: con la CSP por defecto de Jenkins (sin JS ni estilos
 * en línea) la información sigue completa. El script solo agrega filtros.
 */

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DESC = [...SEVERITY_ORDER].reverse() as Severity[];

function maxSev(list: Finding[]): Severity | undefined {
  return list.reduce<Severity | undefined>((m, f) => (!m || severityRank(f.severity) > severityRank(m) ? f.severity : m), undefined);
}

function whereLabel(f: Finding): string {
  if (f.endpoint) return f.endpoint;
  if (f.location === 'log-line' || f.location === 'screenshot') return `${LOCATION_LABEL[f.location]} · ${f.files[0] ?? ''}`;
  return LOCATION_LABEL[f.location];
}

/* ---------- Bloques ---------- */

function severityBar(result: ScanResult): string {
  const counts = result.stats.newBySeverity;
  const total = DESC.reduce((a, s) => a + counts[s], 0);
  if (!total) return '<div class="sbar empty"><span>Sin hallazgos nuevos</span></div>';
  const segs = DESC.filter((s) => counts[s] > 0)
    .map((s) => `<span class="seg s-${s}" style="flex-grow:${counts[s]}" title="${SEVERITY_LABEL[s]}: ${counts[s]}"></span>`)
    .join('');
  const legend = DESC.map((s) => `<li><i class="dot s-${s}"></i>${SEVERITY_LABEL[s]} <b>${counts[s]}</b></li>`).join('');
  return `<div class="sbar" role="img" aria-label="Distribución de hallazgos nuevos por severidad">${segs}</div><ul class="legend">${legend}</ul>`;
}

function exposureMap(findings: Finding[]): string {
  const active = findings.filter((f) => f.status === 'new');
  const rows = LOCATIONS.filter((loc) => findings.some((f) => f.location === loc));
  if (!rows.length) return '<p class="muted">No hay datos para el mapa.</p>';
  const cols = DATA_CLASSES.filter((c) => findings.some((f) => f.dataClass === c));
  const head = cols.map((c) => `<th scope="col">${DATA_CLASS_LABEL[c]}</th>`).join('');
  const body = rows
    .map((loc) => {
      const cells = cols
        .map((cls) => {
          const here = active.filter((f) => f.location === loc && f.dataClass === cls);
          const known = findings.filter((f) => f.location === loc && f.dataClass === cls && f.status !== 'new').length;
          if (!here.length) {
            return `<td class="cell none">${known ? `<span class="known" title="${known} en baseline o aceptados">${known}</span>` : '<span aria-hidden="true">·</span>'}</td>`;
          }
          const sev = maxSev(here)!;
          return `<td class="cell"><button type="button" class="hit s-${sev}" data-loc="${loc}" data-cls="${cls}" title="${here.length} hallazgo(s) · máxima ${SEVERITY_LABEL[sev]}">${here.length}</button></td>`;
        })
        .join('');
      return `<tr><th scope="row">${esc(LOCATION_LABEL[loc as Location])}</th>${cells}</tr>`;
    })
    .join('');
  return `<div class="mapwrap"><table class="map"><thead><tr><th scope="col"><span class="sr">Ubicación</span></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function hotspots(findings: Finding[], key: (f: Finding) => string[], limit = 7): string {
  const groups = new Map<string, Finding[]>();
  for (const f of findings.filter((x) => x.status === 'new')) {
    for (const k of key(f)) {
      const list = groups.get(k) ?? [];
      list.push(f);
      groups.set(k, list);
    }
  }
  const top = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || severityRank(maxSev(b[1])!) - severityRank(maxSev(a[1])!))
    .slice(0, limit);
  if (!top.length) return '<p class="muted">Sin hallazgos nuevos.</p>';
  const max = top[0]![1].length;
  return `<ol class="hot">${top
    .map(([name, list]) => {
      const sev = maxSev(list)!;
      const pct = Math.max(4, Math.round((list.length / max) * 100));
      return `<li><span class="hname" title="${esc(name)}">${esc(name)}</span><span class="htrack"><span class="hfill s-${sev}" style="width:${pct}%"></span></span><span class="hnum">${list.length}</span></li>`;
    })
    .join('')}</ol>`;
}

function findingCard(f: Finding): string {
  const tags = f.tags
    .map((t) => `<span class="tag${t === 'sobreexpuesto' ? ' hot-tag' : ''}">${esc(TAG_LABEL[t] ?? t)}</span>`)
    .join('');
  const crumbs = [SOURCE_LABEL[f.source], LOCATION_LABEL[f.location], f.endpoint, f.fieldPath]
    .filter(Boolean)
    .map((c, i) => (i >= 2 ? `<code>${esc(c)}</code>` : `<span>${esc(c)}</span>`))
    .join('<i class="sep">›</i>');
  const search = [f.title, f.kind, f.endpoint, f.fieldPath, LOCATION_LABEL[f.location], DATA_CLASS_LABEL[f.dataClass], ...f.tests, ...f.tags]
    .join(' ')
    .toLowerCase();
  return `
<details class="card s-${f.severity} st-${f.status}" data-sev="${f.severity}" data-status="${f.status}" data-loc="${f.location}" data-cls="${f.dataClass}" data-text="${esc(search)}">
  <summary>
    <span class="pill s-${f.severity}">${SEVERITY_LABEL[f.severity]}</span>
    <span class="main">
      <span class="ttl"><strong>${esc(f.title)}</strong>${f.kind ? `<span class="kind">${esc(f.kind)}</span>` : ''}</span>
      <span class="crumbs">${crumbs}</span>
    </span>
    <span class="side">
      <code class="masked">${esc(f.masked)}</code>
      <span class="tags">${tags}${f.status !== 'new' ? `<span class="tag">${STATUS_LABEL[f.status]}</span>` : ''}<span class="tag n">×${f.occurrences}</span></span>
    </span>
  </summary>
  <div class="detail">
    <div class="why">${f.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>
    <div class="todo"><b>Qué hacer</b><p>${esc(f.recommendation)}</p>${f.allowReason ? `<p><b>Aceptado porque:</b> ${esc(f.allowReason)}</p>` : ''}</div>
    <dl>
      ${f.tests.length ? `<dt>Pruebas</dt><dd>${f.tests.map((t) => esc(t)).join('<br>')}</dd>` : ''}
      <dt>Archivos</dt><dd>${f.files.map((x) => `<code>${esc(x)}</code>`).join('<br>')}</dd>
      <dt>Huella</dt><dd><code>${esc(f.fingerprint)}</code></dd>
      <dt>Hash del valor</dt><dd><code>${esc(f.valueHash)}</code></dd>
    </dl>
  </div>
</details>`;
}

/* ---------- Página ---------- */

export function renderHtml(result: ScanResult): string {
  const s = result.stats;
  const fs = result.findings;
  const news = fs.filter((f) => f.status === 'new');
  const failOnLabel = result.failOn === 'none' ? 'ninguno' : SEVERITY_LABEL[result.failOn as Severity];
  const blocking = news.filter((f) => result.failOn !== 'none' && severityRank(f.severity) >= severityRank(result.failOn as Severity)).length;

  const verdict = result.failed
    ? { cls: 'fail', icon: '!', label: 'Hay que revisar antes de publicar', text: `${blocking} fuga(s) nueva(s) de severidad ${failOnLabel.toLowerCase()} o mayor bloquean el build.` }
    : news.length
      ? { cls: 'warn', icon: 'i', label: 'Todo en orden, con detalles por mirar', text: `${news.length} hallazgo(s) nuevo(s) por debajo del umbral. El build pasa.` }
      : { cls: 'pass', icon: '✓', label: '¡Todo limpio!', text: 'Tus pruebas no vieron datos sensibles nuevos fuera de lugar.' };

  const overexposed = news.filter((f) => f.tags.includes('sobreexpuesto')).length;
  const endpoints = new Set(news.filter((f) => f.endpoint).map((f) => f.endpoint)).size;
  const tests = new Set(news.flatMap((f) => f.tests)).size;
  const sources = (Object.entries(s.files) as Array<[SourceKind, number]>)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span>${n} ${esc(SOURCE_LABEL[k])}</span>`)
    .join('');

  const issues = [
    ...result.errors.map((e) => `<li class="err"><b>Error</b> ${esc(e.file)}: ${esc(e.message)}</li>`),
    ...result.warnings.map((w) => `<li>${esc(w)}</li>`),
  ].join('');

  const date = new Date(result.finishedAt);
  const when = `${date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })} · ${date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LeakLens · ${esc(verdict.label)}</title>
<style>
/* Layout: tablero claro y amable — encabezado blanco con veredicto, KPIs, mapa de exposición, focos de riesgo y hallazgos.
   Siempre en tema claro (fondo blanco), también para quien usa el sistema en modo oscuro. */
:root{
  color-scheme:light;
  --bg:#FFFFFF;--surface:#FFFFFF;--sunken:#F5F8F7;--fg:#1D2A27;--muted:#62716D;--line:#E3E9E7;
  --accent:#0E7C6B;--accent-soft:#E6F4F1;
  --s-critical:#D14527;--s-high:#E07F22;--s-medium:#C99A12;--s-low:#4A8FA3;--s-info:#9AA6A2;
  --t-critical:#FDECE7;--t-high:#FDF1E4;--t-medium:#FBF5DF;--t-low:#E8F3F6;--t-info:#F1F4F3;
  --ok:#1F8A5B;--t-ok:#E5F5EC;
  --shadow:0 1px 2px rgba(20,40,35,.04),0 4px 14px rgba(20,40,35,.05);
  --mono:ui-monospace,"Cascadia Mono","SF Mono",Consolas,monospace;
  --sans:"Segoe UI Variable","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
  --display:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,sans-serif;
}
*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--fg);font:14.5px/1.55 var(--sans)}
code{font-family:var(--mono);font-size:12.5px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.wrap{max-width:1180px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.muted{color:var(--muted)}

/* Encabezado */
.band{background:var(--surface);border-bottom:1px solid var(--line);padding-block:20px}
.band .wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center}
.brand{display:grid;gap:4px}
.brand h1{margin:0;font:700 26px/1.1 var(--display);letter-spacing:-.01em}
.brand h1 b{color:var(--accent);font-weight:700}
.brand .hello{font-size:15px;color:var(--fg)}
.brand .meta{color:var(--muted);font-size:12.5px}
.verdict{display:flex;align-items:center;gap:14px;padding:14px 20px;border-radius:16px;max-width:440px}
.verdict.fail{background:var(--t-critical);color:#8A2A15}.verdict.warn{background:var(--t-medium);color:#7A5C05}.verdict.pass{background:var(--t-ok);color:#17663F}
.verdict .light{width:36px;height:36px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font:700 18px/1 var(--sans)}
.verdict.fail .light{background:var(--s-critical)}.verdict.warn .light{background:var(--s-medium)}.verdict.pass .light{background:var(--ok)}
.verdict b{display:block;font:650 16px/1.25 var(--display)}
.verdict span{font-size:13px;opacity:.9}

/* KPIs */
.kpis{display:grid;grid-template-columns:1.4fr repeat(4,minmax(0,1fr));gap:14px;margin-top:24px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px;min-width:0;box-shadow:var(--shadow)}
.kpi .n{display:block;font:650 34px/1 var(--display);font-variant-numeric:tabular-nums}
.kpi .l{display:block;color:var(--muted);font-size:13px;margin-top:6px}
.kpi .h{display:block;color:var(--muted);font-size:12px;margin-top:2px;opacity:.85}
.kpi.lead .n{font-size:44px}
.kpi.crit .n{color:var(--s-critical)}.kpi.over .n{color:var(--s-high)}
.sbar{display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px;margin-top:12px;background:var(--sunken)}
.sbar.empty{align-items:center;justify-content:center;height:auto;padding:6px;font-size:12px;color:var(--muted)}
.seg{display:block;min-width:6px}
.legend{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted)}
.legend b{color:var(--fg);font-variant-numeric:tabular-nums}
.dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:1px}
.s-critical{--c:var(--s-critical);--t:var(--t-critical)}.s-high{--c:var(--s-high);--t:var(--t-high)}.s-medium{--c:var(--s-medium);--t:var(--t-medium)}.s-low{--c:var(--s-low);--t:var(--t-low)}.s-info{--c:var(--s-info);--t:var(--t-info)}
.seg,.dot,.hfill{background:var(--c)}

.facts{display:flex;flex-wrap:wrap;gap:4px 18px;color:var(--muted);font-size:12.5px;margin:14px 2px 0}
.facts b{color:var(--fg);font-weight:600}
.facts .src span+span::before{content:" · "}
.issues{margin:14px 0 0;padding:10px 14px 10px 30px;background:var(--t-medium);border-radius:10px;font-size:13px}.issues .err{color:var(--s-critical)}

/* Secciones */
section{margin-top:30px}
.sec-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.sec-h h2{margin:0;font:650 20px/1.2 var(--display)}
.sec-h p{margin:0;color:var(--muted);font-size:13px;max-width:70ch}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px;min-width:0;box-shadow:var(--shadow)}
.grid2{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;align-items:start}
.stack{display:grid;gap:16px;min-width:0}
.panel h3{margin:0 0 14px;font:600 14.5px/1.2 var(--sans);color:var(--fg)}

/* Mapa */
.mapwrap{overflow-x:auto}
.map{border-collapse:separate;border-spacing:4px;width:100%;font-size:13px}
.map th{font-weight:600;color:var(--muted);font-size:12px;text-align:center;padding:2px 4px;white-space:nowrap}
.map tbody th{text-align:right;padding-right:10px;color:var(--fg);font-weight:500}
.cell{padding:0;text-align:center;height:38px;min-width:64px}
.cell.none{background:var(--sunken);border-radius:7px;color:var(--muted)}
.known{font-size:11px;color:var(--muted)}
.hit{width:100%;height:38px;border:0;border-radius:7px;cursor:pointer;font:600 15px/1 var(--mono);background:var(--t);color:var(--c);box-shadow:inset 0 0 0 1.5px var(--c);transition:transform .12s}
.hit:hover{transform:translateY(-1px)}
.hit.on{background:var(--c);color:var(--surface)}
.hit:focus-visible,.chip:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.maplegend{margin:10px 0 0;font-size:12px;color:var(--muted)}

/* Focos */
.hot{list-style:none;margin:0;padding:0;display:grid;gap:9px}
.hot li{display:grid;grid-template-columns:minmax(0,1fr) 34%  28px;gap:10px;align-items:center;font-size:12.5px}
.hname{font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.htrack{height:8px;background:var(--sunken);border-radius:4px;overflow:hidden}
.hfill{display:block;height:100%;border-radius:4px}
.hnum{text-align:right;font:600 13px var(--mono);font-variant-numeric:tabular-nums}

/* Filtros */
.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.toolbar input[type=search]{flex:1 1 240px;min-width:0;padding:8px 12px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--fg);font:inherit}
.chip{display:inline-flex;gap:6px;align-items:center;padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--fg);font:500 12.5px var(--sans);cursor:pointer}
.chip[aria-pressed=false]{opacity:.45}
.chip .dot{margin:0}
.chip.reset{color:var(--muted)}
.active-filter{font-size:12.5px;color:var(--muted)}
.active-filter b{color:var(--fg)}

/* Tarjetas */
.cards{display:grid;gap:8px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;position:relative;overflow:hidden;box-shadow:var(--shadow)}
.card[open]{border-color:var(--c)}
.card::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--c)}
.card.st-baselined,.card.st-allowed{opacity:.62}
summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:80px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 16px 12px 18px}
summary::-webkit-details-marker{display:none}
.pill{font:650 12px/1 var(--sans);text-align:center;padding:7px 0;border-radius:999px;background:var(--t);color:var(--c)}
.main{min-width:0;display:grid;gap:4px}
.ttl strong{font-weight:600}.kind{margin-left:8px;color:var(--muted);font-size:13px}
.crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;color:var(--muted);font-size:12.5px;min-width:0}
.crumbs code{background:var(--sunken);padding:1px 6px;border-radius:4px;overflow-wrap:anywhere;color:var(--fg)}
.sep{font-style:normal;opacity:.5}
.side{display:grid;justify-items:end;gap:6px}
.masked{background:var(--sunken);border:1px solid var(--line);padding:4px 9px;border-radius:6px;white-space:nowrap;font-size:13px}
.tags{display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end}
.tag{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.tag.n{font-family:var(--mono)}
.hot-tag{background:var(--t-high);color:var(--s-high);border-color:transparent;font-weight:600}
.detail{border-top:1px solid var(--line);padding:14px 18px 16px 112px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 24px}
.why p{margin:0 0 8px}
.todo{background:var(--sunken);border-radius:8px;padding:10px 12px;font-size:13.5px}.todo p{margin:4px 0 0}
dl{grid-column:1/-1;display:grid;grid-template-columns:120px minmax(0,1fr);gap:4px 12px;margin:6px 0 0;font-size:12.5px}
dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}
.none-msg{padding:28px;text-align:center;color:var(--muted);background:var(--surface);border:1px dashed var(--line);border-radius:10px}

footer{margin:40px 0 50px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;display:flex;flex-wrap:wrap;gap:6px 24px;justify-content:space-between}

@media (max-width:900px){
  .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi.lead{grid-column:1/-1}
  .grid2{grid-template-columns:minmax(0,1fr)}
  .band .wrap{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:640px){
  summary{grid-template-columns:minmax(0,1fr)}.pill{justify-self:start;padding:5px 10px}
  .side{justify-items:start}.tags{justify-content:flex-start}
  .detail{padding-left:18px;grid-template-columns:minmax(0,1fr)}
  dl{grid-template-columns:minmax(0,1fr)}
}
@media (prefers-reduced-motion:reduce){.hit{transition:none}}
</style>
</head>
<body>
<header class="band">
  <div class="wrap">
    <div class="brand">
      <h1>Leak<b>Lens</b></h1>
      <span class="hello">Esto es lo que tus pruebas vieron en esta ejecución.</span>
      <span class="meta">${esc(when)} · umbral ${esc(failOnLabel)} · países ${esc(result.countries.map((c) => c.toUpperCase()).join(' y '))} · v${esc(result.tool.version)}</span>
    </div>
    <div class="verdict ${verdict.cls}" role="status"><span class="light" aria-hidden="true">${verdict.icon}</span><div><b>${esc(verdict.label)}</b><span>${esc(verdict.text)}</span></div></div>
  </div>
</header>

<main class="wrap">
  <div class="kpis">
    <div class="kpi lead"><span class="n">${news.length}</span><span class="l">Fugas nuevas en esta ejecución</span>${severityBar(result)}</div>
    <div class="kpi crit"><span class="n">${s.newBySeverity.critical}</span><span class="l">Críticas</span><span class="h">Atiéndelas primero</span></div>
    <div class="kpi over"><span class="n">${overexposed}</span><span class="l">Sobreexpuestas</span><span class="h">La API envía de más</span></div>
    <div class="kpi"><span class="n">${endpoints}</span><span class="l">Endpoints afectados</span><span class="h">Con al menos una fuga</span></div>
    <div class="kpi"><span class="n">${tests}</span><span class="l">Pruebas con fugas</span><span class="h">Donde se detectaron</span></div>
  </div>
  <div class="facts">
    <span class="src">Analizado: ${sources || 'ninguna fuente'}</span>
    <span><b>${s.evidences.toLocaleString('es-PE')}</b> evidencias</span>
    <span>En baseline <b>${s.byStatus.baselined}</b></span>
    <span>Aceptados <b>${s.byStatus.allowed}</b></span>
    <span>Duración <b>${(result.durationMs / 1000).toFixed(1)} s</b></span>
  </div>
  ${issues ? `<ul class="issues">${issues}</ul>` : ''}

  <section aria-labelledby="h-map">
    <div class="sec-h"><h2 id="h-map">Mapa de exposición</h2><p>Qué tipo de dato apareció y dónde. Cada celda cuenta hallazgos nuevos y toma el color del más grave. Haz clic para filtrar.</p></div>
    <div class="grid2">
      <div class="panel">${exposureMap(fs)}<p class="maplegend">Los números grises son hallazgos en baseline o aceptados.</p></div>
      <div class="stack">
        <div class="panel"><h3>Endpoints con más fugas</h3>${hotspots(fs, (f) => [whereLabel(f)])}</div>
        <div class="panel"><h3>Pruebas con más fugas</h3>${hotspots(fs, (f) => f.tests, 5)}</div>
      </div>
    </div>
  </section>

  <section aria-labelledby="h-list">
    <div class="sec-h"><h2 id="h-list">Hallazgos</h2><p>Ordenados por estado y severidad. Abre uno para ver por qué importa y qué hacer.</p></div>
    <div class="toolbar" id="toolbar" hidden>
      <input type="search" id="q" placeholder="Buscar endpoint, campo, prueba…" aria-label="Buscar hallazgos">
      ${DESC.map((sev) => `<button type="button" class="chip s-${sev}" data-sev="${sev}" aria-pressed="true"><i class="dot"></i>${SEVERITY_LABEL[sev]}</button>`).join('')}
      <button type="button" class="chip" id="known" aria-pressed="false">Baseline y aceptados</button>
      <button type="button" class="chip reset" id="reset">Limpiar</button>
      <span class="active-filter" id="cellFilter" hidden></span>
    </div>
    <div class="cards">
      ${fs.length ? fs.map(findingCard).join('') : '<div class="none-msg">No hay hallazgos. Tus pruebas no vieron datos sensibles fuera de lugar.</div>'}
    </div>
    <p class="none-msg" id="empty" hidden>Ningún hallazgo coincide con los filtros.</p>
  </section>

  <footer>
    <span>LeakLens nunca escribe valores completos: verás datos enmascarados y hashes HMAC.</span>
    <span>Las huellas son estables entre ejecuciones y alimentan el baseline.</span>
  </footer>
</main>

<script>
(function(){
  var bar=document.getElementById('toolbar'); if(!bar) return; bar.hidden=false;
  var cards=[].slice.call(document.querySelectorAll('.card'));
  var hits=[].slice.call(document.querySelectorAll('.hit'));
  var q=document.getElementById('q'), known=document.getElementById('known'), empty=document.getElementById('empty'), cf=document.getElementById('cellFilter');
  var LOC=${JSON.stringify(LOCATION_LABEL)}, CLS=${JSON.stringify(DATA_CLASS_LABEL)};
  var cell=null;
  function sevOn(){var o={};[].forEach.call(bar.querySelectorAll('[data-sev]'),function(b){o[b.dataset.sev]=b.getAttribute('aria-pressed')==='true';});return o;}
  function apply(){
    var sev=sevOn(), t=q.value.trim().toLowerCase(), showKnown=known.getAttribute('aria-pressed')==='true', n=0;
    cards.forEach(function(c){
      var ok=sev[c.dataset.sev] && (showKnown||c.dataset.status==='new') && (!t||c.dataset.text.indexOf(t)>=0) && (!cell||(c.dataset.loc===cell.loc&&c.dataset.cls===cell.cls));
      c.hidden=!ok; if(ok) n++;
    });
    hits.forEach(function(h){h.classList.toggle('on',!!cell&&h.dataset.loc===cell.loc&&h.dataset.cls===cell.cls);});
    cf.hidden=!cell; if(cell) cf.innerHTML='Mostrando <b>'+CLS[cell.cls]+'</b> en <b>'+LOC[cell.loc]+'</b>';
    empty.hidden=n>0||cards.length===0;
  }
  bar.addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b) return;
    if(b.id==='reset'){cell=null;q.value='';[].forEach.call(bar.querySelectorAll('[data-sev]'),function(x){x.setAttribute('aria-pressed','true');});known.setAttribute('aria-pressed','false');}
    else b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')==='true'?'false':'true');
    apply();
  });
  hits.forEach(function(h){h.addEventListener('click',function(){
    cell=(cell&&cell.loc===h.dataset.loc&&cell.cls===h.dataset.cls)?null:{loc:h.dataset.loc,cls:h.dataset.cls};
    apply(); if(cell) document.getElementById('h-list').scrollIntoView({behavior:'smooth',block:'start'});
  });});
  q.addEventListener('input',apply);
  apply();
})();
</script>
</body>
</html>
`;
}
