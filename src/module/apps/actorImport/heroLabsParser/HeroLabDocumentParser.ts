/**
 * Parser for Hero Lab's native XML export format:
 * <document><public><character>...</character></public></document>
 */

import { ActorSchema } from '../ActorSchema';

type XmlNode = Record<string, unknown> | { _TEXT?: string } | string;
type OneOrMany<T> = T | T[];

function getAttr(node: XmlNode | null | undefined, key: string): string | undefined {
    if (node == null || typeof node !== 'object') return undefined;
    const obj = node as Record<string, unknown>;
    const attrs = obj.$ as Record<string, string> | undefined;
    if (attrs && key in attrs) return attrs[key];
    if (key in obj && typeof (obj as Record<string, unknown>)[key] === 'string') return (obj as Record<string, string>)[key];
    return undefined;
}

function getText(node: XmlNode | null | undefined): string {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    const obj = node as Record<string, unknown>;
    const text = obj._TEXT;
    return typeof text === 'string' ? text : '';
}

function ensureArray<T>(val: OneOrMany<T> | null | undefined): T[] {
    if (val == null) return [];
    return Array.isArray(val) ? val : [val];
}

function getArmorRating(charNode: Record<string, unknown>): string | undefined {
    const block = charNode.armorratings as Record<string, unknown> | undefined;
    if (!block) return undefined;
    const rating = block.armorrating;
    if (!rating) return undefined;
    const list = ensureArray(rating);
    const armor = list.find((r: unknown) => getAttr(r as Record<string, unknown>, 'name') === 'Armor') ?? list[0];
    return armor ? getAttr(armor as XmlNode, 'rating') : undefined;
}

function getMovementValue(charNode: Record<string, unknown>, key: 'walking' | 'running'): string | undefined {
    const block = charNode.movementtypes as Record<string, unknown> | undefined;
    if (!block) return undefined;
    const mt = block.movementtype;
    if (!mt) return undefined;
    const list = ensureArray(mt);
    const land = list.find((m: unknown) => getAttr(m as Record<string, unknown>, 'name') === 'Land Movement') ?? list[0];
    if (!land || typeof land !== 'object') return undefined;
    const child = (land as Record<string, unknown>)[key];
    return child ? getAttr(child as XmlNode, 'value') : undefined;
}

/** Attribute name (Hero Lab) -> SR5 abbreviation */
const ATTR_NAME_TO_ABBREV: Record<string, string> = {
    'Body': 'bod',
    'Agility': 'agi',
    'Reaction': 'rea',
    'Strength': 'str',
    'Willpower': 'wil',
    'Logic': 'log',
    'Intuition': 'int',
    'Charisma': 'cha',
    'Edge': 'edg',
    'Essence': 'ess',
    'Magic': 'mag',
    'Resonance': 'res',
    'Initiative': 'ini'
};

/**
 * Parses Hero Lab document XML (parsed with xml2js) and returns ActorSchema.
 * Expects structure: { document: { public: { character: { ... } } } }
 */
