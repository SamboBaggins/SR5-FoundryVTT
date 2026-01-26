/**
 * Main parser for Hero Labs character data.
 * Converts Hero Labs JSON export or .por file data to ActorSchema format.
 */

import { ActorSchema } from '../ActorSchema';
import { HeroLabsJsonExport, HeroLabsActor, getFirstActor, isHeroLabsJson } from '../HeroLabsSchema';
import { parsePorFile } from './PorFileParser';
import { mapAttributes, mapSkills, mapItems, mapMagicData, mapVehicles } from './FieldMappers';

type MaybeEmpty<T> = T | null | undefined;

/**
 * Parses Hero Labs data (JSON or .por XML) and converts it to ActorSchema format.
 * @param data - Hero Labs JSON export object or .por XML string
 * @returns ActorSchema object ready for CharacterImporter
 */
export async function parseHeroLabsData(data: unknown): Promise<ActorSchema> {
    let heroLabsExport: HeroLabsJsonExport;

    // Determine if input is JSON object or XML string
    if (typeof data === 'string') {
        // Assume it's XML (.por file content)
        heroLabsExport = await parsePorFile(data);
    } else if (isHeroLabsJson(data)) {
        // It's already a Hero Labs JSON export
        heroLabsExport = data;
    } else {
        throw new Error('Invalid Hero Labs data format. Expected JSON export object or .por XML string.');
    }

    // Get the first actor (primary character)
    const actor = getFirstActor(heroLabsExport);
    if (!actor) {
        throw new Error('No character data found in Hero Labs export. The export may be empty or invalid.');
    }

    // Validate actor has minimum required data
    if (!actor.gameValues && !actor.items) {
        throw new Error('Hero Labs actor data is incomplete. Missing gameValues and items.');
    }

    // Convert to ActorSchema
    try {
        return convertToActorSchema(actor);
    } catch (error) {
        throw new Error(`Failed to convert Hero Labs data to ActorSchema: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Converts a Hero Labs actor to ActorSchema format.
 */
function convertToActorSchema(heroLabsActor: HeroLabsActor): ActorSchema {
    const gameValues = heroLabsActor.gameValues || {};
    const items = mapItems(heroLabsActor);
    const magicData = mapMagicData(heroLabsActor);

    // Build the ActorSchema
    const actorSchema: ActorSchema = {
        // Basic info
        settings: '',
        buildmethod: 'Priority',
        imageformat: '',
        metatype: gameValues.metatype || 'Human',
        metatype_english: gameValues.metatype || 'Human',
        metatype_guid: foundry.utils.randomID(),
        metavariant: gameValues.metavariant || null,
        metavariant_english: gameValues.metavariant || null,
        metavariant_guid: foundry.utils.randomID(),
        
        // Movement
        movement: '',
        walk: '0',
        run: '0',
        sprint: '0',
        movementwalk: '0',
        movementswim: '0',
        movementfly: '0',
        
        // Priority (defaults)
        prioritymetatype: '',
        priorityattributes: '',
        priorityspecial: '',
        priorityskills: ['', null],
        priorityresources: '',
        primaryarm: '',
        
        // Character identity
        name: heroLabsActor.name || '[Name not found]',
        alias: heroLabsActor.name || null,
        playername: heroLabsActor.player || null,
        
        // Bio
        gender: null,
        age: null,
        eyes: null,
        height: null,
        weight: null,
        skin: null,
        hair: null,
        description: null,
        background: null,
        concept: null,
        notes: null,
        gamenotes: null,
        
        // Limits
        limitphysical: String(gameValues.physicalLimit ?? 0),
        limitmental: String(gameValues.mentalLimit ?? 0),
        limitsocial: String(gameValues.socialLimit ?? 0),
        limitastral: '0',
        
        // Contact points
        contactpoints: '0',
        contactpointsused: '0',
        cfplimit: '0',
        ainormalprogramlimit: '0',
        aiadvancedprogramlimit: '0',
        spelllimit: '0',
        
        // Karma and resources
        karma: String(gameValues.karma ?? 0),
        totalkarma: String(gameValues.karma ?? 0),
        special: magicData.technomancer === 'True' ? 'resonance' : (magicData.magician === 'True' || magicData.adept === 'True' ? 'magic' : 'mundane'),
        totalspecial: String(gameValues.magic ?? gameValues.resonance ?? 0),
        
        // Attributes
        attributes: mapAttributes(heroLabsActor),
        totalattributes: '0',
        
        // Edge
        edgeused: '0',
        edgeremaining: String(gameValues.edge ?? 0),
        
        // Reputation
        streetcred: String(gameValues.streetCred ?? 0),
        calculatedstreetcred: String(gameValues.streetCred ?? 0),
        totalstreetcred: String(gameValues.streetCred ?? 0),
        burntstreetcred: '0',
        notoriety: String(gameValues.notoriety ?? 0),
        calculatednotoriety: String(gameValues.notoriety ?? 0),
        totalnotoriety: String(gameValues.notoriety ?? 0),
        publicawareness: String(gameValues.publicAwareness ?? 0),
        calculatedpublicawareness: String(gameValues.publicAwareness ?? 0),
        totalpublicawareness: String(gameValues.publicAwareness ?? 0),
        astralreputation: '0',
        totalastralreputation: '0',
        wildreputation: '0',
        totalwildreputation: '0',
        
        // Status flags
        created: 'True',
        nuyen: String(gameValues.nuyen ?? 0).replace(/[,]/g, ''),
        adept: magicData.adept || 'False',
        magician: magicData.magician || 'False',
        technomancer: magicData.technomancer || 'False',
        ai: 'False',
        cyberwaredisabled: 'False',
        critter: 'False',
        totaless: String(gameValues.essence ?? 6),
        
        // Tradition
        tradition: magicData.tradition || null,
        
        // Armor
        dodge: '0',
        armor: '0',
        firearmor: '0',
        coldarmor: '0',
        electricityarmor: '0',
        acidarmor: '0',
        fallingarmor: '0',
        armordicestun: '0',
        firearmordicestun: '0',
        coldarmordicestun: '0',
        electricityarmordicestun: '0',
        acidarmordicestun: '0',
        fallingarmordicestun: '0',
        armordicephysical: '0',
        firearmordicephysical: '0',
        coldarmordicephysical: '0',
        electricityarmordicephysical: '0',
        acidarmordicephysical: '0',
        fallingarmordicephysical: '0',
        
        // Condition monitors
        physicalcm: String(gameValues.physicalCM ?? 0),
        physicalcmiscorecm: 'False',
        stuncm: String(gameValues.stunCM ?? 0),
        stuncmismatrixcm: 'False',
        physicalcmfilled: '0',
        stuncmfilled: '0',
        cmthreshold: '0',
        physicalcmthresholdoffset: '0',
        stuncmthresholdoffset: '0',
        cmoverflow: '0',
        
        // Initiative
        init: String(gameValues.initiative ?? 0),
        initdice: String(gameValues.initiativeDice ?? 1),
        initvalue: String(gameValues.initiative ?? 0),
        initbonus: '0',
        astralinit: '0',
        astralinitdice: '2',
        astralinitvalue: '0',
        matrixarinit: '0',
        matrixarinitdice: '3',
        matrixarinitvalue: '0',
        matrixcoldinit: '0',
        matrixcoldinitdice: '3',
        matrixcoldinitvalue: '0',
        matrixhotinit: '0',
        matrixhotinitdice: '4',
        matrixhotinitvalue: '0',
        riggerinit: '0',
        
        // Magic/Resonance
        magenabled: (magicData.magician === 'True' || magicData.adept === 'True') ? 'True' : 'False',
        initiategrade: magicData.initiationgrade || null,
        resenabled: magicData.technomancer === 'True' ? 'True' : 'False',
        submersiongrade: String(gameValues.submersion ?? 0),
        depenabled: 'False',
        
        // Group
        groupmember: 'False',
        groupname: null,
        groupnotes: null,
        
        // Derived stats
        surprise: '0',
        composure: '0',
        judgeintentions: '0',
        judgeintentionsresist: '0',
        liftandcarry: '0',
        memory: '0',
        liftweight: '0',
        carryweight: '0',
        totalcarriedweight: '0',
        
        // Resistances
        fatigueresist: '0',
        radiationresist: '0',
        sonicresist: '0',
        toxincontactresist: '0',
        toxiningestionresist: '0',
        toxininhalationresist: '0',
        toxininjectionresist: '0',
        pathogencontactresist: '0',
        pathogeningestionresist: '0',
        pathogeninhalationresist: '0',
        pathogeninjectionresist: '0',
        physiologicaladdictionresistfirsttime: '0',
        physiologicaladdictionresistalreadyaddicted: '0',
        psychologicaladdictionresistfirsttime: '0',
        psychologicaladdictionresistalreadyaddicted: '0',
        physicalcmnaturalrecovery: '0',
        stuncmnaturalrecovery: '0',
        indirectdefenseresist: '0',
        directmanaresist: '0',
        directphysicalresist: '0',
        detectionspellresist: '0',
        decreasebodresist: '0',
        decreaseagiresist: '0',
        decreaserearesist: '0',
        decreasestrresist: '0',
        decreasecharesist: '0',
        decreaseintresist: '0',
        decreaselogresist: '0',
        decreasewilresist: '0',
        illusionmanaresist: '0',
        illusionphysicalresist: '0',
        manipulationmentalresist: '0',
        manipulationphysicalresist: '0',
        
        // Skills
        skills: mapSkills(heroLabsActor),
        
        // Items
        weapons: items.weapons || null,
        armors: items.armors || null,
        cyberwares: items.cyberwares || null,
        gears: items.gears || null,
        qualities: items.qualities || null,
        spells: items.spells || null,
        powers: items.powers || null,
        complexforms: items.complexforms || null,
        vehicles: mapVehicles(heroLabsActor) || null,
        contacts: items.contacts || null,
        lifestyles: items.lifestyles || null,
        
        // Other item types (defaults)
        spirits: null,
        aiprograms: null,
        martialarts: null,
        drugs: null,
        limitmodifiersphys: null,
        limitmodifiersment: null,
        limitmodifierssoc: null,
        mentorspirits: null,
        otherarmors: null,
        calendar: null,
        metamagics: null,
        arts: null,
        enhancements: null,
        critterpowers: null,
        sustainedobjects: null,
    };

    return actorSchema;
}

/**
 * Validates Hero Labs data structure.
 * @param data - Data to validate
 * @returns true if valid, throws error if invalid
 */
export function validateHeroLabsData(data: unknown): boolean {
    if (data === null || data === undefined) {
        throw new Error('Hero Labs data is null or undefined.');
    }

    if (typeof data === 'string') {
        // XML string - basic validation
        const trimmed = data.trim();
        if (!trimmed) {
            throw new Error('Hero Labs data is empty.');
        }
        if (!trimmed.startsWith('<')) {
            throw new Error('Invalid .por file format. Expected XML content.');
        }
        // Check for basic XML structure
        if (!trimmed.includes('<?xml') && !trimmed.includes('<portfolio') && !trimmed.includes('<char')) {
            throw new Error('Invalid .por file format. Missing expected XML structure.');
        }
        return true;
    }

    if (typeof data === 'object') {
        if (isHeroLabsJson(data)) {
            const actor = getFirstActor(data);
            if (!actor) {
                throw new Error('No character data found in Hero Labs export. The export may be empty or invalid.');
            }
            // Validate actor has at least a name or id
            if (!actor.name && !actor.id) {
                throw new Error('Hero Labs actor data is missing required fields (name or id).');
            }
            return true;
        } else {
            throw new Error('Invalid Hero Labs JSON structure. Expected "actors" or "portfolio" property.');
        }
    }

    throw new Error('Invalid Hero Labs data format. Expected JSON export object or .por XML string.');
}
