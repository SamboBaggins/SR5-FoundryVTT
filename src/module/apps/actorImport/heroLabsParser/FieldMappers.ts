/**
 * Field mapping utilities to convert Hero Labs data structure to ActorSchema format.
 */

import { ActorSchema } from "../ActorSchema";
import { HeroLabsActor, HeroLabsGameValues, HeroLabsAttribute, HeroLabsSkill, HeroLabsItem } from "../HeroLabsSchema";
import { ImportHelper as IH } from "../../itemImport/helper/ImportHelper";

type MaybeEmpty<T> = T | null | undefined;

/**
 * Attribute name mapping from Hero Labs to SR5
 */
const ATTRIBUTE_MAP: Record<string, string> = {
    'bod': 'body',
    'body': 'body',
    'agi': 'agility',
    'agility': 'agility',
    'rea': 'reaction',
    'reaction': 'reaction',
    'str': 'strength',
    'strength': 'strength',
    'cha': 'charisma',
    'charisma': 'charisma',
    'int': 'intuition',
    'intuition': 'intuition',
    'log': 'logic',
    'logic': 'logic',
    'wil': 'willpower',
    'willpower': 'willpower',
    'edg': 'edge',
    'edge': 'edge',
    'mag': 'magic',
    'magic': 'magic',
    'res': 'resonance',
    'resonance': 'resonance',
};

/**
 * Maps Hero Labs attributes to ActorSchema attributes format
 */
export function mapAttributes(heroLabsActor: HeroLabsActor): ActorSchema['attributes'] {
    const gameValues = heroLabsActor.gameValues;
    if (!gameValues?.attributes) {
        return ['', { attributecategory_english: '', attribute: [] }];
    }

    const attributes: ActorSchema['attributes'][1]['attribute'] = [];
    const attrs = gameValues.attributes;

    for (const [key, value] of Object.entries(attrs)) {
        const attName = normalizeAttributeName(key);
        if (!attName) continue;

        const attValue = typeof value === 'object' && value !== null
            ? value as HeroLabsAttribute
            : { value: value };

        const base = parseNumber(attValue.base ?? attValue.value ?? 0);
        const total = parseNumber(attValue.total ?? attValue.value ?? base);

        attributes.push({
            name_english: attName,
            name: attName,
            base: String(base),
            total: String(total),
            min: String(attValue.min ?? 1),
            max: String(attValue.max ?? 6),
            aug: String(total - base),
            bp: '0',
            metatypecategory: '',
        });
    }

    return ['', {
        attributecategory_english: '',
        attribute: attributes,
    }];
}

/**
 * Maps Hero Labs skills to ActorSchema skills format
 */
