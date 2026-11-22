export interface SanctuaryPalette {
  name: string;
  sheet: string;

  /** Sky and horizon haze */
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  fogColor: string;

  /** Meadow and cast-shadow tones */
  grass: string;
  grassLight: string;
  grassDeep: string;
  /** The hard-edged deep green that cast shadows (and walkable umbra) are drawn in */
  shadowGreen: string;
  moss: string;
  petal: string;

  /** Water in the broken channels */
  water: string;
  waterDeep: string;
  waterFoam: string;

  /** Legacy tone names, kept so every consumer keeps working */
  seaDeep: string;
  seaShallow: string;
  seaFoam: string;
  ruinSilhouette: string;

  sunLightColor: string;
  hemiSky: string;
  hemiGround: string;
  bounceLight: string;

  stoneTop: string;
  stoneSide: string;
  stoneDeep: string;

  /** Carved blue-grey pillar stone */
  terracotta: string;
  /** Warm cream pillar stone */
  ochre: string;
  /** Deeper blue slate */
  slate: string;
  /** Cream capital and trim */
  trim: string;

  accent: string;
  accentPale: string;
  neutral: string;
}

/**
 * One storybook world: a bright meadow, sun-bleached cream ruins, carved blue-grey
 * pillars. Chapters only shift the warmth of the light and the depth of the greens,
 * so every study reads as the same garden at a different hour.
 */
const BASE = {
  stoneTop: '#F1E6C4',
  stoneSide: '#E4D5A9',
  stoneDeep: '#93A8B2',
  terracotta: '#7F9FB6',
  ochre: '#DACB9F',
  slate: '#587790',
  trim: '#F5EBCB',
  accent: '#F0B840',
  accentPale: '#FFE08A',
  neutral: '#5F7480',
  moss: '#8FBA4A',
  petal: '#F4A9D2',
  waterFoam: '#EAF8F4',
  bounceLight: '#BFE3C8',
};

interface Mood {
  name: string;
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  fogColor: string;
  grass: string;
  grassLight: string;
  grassDeep: string;
  shadowGreen: string;
  water: string;
  waterDeep: string;
  sunLightColor: string;
  hemiSky: string;
}

const build = (m: Mood, i: number): SanctuaryPalette => ({
  ...BASE,
  ...m,
  sheet: String(i + 1).padStart(2, '0'),
  seaDeep: m.waterDeep,
  seaShallow: m.water,
  seaFoam: BASE.waterFoam,
  ruinSilhouette: m.grassDeep,
  hemiGround: m.grassDeep,
});

export const SANCTUARY_PALETTES: SanctuaryPalette[] = (
  [
    {
      name: 'Meadow Morning',
      skyTop: '#9FD8EE', skyMid: '#CDEBC2', skyHorizon: '#E8F4B6', fogColor: '#DDEFA6',
      grass: '#AAD62E', grassLight: '#D6F43E', grassDeep: '#77A522', shadowGreen: '#1E6B3A',
      water: '#58A8E8', waterDeep: '#2568B8', sunLightColor: '#FFF3CF', hemiSky: '#4FB59A',
    },
    {
      name: 'Clover Hill',
      skyTop: '#98D2EC', skyMid: '#C6E8BE', skyHorizon: '#E2F2B0', fogColor: '#D8EC9E',
      grass: '#AAD62E', grassLight: '#D6F43E', grassDeep: '#77A522', shadowGreen: '#1B6A3C',
      water: '#5CAEEA', waterDeep: '#2A6EBE', sunLightColor: '#FFF1C8', hemiSky: '#4DB398',
    },
    {
      name: 'Fountain Court',
      skyTop: '#A2DAF0', skyMid: '#D2EEC6', skyHorizon: '#EBF5BC', fogColor: '#E0F0AC',
      grass: '#AAD62E', grassLight: '#D6F43E', grassDeep: '#77A522', shadowGreen: '#216E3A',
      water: '#62B0EC', waterDeep: '#2C6CBC', sunLightColor: '#FFF4D2', hemiSky: '#52B89E',
    },
    {
      name: 'Late Light',
      skyTop: '#A8D0E2', skyMid: '#E4E8B8', skyHorizon: '#F6E8AE', fogColor: '#EAE79E',
      grass: '#AAD62E', grassLight: '#D6F43E', grassDeep: '#77A522', shadowGreen: '#2A6A36',
      water: '#5CA8DE', waterDeep: '#2A66B0', sunLightColor: '#FFE3A6', hemiSky: '#52AE92',
    },
    {
      name: 'Orchard Walk',
      skyTop: '#9ED4EA', skyMid: '#C8E8B8', skyHorizon: '#E0F0A6', fogColor: '#D6EA96',
      grass: '#AAD62E', grassLight: '#D6F43E', grassDeep: '#77A522', shadowGreen: '#1A6638',
      water: '#5AAAE6', waterDeep: '#2866B6', sunLightColor: '#FFF0C0', hemiSky: '#4AA98F',
    },
    {
      name: 'Lagoon Afternoon',
      skyTop: '#92CCEA', skyMid: '#BEE6B8', skyHorizon: '#DAF0A8', fogColor: '#CFE698',
      grass: '#AAD62E', grassLight: '#D6F43E', grassDeep: '#77A522', shadowGreen: '#16603A',
      water: '#4EA2E4', waterDeep: '#2260B2', sunLightColor: '#FFEDBA', hemiSky: '#46A68E',
    },
    {
      name: 'Emerald Dusk',
      skyTop: '#8CB8D8', skyMid: '#D4DDB0', skyHorizon: '#F2D9A8', fogColor: '#D4DE98',
      grass: '#AAD62E', grassLight: '#D6F43E', grassDeep: '#77A522', shadowGreen: '#135A3A',
      water: '#4896DA', waterDeep: '#1F58A8', sunLightColor: '#FFD7A0', hemiSky: '#3F9F94',
    },
  ] as Mood[]
).map(build);
