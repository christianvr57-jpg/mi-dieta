/* Llamadas a Claude. La IA solo propone comidas; los totales y objetivos los calcula calc.js. */
(function (root) {
  'use strict';
  const C = root.Calc;

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const DEFAULT_MODEL = 'claude-sonnet-5-5';
  const TOLERANCIA_KCAL = 0.05;
  const TIMEOUT_MS = 150000;

  const CATEGORIAS = [
    'Carnes y pescados',
    'Huevos y lácteos',
    'Cereales, pan y pasta',
    'Legumbres y frutos secos',
    'Frutas y verduras',
    'Aceites, salsas y otros',
    'Suplementos y geles',
  ];
  const TIPOS = [
    'desayuno', 'media_manana', 'comida', 'merienda', 'cena', 'recena',
    'pre_entreno', 'durante_entreno', 'post_entreno',
  ];

  const FOOD_SCHEMA = {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre del alimento, sin cantidades. Ej: "Pechuga de pollo (cruda)"' },
      categoria: { type: 'string', enum: CATEGORIAS },
      cantidad: { type: 'number', description: 'Cantidad en g o ml' },
      unidad: { type: 'string', enum: ['g', 'ml'] },
      equivalencia: { type: 'string', description: 'Opcional. Ej: "≈ 2 huevos", "1 gel", "1 scoop"' },
      kcal: { type: 'number' },
      hc: { type: 'number', description: 'Hidratos de carbono en g' },
      pro: { type: 'number', description: 'Proteína en g' },
      grasa: { type: 'number', description: 'Grasa en g' },
      fibra: { type: 'number', description: 'Fibra en g' },
    },
    required: ['nombre', 'categoria', 'cantidad', 'unidad', 'kcal', 'hc', 'pro', 'grasa', 'fibra'],
  };
  const MEAL_PROPS = {
    hora: { type: 'string', description: 'Hora HH:MM (24 h)' },
    nombre: { type: 'string', description: 'Ej: "Desayuno", "Post-entreno"' },
    tipo: { type: 'string', enum: TIPOS },
    alimentos: { type: 'array', items: FOOD_SCHEMA },
    nota: { type: 'string', description: 'Opcional. Consejo breve o forma de preparación rápida' },
  };
  const MEAL_REQUIRED = ['hora', 'nombre', 'tipo', 'alimentos'];

  const TOOL_DAY = {
    name: 'registrar_dieta',
    description: 'Registra la dieta completa del día.',
    input_schema: {
      type: 'object',
      properties: {
        comidas: { type: 'array', items: { type: 'object', properties: MEAL_PROPS, required: MEAL_REQUIRED } },
      },
      required: ['comidas'],
    },
  };
  const TOOL_MEAL = {
    name: 'registrar_comida',
    description: 'Registra una única comida alternativa.',
    input_schema: { type: 'object', properties: MEAL_PROPS, required: MEAL_REQUIRED },
  };

  class AIError extends Error {
    constructor(message, { retryable = false } = {}) {
      super(message);
      this.retryable = retryable;
    }
  }

  // ---------- Llamada HTTP ----------
  async function callClaude({ apiKey, model, system, prompt, tool, maxTokens = 8000 }) {
    if (!apiKey) throw new AIError('Falta la API key de Anthropic. Añádela en Perfil → Inteligencia artificial.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: model || DEFAULT_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: prompt }],
          tools: [tool],
          tool_choice: { type: 'tool', name: tool.name },
        }),
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new AIError('La IA tardó demasiado en responder. Inténtalo de nuevo.', { retryable: true });
      throw new AIError('No se pudo conectar con la IA. Revisa tu conexión y que la app esté abierta mientras genera.', { retryable: true });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (_) { /* sin cuerpo */ }
      if (res.status === 401 || res.status === 403) throw new AIError('API key no válida o sin permisos. Revísala en Perfil.');
      if (res.status === 404) throw new AIError('El modelo "' + (model || DEFAULT_MODEL) + '" no existe o no está disponible. Cámbialo en Perfil.');
      if (res.status === 429) throw new AIError('Demasiadas peticiones o límite de uso alcanzado. Espera un minuto.', { retryable: true });
      if (res.status >= 500) throw new AIError('El servicio de IA está saturado (' + res.status + '). Inténtalo de nuevo.', { retryable: true });
      throw new AIError('Error de la IA (' + res.status + '): ' + (detail || 'petición rechazada'));
    }

    const data = await res.json();
    if (data.stop_reason === 'max_tokens') throw new AIError('La respuesta de la IA quedó cortada.', { retryable: true });
    const block = (data.content || []).find((b) => b.type === 'tool_use');
    if (block && block.input && typeof block.input === 'object') return block.input;
    // Respaldo: JSON en texto plano
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const i = text.indexOf('{'), j = text.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try { return JSON.parse(text.slice(i, j + 1)); } catch (_) { /* cae al error */ }
    }
    throw new AIError('La IA no devolvió un JSON válido.', { retryable: true });
  }

  // ---------- Validación / normalización ----------
  const formatErr = (msg) => new AIError('JSON incorrecto: ' + msg, { retryable: true });

  function fixHora(h) {
    const m = /^(\d{1,2})[:.h](\d{2})$/.exec(String(h || '').trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return m[1].padStart(2, '0') + ':' + m[2];
  }
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };

  function normalizeMeal(m, idx) {
    if (!m || typeof m !== 'object') throw formatErr('la comida ' + (idx + 1) + ' no es un objeto');
    const hora = fixHora(m.hora);
    if (!hora) throw formatErr('hora inválida en la comida ' + (idx + 1));
    if (!Array.isArray(m.alimentos) || !m.alimentos.length) throw formatErr('la comida ' + (idx + 1) + ' no tiene alimentos');
    const alimentos = m.alimentos.map((f, k) => {
      const where = 'comida ' + (idx + 1) + ', alimento ' + (k + 1);
      if (!f || typeof f.nombre !== 'string' || !f.nombre.trim()) throw formatErr('falta el nombre (' + where + ')');
      const out = {
        nombre: f.nombre.trim(),
        categoria: CATEGORIAS.includes(f.categoria) ? f.categoria : 'Aceites, salsas y otros',
        cantidad: Math.round(num(f.cantidad)),
        unidad: f.unidad === 'ml' ? 'ml' : 'g',
        equivalencia: typeof f.equivalencia === 'string' ? f.equivalencia.trim() : '',
        hc: Math.round(num(f.hc)),
        pro: Math.round(num(f.pro)),
        grasa: Math.round(num(f.grasa)),
        fibra: Math.round(num(f.fibra)),
      };
      for (const k2 of ['cantidad', 'hc', 'pro', 'grasa', 'fibra']) {
        if (!Number.isFinite(out[k2])) throw formatErr('valor no numérico en "' + k2 + '" (' + where + ')');
      }
      // Las kcal las deducimos de los macros si la IA se desvía (los macros son más fiables).
      const esperado = C.kcalFromMacros(out);
      let kcal = Math.round(num(f.kcal));
      if (!Number.isFinite(kcal) || Math.abs(kcal - esperado) > Math.max(15, 0.12 * esperado)) kcal = Math.round(esperado);
      out.kcal = kcal;
      return out;
    });
    return {
      hora,
      nombre: String(m.nombre || 'Comida').trim(),
      tipo: TIPOS.includes(m.tipo) ? m.tipo : 'comida',
      alimentos,
      nota: typeof m.nota === 'string' ? m.nota.trim() : '',
    };
  }

  function normalizeDay(input) {
    if (!input || !Array.isArray(input.comidas) || input.comidas.length < 3) throw formatErr('faltan comidas');
    const meals = input.comidas.map(normalizeMeal);
    meals.sort((a, b) => C.toMinutes(a.hora) - C.toMinutes(b.hora));
    return meals;
  }

  // ---------- Prompts ----------
  const SYSTEM = [
    'Eres un dietista-nutricionista deportivo. Diseñas la dieta de UN día para una persona que está en fase de volumen (ganar masa muscular con la mínima grasa).',
    'Responde SIEMPRE llamando a la herramienta indicada. No escribas texto fuera de la herramienta.',
    'Usa comida normal de supermercado en Galicia (Gadis, Froiz, Mercadona, Eroski), fácil y rápida de preparar: la persona tiene un bebé en casa y poco tiempo para cocinar. Prioriza recetas de menos de 15 minutos, batch cooking, conservas, microondas, ensaladas completas.',
    'Valores nutricionales realistas (tablas BEDCA / etiquetas españolas). La kcal de cada alimento debe ser coherente con sus macros: kcal ≈ 4·(HC−fibra) + 2·fibra + 4·PRO + 9·grasa.',
    'Cantidades en g o ml, enteras y redondeadas (múltiplos de 5). Pasta, arroz, legumbres, avena, carne y pescado van en crudo/seco (indícalo en el nombre: "(crudo)", "(seco)"). El campo "nombre" no lleva cantidades; usa "equivalencia" para piezas ("≈ 2 huevos").',
    'Usa siempre el mismo nombre para el mismo alimento en todas las comidas (se agrupa en una lista de la compra).',
  ].join('\n');

  function workoutLines(entrenos) {
    if (!entrenos.length) return ['Ningún entreno: día de descanso.'];
    return entrenos.map((w, i) => {
      const ini = C.toMinutes(w.start);
      const fin = C.toHHMM(ini + w.duration);
      let s = (i + 1) + '. ' + C.SPORT_LABEL[w.sport] + ' de ' + w.start + ' a ' + fin + ' (' + w.duration + ' min), intensidad ' + w.intensity;
      if (w.sport === 'running') {
        s += ', ' + C.RUN_TYPE_LABEL[w.runType].toLowerCase();
        if (w.distance) s += ', ' + w.distance + ' km';
      }
      s += '. Gasto neto estimado: ' + w.neto + ' kcal.';
      if (w.duration > 90) s += ' DURA MÁS DE 90 MIN: incluye qué tomar durante.';
      return s;
    });
  }

  function supplementLines(profile) {
    const lines = [];
    const s = profile.suplementos || {};
    if (s.proteina) {
      lines.push(
        'Batido de proteína 226ERS vainilla: 1 scoop = ' + s.proteinaScoopG + ' g de polvo → ' + s.proteinaKcal + ' kcal, ' +
        s.proteinaPro + ' g proteína, ' + s.proteinaHc + ' g HC, ' + s.proteinaGrasa + ' g grasa. Tómalo a diario (1–2 scoops, por ejemplo tras entrenar o en una toma de proteína) y cuenta aparte la leche/bebida con la que se mezcle. Categoría "Suplementos y geles".'
      );
    }
    if (s.creatina) {
      lines.push('Creatina monohidrato: ' + s.creatinaG + ' g a diario, sin kcal ni macros (pon kcal, hc, pro, grasa y fibra a 0). Colócala en una toma que ya exista. Categoría "Suplementos y geles".');
    }
    return lines.length ? lines : ['Ninguno.'];
  }

  function buildDayPrompt(profile, date, plan, workouts) {
    const lo = Math.round(plan.kcal * (1 - TOLERANCIA_KCAL));
    const hi = Math.round(plan.kcal * (1 + TOLERANCIA_KCAL));
    const slots = profile.comidas.map((c) => c.hora + ' ' + c.nombre).join(', ');
    return [
      'FECHA: ' + date,
      '',
      'PERFIL',
      '- ' + profile.sexo + ', ' + profile.edad + ' años, ' + profile.altura + ' cm, ' + profile.peso + ' kg. Objetivo: ' + (profile.objetivo === 'mantener' ? 'mantener peso' : 'ganar masa muscular'),
      '- Se levanta a las ' + profile.despertar + ' y se acuesta a las ' + profile.dormir,
      '- Alimentos que NO toma o no tolera: ' + (profile.excluidos.trim() || 'ninguno, tolera todo'),
      '- Comidas habituales (' + profile.comidas.length + '): ' + slots,
      '',
      'SUPLEMENTOS (obligatorios cada día)',
      ...supplementLines(profile).map((l) => '- ' + l),
      '',
      'ENTRENOS DE HOY',
      ...workoutLines(plan.entrenos),
      '',
      'OBJETIVOS DEL DÍA (calculados, no los cambies)',
      '- Kcal objetivo: ' + plan.kcal + ' (aceptable entre ' + lo + ' y ' + hi + ', ±5 %). Ya incluye un superávit de +' + plan.superavit + ' kcal sobre el gasto de hoy (' + plan.gasto + ' kcal).',
      '- Proteína: ' + plan.pro + ' g · Hidratos: ' + plan.hc + ' g (' + plan.carbPerKg + ' g/kg, ' + plan.carga.toLowerCase() + ') · Grasa: ' + plan.grasa + ' g · Fibra: mínimo ' + plan.fibra + ' g',
      '',
      'REGLAS',
      '1. La suma de kcal de TODAS las comidas debe quedar entre ' + lo + ' y ' + hi + '. Las sumas de macros deben acercarse a los objetivos de arriba (±10 %).',
      '2. Proteína repartida en 4–5 tomas de al menos 25–30 g cada una; la proteína sale de comida normal y del batido.',
      '3. Usa las comidas habituales como base. Puedes moverlas ±60 min para encajar los entrenos o convertirlas en pre/post entreno, y añadir como máximo 2 tomas extra (pre, durante o post). Total de tomas: entre ' + profile.comidas.length + ' y ' + (profile.comidas.length + 2) + '.',
      '4. Antes de cada entreno: comida con hidratos y poca grasa/fibra entre 1,5 y 3 h antes. Si no hay hueco, un tentempié ligero y fácil de digerir (plátano, tostada con miel…) 45–90 min antes.',
      '5. Después de cada entreno, sobre todo tras gimnasio: toma de recuperación en la hora siguiente con 30–40 g de proteína y hidratos (≈1 g/kg tras sesiones duras).',
      '6. Entrenos de más de 90 min: añade una toma de tipo "durante_entreno" a la hora del entreno con 30–60 g de hidratos por hora a partir de los primeros 45–60 min (geles de ≈40 g con ≈22–25 g HC, plátano, dátiles o bebida isotónica) y recomienda 500–750 ml de líquido/hora en "nota".',
      '7. No bajes de las kcal objetivo por el gasto del deporte: el superávit se mantiene también en días de mucho entreno.',
      '8. Cena y última toma: digestivas, a ≥ 1,5 h de acostarse. No incluyas ninguno de los alimentos excluidos.',
      '9. Variedad razonable: no repitas el mismo alimento principal en más de 2 tomas, salvo básicos (aceite, avena, lácteos).',
    ].join('\n');
  }

  async function generateDay({ profile, date, plan, workouts }) {
    const base = buildDayPrompt(profile, date, plan, workouts);
    let feedback = '';
    let best = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const input = await callClaude({
          apiKey: profile.apiKey,
          model: profile.modelo,
          system: SYSTEM,
          prompt: feedback ? base + '\n\nAVISO SOBRE TU INTENTO ANTERIOR: ' + feedback + ' Corrígelo.' : base,
          tool: TOOL_DAY,
        });
        const meals = normalizeDay(input);
        const total = C.sumMeals(meals);
        const desvio = (total.kcal - plan.kcal) / plan.kcal;
        best = { meals, desvio };
        if (Math.abs(desvio) <= TOLERANCIA_KCAL) return { meals, desvio, aviso: '' };
        feedback = 'la suma fue ' + total.kcal + ' kcal y el objetivo es ' + plan.kcal + ' (' + (desvio > 0 ? 'te pasaste' : 'te quedaste corto') + ' un ' + Math.abs(Math.round(desvio * 100)) + ' %). Ajusta cantidades para quedar entre ' + Math.round(plan.kcal * 0.95) + ' y ' + Math.round(plan.kcal * 1.05) + ' kcal.';
      } catch (e) {
        if (!(e instanceof AIError) || !e.retryable || attempt === 1) {
          if (best) break; // ya hay un resultado válido del primer intento
          throw e;
        }
        feedback = e.message;
      }
    }
    const pct = Math.round(best.desvio * 100);
    return {
      meals: best.meals,
      desvio: best.desvio,
      aviso: 'La IA no clavó las kcal objetivo: el total difiere un ' + (pct > 0 ? '+' : '') + pct + ' %. Puedes volver a generar o cambiar alguna comida.',
    };
  }

  async function alternativeMeal({ profile, plan, meals, index }) {
    const meal = meals[index];
    const t = C.sumFoods(meal.alimentos);
    const otros = meals.filter((_, i) => i !== index).flatMap((m) => m.alimentos.map((f) => f.nombre));
    const prompt = [
      'Necesito UNA alternativa para esta comida de mi dieta de hoy.',
      '',
      'COMIDA ACTUAL: ' + meal.hora + ' ' + meal.nombre + ' (' + meal.tipo + ')',
      meal.alimentos.map((f) => '- ' + f.nombre + ' ' + f.cantidad + ' ' + f.unidad).join('\n'),
      'Totales: ' + t.kcal + ' kcal, ' + t.hc + ' g HC, ' + t.pro + ' g PRO, ' + t.grasa + ' g grasa, ' + t.fibra + ' g fibra.',
      '',
      'REQUISITOS',
      '- Mismo hora ("' + meal.hora + '") y mismo tipo ("' + meal.tipo + '").',
      '- Macros muy similares: kcal ' + Math.round(t.kcal * 0.95) + '–' + Math.round(t.kcal * 1.05) + ', HC ' + t.hc + ' g, PRO ' + t.pro + ' g, grasa ' + t.grasa + ' g (±10 %).',
      '- Alimentos distintos a los de la comida actual y, si puedes, a los que ya aparecen en el resto del día: ' + [...new Set(otros)].join(', ') + '.',
      '- No incluyas: ' + (profile.excluidos.trim() || 'nada excluido') + '.',
      '- Si la comida actual incluye batido de proteína o creatina, mantenlos igual.',
      '- Comida de supermercado en Galicia, rápida de preparar (bebé en casa).',
      '- Contexto: objetivo diario ' + plan.kcal + ' kcal, entrenos de hoy: ' + (plan.entrenos.length ? plan.entrenos.map((w) => C.SPORT_LABEL[w.sport] + ' ' + w.start + ' (' + w.duration + ' min)').join(', ') : 'ninguno') + '.',
    ].join('\n');

    let feedback = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const input = await callClaude({
          apiKey: profile.apiKey,
          model: profile.modelo,
          system: SYSTEM,
          prompt: feedback ? prompt + '\n\nAVISO SOBRE TU INTENTO ANTERIOR: ' + feedback + ' Corrígelo.' : prompt,
          tool: TOOL_MEAL,
          maxTokens: 3000,
        });
        const out = normalizeMeal(input, index);
        out.hora = meal.hora;
        out.tipo = meal.tipo;
        return out;
      } catch (e) {
        if (!(e instanceof AIError) || !e.retryable || attempt === 1) throw e;
        feedback = e.message;
      }
    }
  }

  const api = { DEFAULT_MODEL, TOLERANCIA_KCAL, AIError, generateDay, alternativeMeal, normalizeMeal, normalizeDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AI = api;
})(typeof window !== 'undefined' ? window : globalThis);
