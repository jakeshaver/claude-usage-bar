import { defineSprites, drawSprite, SHEETS } from './sprite';
import { POODLE } from './sprites/poodle';
import { CATS } from './sprites/cats';
import { PROPS } from './sprites/props';
import { PORTRAITS } from './sprites/portraits';
import type { Module } from '../core/game';
export { drawSprite, SHEETS };
export { text, wrap, textWidth } from './font';

defineSprites({ ...POODLE, ...CATS, ...PROPS, ...PORTRAITS });

export const ArtModule: Module = { id: 'art', api: { drawSprite, has: (n: string) => !!SHEETS[n], names: () => Object.keys(SHEETS) } };
