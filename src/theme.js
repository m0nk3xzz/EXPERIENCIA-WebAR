// ============================================================
// THEME — identidad por museo (white-label), como variables CSS
// ============================================================
// Cada museo define sus 7 tokens de color + nombre, isotipo y flags de
// háptica/sonido; se aplican como custom properties sobre :root.
// El museo se elige por URL: ?museo=<id>. Para agregar uno: nuevo objeto
// en MUSEUMS. Nada más.

export const MUSEUMS = {
  laton: {
    id: 'laton',
    name: 'Museo de ejemplo',
    mark: 'M', // inicial del isotipo circular; un museo real pondría su SVG
    colors: {
      ink: '#15110E',
      ink2: '#211B16',
      bone: '#F2ECDF',
      accent: '#C9A24B',
      onAccent: '#15110E',
      listen: '#E0574F',
      speak: '#9DBB9E'
    },
    haptics: true,
    sound: true
  },
  jade: {
    id: 'jade',
    name: 'Museo Jade',
    mark: 'J',
    colors: {
      ink: '#0E1614',
      ink2: '#16221F',
      bone: '#E9F1EC',
      accent: '#6DBFA0',
      onAccent: '#0E1614',
      listen: '#E5645B',
      speak: '#B7D6A8'
    },
    haptics: true,
    sound: true
  },
  indigo: {
    id: 'indigo',
    name: 'Museo Índigo',
    mark: 'Í',
    colors: {
      ink: '#0F1220',
      ink2: '#171B2E',
      bone: '#ECEBF5',
      accent: '#9CA9F5',
      onAccent: '#0F1220',
      listen: '#F0685F',
      speak: '#8FD0BE'
    },
    haptics: true,
    sound: true
  }
};

// Las claves desconocidas caen al fallback 'laton'; el alias 'galeria'
// usa la identidad latón.
const ALIASES = { galeria: 'laton' };

export function getMuseumKeyFromUrl() {
  const raw = new URLSearchParams(window.location.search).get('museo');
  if (!raw) return 'laton';
  const key = raw.trim().toLowerCase();
  return MUSEUMS[key] ? key : (ALIASES[key] ?? 'laton');
}

// Aplica los tokens sobre :root (instantáneo, sin transiciones de color).
export function applyTheme(museumId = getMuseumKeyFromUrl()) {
  const museum = MUSEUMS[museumId] ?? MUSEUMS.laton;
  const root = document.documentElement;

  root.style.setProperty('--m-ink', museum.colors.ink);
  root.style.setProperty('--m-ink-2', museum.colors.ink2);
  root.style.setProperty('--m-bone', museum.colors.bone);
  root.style.setProperty('--m-accent', museum.colors.accent);
  root.style.setProperty('--m-on-accent', museum.colors.onAccent);
  root.style.setProperty('--m-listen', museum.colors.listen);
  root.style.setProperty('--m-speak', museum.colors.speak);

  // El visitante ve el nombre del museo en la pestaña, no "WebAR".
  document.title = museum.name;

  // Barra de estado del navegador con el tono del museo.
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', museum.colors.ink);

  return museum;
}
