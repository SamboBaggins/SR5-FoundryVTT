/**
 * Public API for character import. Allows modules (e.g. Hero Labs Import) to
 * import a character from an ActorSchema without opening the system's importer UI.
 */

import { CharacterImporter, importOptionsType } from "./characterImporter/CharacterImporter";
import { SpiritImporter } from "./spiritImporter/SpiritImporter";
import { SpriteImporter } from "./spriteImporter/SpriteImporter";
import { ActorSchema } from "./ActorSchema";

const SPIRIT_TYPES = [
    'air', 'aircraft', 'airwave', 'ally', 'automotive', 'beasts', 'ceramic', 'earth', 'energy',
    'fire', 'guardian', 'guidance', 'homunculus', 'man', 'metal', 'plant', 'ship', 'task', 'train',
    'water', 'watcher', 'blood', 'muse', 'nightmare', 'shade', 'succubus', 'wraith',
    'shedim', 'hopper', 'blade_summoned', 'horror_show', 'unbreakable', 'master_shedim',
    'caretaker', 'nymph', 'scout', 'soldier', 'worker', 'queen',
    'carcass', 'corpse', 'rot', 'palefile', 'detritus',
    'anarch', 'arboreal', 'blackjack', 'boggle', 'bugul', 'chindi', 'corpselight', 'croki',
    'duende', 'ejerian', 'elvar', 'erinyes', 'green_man', 'imp', 'jarl', 'kappa', 'kokopelli',
    'morbi', 'nocnitsa', 'phantom', 'preta', 'stabber', 'tungak', 'vucub_caquix',
    'gum_toad', 'crawler', 'ghasts', 'vryghots', 'gremlin', 'anansi', 'tsuchigumo_warrior',
    'corps_cadavre',
    'abomination', 'barren', 'noxious', 'nuclear', 'plague', 'sludge'
] as const;

function getSpiritType(schema: ActorSchema): typeof SPIRIT_TYPES[number] | undefined {
    const raw = schema.metatype_english ?? '';
    const normalized = raw
        .replace(/\s*\(.*?\)\s*/g, '')
        .replace(/^Spirit of /, '')
        .replace(/ Spirit$/, '')
        .replace(/[\s-]/g, '_')
        .toLowerCase()
        .trim();
    return SPIRIT_TYPES.find(v => RegExp(`\\b${v}\\b`, "i").test(normalized));
}

/**
 * Import a character from an ActorSchema. Used by modules (e.g. Hero Labs Import)
 * after converting external data to ActorSchema.
 * @param schema Character data in Chummer/ActorSchema format
 * @param options Import options (folderId, which items to import, etc.)
 */
export async function importCharacterFromSchema(
    schema: ActorSchema,
    options: importOptionsType
): Promise<void> {
    const spiritType = getSpiritType(schema);
    if (spiritType) {
        await SpiritImporter.import(schema, spiritType, options);
    } else if (schema.metatype_english?.toLowerCase().includes('sprite')) {
        await SpriteImporter.import(schema, options);
    } else {
        await CharacterImporter.import(schema, options);
    }
}
