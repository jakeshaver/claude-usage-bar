export type Tod = 'dawn' | 'day' | 'dusk' | 'night';
export type Scene = 'boot' | 'title' | 'map' | 'play' | 'dialogue' | 'bonus' | 'ending' | 'recovery';
export type QuestState = 'locked' | 'active' | 'done' | 'missed';

export type Condition =
  | { flag: string } | { notFlag: string } | { quest: string; is: QuestState }
  | { item: string; min: number } | { cleared: string } | { memories: number }
  | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export interface Trigger { on: string; when?: Condition; match?: Record<string, string | number> }

export interface AreaDef {
  id: string; name: string; subtitle?: string; tileset: string; music: string; ambience: string;
  tod: Tod; waves: string[]; boss?: string; exits: { to: string; when?: Condition; label?: string }[];
  intro?: string; outro?: string; bonus?: string; ending?: string; scroll?: number;
}
export interface WaveDef {
  id: string; formation: { cols: number; rows: number; spacing?: number };
  cats: { breed: string; row: number; cols?: number[] }[];
  entry: 'swirl-left' | 'swirl-right' | 'split' | 'rain' | 'loop';
  diveRate: number; fireRate: number; pickup?: string;
}
export interface EnemyDef {
  id: string; name: string; sprite: string; hp: number; points: number; divePoints?: number;
  behavior: 'basic' | 'diver' | 'shooter' | 'tank' | 'splitter' | 'capturer' | 'zigzag' | 'boss';
  bestiary: string; size?: number; bossPattern?: string;
}
export interface QuestDef {
  id: string; name: string; desc: string; start: Trigger; complete: Trigger & { count?: number };
  reward: { flags?: string[]; items?: Record<string, number>; score?: number }; dialogue?: string;
  /** closes the quest as 'missed' when any trigger matches (src/quest derives one from gated exits if absent) */
  expire?: Trigger | Trigger[];
}
export interface DialogueDef { id: string; speaker: string; portrait: string; text: string; next?: string; when?: Condition }
export interface ItemDef { id: string; name: string; sprite: string; desc: string; effect: { kind: 'heart' | 'double' | 'spread' | 'shield' | 'speed' | 'key' | 'treat'; value: number; ticks?: number } }
export interface MemoryDef { id: string; area: string; wave: number; title: string; text: string }
export interface BonusDef { id: string; name: string; groups: number; pattern: string; breed: string }
export interface EndingDef { id: string; title: string; text: string[]; when?: Condition }

export interface Content {
  areas: AreaDef[]; waves: WaveDef[]; enemies: EnemyDef[]; quests: QuestDef[];
  dialogue: DialogueDef[]; items: ItemDef[]; memories: MemoryDef[]; bonus: BonusDef[]; endings: EndingDef[];
  start: string;
}

export interface GameState {
  version: number; seed: number; scene: Scene;
  areaId: string; waveIndex: number; tod: Tod;
  score: number; hiScore: number; hearts: number; maxHearts: number;
  flags: Record<string, boolean>; quests: Record<string, QuestState>;
  inventory: Record<string, number>; memories: string[]; areasCleared: string[];
  ending: string | null;
  stats: { shots: number; hits: number; naps: number; playTicks: number; catsBooped: number };
  settings: { music: number; sfx: number; amb: number; shake: boolean; flash: boolean; reduceMotion: boolean; touch: 'auto' | 'on' | 'off' };
}