export function mapSkills(heroLabsActor: HeroLabsActor): ActorSchema['skills'] {
    const gameValues = heroLabsActor.gameValues;
    if (!gameValues?.skills) {
        return { skill: [] };
    }

    const skills: ActorSchema['skills']['skill'] = [];
    const skillData = gameValues.skills;

    for (const [key, value] of Object.entries(skillData)) {
        const skillValue = typeof value === 'object' && value !== null
            ? value as HeroLabsSkill
            : { rating: value };

        const rating = parseNumber(skillValue.rating ?? skillValue.base ?? 0);
        if (rating <= 0 && !skillValue.isLanguage) continue;

        const skillName = skillValue.name ?? key;
        const isLanguage = skillValue.isLanguage === true || skillValue.isLanguage === 'True' || 
                          skillValue.category?.toLowerCase().includes('language');
        const isKnowledge = skillValue.category?.toLowerCase().includes('knowledge') || 
                           skillValue.category?.toLowerCase().includes('academic') ||
                           skillValue.category?.toLowerCase().includes('professional') ||
                           skillValue.category?.toLowerCase().includes('interest') ||
                           skillValue.category?.toLowerCase().includes('street');

        const spec = skillValue.specialization;
        const specs = Array.isArray(spec) ? spec : (spec ? [spec] : []);

        const resonanceSkills = ['compiling', 'decompiling', 'registering'];
        let attr = (skillValue.attribute ?? 'int').toLowerCase();
        if (resonanceSkills.includes((skillName ?? '').toString().toLowerCase())) {
            attr = 'resonance';
        }

        skills.push({
            guid: foundry.utils.randomID(),
            suid: foundry.utils.randomID(),
            name: skillName,
            name_english: skillName,
            skillgroup: '',
            skillgroup_english: '',
            skillcategory: skillValue.category ?? '',
            skillcategory_english: skillValue.category ?? '',
            grouped: 'False',
            default: 'False',
            requiresgroundmovement: 'False',
            requiresswimmovement: 'False',
            requiresflymovement: 'False',
            rating: String(rating),
            ratingmax: String(skillValue.total ?? rating),
            specializedrating: String(rating),
            total: String(skillValue.total ?? rating),
            knowledge: isKnowledge ? 'True' : 'False',
            exotic: 'False',
            buywithkarma: 'False',
            base: String(skillValue.base ?? rating),
            karma: '0',
            spec: specs.length > 0 ? specs[0] : null,
            attribute: attr,
            displayattribute: attr,
            attributemod: '0',
            ratingmod: '0',
            poolmod: '0',
            islanguage: isLanguage ? 'True' : 'False',
            isnativelanguage: (skillValue.isNative === true || skillValue.isNative === 'True') ? 'True' : 'False',
            bp: '0',
            skillspecializations: specs.length > 0 ? {
                skillspecialization: specs.map(s => ({
                    guid: foundry.utils.randomID(),
                    name: s,
                    free: 'False',
                    expertise: 'False',
                    specbonus: '0',
                })),
            } : null,
        });
    }

    return { skill: skills };
}

/**
 * Maps Hero Labs items to ActorSchema items format
 * This is a simplified mapping - detailed item parsing will be done by ItemsParser
 */
export function mapItems(heroLabsActor: HeroLabsActor): {
    weapons?: ActorSchema['weapons'];
    armors?: ActorSchema['armors'];
    cyberwares?: ActorSchema['cyberwares'];
    gears?: ActorSchema['gears'];
    qualities?: ActorSchema['qualities'];
    spells?: ActorSchema['spells'];
    powers?: ActorSchema['powers'];
    complexforms?: ActorSchema['complexforms'];
    vehicles?: ActorSchema['vehicles'];
    contacts?: ActorSchema['contacts'];
    lifestyles?: ActorSchema['lifestyles'];
} {
    const items = heroLabsActor.items;
    if (!items) {
        return {};
    }

    const result: ReturnType<typeof mapItems> = {};

    for (const [itemId, item] of Object.entries(items)) {
        const category = (item.category ?? '').toLowerCase();
        const type = (item.type ?? '').toLowerCase();

        // Map items by category/type
        if (category.includes('weapon') || type.includes('weapon')) {
            if (!result.weapons) result.weapons = { weapon: [] };
            result.weapons.weapon.push(mapWeapon(item, itemId));
        } else if (category.includes('armor') || type.includes('armor')) {
            if (!result.armors) result.armors = { armor: [] };
            result.armors.armor.push(mapArmor(item, itemId));
        } else if (category.includes('cyberware') || category.includes('bioware') || type.includes('ware')) {
            if (!result.cyberwares) result.cyberwares = { cyberware: [] };
            result.cyberwares.cyberware.push(mapCyberware(item, itemId));
        } else if (category.includes('spell') || type.includes('spell')) {
            if (!result.spells) result.spells = { spell: [] };
            result.spells.spell.push(mapSpell(item, itemId));
        } else if (category.includes('power') || type.includes('adept')) {
            if (!result.powers) result.powers = { power: [] };
            result.powers.power.push(mapPower(item, itemId));
        } else if (category.includes('quality') || type.includes('quality')) {
            if (!result.qualities) result.qualities = { quality: [] };
            result.qualities.quality.push(mapQuality(item, itemId));
        } else if (category.includes('vehicle') || type.includes('vehicle') || type.includes('drone')) {
            if (!result.vehicles) result.vehicles = { vehicle: [] };
            result.vehicles.vehicle.push(mapVehicle(item, itemId));
        } else if (category.includes('contact') || type.includes('contact')) {
            if (!result.contacts) result.contacts = { contact: [] };
            result.contacts.contact.push(mapContact(item, itemId));
        } else if (category.includes('lifestyle') || type.includes('lifestyle')) {
            if (!result.lifestyles) result.lifestyles = { lifestyle: [] };
            result.lifestyles.lifestyle.push(mapLifestyle(item, itemId));
        } else {
            // Default to gear
            if (!result.gears) result.gears = { gear: [] };
            result.gears.gear.push(mapGear(item, itemId));
        }
    }

    return result;
}

