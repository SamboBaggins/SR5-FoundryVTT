/**
 * Converts Hero Lab .por or .xml to Chummer-format JSON.
 * Run from SR5-FoundryVTT: npx tsx scripts/convert-herolabs-to-chummer.ts <file.por|file.xml>
 * Output: paste into Foundry → Import Actor → Chummer tab.
 */
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

// Mock Foundry for Node (parser uses foundry.utils.randomID)
(globalThis as unknown as { foundry: { utils: { randomID: () => string } } }).foundry = {
    utils: { randomID: () => 'id-' + Math.random().toString(36).slice(2, 11) }
};

/** Hero Lab .por lead1.xml uses abbreviated thingids for complex forms; map to full SR5 names. */
const HEROLAB_CF_ID_TO_NAME: Record<string, string> = {
    cfCleaner: 'Cleaner',
    cfDiffFire: 'Diffusion of Firewall',
    cfEditor: 'Editor',
    cfInfuAtta: 'Infusion of Attack',
    cfInfuFire: 'Infusion of Firewall',
    cfMirroredPersona: 'Mirrored Persona',
    cfPulseSto: 'Pulse Storm',
    cfPuppetee: 'Puppeteer',
    cfResChann: 'Resonance Channel',
    cfResSpike: 'Resonance Spike',
    cfResVeil: 'Resonance Veil',
    cfStaticBo: 'Static Bomb',
    cfStaticVe: 'Static Veil',
    cfTattleta: 'Tattletale',
};

type ComplexFormEntry = {
    guid: string;
    sourceid: string;
    name: string;
    name_english: string;
    fullname: string;
    fullname_english: string;
    duration: string;
    duration_english: string;
    fv: string;
    fv_english: string;
    target: string;
    target_english: string;
    source: null;
    page: null;
};

function parseComplexFormsFromLead1(lead1Xml: string): ComplexFormEntry[] {
    const found = new Set<string>();
    const entries: ComplexFormEntry[] = [];
    const re = /thing="(cf[A-Za-z]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lead1Xml)) !== null) {
        const thingId = m[1];
        if (found.has(thingId)) continue;
        const name = HEROLAB_CF_ID_TO_NAME[thingId];
        if (!name) continue;
        found.add(thingId);
        entries.push({
            guid: (globalThis as unknown as { foundry: { utils: { randomID: () => string } } }).foundry.utils.randomID(),
            sourceid: '',
            name,
            name_english: name,
            fullname: name,
            fullname_english: name,
            duration: 'I',
            duration_english: 'I',
            fv: '0',
            fv_english: '0',
            target: 'Other',
            target_english: 'Other',
            source: null,
            page: null,
        });
    }
    return entries;
}

/** Extract single main character XML and optional lead1 from a .por (one character per .por). */
async function extractXmlFromPor(porPath: string): Promise<{ mainXml: string; lead1Xml: string | null }> {
    const buffer = fs.readFileSync(porPath);
    const zip = await JSZip.loadAsync(buffer);

    const xmlFiles = Object.keys(zip.files).filter(name => name.endsWith('.xml'));
    if (xmlFiles.length === 0) {
        throw new Error('No XML file found in .por archive');
    }

    let xmlFile = xmlFiles.find(name => name.includes('statblocks_xml'));
    if (!xmlFile) {
        xmlFile = xmlFiles.find(name => name.includes('herolab/portfolio'));
    }
    if (!xmlFile) {
        xmlFile = xmlFiles.find(name => name.toLowerCase().includes('character'));
    }
    if (!xmlFile) {
        xmlFile = xmlFiles[0];
    }

    const mainXml = await zip.files[xmlFile].async('string');
    const lead1File = Object.keys(zip.files).find(name => name === 'herolab/lead1.xml');
    let lead1Xml: string | null = null;
    if (lead1File) {
        lead1Xml = await zip.files[lead1File].async('string');
    }
    return { mainXml, lead1Xml };
}

/** Safe filename segment from a name (no path or invalid chars). */
function safeName(name: string): string {
    return (name || 'entity').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').trim() || 'entity';
}

/** Clone schema and strip vehicles/spirits so the main character JSON does not re-import them. */
function characterOnlySchema(schema: import('../src/module/apps/actorImport/ActorSchema').ActorSchema) {
    const out = JSON.parse(JSON.stringify(schema)) as typeof schema;
    out.vehicles = null;
    out.spirits = null;
    return out;
}

/** Build a minimal character schema that only contains one vehicle (for secondary vehicle JSON). */
function vehicleOnlySchema(
    schema: import('../src/module/apps/actorImport/ActorSchema').ActorSchema,
    vehicle: { fullname?: string; name?: string; [key: string]: unknown }
) {
    const out = JSON.parse(JSON.stringify(schema)) as typeof schema;
    out.name = vehicle.fullname ?? vehicle.name ?? 'Vehicle';
    out.alias = vehicle.fullname ?? vehicle.name ?? 'Vehicle';
    out.vehicles = { vehicle: [vehicle] };
    out.weapons = null;
    out.armors = null;
    out.gears = null;
    out.contacts = null;
    out.lifestyles = null;
    out.spells = null;
    out.powers = null;
    out.complexforms = null;
    out.spirits = null;
    return out;
}

