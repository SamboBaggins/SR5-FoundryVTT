import { ImportHelper as IH } from "@/module/apps/itemImport/helper/ImportHelper";
import { BlankItem, ExtractItemType, Parser } from "../Parser";

/**
 * Parses SINs and the attached licenses.
 * Licenses that are not attached to a SIN are not handled.
 */
export class SinParser extends Parser<'sin'> {
    protected readonly parseType = 'sin';

    protected parseItem(item: BlankItem<'sin'>, itemData: ExtractItemType<'gears', 'gear'>) {
        const system = item.system;

        // FVTT SIN technology.rating: check every possible source (like Skills: every attribute)
        const rating = SinParser.getSinRating(itemData);
        system.technology.rating = Math.max(0, rating);

        // Create licenses if there are any
        if (itemData.children)
            system.licenses = this.parseLicenses(itemData.children);
    }

    /** Get SIN rating from gear entry - check all FVTT-relevant fields (rating, ratinglabel, extra, name). */
    private static getSinRating(itemData: ExtractItemType<'gears', 'gear'>): number {
        const r = Number(itemData.rating) || 0;
        if (r > 0) return r;
        const rl = Number((itemData as Record<string, unknown>).ratinglabel) || 0;
        if (rl > 0) return rl;
        const ex = Number((itemData as Record<string, unknown>).extra) || 0;
        if (ex > 0) return ex;
        const fromName = SinParser.ratingFromName(itemData.name ?? itemData.fullname ?? '');
        return fromName >= 0 ? fromName : 0;
    }

    /** Parse rating from SIN name when present as " (2)" or " (Rtg 2)" (fallback when XML doesn't provide rating). */
    private static ratingFromName(name: string): number {
        if (!name || typeof name !== 'string') return -1;
        const m = name.match(/\(Rtg\s*(\d+)\)|\((\d+)\)\s*$/);
        return m ? Math.max(0, parseInt(m[1] ?? m[2], 10) || 0) : -1;
    }

    private parseLicenses(licensesData: ExtractItemType<'gears', 'gear'>['children']) {
        const licenses: BlankItem<'sin'>['system']['licenses'] = [];

        for (const licenseData of IH.getArray(licensesData?.gear)) {
            if (licenseData.category_english === 'ID/Credsticks') {
                licenses.push({
                    name: licenseData.extra || "Unnamed",
                    rtg: Number(licenseData.rating) || 0,
                    description: ''
                });
            }
        }

        return licenses;
    }
}