/**
 * Maps magic/resonance data from Hero Labs to ActorSchema
 */
export function mapMagicData(heroLabsActor: HeroLabsActor): {
    magician?: 'True' | 'False';
    adept?: 'True' | 'False';
    technomancer?: 'True' | 'False';
    tradition?: ActorSchema['tradition'];
    initiationgrade?: ActorSchema['initiationgrade'];
} {
    const gameValues = heroLabsActor.gameValues;
    if (!gameValues) {
        return {};
    }

    const magic = parseNumber(gameValues.magic ?? 0);
    const resonance = parseNumber(gameValues.resonance ?? 0);
    const tradition = gameValues.tradition;

    const result: ReturnType<typeof mapMagicData> = {};

    if (magic > 0) {
        // Determine if magician or adept (simplified - may need more logic)
        const isAdept = tradition?.toLowerCase().includes('adept') || false;
        result.magician = isAdept ? 'False' : 'True';
        result.adept = isAdept ? 'True' : 'False';
        
        if (tradition) {
            result.tradition = {
                guid: foundry.utils.randomID(),
                sourceid: '',
                istechnomancertradition: 'False',
                name: tradition,
                name_english: tradition,
                fullname: tradition,
                fullname_english: tradition,
                extra: null,
                extra_english: null,
                drainattributes: gameValues.drainAttribute ?? 'Willpower',
                drainattributes_english: gameValues.drainAttribute ?? 'Willpower',
                drainvalue: '2',
                source: null,
                page: null,
            };
        }

        const initiation = parseNumber(gameValues.initiation ?? 0);
        if (initiation > 0) {
            result.initiationgrade = {
                initiationgrade: [{
                    guid: foundry.utils.randomID(),
                    grade: String(initiation),
                    group: 'False',
                    ordeal: 'False',
                    schooling: 'False',
                    technomancer: 'False',
                }],
                metamagics: [],
                arts: [],
                enhancements: [],
            };
        }
    }

    if (resonance > 0) {
        result.technomancer = 'True';
        const submersion = parseNumber(gameValues.submersion ?? 0);
        if (submersion > 0) {
            result.initiationgrade = {
                initiationgrade: [{
                    guid: foundry.utils.randomID(),
                    grade: String(submersion),
                    group: 'False',
                    ordeal: 'False',
                    schooling: 'False',
                    technomancer: 'True',
                }],
                metamagics: [],
                arts: [],
                enhancements: [],
            };
        }
    }

    return result;
}

/**
 * Maps vehicles from Hero Labs to ActorSchema format
 */
export function mapVehicles(heroLabsActor: HeroLabsActor): ActorSchema['vehicles'] {
    const items = heroLabsActor.items;
    if (!items) return null;

    const vehicles: ActorSchema['vehicles']['vehicle'] = [];

    for (const [itemId, item] of Object.entries(items)) {
        const category = (item.category ?? '').toLowerCase();
        const type = (item.type ?? '').toLowerCase();
        
        if (category.includes('vehicle') || type.includes('vehicle') || type.includes('drone')) {
            vehicles.push(mapVehicle(item, itemId));
        }
    }

    return vehicles.length > 0 ? { vehicle: vehicles } : null;
}

// Helper functions for individual item mappings

