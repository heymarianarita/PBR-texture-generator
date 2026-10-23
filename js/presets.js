// Material presets: starting settings tuned for how each material reads in
// Second Life PBR, which is glTF metallic-roughness with no sheen or
// clearcoat. Each preset only sets the keys in PRESET_KEYS; image-specific
// settings (invert, even out lighting, seamless) are left alone.

export const PRESET_KEYS = [
  'roughBase', 'roughContrast', 'roughInvert', 'metallic', 'aoStrength', 'aoRadius',
  'coarse', 'medium', 'fine', 'strength', 'contrast', 'blur',
];

const preset = (id, label, about, [roughBase, roughContrast, metallic, aoStrength, aoRadius,
  coarse, medium, fine, strength, contrast, blur]) => ({
  id, label, about,
  settings: { roughBase, roughContrast, roughInvert: false, metallic, aoStrength, aoRadius,
    coarse, medium, fine, strength, contrast, blur },
});

//                                              rough  rc   metal  ao  aoR  large med  fine  str  contr blur
export const PRESETS = [
  preset('velvet', 'Velvet & bouclé',
    'Second Life has no velvet sheen, so this fakes it: very matte, fuzzy fine bumps and soft shadows between the loops.',
    [0.92, 0.3, 0, 1.6, 6, 0.8, 0.9, 1.6, 3, 1.1, 0]),
  preset('fabric', 'Fabric',
    'Matte woven cloth: mostly fine detail from the weave, little depth.',
    [0.85, 0.5, 0, 1, 4, 0.1, 0.4, 1.4, 2.5, 1, 0]),
  preset('leather', 'Leather',
    'Soft sheen with a pebbled grain of mid-size bumps.',
    [0.55, 0.8, 0, 0.8, 6, 0.5, 0.8, 0.6, 2, 1, 0.5]),
  preset('wood', 'Wood',
    'Satin finish with a fine grain and shallow depth.',
    [0.6, 1, 0, 0.6, 8, 0.2, 0.6, 0.9, 1.5, 1, 0]),
  preset('stone', 'Stone',
    'Rough and matte, with deep cracks and large shapes.',
    [0.82, 0.8, 0, 1.4, 10, 1, 0.8, 0.7, 3, 1.1, 0]),
  preset('plaster', 'Plaster',
    'Very matte with gentle, even bumps. Also suits concrete.',
    [0.9, 0.4, 0, 0.9, 8, 0.6, 0.6, 0.9, 1.8, 1, 0.5]),
  preset('metal', 'Metal',
    'Bare metal: fully metallic, fairly shiny, with light surface detail.',
    [0.35, 1.2, 1, 0.5, 6, 0.2, 0.3, 0.4, 1.2, 1, 0.5]),
  preset('plastic', 'Plastic',
    'Smooth, satin surface with almost no bumps. Also suits painted surfaces.',
    [0.38, 0.4, 0, 0.5, 6, 0.2, 0.2, 0.3, 1, 1, 1]),
  preset('polished', 'Polished',
    'Glossy and smooth, like ceramic, lacquer or polished stone.',
    [0.12, 0.3, 0, 0.3, 6, 0.1, 0.1, 0.2, 0.8, 1, 1]),
];

export const presetById = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
