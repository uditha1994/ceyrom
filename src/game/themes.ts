/** Board collection and striker skins. Purely cosmetic — physics never reads these. */
export interface BoardTheme {
  id: string;
  unlock: number; // player level
  surface: [string, string, string]; // base, grain dark, grain light
  frame: [string, string, string];
  ink: string; // line markings
  accent: string; // red base circles / lotus dots
  inlay: string; // brass
  engrave: string;
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'jak',
    unlock: 1,
    surface: ['#E2C795', '#B98F58', '#F1DDB4'],
    frame: ['#6F4535', '#3F271D', '#8C5B45'],
    ink: '#30251E',
    accent: '#93362A',
    inlay: '#C6A878',
    engrave: 'rgba(232,217,188,0.16)',
  },
  {
    id: 'ebony',
    unlock: 3,
    surface: ['#E8D9BC', '#C2AE88', '#F6EBD3'],
    frame: ['#2B201A', '#140E0B', '#43332A'],
    ink: '#2A1F19',
    accent: '#8E2F25',
    inlay: '#C6A878',
    engrave: 'rgba(198,168,120,0.22)',
  },
  {
    id: 'teak',
    unlock: 6,
    surface: ['#D8AE70', '#A97B40', '#EBCB93'],
    frame: ['#7A5230', '#4D3019', '#9A6C43'],
    ink: '#3A2416',
    accent: '#7E2A1F',
    inlay: '#DCC08E',
    engrave: 'rgba(240,220,180,0.15)',
  },
  {
    id: 'kitul',
    unlock: 10,
    surface: ['#A9825A', '#7E5C3A', '#C29B70'],
    frame: ['#30251E', '#1A130F', '#4A3A30'],
    ink: '#E8D9BC',
    accent: '#C6A878',
    inlay: '#C6A878',
    engrave: 'rgba(198,168,120,0.2)',
  },
];

export interface StrikerSkin {
  id: string;
  unlock: number;
}

export const STRIKER_SKINS: StrikerSkin[] = [
  { id: 'ivory', unlock: 1 },
  { id: 'brass', unlock: 2 },
  { id: 'lacquer', unlock: 4 },
  { id: 'moonstone', unlock: 8 },
];

export const boardTheme = (id: string) => BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
