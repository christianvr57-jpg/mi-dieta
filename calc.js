/* Cálculos nutricionales: todo el cálculo se hace aquí, la IA solo propone alimentos. */
(function (root) {
  'use strict';

  // MET conservadores (Compendium of Physical Activities, ajustados a la baja).
  const MET = {
    running: {
      rodaje: { suave: 7.0, media: 8.5, alta: 9.8 },
      series: { suave: 8.0, media: 9.5, alta: 10.5 },
      tirada: { suave: 7.5, media: 8.8, alta: 9.8 },
    },
    natacion: { suave: 4.5, media: 6.0, alta: 8.0 },
    padel: { suave: 4.0, media: 5.0, alta: 6.5 },
    gimnasio: { suave: 3.0, media: 3.5, alta: 5.0 },
  };

  const SPORT_LABEL = {
    running: 'Running',
    natacion: 'Natación',
    padel: 'Pádel',
    gimnasio: 'Gimnasio',
  };
  const SPORT_ICON = { running: '🏃', natacion: '🏊', padel: '🎾', gimnasio: '🏋️' };
  const INTENSITY_LABEL = { suave: 'suave', media: 'media', alta: 'alta' };
  const RUN_TYPE_LABEL = { rodaje: 'Rodaje', series: 'Series', tirada: 'Tirada larga' };

  const ACTIVITY_FACTORS = [
    { value: 1.2, label: 'Muy sedentario' },
    { value: 1.3, label: 'Oficina + paseos' },
    { value: 1.4, label: 'Algo activo' },
    { value: 1.5, label: 'Activo' },
  ];

  // Hidratos (g/kg) según carga neta de entreno del día (kcal netas).
  const CARB_STEPS = [
    { upTo: 0, perKg: 4.0, label: 'Descanso' },
    { upTo: 250, perKg: 4.5, label: 'Carga ligera' },
    { upTo: 500, perKg: 5.0, label: 'Carga media' },
    { upTo: 800, perKg: 6.0, label: 'Carga alta' },
    { upTo: 1100, perKg: 7.0, label: 'Carga muy alta' },
    { upTo: Infinity, perKg: 8.0, label: 'Carga extrema' },
  ];
  const FAT_MIN_PER_KG = 0.8;
  const FAT_MAX_PER_KG = 1.4;

  function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function toHHMM(min) {
    const t = ((Math.round(min) % 1440) + 1440) % 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }

  // Mifflin-St Jeor
  function bmr(p) {
    const base = 10 * p.peso + 6.25 * p.altura - 5 * p.edad;
    return base + (p.sexo === 'mujer' ? -161 : 5);
  }

  function metFor(w) {
    if (w.sport === 'running') {
      const t = MET.running[w.runType] || MET.running.rodaje;
      return t[w.intensity] || t.media;
    }
    const t = MET[w.sport];
    return t ? t[w.intensity] || t.media : 4;
  }

  // Kcal del entreno: MET·kg·h menos el basal de esas horas (para no contarlo dos veces).
  function workoutKcal(w, bmrDay, peso) {
    const horas = w.duration / 60;
    const met = metFor(w);
    const bruto = met * peso * horas;
    const basal = (bmrDay / 24) * horas;
    return {
      met,
      bruto: Math.round(bruto),
      basal: Math.round(basal),
      neto: Math.max(0, Math.round(bruto - basal)),
    };
  }

  function carbStep(netTraining) {
    for (const s of CARB_STEPS) if (netTraining <= s.upTo) return s;
    return CARB_STEPS[CARB_STEPS.length - 1];
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function dayPlan(profile, workouts) {
    const peso = Number(profile.peso);
    const basal = bmr(profile);
    const factor = Number(profile.factorActividad) || 1.3;
    const actividadDiaria = basal * (factor - 1);

    const entrenos = workouts.map((w) => ({ ...w, ...workoutKcal(w, basal, peso) }));
    const entrenoNeto = entrenos.reduce((s, w) => s + w.neto, 0);

    const gasto = basal * factor + entrenoNeto;
    const superavit = Math.max(0, Number(profile.superavit) || 0);
    const kcal = Math.round(gasto + superavit);

    const pKg = clamp(Number(profile.proteinaKg) || 2.0, 1.8, 2.2);
    const pro = Math.round(pKg * peso);

    const step = carbStep(entrenoNeto);
    let hc = step.perKg * peso;
    let grasa = (kcal - pro * 4 - hc * 4) / 9;
    // La grasa es "el resto", pero dentro de un rango razonable.
    if (grasa < FAT_MIN_PER_KG * peso) {
      grasa = FAT_MIN_PER_KG * peso;
      hc = (kcal - pro * 4 - grasa * 9) / 4;
    } else if (grasa > FAT_MAX_PER_KG * peso) {
      grasa = FAT_MAX_PER_KG * peso;
      hc = (kcal - pro * 4 - grasa * 9) / 4;
    }
    hc = Math.round(hc);
    grasa = Math.round(grasa);

    return {
      peso,
      basal: Math.round(basal),
      factor,
      actividadDiaria: Math.round(actividadDiaria),
      entrenos,
      entrenoNeto,
      gasto: Math.round(gasto),
      superavit,
      kcal,
      pro,
      hc,
      grasa,
      fibra: Math.max(30, Math.round((kcal / 1000) * 14)),
      carbPerKg: Math.round((hc / peso) * 10) / 10,
      carga: step.label,
    };
  }

  // ---- Totales de lo que devuelve la IA ----
  const r = (n) => Math.round(Number(n) || 0);

  function sumFoods(foods) {
    const t = { kcal: 0, hc: 0, pro: 0, grasa: 0, fibra: 0 };
    for (const f of foods) for (const k in t) t[k] += r(f[k]);
    return t;
  }
  function sumMeals(meals) {
    const t = { kcal: 0, hc: 0, pro: 0, grasa: 0, fibra: 0 };
    for (const m of meals) {
      const s = sumFoods(m.alimentos);
      for (const k in t) t[k] += s[k];
    }
    return t;
  }
  function macroPercents(t) {
    const kp = t.pro * 4, kh = t.hc * 4, kg = t.grasa * 9;
    const total = kp + kh + kg || 1;
    return {
      pro: Math.round((kp / total) * 100),
      hc: Math.round((kh / total) * 100),
      grasa: Math.round((kg / total) * 100),
    };
  }

  // Kcal esperadas a partir de macros (Atwater, fibra a 2 kcal/g).
  function kcalFromMacros(f) {
    const fibra = Math.min(Number(f.fibra) || 0, Number(f.hc) || 0);
    return 4 * ((Number(f.hc) || 0) - fibra) + 2 * fibra + 4 * (Number(f.pro) || 0) + 9 * (Number(f.grasa) || 0);
  }

  // Balance del día: ingerido − quemado (basal + actividad diaria + entrenos netos).
  function balance(plan, ingeridas) {
    const quemadas = plan.basal + plan.actividadDiaria + plan.entrenoNeto;
    return { quemadas, balance: ingeridas.kcal - quemadas };
  }

  const api = {
    MET, SPORT_LABEL, SPORT_ICON, INTENSITY_LABEL, RUN_TYPE_LABEL, ACTIVITY_FACTORS,
    toMinutes, toHHMM, bmr, metFor, workoutKcal, dayPlan,
    sumFoods, sumMeals, macroPercents, kcalFromMacros, balance,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
