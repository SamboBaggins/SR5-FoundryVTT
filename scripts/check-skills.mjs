#!/usr/bin/env node
/**
 * Skill-by-skill checker: compare Hero Lab XML (from .por) with converted JSON.
 * Usage: node scripts/check-skills.mjs <path-to.por>
 * Reads the same XML the converter uses, parses skills, runs conversion, compares.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getXmlFromPor(porPath) {
    const buffer = fs.readFileSync(porPath);
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((n) => n.includes('statblocks_xml') && n.endsWith('.xml'));
    const xmlFile = names[0];
    if (!xmlFile) throw new Error('No statblocks XML in .por');
    return await zip.files[xmlFile].async('string');
}

function getAttr(rec, key) {
    if (!rec || typeof rec !== 'object') return undefined;
    const attrs = rec.$;
    if (attrs && attrs[key] !== undefined) return attrs[key];
    if (rec[key] !== undefined && typeof rec[key] === 'string') return rec[key];
    return undefined;
}

function ensureArray(val) {
    if (val == null) return [];
    return Array.isArray(val) ? val : [val];
}

async function parseXmlSkills(xmlContent) {
    const { parseStringPromise } = await import('xml2js');
    const parsed = await parseStringPromise(xmlContent, {
        explicitArray: false,
        attrkey: '$',
        charkey: '_TEXT',
    });
    const doc = parsed.document ?? parsed;
    const pub = doc.public;
    if (!pub || !pub.character) {
        return { groups: [], active: [] };
    }
    const char = pub.character;
    const skills = char.skills;
    if (!skills) return { groups: [], active: [] };

    const groups = [];
    const gBlock = skills.groups;
    if (gBlock && gBlock.skill) {
        for (const g of ensureArray(gBlock.skill)) {
            const name = getAttr(g, 'name');
            const base = getAttr(g, 'base') ?? getAttr(g, 'text') ?? '0';
            const val = parseInt(String(base).replace(/\D/g, ''), 10) || 0;
            if (name) groups.push({ name, rating: val });
        }
    }

    const active = [];
    const aBlock = skills.active;
    if (aBlock && aBlock.skill) {
        for (const s of ensureArray(aBlock.skill)) {
            const name = getAttr(s, 'name');
            const group = getAttr(s, 'group');
            const fromGroup = (getAttr(s, 'fromgroup') ?? '').toLowerCase() === 'yes';
            const base = getAttr(s, 'base') ?? getAttr(s, 'modified') ?? '0';
            const rating = parseInt(String(base).replace(/\D/g, ''), 10) || 0;
            if (name) active.push({ name, group, fromGroup, base, rating });
        }
    }
    return { groups, active };
}

function normalizeSkillKey(name) {
    return String(name || '').trim().toLowerCase().replace(/[\s-]/g, '_');
}

function expectedActiveSkills(groups, active) {
    const groupRating = {};
    for (const g of groups) groupRating[g.name] = g.rating;
    const byName = new Map();
    for (const s of active) {
        const name = s.name;
        if (!name) continue;
        let rating = s.rating;
        if (s.fromGroup && s.group && rating === 0 && groupRating[s.group] != null) {
            rating = groupRating[s.group];
        }
        const key = normalizeSkillKey(name);
        const existing = byName.get(key);
        if (existing == null || existing < rating) byName.set(key, rating);
    }
    return Object.fromEntries(byName);
}

function getConvertedSkills(jsonPath) {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    const char = data?.characters?.character?.[0];
    if (!char || !char.skills || !char.skills.skill) return {};
    const byName = {};
    for (const s of char.skills.skill) {
        const name = normalizeSkillKey(s.name_english ?? s.name ?? '');
        if (!name) continue;
        const rating = parseInt(s.rating || '0', 10);
        if (s.knowledge === 'True' || s.islanguage === 'True') continue;
        if (byName[name] == null || byName[name] < rating) byName[name] = rating;
    }
    return byName;
}

/**
 * Run skill check. If jsonPath is provided, use that file (no conversion). If quiet, only print mismatches/summary.
 * @returns {{ mismatches: string[], ok: boolean }}
 */
async function runSkillCheck(porPath, jsonPath = null, quiet = false) {
    const resolvedPor = path.resolve(porPath);
    if (!resolvedPor || !fs.existsSync(resolvedPor)) {
        throw new Error('Missing or invalid .por path');
    }
    const xmlContent = await getXmlFromPor(resolvedPor);
    const { groups, active } = await parseXmlSkills(xmlContent);
    const expected = expectedActiveSkills(groups, active);

    let actual;
    if (jsonPath && fs.existsSync(path.resolve(jsonPath))) {
        actual = getConvertedSkills(path.resolve(jsonPath));
    } else {
        const sr5Root = path.resolve(__dirname, '..');
        const convOut = execSync(`npx tsx scripts/convert-herolabs-to-chummer.ts "${resolvedPor}"`, {
            cwd: sr5Root,
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
        });
        const outPath = path.join(path.dirname(resolvedPor), 'converted-check-skills.json');
        fs.writeFileSync(outPath, convOut, 'utf8');
        actual = getConvertedSkills(outPath);
    }

    const allNames = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const mismatches = [];
    const activeMismatches = []; // expected active skill but wrong/missing (for quiet mode)
    for (const n of [...allNames].sort()) {
        const exp = expected[n];
        const act = actual[n];
        if (exp !== act) {
            mismatches.push(`${n}: expected ${exp ?? 'MISSING'}, got ${act ?? 'MISSING'}`);
            if (exp != null) activeMismatches.push(`${n}: expected ${exp}, got ${act ?? 'MISSING'}`);
        }
    }

    if (!quiet) {
        console.log('=== Groups (from XML) ===');
        console.log(JSON.stringify(groups, null, 2));
        console.log('\n=== Active skills (from XML, first 30) ===');
        console.log(JSON.stringify(active.slice(0, 30), null, 2));
        console.log('\n=== Expected active ratings (by name) ===');
        for (const n of Object.keys(expected).sort()) {
            console.log(`  ${n}: ${expected[n]}`);
        }
        console.log('\n=== Converted active ratings (by name) ===');
        for (const n of Object.keys(actual).sort()) {
            console.log(`  ${n}: ${actual[n]}`);
        }
    }
    const toShow = quiet ? activeMismatches : mismatches;
    console.log(quiet ? '' : '\n=== MISMATCHES (expected vs converted) ===');
    if (toShow.length > 0) {
        toShow.forEach((m) => console.log(`  ${m}`));
    } else {
        console.log(quiet ? '  Skills OK (no active-skill mismatches).' : '  (none)');
    }
    return { mismatches, ok: activeMismatches.length === 0 };
}

async function main() {
    const porPath = path.resolve(process.argv[2] || '');
    const jsonPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
    const quiet = process.argv.includes('--quiet') || jsonPath != null;
    if (!porPath || !fs.existsSync(porPath)) {
        console.error('Usage: node scripts/check-skills.mjs <path-to.por> [path-to-converted.json] [--quiet]');
        process.exit(1);
    }
    await runSkillCheck(porPath, jsonPath, quiet);
    if (jsonPath && !quiet) {
        console.log('\nDone.');
    }
}

export { runSkillCheck };

if (process.argv[2]) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