function mapWeapon(item: HeroLabsItem, id: string): ActorSchema['weapons']['weapon'][0] {
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? 'Unknown Weapon',
        name_english: item.name ?? 'Unknown Weapon',
        fullname: item.name ?? 'Unknown Weapon',
        fullname_english: item.name ?? 'Unknown Weapon',
        category: item.category ?? 'Ranged',
        category_english: item.category ?? 'Ranged',
        type: item.type ?? '',
        reach: '0',
        rawreach: '0',
        accuracy: String(item.accuracy ?? 0),
        accuracy_noammo: String(item.accuracy ?? 0),
        accuracy_english: String(item.accuracy ?? 0),
        accuracy_english_noammo: String(item.accuracy ?? 0),
        rawaccuracy: String(item.accuracy ?? 0),
        damage: String(item.damage ?? '0'),
        damage_noammo: String(item.damage ?? '0'),
        damage_english: String(item.damage ?? '0'),
        damage_noammo_english: String(item.damage ?? '0'),
        rawdamage: String(item.damage ?? '0'),
        ap: String(item.ap ?? '0'),
        ap_noammo: String(item.ap ?? '0'),
        ap_english: String(item.ap ?? '0'),
        ap_english_noammo: String(item.ap ?? '0'),
        rawap: String(item.ap ?? '0'),
        mode: item.mode ?? null,
        mode_noammo: item.mode ?? null,
        mode_english: item.mode ?? null,
        mode_english_noammo: item.mode ?? null,
        rc: '0',
        rc_noammo: '0',
        rc_english: '0',
        rc_english_noammo: '0',
        rawrc: '0',
        ammo: String(item.ammo ?? '0'),
        ammo_english: String(item.ammo ?? '0'),
        maxammo: String(item.ammo ?? '0'),
        conceal: '0',
        rawconceal: '0',
        availablemounts: '',
        availablemounts_english: '',
        avail: item.availability ?? '',
        avail_english: item.availability ?? '',
        cost: String(item.cost ?? '0'),
        owncost: String(item.cost ?? '0'),
        weight: String(item.weight ?? '0'),
        ownweight: String(item.weight ?? '0'),
        source: null,
        page: null,
        weaponname: null,
        location: null,
        attack: '0',
        sleaze: '0',
        dataprocessing: '0',
        firewall: '0',
        devicerating: '0',
        programlimit: '0',
        iscommlink: 'False',
        isprogram: 'False',
        active: 'False',
        homenode: 'False',
        conditionmonitor: '0',
        matrixcmfilled: '0',
        ranges: [],
        alternateranges: [],
        dicepool: '0',
        dicepool_noammo: '0',
        skill: item.skill ?? null,
        wirelesson: 'False',
    };
}

function mapArmor(item: HeroLabsItem, id: string): ActorSchema['armors']['armor'][0] {
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? 'Unknown Armor',
        name_english: item.name ?? 'Unknown Armor',
        fullname: item.name ?? 'Unknown Armor',
        fullname_english: item.name ?? 'Unknown Armor',
        category: item.category ?? 'Armor',
        category_english: item.category ?? 'Armor',
        armor: String(item.armor ?? '0'),
        totalarmorcapacity: String(item.capacity ?? '0'),
        calculatedcapacity: String(item.capacity ?? '0'),
        capacityremaining: String(item.capacity ?? '0'),
        avail: item.availability ?? '',
        cost: String(item.cost ?? '0'),
        owncost: String(item.cost ?? '0'),
        weight: String(item.weight ?? '0'),
        ownweight: String(item.weight ?? '0'),
        source: null,
        page: null,
        armorname: null,
        equipped: (item.equipped === true || item.equipped === 'True') ? 'True' : 'False',
        ratinglabel: String(item.rating ?? '0'),
        wirelesson: 'False',
        armormods: null,
        gears: null,
        extra: null,
        location: null,
        attack: '0',
        sleaze: '0',
        dataprocessing: '0',
        firewall: '0',
        devicerating: '0',
        programlimit: '0',
        iscommlink: 'False',
        isprogram: 'False',
        active: 'False',
        homenode: 'False',
        conditionmonitor: '0',
        matrixcmfilled: '0',
    };
}