async function main(): Promise<void> {
    const { parseHeroLabsData } = await import('../src/module/apps/actorImport/heroLabsParser/HeroLabsParser');
    const args = process.argv.slice(2);
    const outDirIndex = args.indexOf('--out-dir');
    const outDir = outDirIndex >= 0 && args[outDirIndex + 1] ? args[outDirIndex + 1] : null;
    const fileArgs = outDir ? args.filter((_, i) => i !== outDirIndex && i !== outDirIndex + 1) : args;
    const filePath = fileArgs[0];
    if (!filePath) {
        console.error('Usage: npx tsx scripts/convert-herolabs-to-chummer.ts <file.por|file.xml> [--out-dir <dir>]');
        console.error('  --out-dir: write main character JSON plus separate JSON per vehicle/spirit/sprite (do not combine).');
        process.exit(1);
    }
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) {
        console.error('File not found:', resolved);
        process.exit(1);
    }

    let content: string;
    let lead1Xml: string | null = null;
    const ext = path.extname(resolved).toLowerCase();
    const buffer = fs.readFileSync(resolved);
    const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;

    if (isZip || ext === '.por') {
        const extracted = await extractXmlFromPor(resolved);
        content = extracted.mainXml;
        lead1Xml = extracted.lead1Xml;
    } else {
        content = fs.readFileSync(resolved, 'utf-8');
    }

    try {
        const schema = await parseHeroLabsData(content);
        if (lead1Xml) {
            const complexForms = parseComplexFormsFromLead1(lead1Xml);
            if (complexForms.length > 0) {
                schema.complexforms = { complexform: complexForms };
            }
        }

        if (outDir) {
            const outPath = path.resolve(process.cwd(), outDir);
            if (!fs.existsSync(outPath)) {
                fs.mkdirSync(outPath, { recursive: true });
            }
            const charName = safeName(String(schema.alias ?? schema.name ?? 'character'));

            // Main: character only (no vehicles/spirits so they are not combined)
            const mainSchema = characterOnlySchema(schema);
            const mainPath = path.join(outPath, `${charName}.json`);
            fs.writeFileSync(mainPath, JSON.stringify({ characters: { character: [mainSchema] } }, null, 2), 'utf-8');
            console.error(`Wrote ${mainPath}`);

            // Secondary: one JSON per vehicle
            const vehicles = schema.vehicles?.vehicle;
            const vehicleList = Array.isArray(vehicles) ? vehicles : vehicles ? [vehicles] : [];
            for (const v of vehicleList) {
                const vSchema = vehicleOnlySchema(schema, v);
                const vName = safeName(String(v.fullname ?? v.name ?? 'vehicle'));
                const vPath = path.join(outPath, `${charName}_vehicle_${vName}.json`);
                fs.writeFileSync(vPath, JSON.stringify({ characters: { character: [vSchema] } }, null, 2), 'utf-8');
                console.error(`Wrote ${vPath}`);
            }

            // Secondary: one JSON per spirit (when document parser provides spirits as full ActorSchema)
            const spirits = schema.spirits?.spirit;
            const spiritList = Array.isArray(spirits) ? spirits : spirits ? [spirits] : [];
            for (const s of spiritList) {
                const spiritSchema = s as unknown as typeof schema;
                if (spiritSchema && typeof spiritSchema === 'object' && 'metatype_english' in spiritSchema) {
                    const sName = safeName(String((spiritSchema as typeof schema).name ?? (spiritSchema as typeof schema).alias ?? 'spirit'));
                    const sPath = path.join(outPath, `${charName}_spirit_${sName}.json`);
                    fs.writeFileSync(sPath, JSON.stringify({ characters: { character: [spiritSchema] } }, null, 2), 'utf-8');
                    console.error(`Wrote ${sPath}`);
                }
            }

            // Secondary: one JSON per sprite (when document parser provides sprites as full ActorSchema)
            const sprites = (schema as unknown as { sprites?: { sprite?: unknown[] | unknown } }).sprites?.sprite;
            const spriteList = Array.isArray(sprites) ? sprites : sprites ? [sprites] : [];
            for (const s of spriteList) {
                const spriteSchema = s as unknown as typeof schema;
                if (spriteSchema && typeof spriteSchema === 'object' && 'metatype_english' in spriteSchema) {
                    const sName = safeName(String((spriteSchema as typeof schema).name ?? (spriteSchema as typeof schema).alias ?? 'sprite'));
                    const sPath = path.join(outPath, `${charName}_sprite_${sName}.json`);
                    fs.writeFileSync(sPath, JSON.stringify({ characters: { character: [spriteSchema] } }, null, 2), 'utf-8');
                    console.error(`Wrote ${sPath}`);
                }
            }

            const nSpirit = spiritList.filter((s: unknown) => (s as Record<string, unknown>)?.metatype_english).length;
            const nSprite = spriteList.filter((s: unknown) => (s as Record<string, unknown>)?.metatype_english).length;
            console.error(`Done: 1 character + ${vehicleList.length} vehicle(s) + ${nSpirit} spirit(s) + ${nSprite} sprite(s) → ${outPath}`);
            return;
        }

        const chummerJson = { characters: { character: [schema] } };
        console.log(JSON.stringify(chummerJson, null, 2));
    } catch (err) {
        console.error('Conversion failed:', err instanceof Error ? err.message : err);
        process.exit(1);
    }
}

main();
