/**
 * Parser for Hero Labs .por (Portfolio) files.
 * .por files are XML-based character files used by Hero Labs.
 */

import { Parser } from 'xml2js';
import { HeroLabsJsonExport, HeroLabsActor, HeroLabsPorXml } from '../HeroLabsSchema';

/**
 * Parses a .por XML file and converts it to Hero Labs JSON-like structure.
 * @param xmlContent - The XML content as a string
 * @returns A HeroLabsJsonExport structure
 */
export async function parsePorFile(xmlContent: string): Promise<HeroLabsJsonExport> {
    const parser = new Parser({
        trim: true,
        attrkey: "$",
        charkey: "_TEXT",
        emptyTag: () => null,
        explicitRoot: false,
        explicitArray: false,
        explicitCharkey: true,
    });

    try {
        const xmlData = await parser.parseStringPromise(xmlContent) as HeroLabsPorXml;
        return convertPorXmlToJson(xmlData);
    } catch (error) {
        console.error('Error parsing .por file:', error);
        throw new Error(`Failed to parse .por file: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Converts parsed .por XML structure to Hero Labs JSON export format.
 * @param porXml - The parsed XML structure
 * @returns HeroLabsJsonExport format
 */
function convertPorXmlToJson(porXml: HeroLabsPorXml): HeroLabsJsonExport {
    const result: HeroLabsJsonExport = {
        portfolio: {
            charId: extractValue(porXml, 'portfolio.charId') || undefined,
            version: extractValue(porXml, 'portfolio.version') || undefined,
            baseline: extractValue(porXml, 'portfolio.baseline') || undefined,
        },
        actors: [],
    };

    // Extract character data from portfolio
    const portfolio = porXml.portfolio;
    if (portfolio) {
        const characters = extractCharacters(portfolio);
        if (characters.length > 0) {
            result.actors = characters;
        } else {
            // Fallback: try to extract actor data directly from portfolio
            const actor = extractActorFromPortfolio(portfolio);
            if (actor) {
                result.actors = [actor];
            }
        }
    }

    return result;
}

/**
 * Extracts character data from portfolio structure.
 */
function extractCharacters(portfolio: unknown): HeroLabsActor[] {
    const actors: HeroLabsActor[] = [];
    
    if (typeof portfolio !== 'object' || portfolio === null) {
        return actors;
    }

    const portfolioObj = portfolio as Record<string, unknown>;
    
    // Try various possible structures
    if (portfolioObj.char) {
        const chars = Array.isArray(portfolioObj.char) 
            ? portfolioObj.char 
            : [portfolioObj.char];
        
        for (const char of chars) {
            const actor = extractActorData(char);
            if (actor) actors.push(actor);
        }
    } else if (portfolioObj.character) {
        const chars = Array.isArray(portfolioObj.character)
            ? portfolioObj.character
            : [portfolioObj.character];
        
        for (const char of chars) {
            const actor = extractActorData(char);
            if (actor) actors.push(actor);
        }
    } else if (portfolioObj.actor) {
        const chars = Array.isArray(portfolioObj.actor)
            ? portfolioObj.actor
            : [portfolioObj.actor];
        
        for (const char of chars) {
            const actor = extractActorData(char);
            if (actor) actors.push(actor);
        }
    }

    return actors;
}

/**
 * Extracts actor data from a character/actor object.
 */
function extractActorData(charData: unknown): HeroLabsActor | null {
    if (typeof charData !== 'object' || charData === null) {
        return null;
    }

    const char = charData as Record<string, unknown>;
    
    const actor: HeroLabsActor = {
        id: extractStringValue(char, 'id') || '1',
        name: extractStringValue(char, 'name'),
        player: extractStringValue(char, 'player'),
        gameValues: extractGameValues(char),
        items: extractItems(char),
    };

    return actor;
}

/**
 * Extracts game values from character data.
 */
function extractGameValues(char: Record<string, unknown>): HeroLabsActor['gameValues'] {
    const gameValues: HeroLabsActor['gameValues'] = {};

    // Extract attributes
    if (char.attributes || char.attr) {
        const attrs = char.attributes || char.attr;
        if (typeof attrs === 'object' && attrs !== null) {
            gameValues.attributes = attrs as Record<string, unknown>;
        }
    }

    // Extract skills
    if (char.skills || char.skill) {
        const skills = char.skills || char.skill;
        if (typeof skills === 'object' && skills !== null) {
            gameValues.skills = skills as Record<string, unknown>;
        }
    }

    // Extract basic stats
    gameValues.metatype = extractStringValue(char, 'metatype');
    gameValues.metavariant = extractStringValue(char, 'metavariant');
    gameValues.essence = extractNumberValue(char, 'essence');
    gameValues.magic = extractNumberValue(char, 'magic');
    gameValues.resonance = extractNumberValue(char, 'resonance');
    gameValues.edge = extractNumberValue(char, 'edge');
    gameValues.karma = extractNumberValue(char, 'karma');
    gameValues.nuyen = extractNumberValue(char, 'nuyen');
    gameValues.physicalLimit = extractNumberValue(char, 'physicalLimit');
    gameValues.mentalLimit = extractNumberValue(char, 'mentalLimit');
    gameValues.socialLimit = extractNumberValue(char, 'socialLimit');
    gameValues.initiative = extractNumberValue(char, 'initiative');
    gameValues.initiativeDice = extractNumberValue(char, 'initiativeDice');
    gameValues.physicalCM = extractNumberValue(char, 'physicalCM');
    gameValues.stunCM = extractNumberValue(char, 'stunCM');
    gameValues.streetCred = extractNumberValue(char, 'streetCred');
    gameValues.notoriety = extractNumberValue(char, 'notoriety');
    gameValues.publicAwareness = extractNumberValue(char, 'publicAwareness');
    gameValues.tradition = extractStringValue(char, 'tradition');
    gameValues.drainAttribute = extractStringValue(char, 'drainAttribute');
    gameValues.submersion = extractNumberValue(char, 'submersion');
    gameValues.initiation = extractNumberValue(char, 'initiation');

    return gameValues;
}

/**
 * Extracts items from character data.
 */
function extractItems(char: Record<string, unknown>): HeroLabsActor['items'] {
    const items: HeroLabsActor['items'] = {};

    // Try various item collection names
    const itemCollections = ['items', 'item', 'equipment', 'gear', 'possessions'];
    
    for (const collectionName of itemCollections) {
        if (char[collectionName]) {
            const collection = char[collectionName];
            if (typeof collection === 'object' && collection !== null) {
                const collectionObj = collection as Record<string, unknown>;
                
                // Handle array of items
                if (Array.isArray(collectionObj)) {
                    for (const item of collectionObj) {
                        if (typeof item === 'object' && item !== null) {
                            const itemObj = item as Record<string, unknown>;
                            const itemId = extractStringValue(itemObj, 'id') || foundry.utils.randomID();
                            items[itemId] = itemObj as HeroLabsActor['items'][string];
                        }
                    }
                } else {
                    // Handle object with item IDs as keys
                    for (const [itemId, item] of Object.entries(collectionObj)) {
                        if (typeof item === 'object' && item !== null) {
                            items[itemId] = item as HeroLabsActor['items'][string];
                        }
                    }
                }
                break;
            }
        }
    }

    return Object.keys(items).length > 0 ? items : undefined;
}

/**
 * Extracts actor from portfolio when character structure is different.
 */
function extractActorFromPortfolio(portfolio: unknown): HeroLabsActor | null {
    if (typeof portfolio !== 'object' || portfolio === null) {
        return null;
    }

    const portfolioObj = portfolio as Record<string, unknown>;
    
    // Try to extract actor data directly from portfolio
    const actor: HeroLabsActor = {
        id: '1',
        name: extractStringValue(portfolioObj, 'name'),
        player: extractStringValue(portfolioObj, 'player'),
        gameValues: extractGameValues(portfolioObj),
        items: extractItems(portfolioObj),
    };

    return actor;
}

/**
 * Extracts a string value from an object using a dot-notation path.
 */
function extractStringValue(obj: unknown, path: string): string | undefined {
    const value = extractValue(obj, path);
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (value && typeof value === 'object' && '_TEXT' in value) {
        return String((value as { _TEXT: unknown })._TEXT);
    }
    return undefined;
}

/**
 * Extracts a number value from an object using a dot-notation path.
 */
function extractNumberValue(obj: unknown, path: string): number | undefined {
    const value = extractValue(obj, path);
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = parseFloat(value.replace(/[,]/g, ''));
        return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

/**
 * Extracts a value from an object using a dot-notation path.
 */
function extractValue(obj: unknown, path: string): unknown {
    if (typeof obj !== 'object' || obj === null) {
        return undefined;
    }

    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
        if (typeof current !== 'object' || current === null) {
            return undefined;
        }

        const currentObj = current as Record<string, unknown>;
        
        // Handle _TEXT key for XML text content
        if (part in currentObj) {
            current = currentObj[part];
        } else if ('_TEXT' in currentObj) {
            return currentObj._TEXT;
        } else {
            return undefined;
        }
    }

    // If final value is an object with _TEXT, return the text
    if (typeof current === 'object' && current !== null && '_TEXT' in current) {
        return (current as { _TEXT: unknown })._TEXT;
    }

    return current;
}