function mapCyberware(item: HeroLabsItem, id: string): ActorSchema['cyberwares']['cyberware'][0] {
    const isBioware = (item.category ?? '').toLowerCase().includes('bioware') || 
                     (item.type ?? '').toLowerCase().includes('bioware');
    
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? 'Unknown Ware',
        name_english: item.name ?? 'Unknown Ware',
        fullname: item.name ?? 'Unknown Ware',
        fullname_english: item.name ?? 'Unknown Ware',
        category: item.category ?? 'Cyberware',
        category_english: item.category ?? 'Cyberware',
        ess: String(item.essence ?? '0'),
        capacity: String(item.capacity ?? '0'),
        avail: item.availability ?? '',
        cost: String(item.cost ?? '0'),
        owncost: String(item.cost ?? '0'),
        weight: String(item.weight ?? '0'),
        ownweight: String(item.weight ?? '0'),
        source: null,
        page: null,
        rating: String(item.rating ?? '0'),
        minrating: '0',
        maxrating: '0',
        ratinglabel: String(item.rating ?? '0'),
        allowsubsystems: null,
        wirelesson: 'False',
        grade: item.grade ?? 'Standard',
        location: null,
        extra: null,
        improvementsource: isBioware ? 'Bioware' : 'Cyberware',
        isgeneware: 'False',
        attack: '0',
        sleaze: '0',
        dataprocessing: '0',
        firewall: '0',
        devicerating: '0',
        programlimit: '0',
        iscommlink: 'False',
        isprogram: 'False',
        active: 'False',
        homenode: 'False',
        conditionmonitor: '0',
        matrixcmfilled: '0',
        gears: null,
        children: null,
    };
}

function mapSpell(item: HeroLabsItem, id: string): ActorSchema['spells']['spell'][0] {
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? 'Unknown Spell',
        name_english: item.name ?? 'Unknown Spell',
        fullname: item.name ?? 'Unknown Spell',
        fullname_english: item.name ?? 'Unknown Spell',
        descriptors: '',
        descriptors_english: '',
        category: item.category ?? 'Combat',
        category_english: item.category ?? 'Combat',
        type: item.type ?? 'Mana',
        type_english: item.type ?? 'Mana',
        range: item.range ?? 'LOS',
        range_english: item.range ?? 'LOS',
        damage: '',
        damage_english: '',
        duration: item.duration ?? 'Instant',
        duration_english: item.duration ?? 'Instant',
        dv: String(item.drain ?? '0'),
        dv_english: String(item.drain ?? '0'),
        alchemy: 'False',
        limited: 'False',
        barehandedadept: 'False',
        dicepool: '0',
        source: null,
        page: null,
        extra: null,
    };
}

function mapPower(item: HeroLabsItem, id: string): ActorSchema['powers']['power'][0] {
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? 'Unknown Power',
        name_english: item.name ?? 'Unknown Power',
        fullname: item.name ?? 'Unknown Power',
        fullname_english: item.name ?? 'Unknown Power',
        extra: null,
        extra_english: null,
        pointsperlevel: '1',
        adeptway: 'False',
        rating: String(item.rating ?? '0'),
        totalpoints: String(item.rating ?? '0'),
        action: null,
        action_english: null,
        source: null,
        page: null,
        enhancements: null,
    };
}

function mapQuality(item: HeroLabsItem, id: string): ActorSchema['qualities']['quality'][0] {
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? 'Unknown Quality',
        name_english: item.name ?? 'Unknown Quality',
        fullname: item.name ?? 'Unknown Quality',
        fullname_english: item.name ?? 'Unknown Quality',
        extra: null,
        extra_english: null,
        bp: '0',
        qualitytype: 'Positive',
        qualitytype_english: 'Positive',
        qualitysource: null,
        metagenic: 'False',
        source: null,
        page: null,
    };
}

