/**
 * Type definitions for Hero Labs character export formats.
 * Supports both JSON export format and .por XML file structure.
 */

type Many<T> = T[];
type MaybeEmpty<T> = T | null | undefined;
type OneOrMany<T> = T | Many<T>;

/**
 * Hero Labs JSON Export Format
 * Based on Hero Lab Online export structure
 */
export type HeroLabsJsonExport = {
    portfolio?: {
        charId?: string;
        version?: string;
        baseline?: string;
    };
    metadata?: {
        gameSystem?: string;
        name?: string;
        version?: string;
    };
    actors: OneOrMany<HeroLabsActor>;
};

/**
 * Hero Labs Actor (character) structure
 */
export type HeroLabsActor = {
    id?: string;
    name?: string;
    player?: string;
    gameValues?: HeroLabsGameValues;
    items?: HeroLabsItems;
    [key: string]: unknown; // Allow additional fields
};

/**
 * Game-specific values for Shadowrun 5e
 */
export type HeroLabsGameValues = {
    // Attributes
    attributes?: {
        [key: string]: HeroLabsAttribute | number | string;
    };
    
    // Skills
    skills?: {
        [key: string]: HeroLabsSkill | number | string;
    };
    
    // Basic character info
    metatype?: string;
    metavariant?: string;
    essence?: string | number;
    magic?: string | number;
    resonance?: string | number;
    edge?: string | number;
    karma?: string | number;
    nuyen?: string | number;
    
    // Limits
    physicalLimit?: string | number;
    mentalLimit?: string | number;
    socialLimit?: string | number;
    
    // Initiative
    initiative?: string | number;
    initiativeDice?: string | number;
    
    // Condition monitors
    physicalCM?: string | number;
    stunCM?: string | number;
    
    // Reputation
    streetCred?: string | number;
    notoriety?: string | number;
    publicAwareness?: string | number;
    
    // Magic/Resonance specific
    tradition?: string;
    drainAttribute?: string;
    submersion?: string | number;
    initiation?: string | number;
    
    [key: string]: unknown;
};

/**
 * Hero Labs Attribute structure
 */
export type HeroLabsAttribute = {
    value?: number | string;
    base?: number | string;
    total?: number | string;
    min?: number | string;
    max?: number | string;
    name?: string;
    [key: string]: unknown;
};

/**
 * Hero Labs Skill structure
 */
export type HeroLabsSkill = {
    rating?: number | string;
    base?: number | string;
    total?: number | string;
    attribute?: string;
    category?: string;
    specialization?: string | string[];
    name?: string;
    isLanguage?: boolean | string;
    isNative?: boolean | string;
    [key: string]: unknown;
};

/**
 * Hero Labs Items collection
 */
export type HeroLabsItems = {
    [itemId: string]: HeroLabsItem;
};

/**
 * Hero Labs Item structure
 */
export type HeroLabsItem = {
    id?: string;
    name?: string;
    category?: string;
    type?: string;
    equipped?: boolean | string;
    quantity?: number | string;
    rating?: number | string;
    
    // Weapon specific
    damage?: string | number;
    ap?: string | number;
    accuracy?: string | number;
    mode?: string;
    ammo?: string | number;
    skill?: string;
    
    // Armor specific
    armor?: string | number;
    capacity?: string | number;
    
    // Cyberware/Bioware specific
    essence?: string | number;
    grade?: string;
    
    // Spell specific
    category?: string;
    range?: string;
    duration?: string;
    type?: string;
    drain?: string | number;
    
    // Gear specific
    cost?: string | number;
    availability?: string;
    weight?: string | number;
    
    // Contact specific
    connection?: string | number;
    loyalty?: string | number;
    
    // Vehicle specific
    handling?: string | number;
    speed?: string | number;
    body?: string | number;
    armor?: string | number;
    
    [key: string]: unknown;
};

/**
 * Hero Labs .por XML structure (simplified)
 * .por files are XML-based but the exact structure may vary
 */
export type HeroLabsPorXml = {
    "?xml"?: {
        "@version"?: string;
        "@encoding"?: string;
    };
    portfolio?: {
        char?: OneOrMany<HeroLabsPorCharacter>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
};

/**
 * Hero Labs .por Character structure
 */
export type HeroLabsPorCharacter = {
    id?: string;
    name?: string;
    [key: string]: unknown;
};

/**
 * Helper type to check if data is Hero Labs format
 */
export function isHeroLabsJson(data: unknown): data is HeroLabsJsonExport {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return 'actors' in obj || 'portfolio' in obj;
}

/**
 * Helper to get first actor from Hero Labs export
 */
export function getFirstActor(exportData: HeroLabsJsonExport): HeroLabsActor | null {
    if (!exportData.actors) return null;
    
    if (Array.isArray(exportData.actors)) {
        return exportData.actors[0] || null;
    }
    
    return exportData.actors;
}
