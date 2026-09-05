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

/** Get attribute or child element text (Hero Lab may use either). */
function getAttrOrText(node: XmlNode | null | undefined, key: string): string {
    const attr = getAttr(node, key);
    if (attr !== undefined && attr !== '') return attr;
    if (node == null || typeof node !== 'object') return '';
    const obj = node as Record<string, unknown>;
    const child = obj[key];
    return child != null ? getText(child as XmlNode) : '';
}

/** FVTT SIN system fields we need to populate from Hero Lab identity (same idea as Skills: check every possible source). */
const SIN_RATING_KEYS = ['rating', 'Rating', 'sinrating', 'SinRating', 'level', 'Level', 'value', 'Value', 'rtg', 'Rtg'];

function getVal(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
        const v = getAttr(obj, k) ?? getAttrOrText(obj, k);
        if (v !== undefined && v !== '') {
            const num = String(v).replace(/\D/g, '');
            if (num) return num;
        }
    }
    return undefined;
}

/** Recursively walk identity tree (depth-limited) and return first numeric rating found near a SIN/fake context. */
function walkIdentityForRating(obj: unknown, depth: number, nameContext: string): string {
    if (depth <= 0 || obj == null) return '0';
    const rec = obj as Record<string, unknown>;
    const name = (getAttr(rec, 'name') ?? getAttrOrText(rec, 'name') ?? '').toLowerCase();
    const ctx = nameContext || name;
    const isSinContext = /sin|fake|identification/i.test(ctx);
    if (isSinContext) {
        const r = getVal(rec, SIN_RATING_KEYS);
        if (r !== undefined && r !== '') return r;
    }
    for (const key of Object.keys(rec)) {
        if (key === '$' || key === '_TEXT') continue;
        const child = rec[key];
        if (Array.isArray(child)) {
            for (const c of child) {
                const inner = walkIdentityForRating(c, depth - 1, ctx || nameContext);
                if (inner !== '0') return inner;
            }
        } else if (child && typeof child === 'object') {
            const inner = walkIdentityForRating(child, depth - 1, ctx || nameContext);
            if (inner !== '0') return inner;
        }
    }
    return '0';
}

