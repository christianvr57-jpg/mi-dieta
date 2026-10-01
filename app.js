/* Mi Dieta – interfaz. Los cálculos viven en calc.js y la IA en ai.js. */
(function () {
  'use strict';
  const C = window.Calc;
  const AI = window.AI;

  // ---------- Utilidades ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MINUS = '−';
  const fmt = (n) => Math.round(n).toLocaleString('es-ES');
  const signed = (n) => (n < 0 ? MINUS : '+') + fmt(Math.abs(n));

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  function longDate(s) {
    return cap(parseDate(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  }
  function shortDate(s) {
    return cap(parseDate(s).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }));
  }

  const store = {
    get(k, d) {
      try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { toast('No se pudo guardar en el dispositivo'); return false; }
    },
  };

  // ---------- Estado ----------
  const MEAL_PRESETS = {
    3: [['Desayuno', '09:00'], ['Comida', '14:00'], ['Cena', '21:00']],
    4: [['Desayuno', '09:00'], ['Comida', '14:00'], ['Merienda', '18:00'], ['Cena', '21:00']],
    5: [['Desayuno', '09:00'], ['Media mañana', '11:30'], ['Comida', '14:00'], ['Merienda', '18:00'], ['Cena', '21:00']],
    6: [['Desayuno', '09:00'], ['Media mañana', '11:30'], ['Comida', '14:00'], ['Merienda', '18:00'], ['Cena', '21:00'], ['Recena', '22:30']],
  };
  const presetMeals = (n) => MEAL_PRESETS[n].map(([nombre, hora]) => ({ nombre, hora }));

  const DEFAULT_PROFILE = {
    edad: 32, sexo: 'hombre', altura: 184, peso: 81,
    objetivo: 'ganar', superavit: 275, proteinaKg: 2.0, factorActividad: 1.3,
    despertar: '07:30', dormir: '23:00',
    comidas: presetMeals(5),
    excluidos: '',
    suplementos: {
      proteina: true, proteinaScoopG: 30, proteinaKcal: 120, proteinaPro: 24, proteinaHc: 2, proteinaGrasa: 2,
      creatina: true, creatinaG: 5,
    },
    apiKey: '', modelo: AI.DEFAULT_MODEL,
    pesoHistorial: [],
  };

  let profile = store.get('nutri.profile', null);
  let history = store.get('nutri.history', []);
  let drafts = store.get('nutri.drafts', {});
  const state = {
    view: profile ? 'dia' : 'perfil',
    editing: !profile,
    date: todayStr(),
    current: null,       // fecha de la dieta que se muestra en Resultado
    swapping: -1,
    sheet: null,         // formulario de entreno
    draftMeals: null,    // filas de comidas mientras se edita el perfil
  };

  const saveProfile = () => store.set('nutri.profile', profile);
  const saveHistory = () => store.set('nutri.history', history);
  const saveDrafts = () => store.set('nutri.drafts', drafts);
  const workoutsOf = (date) => (drafts[date] || []).slice().sort((a, b) => C.toMinutes(a.start) - C.toMinutes(b.start));
  const entryOf = (date) => history.find((e) => e.date === date);

  // ---------- UI base ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function setBusy(text) {
    $('#busyText').textContent = text || '';
    $('#busy').classList.toggle('show', !!text);
  }
  function openSheet(html) {
    $('#sheet').innerHTML = '<div class="grab"></div>' + html;
    $('#sheet').classList.add('show');
    $('#overlay').classList.add('show');
  }
  function closeSheet() {
    $('#sheet').classList.remove('show');
    $('#overlay').classList.remove('show');
    state.sheet = null;
  }
  function dialog(title, message, buttons) {
    openSheet(
      '<h2>' + esc(title) + '</h2><p class="muted" style="margin:6px 0 16px">' + esc(message) + '</p><div class="btn-row">' +
      buttons.map((b, i) => '<button class="btn ' + (b.kind || '') + '" data-action="dialog" data-i="' + i + '">' + esc(b.label) + '</button>').join('') +
      '</div>'
    );
    dialog.buttons = buttons;
  }
  const errorDialog = (message) => dialog('No se pudo completar', message, [{ label: 'Entendido', kind: 'primary', run: closeSheet }]);

  const TABS = [
    { id: 'perfil', label: 'Perfil', svg: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>' },
    { id: 'dia', label: 'Mi día', svg: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
    { id: 'resultado', label: 'Dieta', svg: '<path d="M7 3v8a3 3 0 0 0 3 3v7M10 3v6M4 3v6a3 3 0 0 0 3 3M17 21V3c-2.5 1.5-4 4.5-4 8h4"/>' },
    { id: 'historial', label: 'Historial', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  ];
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map((t) =>
      '<button data-action="tab" data-id="' + t.id + '" aria-current="' + (state.view === t.id) + '"><svg viewBox="0 0 24 24">' + t.svg + '</svg>' + t.label + '</button>'
    ).join('');
  }
  function setHeader(title, sub) {
    $('#title').textContent = title;
    $('#subtitle').textContent = sub || '';
  }

  function render(keepScroll) {
    renderTabs();
    const app = $('#app');
    if (state.view === 'perfil') app.innerHTML = state.editing ? viewProfileForm() : viewProfile();
    else if (state.view === 'dia') app.innerHTML = viewDay();
    else if (state.view === 'resultado') app.innerHTML = viewResult();
    else app.innerHTML = viewHistory();
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function go(view) {
    if (!profile && view !== 'perfil') { toast('Primero completa tu perfil'); view = 'perfil'; }
    state.view = view;
    if (view === 'perfil' && profile) state.editing = false;
    render();
  }

  // ---------- Pantalla 1: Perfil ----------
  function viewProfile() {
    setHeader('Mi perfil', 'Se guarda en este dispositivo');
    const p = profile;
    const basal = Math.round(C.bmr(p));
    const s = p.suplementos;
    return (
      '<div class="card"><h3>Peso actual</h3>' +
      '<div class="btn-row" style="align-items:center"><input type="number" id="quickPeso" inputmode="decimal" step="0.1" value="' + esc(p.peso) + '" aria-label="Peso en kg" style="flex:1.2">' +
      '<button class="btn primary" data-action="save-weight" style="flex:1">Actualizar</button></div>' +
      '<p class="muted small" style="margin-top:8px">Pésate en ayunas y a diario o 3 veces por semana; revisa la media cada 2 semanas.</p>' +
      (p.pesoHistorial.length
        ? '<p class="muted small" style="margin-top:6px">Últimos: ' + p.pesoHistorial.slice(-5).reverse().map((h) => shortDate(h.fecha) + ' · ' + h.peso + ' kg').join(' — ') + '</p>'
        : '') +
      '</div>' +
      '<div class="card"><h3>Datos</h3>' +
      kv('Edad', p.edad + ' años') + kv('Sexo', p.sexo === 'mujer' ? 'Mujer' : 'Hombre') + kv('Altura', p.altura + ' cm') +
      kv('Metabolismo basal (Mifflin-St Jeor)', fmt(basal) + ' kcal') +
      kv('Actividad diaria', '×' + p.factorActividad) + '</div>' +
      '<div class="card"><h3>Objetivo</h3>' +
      kv('Meta', p.objetivo === 'mantener' ? 'Mantener peso' : 'Ganar masa muscular') +
      kv('Superávit diario', '+' + p.superavit + ' kcal') + kv('Proteína', p.proteinaKg + ' g/kg') + '</div>' +
      '<div class="card"><h3>Rutina y comidas</h3>' +
      kv('Se levanta / acuesta', p.despertar + ' / ' + p.dormir) +
      p.comidas.map((m) => kv(m.nombre, m.hora)).join('') + '</div>' +
      '<div class="card"><h3>Alimentación</h3>' +
      kv('No toma', p.excluidos.trim() || 'Tolera todo') +
      kv('Batido 226ERS vainilla', s.proteina ? s.proteinaScoopG + ' g · ' + s.proteinaPro + ' g prot.' : 'No') +
      kv('Creatina', s.creatina ? s.creatinaG + ' g/día' : 'No') + '</div>' +
      '<div class="card"><h3>Inteligencia artificial</h3>' +
      kv('API key', p.apiKey ? '••••' + esc(p.apiKey.slice(-4)) : '<span class="neg">Falta</span>') + kv('Modelo', esc(p.modelo)) + '</div>' +
      '<button class="btn xl primary" data-action="edit-profile">Editar perfil</button>'
    );
  }
  function kv(k, v) { return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>'; }

  function mealRowsHtml(rows) {
    return rows.map((m, i) =>
      '<div class="mealrow"><input type="text" id="mn' + i + '" value="' + esc(m.nombre) + '" aria-label="Nombre de la comida ' + (i + 1) + '">' +
      '<input type="time" id="mh' + i + '" value="' + esc(m.hora) + '" aria-label="Hora de la comida ' + (i + 1) + '"></div>'
    ).join('');
  }
  function viewProfileForm() {
    setHeader(profile ? 'Editar perfil' : 'Bienvenido', profile ? '' : 'Rellena tu perfil una vez');
    const p = profile ? JSON.parse(JSON.stringify(profile)) : JSON.parse(JSON.stringify(DEFAULT_PROFILE));
    if (!state.draftMeals) state.draftMeals = p.comidas;
    const s = p.suplementos;
    const chk = (v) => (v ? 'checked' : '');
    const opt = (v, cur, label) => '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>';
    return (
      '<form id="profileForm" autocomplete="off" novalidate>' +
      '<div class="card"><h3>Datos personales</h3>' +
      '<div class="grid2"><label class="field"><span>Edad</span><input type="number" id="edad" inputmode="numeric" value="' + esc(p.edad) + '"></label>' +
      '<label class="field"><span>Sexo</span><select id="sexo">' + opt('hombre', p.sexo, 'Hombre') + opt('mujer', p.sexo, 'Mujer') + '</select></label>' +
      '<label class="field"><span>Altura (cm)</span><input type="number" id="altura" inputmode="numeric" value="' + esc(p.altura) + '"></label>' +
      '<label class="field"><span>Peso actual (kg)</span><input type="number" id="peso" inputmode="decimal" step="0.1" value="' + esc(p.peso) + '"></label></div>' +
      '<label class="field"><span>Actividad diaria (sin contar entrenos)</span><select id="factor">' +
      C.ACTIVITY_FACTORS.map((f) => opt(f.value, p.factorActividad, f.label)).join('') + '</select></label></div>' +

      '<div class="card"><h3>Objetivo</h3>' +
      '<label class="field"><span>Meta</span><select id="objetivo">' + opt('ganar', p.objetivo, 'Ganar masa muscular') + opt('mantener', p.objetivo, 'Mantener peso (sin superávit)') + '</select></label>' +
      '<div class="grid2"><label class="field"><span>Superávit (kcal/día)</span><input type="number" id="superavit" inputmode="numeric" value="' + esc(p.superavit) + '"></label>' +
      '<label class="field"><span>Proteína (g/kg)</span><input type="number" id="proteinaKg" inputmode="decimal" step="0.1" value="' + esc(p.proteinaKg) + '"></label></div>' +
      '<p class="muted small hint" style="margin-top:6px">Superávit ligero recomendado: 250–300 kcal. Proteína entre 1,8 y 2,2 g/kg.</p></div>' +

      '<div class="card"><h3>Rutina</h3><div class="grid2">' +
      '<label class="field"><span>Me levanto</span><input type="time" id="despertar" value="' + esc(p.despertar) + '"></label>' +
      '<label class="field"><span>Me acuesto</span><input type="time" id="dormir" value="' + esc(p.dormir) + '"></label></div></div>' +

      '<div class="card"><h3>Comidas</h3>' +
      '<label class="field"><span>Nº de comidas al día</span><select id="nComidas">' +
      [3, 4, 5, 6].map((n) => opt(n, state.draftMeals.length, n + ' comidas')).join('') + '</select></label>' +
      '<div id="mealRows">' + mealRowsHtml(state.draftMeals) + '</div>' +
      '<p class="muted small" style="margin-top:8px">Horarios aproximados: la dieta los adapta a tus entrenos.</p></div>' +

      '<div class="card"><h3>Alimentos y suplementos</h3>' +
      '<label class="field"><span>Alimentos que no tomo o no tolero</span><textarea id="excluidos" placeholder="Déjalo vacío si toleras todo">' + esc(p.excluidos) + '</textarea></label>' +
      '<label class="switch"><span>Batido de proteína 226ERS vainilla</span><input type="checkbox" id="proteina" ' + chk(s.proteina) + '></label>' +
      '<div class="grid2"><label class="field"><span>1 scoop (g)</span><input type="number" id="pScoop" inputmode="decimal" value="' + esc(s.proteinaScoopG) + '"></label>' +
      '<label class="field"><span>Kcal / scoop</span><input type="number" id="pKcal" inputmode="decimal" value="' + esc(s.proteinaKcal) + '"></label>' +
      '<label class="field"><span>Proteína (g)</span><input type="number" id="pPro" inputmode="decimal" value="' + esc(s.proteinaPro) + '"></label>' +
      '<label class="field"><span>Hidratos (g)</span><input type="number" id="pHc" inputmode="decimal" value="' + esc(s.proteinaHc) + '"></label>' +
      '<label class="field"><span>Grasa (g)</span><input type="number" id="pGrasa" inputmode="decimal" value="' + esc(s.proteinaGrasa) + '"></label></div>' +
      '<p class="muted small" style="margin-top:6px">Valores orientativos: cámbialos por los de la etiqueta de tu bote.</p>' +
      '<label class="switch"><span>Creatina diaria</span><input type="checkbox" id="creatina" ' + chk(s.creatina) + '></label>' +
      '<label class="field"><span>Dosis de creatina (g)</span><input type="number" id="cDosis" inputmode="decimal" step="0.5" value="' + esc(s.creatinaG) + '"></label></div>' +

      '<div class="card"><h3>Inteligencia artificial</h3>' +
      '<label class="field"><span>API key de Anthropic</span><input type="password" id="apiKey" value="' + esc(p.apiKey) + '" placeholder="sk-ant-…" autocapitalize="off" autocorrect="off" spellcheck="false">' +
      '<p class="muted hint">Se guarda solo en este iPhone y se envía únicamente a Anthropic. Usa una clave con límite de gasto.</p></label>' +
      '<label class="field"><span>Modelo</span><input type="text" id="modelo" value="' + esc(p.modelo) + '" autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>' +

      '<div class="btn-row"><button type="button" class="btn xl primary" data-action="save-profile">Guardar</button>' +
      (profile ? '<button type="button" class="btn xl" data-action="cancel-profile">Cancelar</button>' : '') + '</div></form>'
    );
  }

  function readMealRows() {
    const n = $('#nComidas') ? Number($('#nComidas').value) : state.draftMeals.length;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const nombre = $('#mn' + i), hora = $('#mh' + i);
      rows.push(nombre ? { nombre: nombre.value.trim() || 'Comida ' + (i + 1), hora: hora.value } : null);
    }
    return rows;
  }
  function changeMealCount() {
    const n = Number($('#nComidas').value);
    const cur = readMealRows().filter(Boolean);
    const preset = presetMeals(n);
    // Si cambia el número, usamos los horarios por defecto de ese número, conservando lo ya editado si coincide.
    state.draftMeals = cur.length === n ? cur : preset;
    $('#mealRows').innerHTML = mealRowsHtml(state.draftMeals);
  }

  function submitProfile() {
    const val = (id) => $('#' + id).value;
    const n = (id) => Number(val(id).replace(',', '.'));
    const p = {
      edad: n('edad'), sexo: val('sexo'), altura: n('altura'), peso: n('peso'),
      objetivo: val('objetivo'), superavit: n('superavit'), proteinaKg: n('proteinaKg'), factorActividad: n('factor'),
      despertar: val('despertar'), dormir: val('dormir'),
      comidas: readMealRows().filter(Boolean),
      excluidos: val('excluidos'),
      suplementos: {
        proteina: $('#proteina').checked, proteinaScoopG: n('pScoop'), proteinaKcal: n('pKcal'), proteinaPro: n('pPro'),
        proteinaHc: n('pHc'), proteinaGrasa: n('pGrasa'),
        creatina: $('#creatina').checked, creatinaG: n('cDosis'),
      },
      apiKey: val('apiKey').trim(), modelo: val('modelo').trim() || AI.DEFAULT_MODEL,
      pesoHistorial: profile ? profile.pesoHistorial : [],
    };
    const bad = (cond, msg) => { if (cond) { toast(msg); return true; } return false; };
    if (bad(!(p.edad >= 14 && p.edad <= 90), 'Revisa la edad')) return;
    if (bad(!(p.altura >= 120 && p.altura <= 230), 'Revisa la altura (cm)')) return;
    if (bad(!(p.peso >= 35 && p.peso <= 200), 'Revisa el peso (kg)')) return;
    if (bad(!/^\d{2}:\d{2}$/.test(p.despertar) || !/^\d{2}:\d{2}$/.test(p.dormir), 'Indica la hora de levantarte y acostarte')) return;
    if (bad(p.comidas.some((m) => !/^\d{2}:\d{2}$/.test(m.hora)), 'Indica la hora de todas las comidas')) return;
    if (bad(!(p.superavit >= 0 && p.superavit <= 800), 'El superávit debe estar entre 0 y 800 kcal')) return;
    if (bad(!(p.proteinaKg >= 1.8 && p.proteinaKg <= 2.2), 'La proteína debe estar entre 1,8 y 2,2 g/kg')) return;
    if (p.objetivo === 'mantener') p.superavit = 0;
    p.comidas.sort((a, b) => C.toMinutes(a.hora) - C.toMinutes(b.hora));
    if (!profile || profile.peso !== p.peso) logWeight(p, p.peso);
    profile = p;
    saveProfile();
    state.editing = false;
    state.draftMeals = null;
    toast('Perfil guardado');
    go(p.apiKey ? 'dia' : 'perfil');
    if (!p.apiKey) toast('Falta la API key para generar dietas');
  }
  function logWeight(p, peso) {
    const hoy = todayStr();
    p.pesoHistorial = p.pesoHistorial.filter((h) => h.fecha !== hoy);
    p.pesoHistorial.push({ fecha: hoy, peso });
    p.pesoHistorial = p.pesoHistorial.slice(-60);
  }

  // ---------- Pantalla 2: Mi día ----------
  function workoutDesc(w) {
    let t = C.SPORT_LABEL[w.sport];
    if (w.sport === 'running') {
      t += ' · ' + C.RUN_TYPE_LABEL[w.runType].toLowerCase();
      if (w.distance) t += ' · ' + String(w.distance).replace('.', ',') + ' km';
    }
    return t;
  }
  function viewDay() {
    const d = state.date;
    setHeader('Mi día', longDate(d));
    const ws = workoutsOf(d);
    const plan = C.dayPlan(profile, ws);
    const existing = entryOf(d);
    let html =
      '<div class="card"><label class="field"><span>Fecha</span><input type="date" id="dateInput" value="' + d + '"></label></div>' +
      '<h2 class="section">Entrenos</h2>';
    if (!ws.length) {
      html += '<div class="card center"><div style="font-size:34px">😴</div><p><b>Día de descanso</b></p><p class="muted small">Sin entrenos añadidos.</p></div>';
    } else {
      html += '<div>' + ws.map((w, i) => {
        const fin = C.toHHMM(C.toMinutes(w.start) + w.duration);
        return '<div class="workout"><div class="ico">' + C.SPORT_ICON[w.sport] + '</div><div class="grow"><div class="t">' + esc(workoutDesc(w)) + '</div>' +
          '<div class="s">' + w.start + '–' + fin + ' · ' + w.duration + ' min · intensidad ' + C.INTENSITY_LABEL[w.intensity] + '</div></div>' +
          '<button class="iconbtn" data-action="edit-workout" data-id="' + w.id + '" aria-label="Editar entreno">✏️</button></div>';
      }).join('') + '</div>';
    }
    html += '<button class="btn soft" data-action="add-workout" style="margin-top:12px">＋ Añadir entreno</button>';

    html +=
      '<h2 class="section">Objetivo estimado</h2><div class="card"><div class="stat-grid">' +
      '<div class="stat"><div class="n">' + fmt(plan.kcal) + '</div><div class="l">kcal objetivo</div></div>' +
      '<div class="stat"><div class="n">' + fmt(plan.gasto) + '</div><div class="l">kcal de gasto</div></div>' +
      '<div class="stat"><div class="n">' + plan.hc + ' g</div><div class="l">hidratos · ' + plan.carbPerKg + ' g/kg</div></div>' +
      '<div class="stat"><div class="n">' + plan.pro + ' g</div><div class="l">proteína</div></div>' +
      '<div class="stat"><div class="n">' + plan.grasa + ' g</div><div class="l">grasa</div></div>' +
      '<div class="stat"><div class="n">' + esc(plan.carga) + '</div><div class="l">carga del día</div></div></div>' +
      '<p class="muted small" style="margin-top:10px">Basal ' + fmt(plan.basal) + ' + actividad ' + fmt(plan.actividadDiaria) + ' + entrenos ' + fmt(plan.entrenoNeto) + ' + superávit ' + fmt(plan.superavit) + ' kcal.</p></div>';

    if (existing) {
      html += '<div class="banner ok">Ya generaste la dieta de este día. <a href="#" data-action="open-entry" data-date="' + d + '" style="color:inherit;font-weight:700">Verla</a> o genera una nueva.</div>';
    }
    html += '<button class="btn xl primary" data-action="generate">Generar mi dieta</button>';
    return html;
  }

  function sheetWorkout() {
    const w = state.sheet;
    const seg = (field, options, cls) =>
      '<div class="seg ' + (cls || '') + '">' + options.map(([v, label, ico]) =>
        '<button type="button" data-action="sheet-set" data-field="' + field + '" data-value="' + v + '" aria-pressed="' + (w[field] === v) + '">' +
        (ico ? '<span class="ico">' + ico + '</span>' : '') + label + '</button>').join('') + '</div>';
    const isRun = w.sport === 'running';
    openSheet(
      '<h2>' + (w.id ? 'Editar entreno' : 'Añadir entreno') + '</h2>' +
      '<label class="field"><span>Deporte</span>' +
      seg('sport', Object.keys(C.SPORT_LABEL).map((k) => [k, C.SPORT_LABEL[k], C.SPORT_ICON[k]]), 'sports') + '</label>' +
      '<div class="grid2"><label class="field"><span>Hora de inicio</span><input type="time" data-sheet-field="start" value="' + esc(w.start) + '"></label>' +
      '<label class="field"><span>Duración (min)</span><input type="number" inputmode="numeric" data-sheet-field="duration" value="' + esc(w.duration) + '"></label></div>' +
      '<div class="chips">' + [30, 45, 60, 75, 90, 120].map((m) => '<button type="button" class="chip" data-action="sheet-duration" data-m="' + m + '">' + m + '′</button>').join('') + '</div>' +
      '<label class="field"><span>Intensidad</span>' + seg('intensity', [['suave', 'Suave'], ['media', 'Media'], ['alta', 'Alta']]) + '</label>' +
      (isRun
        ? '<label class="field"><span>Tipo de carrera</span>' + seg('runType', [['rodaje', 'Rodaje'], ['series', 'Series'], ['tirada', 'Tirada larga']]) + '</label>' +
          '<label class="field"><span>Distancia (km, opcional)</span><input type="number" inputmode="decimal" step="0.1" data-sheet-field="distance" value="' + esc(w.distance) + '"></label>'
        : '') +
      '<div class="btn-row" style="margin-top:18px">' +
      (w.id ? '<button type="button" class="btn danger" data-action="delete-workout">Eliminar</button>' : '<button type="button" class="btn" data-action="close-sheet">Cancelar</button>') +
      '<button type="button" class="btn primary" data-action="save-workout">Guardar</button></div>'
    );
  }
  function newWorkout() {
    const ws = workoutsOf(state.date);
    const last = ws[ws.length - 1];
    return {
      id: null, sport: 'gimnasio',
      start: last ? C.toHHMM(C.toMinutes(last.start) + last.duration + 120) : '18:00',
      duration: 60, intensity: 'media', runType: 'rodaje', distance: '',
    };
  }
  function saveWorkout() {
    const w = state.sheet;
    const dur = Math.round(Number(w.duration));
    if (!/^\d{2}:\d{2}$/.test(w.start)) return toast('Indica la hora de inicio');
    if (!(dur >= 5 && dur <= 480)) return toast('La duración debe estar entre 5 y 480 min');
    const out = {
      id: w.id || 'w' + Date.now().toString(36),
      sport: w.sport, start: w.start, duration: dur, intensity: w.intensity,
      runType: w.sport === 'running' ? w.runType : null,
      distance: w.sport === 'running' && Number(w.distance) > 0 ? Number(String(w.distance).replace(',', '.')) : null,
    };
    const list = (drafts[state.date] || []).filter((x) => x.id !== out.id);
    list.push(out);
    drafts[state.date] = list;
    saveDrafts();
    closeSheet();
    render();
  }

  // ---------- Generación ----------
  async function generate() {
    if (!profile.apiKey) {
      return dialog('Falta la API key', 'Para generar la dieta necesitas tu API key de Anthropic. Añádela en Perfil → Editar perfil → Inteligencia artificial.', [
        { label: 'Ir al perfil', kind: 'primary', run: () => { closeSheet(); state.view = 'perfil'; state.editing = true; state.draftMeals = null; render(); } },
        { label: 'Cerrar', run: closeSheet },
      ]);
    }
    const date = state.date;
    const ws = workoutsOf(date);
    const plan = C.dayPlan(profile, ws);
    setBusy('Generando tu dieta…\nPuede tardar hasta un minuto. Mantén la app abierta.');
    try {
      const res = await AI.generateDay({ profile, date, plan, workouts: plan.entrenos });
      const entry = { date, createdAt: Date.now(), plan, meals: res.meals, aviso: res.aviso };
      history = history.filter((e) => e.date !== date);
      history.push(entry);
      history.sort((a, b) => (a.date < b.date ? 1 : -1));
      history = history.slice(0, 90);
      saveHistory();
      state.current = date;
      setBusy('');
      go('resultado');
    } catch (e) {
      setBusy('');
      errorDialog(e.message || 'Error desconocido');
    }
  }

  // ---------- Pantalla 3: Resultado ----------
  const MEAL_TAGS = { pre_entreno: 'Pre-entreno', durante_entreno: 'Durante el entreno', post_entreno: 'Recuperación' };
  function mealTable(m) {
    const t = C.sumFoods(m.alimentos);
    return (
      '<div class="tablewrap"><table><thead><tr><th>Alimento</th><th>kcal</th><th>HC</th><th>PRO</th><th>Grasa</th><th>Fibra</th></tr></thead><tbody>' +
      m.alimentos.map((f) =>
        '<tr><td>' + esc(f.nombre) + ' (' + f.cantidad + ' ' + f.unidad + ')' + (f.equivalencia ? '<span class="eq">' + esc(f.equivalencia) + '</span>' : '') + '</td>' +
        '<td>' + f.kcal + '</td><td>' + f.hc + '</td><td>' + f.pro + '</td><td>' + f.grasa + '</td><td>' + f.fibra + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td><td>' + t.kcal + '</td><td>' + t.hc + '</td><td>' + t.pro + '</td><td>' + t.grasa + '</td><td>' + t.fibra + '</td></tr></tfoot></table></div>'
    );
  }
  function viewResult() {
    const entry = state.current && entryOf(state.current);
    if (!entry) {
      setHeader('Mi dieta', '');
      return '<div class="empty"><div class="em">🍽️</div><p>Todavía no hay ninguna dieta.</p><p class="small">Añade tus entrenos en <b>Mi día</b> y pulsa <b>Generar mi dieta</b>.</p></div>' +
        '<button class="btn primary" data-action="tab" data-id="dia">Ir a Mi día</button>';
    }
    setHeader('Mi dieta', '');
    const plan = entry.plan;
    const items = [];
    entry.meals.forEach((m, i) => items.push({ min: C.toMinutes(m.hora), kind: 'meal', m, i }));
    plan.entrenos.forEach((w) => items.push({ min: C.toMinutes(w.start), kind: 'train', w }));
    items.sort((a, b) => a.min - b.min || (a.kind === 'train' ? 1 : -1));

    const tot = C.sumMeals(entry.meals);
    const pct = C.macroPercents(tot);
    const bal = C.balance(plan, tot);
    const esHoy = entry.date === todayStr();

    let html = '<div class="hero"><h2>' + (esHoy ? 'MI DÍA DE HOY' : 'MI DÍA') + '</h2><div class="d">' + esc(longDate(entry.date)) + '</div></div>';
    if (entry.aviso) html += '<div class="banner">⚠️ ' + esc(entry.aviso) + '</div>';

    html += items.map((it) => {
      if (it.kind === 'train') {
        const w = it.w;
        const fin = C.toHHMM(C.toMinutes(w.start) + w.duration);
        return '<section class="block train"><div class="block-head"><div><div class="time">' + w.start + ' – ' + fin + '</div><h3>' + C.SPORT_ICON[w.sport] + ' ' + esc(workoutDesc(w)) + '</h3>' +
          '<div class="muted small">' + w.duration + ' min · intensidad ' + C.INTENSITY_LABEL[w.intensity] + '</div></div>' +
          '<div class="big train">' + MINUS + fmt(w.neto) + ' <small>kcal</small></div></div></section>';
      }
      const t = C.sumFoods(it.m.alimentos);
      const tag = MEAL_TAGS[it.m.tipo];
      return '<section class="block meal"><div class="block-head"><div><div class="time">' + it.m.hora + '</div><h3>' + esc(it.m.nombre) + '</h3>' +
        (tag ? '<span class="tag">' + tag + '</span>' : '') + '</div><div class="big meal">+' + fmt(t.kcal) + ' <small>kcal</small></div></div>' +
        mealTable(it.m) + (it.m.nota ? '<p class="note">💡 ' + esc(it.m.nota) + '</p>' : '') +
        '<button class="btn sm" style="margin-top:12px" data-action="swap" data-idx="' + it.i + '"' + (state.swapping >= 0 ? ' disabled' : '') + '>' +
        (state.swapping === it.i ? '<span class="spinner"></span> Buscando alternativa…' : '↻ Cambiar esta comida') + '</button></section>';
    }).join('');

    const dk = (a, b) => (a >= b ? '+' : MINUS) + Math.abs(Math.round(((a - b) / b) * 100)) + ' % vs objetivo';
    html += '<div class="cards3">' +
      '<div class="card"><div class="head">Calorías ingeridas</div><div class="num meal pos">+' + fmt(tot.kcal) + ' <small style="font-size:16px">kcal</small></div>' +
      '<div class="muted small">Objetivo ' + fmt(plan.kcal) + ' kcal · ' + dk(tot.kcal, plan.kcal) + '</div>' +
      '<div class="bar" aria-hidden="true"><i style="width:' + pct.hc + '%;background:#e0a526"></i><i style="width:' + pct.pro + '%;background:#2b8a5b"></i><i style="width:' + pct.grasa + '%;background:#6b7fd7"></i></div>' +
      macroRow('#e0a526', 'Hidratos', tot.hc, pct.hc, plan.hc) + macroRow('#2b8a5b', 'Proteína', tot.pro, pct.pro, plan.pro) + macroRow('#6b7fd7', 'Grasa', tot.grasa, pct.grasa, plan.grasa) +
      '<div class="kv"><span>Fibra</span><b>' + tot.fibra + ' g <span class="muted">(mín. ' + plan.fibra + ')</span></b></div></div>' +

      '<div class="card"><div class="head">Calorías quemadas</div><div class="num" style="color:var(--train)">' + MINUS + fmt(bal.quemadas) + ' <small style="font-size:16px">kcal</small></div>' +
      plan.entrenos.map((w) => '<div class="kv"><span>' + C.SPORT_ICON[w.sport] + ' ' + esc(workoutDesc(w)) + '</span><b>' + MINUS + fmt(w.neto) + '</b></div>').join('') +
      '<div class="kv"><span>Metabolismo basal</span><b>' + MINUS + fmt(plan.basal) + '</b></div>' +
      '<div class="kv"><span>Actividad diaria</span><b>' + MINUS + fmt(plan.actividadDiaria) + '</b></div>' +
      (plan.entrenos.length ? '<p class="muted small" style="margin-top:6px">Los entrenos se cuentan en neto: ya sin el basal de esas horas.</p>' : '') + '</div>' +

      '<div class="card"><div class="head">Balance del día</div><div class="num ' + (bal.balance >= 0 ? 'pos' : 'neg') + '">' + signed(bal.balance) + ' <small style="font-size:16px">kcal</small></div>' +
      '<div class="muted small">Ingeridas ' + fmt(tot.kcal) + ' ' + MINUS + ' quemadas ' + fmt(bal.quemadas) + '. Superávit previsto: +' + fmt(plan.superavit) + ' kcal.</div></div></div>';

    html += '<div class="btn-row"><button class="btn" data-action="shopping">🛒 Lista de la compra</button><button class="btn" data-action="share">📋 Copiar / compartir</button></div>' +
      '<button class="btn" data-action="regenerate">Volver a generar</button>';
    return html;
  }
  function macroRow(color, label, g, pct, target) {
    return '<div class="kv"><span><i class="dot" style="background:' + color + '"></i>' + label + '</span><b>' + g + ' g · ' + pct + ' % <span class="muted">(obj. ' + target + ')</span></b></div>';
  }

  async function swapMeal(idx) {
    const entry = entryOf(state.current);
    if (!entry || state.swapping >= 0) return;
    state.swapping = idx;
    render(true);
    try {
      const before = C.sumFoods(entry.meals[idx].alimentos);
      const alt = await AI.alternativeMeal({ profile, plan: entry.plan, meals: entry.meals, index: idx });
      entry.meals[idx] = alt;
      entry.aviso = '';
      const after = C.sumFoods(alt.alimentos);
      saveHistory();
      const dev = Math.round(((after.kcal - before.kcal) / before.kcal) * 100);
      state.swapping = -1;
      render(true);
      toast(Math.abs(dev) > 10 ? 'Comida cambiada (' + (dev > 0 ? '+' : MINUS) + Math.abs(dev) + ' % kcal)' : 'Comida cambiada');
    } catch (e) {
      state.swapping = -1;
      render(true);
      errorDialog(e.message || 'No se pudo cambiar la comida');
    }
  }

  // ---------- Lista de la compra y compartir ----------
  function shoppingItems(entry) {
    const map = new Map();
    for (const m of entry.meals) {
      for (const f of m.alimentos) {
        const key = f.nombre.toLowerCase() + '|' + f.unidad;
        const cur = map.get(key) || { nombre: f.nombre, categoria: f.categoria, unidad: f.unidad, total: 0 };
        cur.total += f.cantidad;
        map.set(key, cur);
      }
    }
    return [...map.values()];
  }
  const CATS = ['Carnes y pescados', 'Huevos y lácteos', 'Cereales, pan y pasta', 'Legumbres y frutos secos', 'Frutas y verduras', 'Aceites, salsas y otros', 'Suplementos y geles'];
  function showShopping() {
    const entry = entryOf(state.current);
    if (!entry) return;
    const items = shoppingItems(entry);
    let n = 0;
    const html = CATS.map((cat) => {
      const rows = items.filter((i) => i.categoria === cat).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      if (!rows.length) return '';
      return '<div class="shop-cat">' + cat + '</div>' + rows.map((i) => {
        const id = 'sh' + n++;
        return '<div class="shop-item" data-shop><input type="checkbox" id="' + id + '"><label for="' + id + '">' + esc(i.nombre) + '</label><span class="q">' + fmt(i.total) + ' ' + i.unidad + '</span></div>';
      }).join('');
    }).join('');
    openSheet('<h2>Lista de la compra</h2><p class="muted small">Para el día ' + esc(shortDate(entry.date)) + '. Cantidades en crudo/seco según la dieta.</p>' + html +
      '<button class="btn" style="margin-top:18px" data-action="close-sheet">Cerrar</button>');
  }

  function shareText(entry) {
    const plan = entry.plan;
    const tot = C.sumMeals(entry.meals);
    const pct = C.macroPercents(tot);
    const bal = C.balance(plan, tot);
    const lines = ['MI DÍA – ' + longDate(entry.date), 'Objetivo: ' + fmt(plan.kcal) + ' kcal · HC ' + plan.hc + ' g · PRO ' + plan.pro + ' g · Grasa ' + plan.grasa + ' g', ''];
    const items = [];
    entry.meals.forEach((m) => items.push({ min: C.toMinutes(m.hora), m }));
    plan.entrenos.forEach((w) => items.push({ min: C.toMinutes(w.start), w }));
    items.sort((a, b) => a.min - b.min);
    for (const it of items) {
      if (it.w) {
        lines.push(it.w.start + ' ' + C.SPORT_ICON[it.w.sport] + ' ' + workoutDesc(it.w) + ' ' + it.w.duration + ' min (' + MINUS + fmt(it.w.neto) + ' kcal)', '');
      } else {
        const t = C.sumFoods(it.m.alimentos);
        lines.push(it.m.hora + ' ' + it.m.nombre + ' (+' + fmt(t.kcal) + ' kcal · HC ' + t.hc + ' · PRO ' + t.pro + ' · G ' + t.grasa + ')');
        it.m.alimentos.forEach((f) => lines.push('  · ' + f.nombre + ' ' + f.cantidad + ' ' + f.unidad + (f.equivalencia ? ' (' + f.equivalencia + ')' : '')));
        if (it.m.nota) lines.push('  ' + it.m.nota);
        lines.push('');
      }
    }
    lines.push('INGERIDAS: ' + fmt(tot.kcal) + ' kcal · HC ' + tot.hc + ' g (' + pct.hc + ' %) · PRO ' + tot.pro + ' g (' + pct.pro + ' %) · Grasa ' + tot.grasa + ' g (' + pct.grasa + ' %) · Fibra ' + tot.fibra + ' g');
    lines.push('QUEMADAS: ' + fmt(bal.quemadas) + ' kcal (basal ' + fmt(plan.basal) + ' + actividad ' + fmt(plan.actividadDiaria) + ' + entrenos ' + fmt(plan.entrenoNeto) + ')');
    lines.push('BALANCE: ' + signed(bal.balance) + ' kcal');
    return lines.join('\n');
  }
  async function shareEntry() {
    const entry = entryOf(state.current);
    if (!entry) return;
    const text = shareText(entry);
    if (navigator.share) {
      try { await navigator.share({ title: 'Mi dieta de hoy', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('Dieta copiada'); }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Dieta copiada'); } catch (_2) { toast('No se pudo copiar'); }
      ta.remove();
    }
  }

  // ---------- Historial ----------
  function viewHistory() {
    setHeader('Historial', 'Días generados');
    if (!history.length) return '<div class="empty"><div class="em">🗓️</div><p>Aún no has generado ningún día.</p></div>';
    return history.map((e) => {
      const tot = C.sumMeals(e.meals);
      const ico = e.plan.entrenos.length ? e.plan.entrenos.map((w) => C.SPORT_ICON[w.sport]).join(' ') : '😴 Descanso';
      return '<div class="card" style="display:flex;gap:10px;align-items:center">' +
        '<button class="grow" data-action="open-entry" data-date="' + e.date + '" style="flex:1;text-align:left;background:none;border:0;cursor:pointer;padding:0">' +
        '<div style="font-weight:700;text-transform:capitalize">' + esc(shortDate(e.date)) + ' · ' + ico + '</div>' +
        '<div class="muted small">Objetivo ' + fmt(e.plan.kcal) + ' kcal · ingeridas ' + fmt(tot.kcal) + ' kcal</div></button>' +
        '<button class="iconbtn" data-action="delete-entry" data-date="' + e.date + '" aria-label="Eliminar">🗑️</button></div>';
    }).join('');
  }

  // ---------- Eventos ----------
  const actions = {
    tab: (el) => go(el.dataset.id),
    'edit-profile': () => { state.editing = true; state.draftMeals = null; render(); },
    'cancel-profile': () => { state.editing = false; state.draftMeals = null; render(); },
    'save-profile': submitProfile,
    'save-weight': () => {
      const v = Number(($('#quickPeso').value || '').replace(',', '.'));
      if (!(v >= 35 && v <= 200)) return toast('Revisa el peso');
      profile.peso = v;
      logWeight(profile, v);
      saveProfile();
      toast('Peso actualizado');
      render();
    },
    'add-workout': () => { state.sheet = newWorkout(); sheetWorkout(); },
    'edit-workout': (el) => {
      const w = (drafts[state.date] || []).find((x) => x.id === el.dataset.id);
      if (w) { state.sheet = { ...w, runType: w.runType || 'rodaje', distance: w.distance || '' }; sheetWorkout(); }
    },
    'sheet-set': (el) => { state.sheet[el.dataset.field] = el.dataset.value; sheetWorkout(); },
    'sheet-duration': (el) => { state.sheet.duration = Number(el.dataset.m); sheetWorkout(); },
    'save-workout': saveWorkout,
    'delete-workout': () => {
      drafts[state.date] = (drafts[state.date] || []).filter((x) => x.id !== state.sheet.id);
      saveDrafts(); closeSheet(); render();
    },
    'close-sheet': closeSheet,
    generate,
    regenerate: () => { state.date = state.current || state.date; go('dia'); },
    swap: (el) => swapMeal(Number(el.dataset.idx)),
    shopping: showShopping,
    share: shareEntry,
    'open-entry': (el, ev) => { ev.preventDefault(); state.current = el.dataset.date; state.date = el.dataset.date; go('resultado'); },
    'delete-entry': (el) => {
      const date = el.dataset.date;
      dialog('Eliminar día', 'Se borrará la dieta del ' + shortDate(date) + ' del historial.', [
        { label: 'Cancelar', run: closeSheet },
        { label: 'Eliminar', kind: 'danger', run: () => { history = history.filter((e) => e.date !== date); saveHistory(); if (state.current === date) state.current = null; closeSheet(); render(); } },
      ]);
    },
    dialog: (el) => { const b = dialog.buttons[Number(el.dataset.i)]; if (b && b.run) b.run(); },
  };

  document.addEventListener('click', (ev) => {
    if (ev.target.id === 'overlay') return closeSheet();
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, ev);
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'dateInput') {
      if (t.value) { state.date = t.value; render(); }
    } else if (t.id === 'nComidas') {
      changeMealCount();
    } else if (t.closest && t.closest('[data-shop]')) {
      t.closest('[data-shop]').classList.toggle('done', t.checked);
    }
  });
  document.addEventListener('input', (ev) => {
    const f = ev.target.dataset && ev.target.dataset.sheetField;
    if (f && state.sheet) state.sheet[f] = ev.target.value;
  });

  // ---------- Arranque ----------
  (function pruneDrafts() {
    const limit = new Date(); limit.setDate(limit.getDate() - 30);
    const min = limit.getFullYear() + '-' + pad(limit.getMonth() + 1) + '-' + pad(limit.getDate());
    let changed = false;
    for (const d of Object.keys(drafts)) if (d < min) { delete drafts[d]; changed = true; }
    if (changed) saveDrafts();
  })();
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