function mapVehicle(item: HeroLabsItem, id: string): ActorSchema['vehicles']['vehicle'][0] {
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? 'Unknown Vehicle',
        name_english: item.name ?? 'Unknown Vehicle',
        fullname: item.name ?? 'Unknown Vehicle',
        fullname_english: item.name ?? 'Unknown Vehicle',
        category: item.category ?? 'Groundcraft',
        category_english: item.category ?? 'Groundcraft',
        isdrone: (item.type ?? '').toLowerCase().includes('drone') ? 'True' : 'False',
        handling: String(item.handling ?? '0'),
        accel: '0',
        speed: String(item.speed ?? '0'),
        pilot: '0',
        body: String(item.body ?? '0'),
        armor: String(item.armor ?? '0'),
        seats: '0',
        sensor: '0',
        avail: item.availability ?? '',
        cost: String(item.cost ?? '0'),
        owncost: String(item.cost ?? '0'),
        source: null,
        page: null,
        physicalcm: '0',
        physicalcmfilled: '0',
        vehiclename: null,
        maneuver: '0',
        location: null,
        attack: '0',
        sleaze: '0',
        dataprocessing: '0',
        firewall: '0',
        devicerating: '0',
        programlimit: '0',
        iscommlink: 'False',
        isprogram: 'False',
        active: 'False',
        homenode: 'False',
        matrixcm: '0',
        matrixcmfilled: '0',
        mods: null,
        gears: null,
        weapons: null,
        notes: null,
    };
}

function mapContact(item: HeroLabsItem, id: string): ActorSchema['contacts']['contact'][0] {
    return {
        guid: id,
        name: item.name ?? null,
        role: null,
        location: null,
        connection: String(item.connection ?? '0'),
        loyalty: String(item.loyalty ?? '0'),
        metatype: null,
        gender: null,
        age: null,
        contacttype: null,
        preferredpayment: null,
        hobbiesvice: null,
        personallife: null,
        type: 'Contact',
        forcedloyalty: '0',
        blackmail: 'False',
        family: 'False',
    };
}

function mapLifestyle(item: HeroLabsItem, id: string): ActorSchema['lifestyles']['lifestyle'][0] {
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? null,
        city: null,
        district: null,
        borough: null,
        cost: String(item.cost ?? '0'),
        totalmonthlycost: String(item.cost ?? '0'),
        totalcost: String(item.cost ?? '0'),
        dice: '0',
        multiplier: '1',
        months: '1',
        purchased: 'True',
        type: item.type ?? 'Street',
        increment: '1',
        bonuslp: '0',
        baselifestyle: item.type ?? 'Street',
        baselifestyle_english: item.type ?? 'Street',
        trustfund: 'False',
        source: null,
        page: null,
        qualities: null,
    };
}

function mapGear(item: HeroLabsItem, id: string): ActorSchema['gears']['gear'][0] {
    return {
        guid: id,
        sourceid: '',
        name: item.name ?? 'Unknown Gear',
        name_english: item.name ?? 'Unknown Gear',
        fullname: item.name ?? 'Unknown Gear',
        fullname_english: item.name ?? 'Unknown Gear',
        category: item.category ?? 'Gear',
        category_english: item.category ?? 'Gear',
        ispersona: 'False',
        isammo: (item.category ?? '').toLowerCase().includes('ammo') ? 'True' : 'False',
        issin: 'False',
        capacity: item.capacity ?? null,
        armorcapacity: null,
        maxrating: null,
        rating: String(item.rating ?? '0'),
        qty: String(item.quantity ?? '1'),
        avail: item.availability ?? '',
        avail_english: item.availability ?? '',
        cost: String(item.cost ?? '0'),
        owncost: String(item.cost ?? '0'),
        weight: String(item.weight ?? '0'),
        ownweight: String(item.weight ?? '0'),
        extra: null,
        bonded: 'False',
        equipped: (item.equipped === true || item.equipped === 'True') ? 'True' : 'False',
        wirelesson: 'False',
        location: null,
        gearname: null,
        source: null,
        page: null,
        attack: '0',
        sleaze: '0',
        dataprocessing: '0',
        firewall: '0',
        devicerating: '0',
        programlimit: '0',
        iscommlink: 'False',
        isprogram: 'False',
        active: 'False',
        homenode: 'False',
        conditionmonitor: '0',
        matrixcmfilled: '0',
        children: null,
    };
}

// Utility functions

function normalizeAttributeName(name: string): string {
    const normalized = name.trim().toLowerCase();
    return ATTRIBUTE_MAP[normalized] ?? '';
}

function parseNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = parseFloat(value.replace(/[,]/g, ''));
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}