/** Extract SIN rating from identity: check all FVTT-relevant sources (like Skills: every attribute and nested block). */
function getIdentitySinRating(idRec: Record<string, unknown>): string {
    // 1) Direct on identity (same as FVTT technology.rating source)
    const direct = getVal(idRec, SIN_RATING_KEYS);
    if (direct !== undefined && direct !== '') return direct;
    // 2) identity.sin child
    const sinChild = idRec.sin ?? idRec.Sin ?? idRec.sinnumber;
    if (sinChild && typeof sinChild === 'object') {
        const r = getVal(sinChild as Record<string, unknown>, SIN_RATING_KEYS);
        if (r !== undefined && r !== '') return r;
    }
    // 3) Any nested item/thing/gear that looks like SIN (explicit list check like Skills)
    const itemLists = [
        (idRec.gear as Record<string, unknown>)?.item,
        idRec.item,
        (idRec.things as Record<string, unknown>)?.thing,
        idRec.things,
        idRec.thing,
    ].filter(Boolean);
    for (const list of itemLists) {
        const arr = ensureArray(list);
        for (const it of arr) {
            const itemRec = it as Record<string, unknown>;
            const iname = (getAttr(itemRec, 'name') ?? getAttrOrText(itemRec, 'name') ?? '').toLowerCase();
            const cat = (getAttr(itemRec, 'category') ?? getAttrOrText(itemRec, 'category') ?? '').toLowerCase();
            if (iname.includes('sin') || iname.includes('fake') || cat.includes('identification')) {
                const r = getVal(itemRec, SIN_RATING_KEYS);
                if (r !== undefined && r !== '') return r;
            }
        }
    }
    // 4) Full tree walk (any node with rating near sin/fake name)
    const fromWalk = walkIdentityForRating(idRec, 5, (getAttr(idRec, 'name') ?? '').toLowerCase());
    if (fromWalk !== '0') return fromWalk;
    // 5) Text fallback: description/name containing "Fake SIN (2)" or "(2)"
    const desc = getAttrOrText(idRec, 'description') || getText(idRec.description) || getAttrOrText(idRec, 'text') || '';
    const combined = `${(getAttrOrText(idRec, 'name') || '')} ${desc}`;
    const m = combined.match(/fake\s*sin\s*\((\d+)\)|sin\s*\((\d+)\)|rating[:\s]*(\d+)/i) ?? combined.match(/\((\d+)\)/);
    if (m) return String(parseInt(m[1] ?? m[2] ?? m[3] ?? '0', 10) || 0);
    return '0';
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

/** Get attribute modified/base value by Hero Lab attribute name from attribute list */
function getAttrValueFromList(attrList: unknown[], attrName: string): string {
    const att = attrList.find((a: unknown) => getAttr(a as Record<string, unknown>, 'name') === attrName) as XmlNode | undefined;
    if (!att) return '0';
    const total = getAttr(att, 'modified') ?? getAttr(att, 'base');
    return total ?? '0';
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
    const rawCharType = (getAttr(charNode, 'type') ?? getAttr(charNode, 'herotype') ?? getAttr(publicNode as XmlNode, 'charactertype') ?? '').toLowerCase();
    const isCritterType = ['critter', 'spirit', 'sprite', 'vehicle', 'ic', 'ally', 'enemy'].some(t => rawCharType.includes(t));
    const isNpcType = rawCharType.includes('npc') || rawCharType.includes('grunt') || rawCharType.includes('ally') || rawCharType.includes('enemy');
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

    // Reputations (Social: Street Cred, Notoriety, Public Awareness)
    const reps = (charNode.reputations as Record<string, unknown>)?.reputation;
    const repList = ensureArray(reps);
    let streetCred = '0', notoriety = '0', publicAwareness = '0';
    for (const r of repList) {
        const rec = r as Record<string, unknown>;
        const n = (getAttr(rec, 'name') ?? '').toLowerCase();
        const v = (getAttr(rec, 'value') ?? getAttr(rec, 'modified') ?? getAttr(rec, 'total') ?? getText(rec) ?? '0').replace(/[,]/g, '').trim();
        const num = String(parseInt(v.replace(/[^0-9-]/g, ''), 10) || 0);
        if (n.includes('street')) streetCred = num;
        else if (n.includes('notoriety')) notoriety = num;
        else if (n.includes('public')) publicAwareness = num;
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
    const groupsBlock = skillsBlock?.groups as Record<string, unknown> | undefined;
    const groupList = groupsBlock?.skill ? ensureArray((groupsBlock as Record<string, unknown>).skill) : [];
    const groupRatingMap: Record<string, number> = {};
    for (const g of groupList) {
        const grec = g as Record<string, unknown>;
        const gname = getAttr(grec, 'name') ?? '';
        if (!gname) continue;
        const gbase = getAttr(grec, 'base') ?? getAttr(grec, 'text') ?? '0';
        const gval = parseInt(String(gbase).replace(/\D/g, ''), 10) || 0;
        if (gval > 0) groupRatingMap[gname] = gval;
    }

    const activeSkills = skillsBlock?.active ? ensureArray((skillsBlock.active as Record<string, unknown>).skill) : [];
    const knowledgeSkills = skillsBlock?.knowledge ? ensureArray((skillsBlock.knowledge as Record<string, unknown>).skill) : [];
    const languageSkills = skillsBlock?.language ? ensureArray((skillsBlock.language as Record<string, unknown>).skill) : [];
    const skillEntries: ActorSchema['skills']['skill'] = [];

    /** SR5 Resonance-linked skills (Tasking group); must use attribute 'resonance', not Intuition/Logic. */
    const RESONANCE_SKILL_NAMES = ['compiling', 'decompiling', 'registering'];

    const pushSkill = (s: unknown, isLang: boolean, isNative: boolean) => {
        const rec = s as Record<string, unknown>;
        const sname = getAttr(rec, 'name') ?? 'Unknown';
        const group = getAttr(rec, 'group') ?? '';
        const fromGroup = (getAttr(rec, 'fromgroup') ?? '').toLowerCase() === 'yes';
        let base = getAttr(rec, 'base') ?? getAttr(rec, 'modified') ?? '0';
        if (fromGroup && group && (parseInt(String(base).replace(/\D/g, ''), 10) || 0) === 0 && groupRatingMap[group] != null) {
            base = String(groupRatingMap[group]);
        }
        const total = getAttr(rec, 'modified') ?? base;
        const rating = String(parseInt(String(base).replace(/\D/g, ''), 10) || 0);
        if (rating === '0' && !isLang) return;
        let attr = (getAttr(rec, 'attribute') ?? 'log').toLowerCase();
        if (RESONANCE_SKILL_NAMES.includes(sname.toLowerCase())) {
            attr = 'resonance';
        }
        const cat = (getAttr(rec, 'category') ?? '').toLowerCase();
        let skillCategory = 'street';
        if (cat.includes('academic') || (sname || '').includes('Academic')) skillCategory = 'academic';
        else if (cat.includes('professional') || (sname || '').includes('Professional')) skillCategory = 'professional';
        else if (cat.includes('interest') || (sname || '').includes('Interest')) skillCategory = 'interest';

        // Extract specialization from <specialization bonustext="..."/> child element
        let spec: string | null = null;
        const specNode = (rec.specialization as Record<string, unknown>) || undefined;
        if (specNode) {
            const bonusText = getAttr(specNode, 'bonustext') ?? '';
            if (bonusText) {
                // Format: "Drawing +2" → extract just the main skill name
                spec = bonusText.replace(/\s*\+\d+\s*$/, '').trim();
            }
        }

        skillEntries.push({
            guid: foundry.utils.randomID(),
            suid: foundry.utils.randomID(),
            name: sname,
            name_english: sname,
            skillgroup: group,
            skillgroup_english: group,
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
            // knowledge = True only for actual knowledge skills (academic/professional/interest) and languages; not for skill-group membership (Firearms, Tasking, etc.)
            knowledge: (isLang || skillCategory !== 'street') ? 'True' : 'False',
            exotic: 'False',
            buywithkarma: 'False',
            base: rating,
            karma: '0',
            spec: spec,
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

    // Complex forms are read from the powers block or (for .por) from lead1.xml in the converter.
    const complexFormEntries: NonNullable<ActorSchema['complexforms']>['complexform'] = [];

    for (const s of activeSkills) {
        const rec = s as Record<string, unknown>;
        const sname = getAttr(rec, 'name') ?? '';
        const group = getAttr(rec, 'group');
        if (group && sname === group) continue;
        pushSkill(s, false, false);
    }

    // Dedupe active skills by name_english: Hero Lab may export duplicate entries (e.g. two "Compiling"); keep highest rating.
    const activeByName = new Map<string, (typeof skillEntries)[0]>();
    for (const sk of skillEntries) {
        const key = (sk.name_english ?? sk.name ?? '').trim().toLowerCase();
        if (!key) continue;
        const existing = activeByName.get(key);
        const ratingNum = parseInt(sk.rating || '0', 10);
        if (!existing || parseInt(existing.rating || '0', 10) < ratingNum) {
            activeByName.set(key, sk);
        }
    }
    const dedupedActive = Array.from(activeByName.values());
    skillEntries.length = 0;
    skillEntries.push(...dedupedActive);

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

    // Contacts
    const contactsBlock = charNode.contacts as Record<string, unknown> | undefined;
    const contactList = contactsBlock?.contact ? ensureArray((contactsBlock.contact as Record<string, unknown>)) : [];
    const contactEntries: NonNullable<ActorSchema['contacts']>['contact'] = [];
    for (const c of contactList) {
        const rec = c as Record<string, unknown>;
        const cname = getAttr(rec, 'name') ?? 'Unknown Contact';
        const connection = getAttr(rec, 'connection') ?? '0';
        const loyalty = getAttr(rec, 'loyalty') ?? '0';
        contactEntries.push({
            guid: foundry.utils.randomID(),
            name: cname,
            role: getAttr(rec, 'type') ?? null,
            location: null,
            connection,
            loyalty,
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
        });
    }

    // Lifestyles and SINs - extract from identities (check both casings like Skills blocks)
    const identitiesBlock = (charNode.identities ?? (charNode as Record<string, unknown>).Identities) as Record<string, unknown> | undefined;
    const lifestyleEntries: NonNullable<ActorSchema['lifestyles']>['lifestyle'] = [];
    if (identitiesBlock) {
        const identityList = (identitiesBlock.identity ?? (identitiesBlock as Record<string, unknown>).Identity) ? ensureArray(identitiesBlock.identity ?? (identitiesBlock as Record<string, unknown>).Identity) : [];
        for (const identity of identityList) {
            const idRec = identity as Record<string, unknown>;
            const identityName = getAttr(idRec, 'name') ?? '';
            
            // Extract lifestyle
            const lifestyleNode = idRec.lifestyle as Record<string, unknown> | undefined;
            if (lifestyleNode) {
                const lname = getAttr(lifestyleNode, 'name') ?? 'Street Lifestyle';
                const months = getAttr(lifestyleNode, 'months') ?? '1';
                const costNode = lifestyleNode.gearcost as Record<string, unknown> | undefined;
                const cost = costNode ? (getAttr(costNode, 'value') ?? '0') : '0';
                const lifestyleType = lname.toLowerCase().includes('street') ? 'Street' :
                                     lname.toLowerCase().includes('squatter') ? 'Squatter' :
                                     lname.toLowerCase().includes('low') ? 'Low' :
                                     lname.toLowerCase().includes('middle') ? 'Middle' :
                                     lname.toLowerCase().includes('high') ? 'High' :
                                     lname.toLowerCase().includes('luxury') ? 'Luxury' : 'Street';
                
                lifestyleEntries.push({
                    guid: foundry.utils.randomID(),
                    sourceid: '',
                    name: lname,
                    city: null,
                    district: null,
                    borough: null,
                    cost: cost.replace(/[^0-9]/g, ''),
                    totalmonthlycost: cost.replace(/[^0-9]/g, ''),
                    totalcost: String(parseInt(cost.replace(/[^0-9]/g, ''), 10) * parseInt(months, 10) || 0),
                    dice: '0',
                    multiplier: '1',
                    months,
                    purchased: 'True',
                    type: lifestyleType,
                    increment: '1',
                    bonuslp: '0',
                    baselifestyle: lifestyleType,
                    baselifestyle_english: lifestyleType,
                    trustfund: 'False',
                    source: null,
                    page: null,
                    qualities: null,
                });
            }
            
        }
    }
    
    // Store identity name + SIN rating for SIN creation (after gearEntries is defined)
    const identityData: Array<{ name: string; rating: string }> = [];
    if (identitiesBlock) {
        const identityList = (identitiesBlock.identity ?? (identitiesBlock as Record<string, unknown>).Identity) ? ensureArray(identitiesBlock.identity ?? (identitiesBlock as Record<string, unknown>).Identity) : [];
        for (const identity of identityList) {
            const idRec = identity as Record<string, unknown>;
            const identityName = (getAttrOrText(idRec, 'name') || getAttr(idRec, 'name')) ?? '';
            if (!identityName) continue;
            let ratingNum = getIdentitySinRating(idRec);
            if (ratingNum === '0' || ratingNum === '') {
                const fromName = identityName.match(/\(Rtg\s*(\d+)\)|\((\d+)\)|rating[:\s]*(\d+)/i);
                if (fromName) ratingNum = String(parseInt(fromName[1] ?? fromName[2] ?? fromName[3] ?? '0', 10) || 0);
            }
            identityData.push({ name: identityName, rating: ratingNum });
        }
    }

    // Gear/Items - extract from gear block
    const gearBlock = charNode.gear as Record<string, unknown> | undefined;
    
    // Spells, adept powers, and complex forms (from spells block, powers block, or magic.*)
    const spellEntries: NonNullable<ActorSchema['spells']>['spell'] = [];
    const powerEntries: NonNullable<ActorSchema['powers']>['power'] = [];
    const magicNode = charNode.magic as Record<string, unknown> | undefined;
    const powersBlock = (charNode.powers ?? magicNode?.powers ?? (charNode as Record<string, unknown>).Powers) as Record<string, unknown> | undefined;
    const spellsBlock = (charNode.spells ?? magicNode?.spells ?? (charNode as Record<string, unknown>).Spells) as Record<string, unknown> | undefined;

    const pushSpell = (rec: Record<string, unknown>) => {
        const sname = getAttr(rec, 'name') ?? 'Unknown Spell';
        spellEntries.push({
            guid: foundry.utils.randomID(),
            sourceid: '',
            name: sname,
            name_english: sname,
            fullname: sname,
            fullname_english: sname,
            descriptors: getAttr(rec, 'descriptors') ?? '',
            descriptors_english: getAttr(rec, 'descriptors') ?? '',
            description: getAttr(rec, 'description') ?? undefined,
            category: getAttr(rec, 'category') ?? 'Combat',
            category_english: getAttr(rec, 'category') ?? 'Combat',
            type: getAttr(rec, 'type') ?? 'Mana',
            type_english: getAttr(rec, 'type') ?? 'Mana',
            range: getAttr(rec, 'range') ?? 'LOS',
            range_english: getAttr(rec, 'range') ?? 'LOS',
            damage: getAttr(rec, 'damage') ?? '',
            damage_english: getAttr(rec, 'damage') ?? '',
            duration: getAttr(rec, 'duration') ?? 'Instant',
            duration_english: getAttr(rec, 'duration') ?? 'Instant',
            dv: getAttr(rec, 'dv') ?? getAttr(rec, 'drain') ?? '0',
            dv_english: getAttr(rec, 'dv') ?? getAttr(rec, 'drain') ?? '0',
            alchemy: 'False',
            limited: 'False',
            barehandedadept: 'False',
            dicepool: getAttr(rec, 'dicepool') ?? '0',
            source: null,
            page: null,
            extra: null,
            notes: null,
        });
    };

    const spellsSource = spellsBlock ?? (magicNode?.spells as Record<string, unknown> | undefined);
    if (spellsSource) {
        const spellList = (spellsSource.spell && ensureArray(spellsSource.spell)) ||
            (spellsSource.item && ensureArray(spellsSource.item)) ||
            [];
        for (const s of spellList) {
            pushSpell(s as Record<string, unknown>);
        }
    }
    const adeptPowersBlock = magicNode?.adeptpowers as Record<string, unknown> | undefined;
    const powersSource = powersBlock ?? adeptPowersBlock;
    if (powersSource) {
        const powerList = (powersSource.power && ensureArray(powersSource.power)) ||
            (powersSource.item && ensureArray(powersSource.item)) ||
            (powersSource.adeptpower && ensureArray(powersSource.adeptpower)) ||
            [];
        for (const power of powerList) {
            const pRec = power as Record<string, unknown>;
            const pname = (getAttrOrText(pRec, 'name') || getAttr(pRec, 'name')) ?? '';
            const ptype = ((getAttrOrText(pRec, 'type') || getAttr(pRec, 'type')) ?? '').toLowerCase();
            const pcat = ((getAttrOrText(pRec, 'category') || getAttr(pRec, 'category')) ?? '').toLowerCase();
            if (ptype.includes('spell') || pcat.includes('spell') || pcat.includes('ritual') ||
                ['combat', 'detection', 'health', 'illusion', 'manipulation'].some(c => pcat.includes(c) || ptype.includes(c))) {
                pushSpell(pRec);
                continue;
            }
            if (ptype.includes('complex') || ptype.includes('form') ||
                pname.toLowerCase().includes('pulse') || pname.toLowerCase().includes('thread') ||
                pname.toLowerCase().includes('compile') || pname.toLowerCase().includes('decompile') ||
                pname.toLowerCase().includes('register') || pname.toLowerCase().includes('resonance')) {
                complexFormEntries.push({
                    guid: foundry.utils.randomID(),
                    sourceid: '',
                    name: pname,
                    name_english: pname,
                    fullname: pname,
                    fullname_english: pname,
                    duration: getAttr(pRec, 'duration') ?? '',
                    duration_english: getAttr(pRec, 'duration') ?? '',
                    fv: getAttr(pRec, 'fv') ?? getAttr(pRec, 'drain') ?? '0',
                    fv_english: getAttr(pRec, 'fv') ?? getAttr(pRec, 'drain') ?? '0',
                    target: getAttr(pRec, 'target') ?? '',
                    target_english: getAttr(pRec, 'target') ?? '',
                    source: null,
                    page: null,
                });
                continue;
            }
            // Adept power (or other power type)
            const rating = getAttr(pRec, 'rating') ?? getAttr(pRec, 'value') ?? getAttr(pRec, 'level') ?? '0';
            const points = getAttr(pRec, 'points') ?? getAttr(pRec, 'totalpoints') ?? getAttr(pRec, 'adeptpp') ?? rating;
            powerEntries.push({
                guid: foundry.utils.randomID(),
                sourceid: '',
                name: pname,
                name_english: pname,
                fullname: pname,
                fullname_english: pname,
                extra: getAttr(pRec, 'extra') ?? null,
                extra_english: getAttr(pRec, 'extra') ?? null,
                pointsperlevel: '1',
                adeptway: 'False',
                rating: String(parseInt(String(rating).replace(/\D/g, ''), 10) || 0),
                totalpoints: String(parseInt(String(points).replace(/\D/g, ''), 10) || parseInt(String(rating).replace(/\D/g, ''), 10) || 0),
                action: getAttr(pRec, 'action') ?? null,
                action_english: getAttr(pRec, 'action') ?? null,
                source: null,
                page: null,
                enhancements: null,
            });
        }
    }
    const gearEntries: NonNullable<ActorSchema['gears']>['gear'] = [];
    
    // Helper to extract modifications/accessories from an item
    // Extract cyberware/bioware items with proper schema fields
    const extractWare = (itemRec: Record<string, unknown>, isVirtualCyber: boolean): NonNullable<ActorSchema['cyberwares']>['cyberware'] => {
        const iname = getAttr(itemRec, 'name') ?? 'Unknown Ware';
        const ess = (getAttr(itemRec, 'essencecost') ?? '0').replace(/[^0-9.]/g, '') || '0';
        const rating = getAttr(itemRec, 'rating') ?? '0';
        const costNode = itemRec.gearcost as Record<string, unknown> | undefined;
        const cost = costNode ? (getAttr(costNode, 'value') ?? '0') : '0';
        const availNode = itemRec.availability as Record<string, unknown> | undefined;
        const avail = availNode ? (getAttr(availNode, 'text') ?? '') : '';
        const children = extractModifications(itemRec); // nested mods/accessories

        return {
            guid: foundry.utils.randomID(),
            sourceid: '',
            name: iname,
            name_english: iname,
            fullname: iname,
            fullname_english: iname,
            category: isVirtualCyber ? 'Bioware' : 'Cyberware',
            category_english: isVirtualCyber ? 'Bioware' : 'Cyberware',
            ess: ess,
            capacity: null,
            avail: avail,
            avail_english: avail,
            cost: cost.replace(/[^0-9]/g, ''),
            owncost: cost.replace(/[^0-9]/g, ''),
            weight: '0',
            ownweight: '0',
            source: null,
            page: null,
            rating: rating,
            minrating: '0',
            maxrating: rating,
            ratinglabel: rating,
            allowsubsystems: null,
            wirelesson: (getAttr(itemRec, 'wireless') === 'Present') ? 'True' : 'False',
            grade: 'standard',
            location: null,
            extra: null,
            improvementsource: isVirtualCyber ? 'Bioware' : null,
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
            children: children.length > 0 ? { gear: children } : null,
        };
    };

    const extractModifications = (itemRec: Record<string, unknown>): NonNullable<ActorSchema['gears']>['gear'] => {
        const mods: NonNullable<ActorSchema['gears']>['gear'] = [];
        const modsBlock = itemRec.modifications as Record<string, unknown> | undefined;
        const accessoriesBlock = itemRec.accessories as Record<string, unknown> | undefined;
        const otherGearBlock = itemRec.othergear as Record<string, unknown> | undefined;
        
        // Extract modifications
        if (modsBlock) {
            const modItems = modsBlock.item ? ensureArray(modsBlock.item) : [];
            for (const mod of modItems) {
                const modRec = mod as Record<string, unknown>;
                const mname = getAttr(modRec, 'name') ?? 'Unknown Modification';
                const mcostNode = modRec.gearcost as Record<string, unknown> | undefined;
                const mcost = mcostNode ? (getAttr(mcostNode, 'value') ?? '0') : '0';
                const mavailNode = modRec.availability as Record<string, unknown> | undefined;
                const mavail = mavailNode ? (getAttr(mavailNode, 'text') ?? '') : '';
                
                mods.push({
                    guid: foundry.utils.randomID(),
                    sourceid: '',
                    name: mname,
                    name_english: mname,
                    fullname: mname,
                    fullname_english: mname,
                    category: 'Modification',
                    category_english: 'Modification',
                    ispersona: 'False',
                    isammo: 'False',
                    issin: 'False',
                    capacity: null,
                    armorcapacity: null,
                    maxrating: null,
                    rating: '0',
                    qty: '1',
                    avail: mavail,
                    avail_english: mavail,
                    cost: mcost.replace(/[^0-9]/g, ''),
                    owncost: mcost.replace(/[^0-9]/g, ''),
                    weight: '0',
                    ownweight: '0',
                    extra: null,
                    bonded: 'False',
                    equipped: 'False',
                    wirelesson: (getAttr(modRec, 'wireless') === 'Present') ? 'True' : 'False',
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
                });
            }
        }
        
        // Extract accessories
        if (accessoriesBlock) {
            const accItems = accessoriesBlock.item ? ensureArray(accessoriesBlock.item) : [];
            for (const acc of accItems) {
                const accRec = acc as Record<string, unknown>;
                const aname = getAttr(accRec, 'name') ?? 'Unknown Accessory';
                const acostNode = accRec.gearcost as Record<string, unknown> | undefined;
                const acost = acostNode ? (getAttr(acostNode, 'value') ?? '0') : '0';
                const aavailNode = accRec.availability as Record<string, unknown> | undefined;
                const aavail = aavailNode ? (getAttr(aavailNode, 'text') ?? '') : '';
                
                mods.push({
                    guid: foundry.utils.randomID(),
                    sourceid: '',
                    name: aname,
                    name_english: aname,
                    fullname: aname,
                    fullname_english: aname,
                    category: 'Accessory',
                    category_english: 'Accessory',
                    ispersona: 'False',
                    isammo: 'False',
                    issin: 'False',
                    capacity: null,
                    armorcapacity: null,
                    maxrating: null,
                    rating: '0',
                    qty: '1',
                    avail: aavail,
                    avail_english: aavail,
                    cost: acost.replace(/[^0-9]/g, ''),
                    owncost: acost.replace(/[^0-9]/g, ''),
                    weight: '0',
                    ownweight: '0',
                    extra: null,
                    bonded: 'False',
                    equipped: 'False',
                    wirelesson: (getAttr(accRec, 'wireless') === 'Present') ? 'True' : 'False',
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
                });
            }
        }
        
        // Extract other gear (nested items)
        if (otherGearBlock) {
            const otherItems = otherGearBlock.item ? ensureArray(otherGearBlock.item) : [];
            for (const otherItem of otherItems) {
                const otherRec = otherItem as Record<string, unknown>;
                const oname = getAttr(otherRec, 'name') ?? 'Unknown Item';
                const ocostNode = otherRec.gearcost as Record<string, unknown> | undefined;
                const ocost = ocostNode ? (getAttr(ocostNode, 'value') ?? '0') : '0';
                const oavailNode = otherRec.availability as Record<string, unknown> | undefined;
                const oavail = oavailNode ? (getAttr(oavailNode, 'text') ?? '') : '';
                
                mods.push({
                    guid: foundry.utils.randomID(),
                    sourceid: '',
                    name: oname,
                    name_english: oname,
                    fullname: oname,
                    fullname_english: oname,
                    category: 'Gear',
                    category_english: 'Gear',
                    ispersona: 'False',
                    isammo: 'False',
                    issin: 'False',
                    capacity: null,
                    armorcapacity: null,
                    maxrating: null,
                    rating: '0',
                    qty: getAttr(otherRec, 'quantity') ?? '1',
                    avail: oavail,
                    avail_english: oavail,
                    cost: ocost.replace(/[^0-9]/g, ''),
                    owncost: ocost.replace(/[^0-9]/g, ''),
                    weight: '0',
                    ownweight: '0',
                    extra: null,
                    bonded: 'False',
                    equipped: 'False',
                    wirelesson: (getAttr(otherRec, 'wireless') === 'Present') ? 'True' : 'False',
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
                });
            }
        }
        
        return mods;
    };
    
    // Extract items from various gear subcategories
    const extractItemsFromBlock = (block: Record<string, unknown> | undefined, category: string) => {
        if (!block) return [];
        const items = block.item ? ensureArray(block.item) : [];
        return items.map((item: unknown) => {
            const rec = item as Record<string, unknown>;
            const iname = getAttr(rec, 'name') ?? 'Unknown Item';
            const quantity = getAttr(rec, 'quantity') ?? '1';
            const costNode = rec.gearcost as Record<string, unknown> | undefined;
            const cost = costNode ? (getAttr(costNode, 'value') ?? '0') : '0';
            const availNode = rec.availability as Record<string, unknown> | undefined;
            const avail = availNode ? (getAttr(availNode, 'text') ?? '') : '';
            
            // Check if item is a SIN
            const isSin = iname.toLowerCase().includes('sin') || 
                         iname.toLowerCase().includes('system identification') ||
                         (rec.category && String(rec.category).toLowerCase().includes('sin')) ||
                         (rec.type && String(rec.type).toLowerCase().includes('sin'));
            
            // Extract modifications/accessories/children
            const children = extractModifications(rec);
            
            return {
                guid: foundry.utils.randomID(),
                sourceid: '',
                name: iname,
                name_english: iname,
                fullname: iname,
                fullname_english: iname,
                category: category,
                category_english: category,
                ispersona: 'False',
                isammo: category.toLowerCase().includes('ammo') ? 'True' : 'False',
                issin: isSin ? 'True' : 'False',
                capacity: null,
                armorcapacity: null,
                maxrating: null,
                rating: '0',
                qty: quantity,
                avail: avail,
                avail_english: avail,
                cost: cost.replace(/[^0-9]/g, ''),
                owncost: cost.replace(/[^0-9]/g, ''),
                weight: '0',
                ownweight: '0',
                extra: null,
                bonded: 'False',
                equipped: 'False',
                wirelesson: (getAttr(rec, 'wireless') === 'Present') ? 'True' : 'False',
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
                children: children.length > 0 ? { gear: children } : null,
            };
        });
    };

    // Extract weapons, armors, vehicles, and cyberware/bioware
    const weaponEntries: NonNullable<ActorSchema['weapons']>['weapon'] = [];
    const armorEntries: NonNullable<ActorSchema['armors']>['armor'] = [];
    const vehicleEntries: NonNullable<ActorSchema['vehicles']>['vehicle'] = [];
    const cyberwareEntries: NonNullable<ActorSchema['cyberwares']>['cyberware'] = [];

    if (gearBlock) {
        // Extract vehicles from gear.vehicles (e.g. character's owned vehicles)
        const vehiclesBlock = gearBlock.vehicles as Record<string, unknown> | undefined;
        if (vehiclesBlock) {
            const vehicleItems = vehiclesBlock.item ? ensureArray(vehiclesBlock.item) : [];
            for (const v of vehicleItems) {
                const vRec = v as Record<string, unknown>;
                const vname = getAttr(vRec, 'name') ?? name;
                const vehicleInfo = vRec.vehicleinfo as Record<string, unknown> | undefined;
                const costNode = vRec.gearcost as Record<string, unknown> | undefined;
                const cost = costNode ? (getAttr(costNode, 'value') ?? '0') : '0';
                const availNode = vRec.availability as Record<string, unknown> | undefined;
                const avail = availNode ? (getAttr(availNode, 'text') ?? '') : '';
                const handling = vehicleInfo ? (getAttr(vehicleInfo, 'handling') ?? getAttr(vRec, 'handling') ?? '0') : (getAttr(vRec, 'handling') ?? '0');
                const speed = vehicleInfo ? (getAttr(vehicleInfo, 'speed') ?? getAttr(vRec, 'speed') ?? '0') : (getAttr(vRec, 'speed') ?? '0');
                const accel = vehicleInfo ? (getAttr(vehicleInfo, 'acceleration') ?? getAttr(vRec, 'acceleration') ?? '0') : (getAttr(vRec, 'acceleration') ?? '0');
                const pilot = vehicleInfo ? (getAttr(vehicleInfo, 'pilot') ?? getAttr(vRec, 'pilot') ?? '0') : (getAttr(vRec, 'pilot') ?? '0');
                const body = vehicleInfo ? (getAttr(vehicleInfo, 'body') ?? getAttr(vRec, 'body') ?? '0') : (getAttr(vRec, 'body') ?? '0');
                const armor = vehicleInfo ? (getAttr(vehicleInfo, 'armor') ?? getAttr(vRec, 'armor') ?? '0') : (getAttr(vRec, 'armor') ?? '0');
                const sensor = vehicleInfo ? (getAttr(vehicleInfo, 'sensor') ?? getAttr(vRec, 'sensor') ?? '0') : (getAttr(vRec, 'sensor') ?? '0');
                const seats = vehicleInfo ? (getAttr(vehicleInfo, 'seats') ?? getAttr(vRec, 'seats') ?? '0') : (getAttr(vRec, 'seats') ?? '0');
                const isDrone = (getAttr(vRec, 'type') ?? '').toLowerCase().includes('drone') ? 'True' : 'False';
                vehicleEntries.push({
                    guid: foundry.utils.randomID(),
                    sourceid: '',
                    name: vname,
                    name_english: vname,
                    fullname: vname,
                    fullname_english: vname,
                    category: isDrone === 'True' ? 'Drone' : 'Groundcraft',
                    category_english: isDrone === 'True' ? 'Drone' : 'Groundcraft',
                    isdrone: isDrone,
                    handling: String(handling).replace(/[^0-9/.-]/g, '') || '0',
                    accel: String(accel).replace(/[^0-9/.-]/g, '') || '0',
                    speed: String(speed).replace(/[^0-9/.-]/g, '') || '0',
                    pilot: String(pilot).replace(/[^0-9]/g, '') || '0',
                    body: String(body).replace(/[^0-9]/g, '') || '0',
                    armor: String(armor).replace(/[^0-9]/g, '') || '0',
                    seats: String(seats).replace(/[^0-9]/g, '') || '0',
                    sensor: String(sensor).replace(/[^0-9]/g, '') || '0',
                    avail,
                    cost: cost.replace(/[^0-9]/g, ''),
                    owncost: cost.replace(/[^0-9]/g, ''),
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
                });
            }
        }
        // Extract weapons with accessories
        const weaponsBlock = gearBlock.weapons as Record<string, unknown> | undefined;
        if (weaponsBlock) {
            const weaponItems = weaponsBlock.item ? ensureArray(weaponsBlock.item) : [];
            for (const weapon of weaponItems) {
                const wRec = weapon as Record<string, unknown>;
                const wname = getAttr(wRec, 'name') ?? 'Unknown Weapon';
                const weaponInfo = wRec.weaponinfo as Record<string, unknown> | undefined;
                const damageText = weaponInfo ? getAttr(weaponInfo, 'damagetext') ?? '0P' : '0P';
                const apText = weaponInfo ? getAttr(weaponInfo, 'ap') ?? '0' : '0';
                const accuracyText = weaponInfo ? getAttr(weaponInfo, 'dicepool') ?? '0' : '0';
                const costNode = wRec.gearcost as Record<string, unknown> | undefined;
                const cost = costNode ? (getAttr(costNode, 'value') ?? '0') : '0';
                const availNode = wRec.availability as Record<string, unknown> | undefined;
                const avail = availNode ? (getAttr(availNode, 'text') ?? '') : '';

                // Extract fire modes from weaponinfo
                let modesText: string | null = null;
                let rcValue = '0';
                let ammoCount = '0';
                if (weaponInfo) {
                    const modesTextAttr = getAttr(weaponInfo, 'modestext') ?? '';
                    if (modesTextAttr) {
                        modesText = modesTextAttr;
                    }
                    const rcAttr = getAttr(weaponInfo, 'recoilcomp') ?? '0';
                    rcValue = String(rcAttr).replace(/[^0-9]/g, '') || '0';

                    // Extract ammo count from <ammunitionused count="..." type="..."/>
                    const ammoUsed = weaponInfo.ammunitionused as Record<string, unknown> | undefined;
                    if (ammoUsed) {
                        const ammoCountAttr = getAttr(ammoUsed, 'count') ?? '0';
                        ammoCount = String(ammoCountAttr).replace(/[^0-9]/g, '') || '0';
                    }
                }
                
                // Extract accessories/modifications
                const accessories: Array<{
                    guid: string;
                    sourceid: string;
                    name: string;
                    name_english: string;
                    fullname: string;
                    fullname_english: string;
                    mount: string;
                    extramount: string;
                    addmount: string | null;
                    damage: string;
                    rc: string | null;
                    ap: string;
                    conceal: string;
                    avail: string;
                    ratinglabel: string;
                    cost: string;
                    owncost: string;
                    weight: string;
                    ownweight: string;
                    included: string;
                    source: string | null;
                    page: string | null;
                    accuracy: string;
                    gears?: ActorSchema['gears'] | null;
                    notes?: string | null;
                }> = [];
                const modsBlock = wRec.modifications as Record<string, unknown> | undefined;
                if (modsBlock) {
                    const modItems = modsBlock.item ? ensureArray(modsBlock.item) : [];
                    for (const mod of modItems) {
                        const modRec = mod as Record<string, unknown>;
                        const mname = getAttr(modRec, 'name') ?? 'Unknown Modification';
                        const mcostNode = modRec.gearcost as Record<string, unknown> | undefined;
                        const mcost = mcostNode ? (getAttr(mcostNode, 'value') ?? '0') : '0';
                        const mavailNode = modRec.availability as Record<string, unknown> | undefined;
                        const mavail = mavailNode ? (getAttr(mavailNode, 'text') ?? '') : '';
                        
                        accessories.push({
                            guid: foundry.utils.randomID(),
                            sourceid: '',
                            name: mname,
                            name_english: mname,
                            fullname: mname,
                            fullname_english: mname,
                            mount: getAttr(modRec, 'mount') ?? 'barrel',
                            extramount: '',
                            addmount: null,
                            damage: '0',
                            rc: getAttr(modRec, 'rc') ?? '0',
                            ap: '0',
                            conceal: '0',
                            avail: mavail,
                            ratinglabel: '0',
                            cost: mcost.replace(/[^0-9]/g, ''),
                            owncost: mcost.replace(/[^0-9]/g, ''),
                            weight: '0',
                            ownweight: '0',
                            included: 'False',
                            source: null,
                            page: null,
                            accuracy: '0',
                            gears: null,
                        });
                    }
                }
                
                weaponEntries.push({
                    guid: foundry.utils.randomID(),
                    sourceid: '',
                    name: wname,
                    name_english: wname,
                    fullname: wname,
                    fullname_english: wname,
                    category: 'Ranged',
                    category_english: 'Ranged',
                    type: 'Ranged',
                    reach: '0',
                    rawreach: '0',
                    accuracy: accuracyText,
                    accuracy_noammo: accuracyText,
                    accuracy_english: accuracyText,
                    accuracy_english_noammo: accuracyText,
                    rawaccuracy: accuracyText,
                    damage: damageText,
                    damage_noammo: damageText,
                    damage_english: damageText,
                    damage_noammo_english: damageText,
                    rawdamage: damageText,
                    ap: apText,
                    ap_noammo: apText,
                    ap_english: apText,
                    ap_english_noammo: apText,
                    rawap: apText,
                    mode: modesText,
                    mode_noammo: modesText,
                    mode_english: modesText,
                    mode_english_noammo: modesText,
                    rc: rcValue,
                    rc_noammo: rcValue,
                    rc_english: rcValue,
                    rc_english_noammo: rcValue,
                    rawrc: rcValue,
                    ammo: ammoCount,
                    ammo_english: ammoCount,
                    maxammo: ammoCount,
                    conceal: '0',
                    rawconceal: '0',
                    availablemounts: '',
                    availablemounts_english: '',
                    avail: avail,
                    avail_english: avail,
                    cost: cost.replace(/[^0-9]/g, ''),
                    owncost: cost.replace(/[^0-9]/g, ''),
                    weight: '0',
                    ownweight: '0',
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
                    accessories: accessories.length > 0 ? { accessory: accessories } : undefined,
                    ranges: [],
                    alternateranges: [],
                    dicepool: '0',
                    dicepool_noammo: '0',
                    skill: null,
                    wirelesson: (getAttr(wRec, 'wireless') === 'Present') ? 'True' : 'False',
                });
            }
        }
        
        // Extract armor with modifications
        const armorBlock = gearBlock.armor as Record<string, unknown> | undefined;
        if (armorBlock) {
            const armorItems = armorBlock.item ? ensureArray(armorBlock.item) : [];
            for (const armor of armorItems) {
                const aRec = armor as Record<string, unknown>;
                const aname = getAttr(aRec, 'name') ?? 'Unknown Armor';
                const armorInfo = aRec.armorinfo as Record<string, unknown> | undefined;
                const armorRating = armorInfo ? getAttr(armorInfo, 'rating') ?? '0' : '0';
                const costNode = aRec.gearcost as Record<string, unknown> | undefined;
                const cost = costNode ? (getAttr(costNode, 'value') ?? '0') : '0';
                const availNode = aRec.availability as Record<string, unknown> | undefined;
                const avail = availNode ? (getAttr(availNode, 'text') ?? '') : '';
                
                // Extract armor modifications
                const armormods: Array<{
                    guid: string;
                    sourceid: string;
                    name: string;
                    name_english: string;
                    fullname: string;
                    fullname_english: string;
                    category: string;
                    category_english: string;
                    armor: string;
                    maxrating: string;
                    rating: string;
                    ratinglabel: string;
                    avail: string;
                    cost: string;
                    owncost: string;
                    weight: string;
                    ownweight: string;
                    source: string | null;
                    page: string | null;
                    included: string;
                    equipped: string;
                    wirelesson: string;
                    gears: ActorSchema['gears'] | null;
                    extra: string | null;
                }> = [];
                const modsBlock = aRec.modifications as Record<string, unknown> | undefined;
                const accessoriesBlock = aRec.accessories as Record<string, unknown> | undefined;
                
                if (modsBlock) {
                    const modItems = modsBlock.item ? ensureArray(modsBlock.item) : [];
                    for (const mod of modItems) {
                        const modRec = mod as Record<string, unknown>;
                        const mname = getAttr(modRec, 'name') ?? 'Unknown Modification';
                        const mcostNode = modRec.gearcost as Record<string, unknown> | undefined;
                        const mcost = mcostNode ? (getAttr(mcostNode, 'value') ?? '0') : '0';
                        const mavailNode = modRec.availability as Record<string, unknown> | undefined;
                        const mavail = mavailNode ? (getAttr(mavailNode, 'text') ?? '') : '';
                        
                        armormods.push({
                            guid: foundry.utils.randomID(),
                            sourceid: '',
                            name: mname,
                            name_english: mname,
                            fullname: mname,
                            fullname_english: mname,
                            category: 'Armor Modification',
                            category_english: 'Armor Modification',
                            armor: '0',
                            maxrating: '0',
                            rating: '0',
                            ratinglabel: '0',
                            avail: mavail,
                            cost: mcost.replace(/[^0-9]/g, ''),
                            owncost: mcost.replace(/[^0-9]/g, ''),
                            weight: '0',
                            ownweight: '0',
                            source: null,
                            page: null,
                            included: 'False',
                            equipped: 'False',
                            wirelesson: (getAttr(modRec, 'wireless') === 'Present') ? 'True' : 'False',
                            gears: null,
                            extra: null,
                        });
                    }
                }
                
                if (accessoriesBlock) {
                    const accItems = accessoriesBlock.item ? ensureArray(accessoriesBlock.item) : [];
                    for (const acc of accItems) {
                        const accRec = acc as Record<string, unknown>;
                        const aname = getAttr(accRec, 'name') ?? 'Unknown Accessory';
                        const acostNode = accRec.gearcost as Record<string, unknown> | undefined;
                        const acost = acostNode ? (getAttr(acostNode, 'value') ?? '0') : '0';
                        const aavailNode = accRec.availability as Record<string, unknown> | undefined;
                        const aavail = aavailNode ? (getAttr(aavailNode, 'text') ?? '') : '';
                        
                        armormods.push({
                            guid: foundry.utils.randomID(),
                            sourceid: '',
                            name: aname,
                            name_english: aname,
                            fullname: aname,
                            fullname_english: aname,
                            category: 'Armor Accessory',
                            category_english: 'Armor Accessory',
                            armor: '0',
                            maxrating: '0',
                            rating: '0',
                            ratinglabel: '0',
                            avail: aavail,
                            cost: acost.replace(/[^0-9]/g, ''),
                            owncost: acost.replace(/[^0-9]/g, ''),
                            weight: '0',
                            ownweight: '0',
                            source: null,
                            page: null,
                            included: 'False',
                            equipped: 'False',
                            wirelesson: (getAttr(accRec, 'wireless') === 'Present') ? 'True' : 'False',
                            gears: null,
                            extra: null,
                        });
                    }
                }
                
                armorEntries.push({
                    guid: foundry.utils.randomID(),
                    sourceid: '',
                    name: aname,
                    name_english: aname,
                    fullname: aname,
                    fullname_english: aname,
                    category: 'Armor',
                    category_english: 'Armor',
                    armor: armorRating,
                    totalarmorcapacity: '0',
                    calculatedcapacity: '0',
                    capacityremaining: '0',
                    avail: avail,
                    cost: cost.replace(/[^0-9]/g, ''),
                    owncost: cost.replace(/[^0-9]/g, ''),
                    weight: '0',
                    ownweight: '0',
                    source: null,
                    page: null,
                    armorname: null,
                    equipped: (getAttr(aRec, 'equipped') === 'yes' || getAttr(armorInfo, 'equipped') === 'yes') ? 'True' : 'False',
                    ratinglabel: armorRating,
                    wirelesson: (getAttr(aRec, 'wireless') === 'Present') ? 'True' : 'False',
                    armormods: armormods.length > 0 ? { armormod: armormods } : null,
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
                });
            }
        }
        
        // Extract cyberware and bioware into dedicated cyberwareEntries
        const augmentationsBlock = gearBlock.augmentations as Record<string, unknown> | undefined;
        const cyberwareBlock = augmentationsBlock?.cyberware as Record<string, unknown> | undefined;
        const biowareBlock = augmentationsBlock?.bioware as Record<string, unknown> | undefined;
        const otherGearBlock = gearBlock.gear as Record<string, unknown> | undefined;

        if (cyberwareBlock) {
            const cyberwareItems = cyberwareBlock.item ? ensureArray(cyberwareBlock.item) : [];
            for (const item of cyberwareItems) {
                cyberwareEntries.push(extractWare(item as Record<string, unknown>, false));
            }
        }
        if (biowareBlock) {
            const biowareItems = biowareBlock.item ? ensureArray(biowareBlock.item) : [];
            for (const item of biowareItems) {
                cyberwareEntries.push(extractWare(item as Record<string, unknown>, true));
            }
        }
        gearEntries.push(...extractItemsFromBlock(otherGearBlock, 'Gear'));
        
        // Add SIN items from identities (with SIN rating from identity)
        for (const id of identityData) {
            const ratingSuffix = id.rating !== '0' ? ` (${id.rating})` : '';
            const sinName = `SIN: ${id.name}${ratingSuffix}`;
            gearEntries.push({
                guid: foundry.utils.randomID(),
                sourceid: '',
                name: sinName,
                name_english: sinName,
                fullname: sinName,
                fullname_english: sinName,
                category: 'Identification',
                category_english: 'Identification',
                ispersona: 'False',
                isammo: 'False',
                issin: 'True',
                capacity: null,
                armorcapacity: null,
                maxrating: null,
                rating: id.rating,
                ratinglabel: id.rating,
                qty: '1',
                avail: '',
                avail_english: '',
                cost: '0',
                owncost: '0',
                weight: '0',
                ownweight: '0',
                extra: null,
                bonded: 'False',
                equipped: 'False',
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
            });
        }
        
        // Also check for direct item lists
        const directItems = gearBlock.item ? ensureArray(gearBlock.item) : [];
        gearEntries.push(...directItems.map((item: unknown) => {
            const rec = item as Record<string, unknown>;
            const iname = getAttr(rec, 'name') ?? 'Unknown Item';
            const quantity = getAttr(rec, 'quantity') ?? '1';
            const costNode = rec.gearcost as Record<string, unknown> | undefined;
            const cost = costNode ? (getAttr(costNode, 'value') ?? '0') : '0';
            const availNode = rec.availability as Record<string, unknown> | undefined;
            const avail = availNode ? (getAttr(availNode, 'text') ?? '') : '';
            
            return {
                guid: foundry.utils.randomID(),
                sourceid: '',
                name: iname,
                name_english: iname,
                fullname: iname,
                fullname_english: iname,
                category: 'Gear',
                category_english: 'Gear',
                ispersona: 'False',
                isammo: 'False',
                issin: (iname.toLowerCase().includes('sin') || iname.toLowerCase().includes('system identification')) ? 'True' : 'False',
                capacity: null,
                armorcapacity: null,
                maxrating: null,
                rating: '0',
                qty: quantity,
                avail: avail,
                avail_english: avail,
                cost: cost.replace(/[^0-9]/g, ''),
                owncost: cost.replace(/[^0-9]/g, ''),
                weight: '0',
                ownweight: '0',
                extra: null,
                bonded: 'False',
                equipped: 'False',
                wirelesson: (getAttr(rec, 'wireless') === 'Present') ? 'True' : 'False',
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
        }));
    }

    // When this is a vehicle-type character (e.g. standalone vehicle .por), build one vehicle from character attributes if none from gear
    if (rawCharType.includes('vehicle') && vehicleEntries.length === 0) {
        const vBody = getAttrValueFromList(attrList, 'Body');
        const vArmor = getAttrValueFromList(attrList, 'Armor');
        const vPilot = getAttrValueFromList(attrList, 'Pilot');
        const vHandling = getAttrValueFromList(attrList, 'Handling');
        const vSpeed = getAttrValueFromList(attrList, 'Speed');
        const vAccel = getAttrValueFromList(attrList, 'Acceleration');
        const vSensor = getAttrValueFromList(attrList, 'Sensor');
        const vSeats = getAttrValueFromList(attrList, 'Seats');
        vehicleEntries.push({
            guid: foundry.utils.randomID(),
            sourceid: '',
            name,
            name_english: name,
            fullname: name,
            fullname_english: name,
            category: 'Groundcraft',
            category_english: 'Groundcraft',
            isdrone: 'False',
            handling: vHandling || '0',
            accel: vAccel || '0',
            speed: vSpeed || '0',
            pilot: vPilot || '0',
            body: vBody || '0',
            armor: vArmor || '0',
            seats: vSeats || '0',
            sensor: vSensor || '0',
            avail: '',
            cost: '0',
            owncost: '0',
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
        height: personal ? (getText((personal as Record<string, unknown>).charheight) || getAttr((personal as Record<string, unknown>).charheight as XmlNode, 'text') || null) : null,
        weight: personal ? (getText((personal as Record<string, unknown>).charweight) || getAttr((personal as Record<string, unknown>).charweight as XmlNode, 'text') || null) : null,
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
        adept: powerEntries.length > 0 ? 'True' : 'False',
        magician: hasMagic ? 'True' : 'False',
        technomancer: hasResonance ? 'True' : 'False',
        ai: 'False',
        cyberwaredisabled: 'False',
        critter: isCritterType ? 'True' : 'False',
        charactertype: isNpcType ? 'NPC' : (isCritterType ? 'Critter' : 'PC'),
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
        weapons: weaponEntries.length > 0 ? { weapon: weaponEntries } : null,
        armors: armorEntries.length > 0 ? { armor: armorEntries } : null,
        cyberwares: cyberwareEntries.length > 0 ? { cyberware: cyberwareEntries } : null,
        gears: gearEntries.length > 0 ? { gear: gearEntries } : null,
        qualities: qualityEntries.length > 0 ? { quality: qualityEntries } : null,
        spells: spellEntries.length > 0 ? { spell: spellEntries } : null,
        powers: powerEntries.length > 0 ? { power: powerEntries } : null,
        complexforms: complexFormEntries.length > 0 ? { complexform: complexFormEntries } : null,
        vehicles: vehicleEntries.length > 0 ? { vehicle: vehicleEntries } : null,
        contacts: contactEntries.length > 0 ? { contact: contactEntries } : null,
        lifestyles: lifestyleEntries.length > 0 ? { lifestyle: lifestyleEntries } : null,
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