export function parseHeroLabDocumentXml(parsed: unknown): ActorSchema {
    const doc = parsed as Record<string, unknown>;
    const root = (doc.document ?? doc) as Record<string, unknown>;
    const publicNode = root.public as Record<string, unknown> | undefined;
    if (!publicNode) throw new Error('Hero Lab XML: missing document/public root.');
    const charNode = publicNode.character as Record<string, unknown> | undefined;
    if (!charNode || typeof charNode !== 'object') throw new Error('Hero Lab XML: missing character node.');

    const name = getAttr(charNode, 'name') ?? '[Name not found]';
    const playername = getAttr(charNode, 'playername') ?? '';
    const race = getAttr((charNode.race as XmlNode), 'name') ?? 'Human';
    const heritage = getAttr((charNode.heritage as XmlNode), 'name') ?? '';
    const karmaNode = charNode.karma as Record<string, unknown>;
    const karmaTotal = getAttr(karmaNode, 'total') ?? getAttr(karmaNode, 'left') ?? '0';
    const cashNode = charNode.cash as Record<string, unknown>;
    const nuyen = (getAttr(cashNode, 'total') ?? '0').replace(/[,¥]/g, '');
    const personal = charNode.personal as Record<string, unknown> | undefined;
    const description = personal ? getText(personal.description) : '';

    // Attributes
    const attributesBlock = charNode.attributes as Record<string, unknown> | undefined;
    const attrList = attributesBlock ? ensureArray(attributesBlock.attribute) : [];
    const attributeEntries: ActorSchema['attributes'][1]['attribute'] = [];
    for (const a of attrList) {
        const att = a as Record<string, unknown>;
        const aname = getAttr(att, 'name');
        if (!aname) continue;
        const abbrev = ATTR_NAME_TO_ABBREV[aname];
        if (!abbrev || abbrev === 'ini' || abbrev === 'ess') continue; // skip Initiative, Essence for standard attribute list
        const base = getAttr(att, 'base') ?? getAttr(att, 'modified') ?? '0';
        const total = getAttr(att, 'modified') ?? base;
        const numBase = parseInt(String(base).replace(/[^0-9]/g, ''), 10) || 0;
        const numTotal = parseInt(String(total).replace(/[^0-9]/g, ''), 10) || numBase;
        attributeEntries.push({
            name_english: abbrev,
            name: aname,
            base: String(numBase),
            total: String(numTotal),
            min: getAttr(att, 'minimum') ?? '1',
            max: getAttr(att, 'augmentedmaximum') ?? '6',
            aug: String(Math.max(0, numTotal - numBase)),
            bp: '0',
            metatypecategory: ''
        });
    }

    // Initiative from attribute or derived
    let initBase = '0';
    let initDice = '1';
    const iniAttr = attrList.find((a: unknown) => getAttr(a as Record<string, unknown>, 'name') === 'Initiative') as Record<string, unknown> | undefined;
    if (iniAttr) {
        const mod = getAttr(iniAttr, 'modified') ?? getAttr(iniAttr, 'base') ?? '0';
        const text = getAttr(iniAttr, 'text') ?? mod;
        initBase = String(parseInt(String(mod).replace(/\D/g, ''), 10) || 0);
        if (/\d*D?\d*/i.test(String(text))) {
            const diceMatch = String(text).match(/(\d+)D\d+/i);
            if (diceMatch) initDice = diceMatch[1];
        }
    }

    // Reputations
    const reps = (charNode.reputations as Record<string, unknown>)?.reputation;
    const repList = ensureArray(reps);
    let streetCred = '0', notoriety = '0', publicAwareness = '0';
    for (const r of repList) {
        const rec = r as Record<string, unknown>;
        const n = (getAttr(rec, 'name') ?? '').toLowerCase();
        const v = getAttr(rec, 'value') ?? '0';
        if (n.includes('street')) streetCred = v;
        else if (n.includes('notoriety')) notoriety = v;
        else if (n.includes('public')) publicAwareness = v;
    }

    // Magic/Resonance
    const hasResonance = (charNode.resonance as Record<string, unknown>) != null;
    const hasMagic = (charNode.magic as Record<string, unknown>) != null;
    let magicVal = '0', resonanceVal = '0';
    const resAttr = attrList.find((a: unknown) => getAttr(a as Record<string, unknown>, 'name') === 'Resonance') as Record<string, unknown> | undefined;
    const magAttr = attrList.find((a: unknown) => getAttr(a as Record<string, unknown>, 'name') === 'Magic') as Record<string, unknown> | undefined;
    if (resAttr) resonanceVal = getAttr(resAttr, 'modified') ?? getAttr(resAttr, 'base') ?? '0';
    if (magAttr) magicVal = getAttr(magAttr, 'modified') ?? getAttr(magAttr, 'base') ?? '0';

    const special = hasResonance ? 'resonance' : (parseInt(magicVal, 10) > 0 ? 'magic' : 'mundane');
    const totalspecial = hasResonance ? resonanceVal : magicVal;

    // Skills: active, knowledge, language
    const skillsBlock = charNode.skills as Record<string, unknown> | undefined;
    const activeSkills = skillsBlock?.active ? ensureArray((skillsBlock.active as Record<string, unknown>).skill) : [];
    const knowledgeSkills = skillsBlock?.knowledge ? ensureArray((skillsBlock.knowledge as Record<string, unknown>).skill) : [];
    const languageSkills = skillsBlock?.language ? ensureArray((skillsBlock.language as Record<string, unknown>).skill) : [];
    const skillEntries: ActorSchema['skills']['skill'] = [];

    const pushSkill = (s: unknown, isLang: boolean, isNative: boolean) => {
        const rec = s as Record<string, unknown>;
        const sname = getAttr(rec, 'name') ?? 'Unknown';
        const base = getAttr(rec, 'base') ?? getAttr(rec, 'modified') ?? '0';
        const total = getAttr(rec, 'modified') ?? base;
        const rating = String(parseInt(String(base).replace(/\D/g, ''), 10) || 0);
        if (rating === '0' && !isLang) return;
        const attr = (getAttr(rec, 'attribute') ?? 'log').toLowerCase();
        const cat = (getAttr(rec, 'category') ?? '').toLowerCase();
        let skillCategory = 'street';
        if (cat.includes('academic') || (sname || '').includes('Academic')) skillCategory = 'academic';
        else if (cat.includes('professional') || (sname || '').includes('Professional')) skillCategory = 'professional';
        else if (cat.includes('interest') || (sname || '').includes('Interest')) skillCategory = 'interest';
        skillEntries.push({
            guid: foundry.utils.randomID(),
            suid: foundry.utils.randomID(),
            name: sname,
            name_english: sname,
            skillgroup: getAttr(rec, 'group') ?? '',
            skillgroup_english: getAttr(rec, 'group') ?? '',
            skillcategory: skillCategory,
            skillcategory_english: skillCategory,
            grouped: 'False',
            default: 'False',
            requiresgroundmovement: 'False',
            requiresswimmovement: 'False',
            requiresflymovement: 'False',
            rating,
            ratingmax: String(parseInt(String(total).replace(/\D/g, ''), 10) || parseInt(rating, 10)),
            specializedrating: rating,
            total: rating,
            knowledge: (isLang || skillCategory !== 'street' || !!getAttr(rec, 'group')) ? 'True' : 'False',
            exotic: 'False',
            buywithkarma: 'False',
            base: rating,
            karma: '0',
            spec: null,
            attribute: attr === 'int' ? 'intuition' : attr,
            displayattribute: attr,
            attributemod: '0',
            ratingmod: '0',
            poolmod: '0',
            islanguage: isLang ? 'True' : 'False',
            isnativelanguage: isNative ? 'True' : 'False',
            bp: '0',
            skillspecializations: null
        });
    };

    for (const s of activeSkills) {
        const rec = s as Record<string, unknown>;
        if (getAttr(rec, 'group')) continue; // skip group placeholder, use actual skills
        pushSkill(s, false, false);
    }
    for (const s of knowledgeSkills) pushSkill(s, false, false);
    for (const s of languageSkills) {
        const rec = s as Record<string, unknown>;
        pushSkill(s, true, (getAttr(rec, 'text') ?? '').toUpperCase() === 'N');
    }

    // Qualities
    const qualitiesBlock = charNode.qualities as Record<string, unknown> | undefined;
    const posQuals = qualitiesBlock?.positive ? ensureArray((qualitiesBlock.positive as Record<string, unknown>).quality) : [];
    const negQuals = qualitiesBlock?.negative ? ensureArray((qualitiesBlock.negative as Record<string, unknown>).quality) : [];
    const qualityEntries: NonNullable<ActorSchema['qualities']>['quality'] = [];
    for (const q of posQuals) {
        const rec = q as Record<string, unknown>;
        const qname = getAttr(rec, 'name') ?? 'Unknown';
        qualityEntries.push({
            guid: foundry.utils.randomID(),
            sourceid: '',
            name: qname,
            name_english: qname,
            fullname: qname,
            fullname_english: qname,
            extra: null,
            extra_english: null,
            bp: '0',
            qualitytype: 'Positive',
            qualitytype_english: 'Positive',
            qualitysource: null,
            metagenic: 'False',
            source: null,
            page: null
        });
    }
    for (const q of negQuals) {
        const rec = q as Record<string, unknown>;
        const qname = getAttr(rec, 'name') ?? 'Unknown';
        qualityEntries.push({
            guid: foundry.utils.randomID(),
            sourceid: '',
            name: qname,
            name_english: qname,
            fullname: qname,
            fullname_english: qname,
            extra: null,
            extra_english: null,
            bp: '0',
            qualitytype: 'Negative',
            qualitytype_english: 'Negative',
            qualitysource: null,
            metagenic: 'False',
            source: null,
            page: null
        });
    }

    // Build minimal ActorSchema (items like weapons/armor/gear can be extended later from character.gear)
    const schema: ActorSchema = {
        settings: '',
        buildmethod: 'Priority',
        imageformat: '',
        metatype: race.toLowerCase().replace(/\s+/g, '_'),
        metatype_english: race,
        metatype_guid: foundry.utils.randomID(),
        metavariant: null,
        metavariant_english: null,
        metavariant_guid: '',
        movement: '',
        walk: getMovementValue(charNode, 'walking') ?? '0',
        run: getMovementValue(charNode, 'running') ?? '0',
        sprint: '0',
        movementwalk: '0',
        movementswim: '0',
        movementfly: '0',
        prioritymetatype: '',
        priorityattributes: '',
        priorityspecial: '',
        priorityskills: ['', null],
        priorityresources: '',
        primaryarm: '',
        name,
        alias: name,
        playername: playername || null,
        gender: personal ? getAttr(personal, 'gender') ?? null : null,
        age: personal ? getAttr(personal, 'age') ?? null : null,
        eyes: personal ? getAttr(personal, 'eyes') ?? null : null,
        height: personal ? getText((personal as Record<string, unknown>).charheight) || getAttr((personal as Record<string, unknown>).charheight as XmlNode, 'text') ?? null : null,
        weight: personal ? getText((personal as Record<string, unknown>).charweight) || getAttr((personal as Record<string, unknown>).charweight as XmlNode, 'text') ?? null : null,
        skin: personal ? getAttr(personal, 'skin') ?? null : null,
        hair: personal ? getAttr(personal, 'hair') ?? null : null,
        description: description || null,
        background: null,
        concept: null,
        notes: null,
        gamenotes: null,
        limitphysical: '0',
        limitmental: '0',
        limitsocial: '0',
        limitastral: '0',
        contactpoints: '0',
        contactpointsused: '0',
        cfplimit: '0',
        ainormalprogramlimit: '0',
        aiadvancedprogramlimit: '0',
        spelllimit: '0',
        karma: karmaTotal,
        totalkarma: karmaTotal,
        special,
        totalspecial,
        attributes: ['', { attributecategory_english: '', attribute: attributeEntries }],
        totalattributes: '0',
        edgeused: '0',
        edgeremaining: getAttr(attrList.find((a: unknown) => getAttr(a as Record<string, unknown>, 'name') === 'Edge') as XmlNode, 'modified') ?? '0',
        streetcred: streetCred,
        calculatedstreetcred: streetCred,
        totalstreetcred: streetCred,
        burntstreetcred: '0',
        notoriety,
        calculatednotoriety: notoriety,
        totalnotoriety: notoriety,
        publicawareness: publicAwareness,
        calculatedpublicawareness: publicAwareness,
        totalpublicawareness: publicAwareness,
        astralreputation: '0',
        totalastralreputation: '0',
        wildreputation: '0',
        totalwildreputation: '0',
        created: 'True',
        nuyen,
        adept: 'False',
        magician: hasMagic ? 'True' : 'False',
        technomancer: hasResonance ? 'True' : 'False',
        ai: 'False',
        cyberwaredisabled: 'False',
        critter: 'False',
        totaless: getAttr(attrList.find((a: unknown) => getAttr(a as Record<string, unknown>, 'name') === 'Essence') as XmlNode, 'modified') ?? '6',
        tradition: null,
        dodge: '0',
        armor: getArmorRating(charNode) ?? '0',
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
        physicalcm: '0',
        physicalcmiscorecm: 'False',
        stuncm: '0',
        stuncmismatrixcm: 'False',
        physicalcmfilled: '0',
        stuncmfilled: '0',
        cmthreshold: '0',
        physicalcmthresholdoffset: '0',
        stuncmthresholdoffset: '0',
        cmoverflow: '0',
        psyche: 'False',
        init: initBase,
        initdice: initDice,
        initvalue: initBase,
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
        magenabled: hasMagic ? 'True' : 'False',
        initiategrade: null,
        resenabled: hasResonance ? 'True' : 'False',
        submersiongrade: '0',
        depenabled: 'False',
        groupmember: 'False',
        groupname: null,
        groupnotes: null,
        surprise: '0',
        composure: '0',
        judgeintentions: '0',
        judgeintentionsresist: '0',
        liftandcarry: '0',
        memory: '0',
        liftweight: '0',
        carryweight: '0',
        totalcarriedweight: '0',
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
        skills: { skill: skillEntries },
        weapons: null,
        armors: null,
        cyberwares: null,
        gears: null,
        qualities: qualityEntries.length > 0 ? { quality: qualityEntries } : null,
        spells: null,
        powers: null,
        complexforms: null,
        vehicles: null,
        contacts: null,
        lifestyles: null,
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
        sustainedobjects: null
    };

    return schema;
}

/** Detect if parsed XML is Hero Lab document format (document/public/character). */
export function isHeroLabDocumentFormat(parsed: unknown): boolean {
    const doc = parsed as Record<string, unknown>;
    const root = doc.document ?? doc;
    if (!root || typeof root !== 'object') return false;
    const pub = (root as Record<string, unknown>).public;
    return pub != null && typeof pub === 'object' && (pub as Record<string, unknown>).character != null;
}
