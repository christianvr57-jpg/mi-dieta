# Mi Dieta (PWA para iPhone)

Web app estática: HTML + CSS + JS, sin dependencias ni build.

| Archivo | Qué hace |
|---|---|
| `calc.js` | Mifflin-St Jeor, MET por deporte/intensidad, gasto, objetivo kcal y macros, totales y balance |
| `ai.js` | Llamada a Claude (tool use con JSON forzado), validación, reintento y "cambiar comida" |
| `app.js` | Pantallas: Perfil, Mi día, Dieta (resultado), Historial, lista de la compra, compartir |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app y uso sin conexión |

## Publicarla (hace falta HTTPS)

Sube la carpeta tal cual a cualquier hosting estático gratuito: Netlify Drop (arrastrar la carpeta), Cloudflare Pages o GitHub Pages.

Probar en local: `python -m http.server 8765` y abrir `http://localhost:8765`.

## Instalarla en el iPhone

1. Abre la URL en **Safari** → Compartir → **Añadir a pantalla de inicio**.
2. Abre la app desde el icono nuevo y rellena el perfil **ahí**: iOS guarda los datos de la app instalada por separado de los de Safari.
3. En Perfil → Inteligencia artificial pega tu API key de Anthropic.

## Ajustes de cálculo (en `calc.js`)

- `MET`: valores conservadores por deporte e intensidad.
- `CARB_STEPS`: g/kg de hidratos según la carga neta de entreno del día.
- `FAT_MIN_PER_KG` / `FAT_MAX_PER_KG`: límites de la grasa, que es "el resto".
- Superávit, proteína (g/kg) y factor de actividad se cambian desde el perfil.
