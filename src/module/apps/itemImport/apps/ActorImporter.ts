import { CharacterImporter } from "../../actorImport/characterImporter/CharacterImporter";
import { SpiritImporter } from "../../actorImport/spiritImporter/SpiritImporter";
import { SpriteImporter } from "../../actorImport/spriteImporter/SpriteImporter";
import { ActorFile, ActorSchema } from "../../actorImport/ActorSchema";
import { ImporterSourcesConfig } from "./ImporterSourcesConfig";
import { ImportHelper as IH } from "../helper/ImportHelper";
import { parseHeroLabsData, validateHeroLabsData } from "../../actorImport/heroLabsParser/HeroLabsParser";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

interface ImporterContext extends foundry.applications.api.ApplicationV2.RenderContext {
    folders: { id: string, name: string }[]
};

const BaseClass = HandlebarsApplicationMixin(ApplicationV2<ImporterContext>);
type BaseClassType = InstanceType<typeof BaseClass>;

export class ActorImporter extends BaseClass {
    /**
     * Default options for the application window.
     */
    static override DEFAULT_OPTIONS = {
        id: "chummer-data-import",
        tag: "form",
        position: {
            width: 600,
            height: "auto" as const,
        },
        window: {
            classes: ["chummer-import"],
            title: "Chummer/Data Import",
            icon: "fas fa-file-import",
        },
        actions: {
            import: function(this: ActorImporter) {
                void this.handleActorImport();
            },
            openConfig: function(this: ActorImporter) {
                void new ImporterSourcesConfig().render(true);
            },
            loadExample: function(this: ActorImporter) {
                this.loadHeroLabsExample();
            }
        }
    };

    /**
     * Template parts used by the HandlebarsApplicationMixin.
     */
    static override PARTS = {
        content: {
            template: "systems/shadowrun5e/dist/templates/apps/actor-importer.hbs",
        },
    };

    /**
     * Dynamic title for the application window.
     */
    override get title() {
        return game.i18n.localize("SR5.Import.ActorImporter.Title");
    }

    override async _prepareContext(...args: Parameters<BaseClassType['_prepareContext']>) {
        const baseContext = await super._prepareContext(...args);
        const compareOptions = { numeric: true, sensitivity: 'base' } satisfies Intl.CollatorOptions;

        const folders = game.folders
            .filter(f => f.type === "Actor")
            .map(folder => ({
                id: folder.id,
                name: `${'─'.repeat(folder.ancestors.length) + ' '}${folder.name}`.trim(),
                sortKey: [...folder.ancestors.reverse().map(a => a.name), folder.name]
            }))
            .sort((a, b) => {
                const len = Math.min(a.sortKey.length, b.sortKey.length);
                for (let i = 0; i < len; i++) {
                    const cmp = a.sortKey[i].localeCompare(b.sortKey[i], undefined, compareOptions);
                    if (cmp !== 0) return cmp;
                }
                return a.sortKey.length - b.sortKey.length;
            })
            .map(({ id, name }) => ({ id, name }));

        return { ...baseContext, folders };
    }

    override async _activateListeners(html: JQuery<HTMLElement> | HTMLElement) {
        const $html = (typeof (html as JQuery).find === 'function') ? (html as JQuery<HTMLElement>) : $(html as HTMLElement);
        await super._activateListeners($html);

        // Tab switching (preventDefault so form/other handlers don't capture the click)
        $html.find('.import-tab').on('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const tab = $(event.currentTarget);
            const source = tab.data('source');
            if (source) this.switchImportSource(source);
        });

        // File input handler
        const fileInput = $html.find('#herolabs-file-input')[0] as HTMLInputElement;
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                if (target.files && target.files.length > 0) {
                    this.handleFileUpload(target.files[0]);
                }
            });
        }

        // Browse button
        $html.find('.browse-button').on('click', () => {
            fileInput?.click();
        });

        // Remove file button
        $html.find('#herolabs-remove-file').on('click', () => {
            this.clearFileUpload();
        });

        // Load example (no data-action on button; bind manually so we use same element)
        $html.find('.load-example-button').on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.loadHeroLabsExample();
        });

        // Drag and drop
        const dropArea = $html.find('#herolabs-file-drop')[0];
        if (dropArea) {
            dropArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropArea.classList.add('drag-over');
            });

            dropArea.addEventListener('dragleave', () => {
                dropArea.classList.remove('drag-over');
            });

            dropArea.addEventListener('drop', (e) => {
                e.preventDefault();
                dropArea.classList.remove('drag-over');
                if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                    this.handleFileUpload(e.dataTransfer.files[0]);
                }
            });
        }
    }

    private switchImportSource(source: string) {
        const html = $(this.element as HTMLElement);

        // Update tabs
        html.find('.import-tab').removeClass('active');
        html.find(`.import-tab[data-source="${source}"]`).addClass('active');
        
        // Update sections
        html.find('.import-section').hide();
        html.find(`#${source}-section`).show();
    }

    private async handleFileUpload(file: File) {
        const html = $(this.element as HTMLElement);
        const fileName = file.name;
        const fileExtension = fileName.split('.').pop()?.toLowerCase();

        // Validate file type (.por, .xml, .json) – accept is relaxed so picker shows all files
        const allowed = ['por', 'xml', 'json', 'txt'];
        if (!fileExtension || !allowed.includes(fileExtension)) {
            ui.notifications?.error(game.i18n.localize('SR5.Import.HeroLabs.InvalidFileType'));
            return;
        }
        const treatAsXml = fileExtension === 'por' || fileExtension === 'xml' || (fileExtension === 'txt' && fileName.toLowerCase().endsWith('.xml'));

        // Show file info
        html.find('#herolabs-file-name').text(fileName);
        html.find('.file-upload-prompt').hide();
        html.find('#herolabs-file-info').show();

        try {
            // Read file content
            const content = await this.readFileContent(file);
            
            // Store content for import
            this._heroLabsFileContent = content;
            this._heroLabsFileType = treatAsXml ? 'xml' : 'json';
            
            // If JSON, try to parse and show in textarea
            if (fileExtension === 'json') {
                try {
                    const jsonText = typeof content === 'string' ? content : new TextDecoder().decode(content);
                    const textarea = html.find('#herolabs-input')[0] as HTMLTextAreaElement;
                    if (textarea) {
                        textarea.value = jsonText;
                    }
                } catch (e) {
                    console.warn('Could not parse JSON file for textarea display:', e);
                }
            }
        } catch (error) {
            ui.notifications?.error(
                game.i18n.format('SR5.Import.HeroLabs.FileReadError', 
                    error instanceof Error ? error.message : String(error))
            );
            this.clearFileUpload();
        }
    }

    private clearFileUpload() {
        const html = $(this.element as HTMLElement);
        html.find('#herolabs-file-input').val('');
        html.find('.file-upload-prompt').show();
        html.find('#herolabs-file-info').hide();
        this._heroLabsFileContent = null;
        this._heroLabsFileType = null;
    }

    private async readFileContent(file: File): Promise<string | ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (e.target?.result) {
                    resolve(e.target.result);
                } else {
                    reject(new Error('Failed to read file'));
                }
            };
            reader.onerror = () => reject(new Error('File reading error'));
            
            // Read as text for JSON, XML, and .txt; .por may be binary so use ArrayBuffer
            if (file.name.endsWith('.json') || file.name.endsWith('.xml') || file.name.endsWith('.txt')) {
                reader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }
        });
    }

    private _heroLabsFileContent: string | ArrayBuffer | null = null;
    private _heroLabsFileType: 'xml' | 'json' | null = null;

    /** Minimal Hero Lab document XML for "Load example character" – valid for parseHeroLabDocumentXml */
    private static readonly HERO_LABS_EXAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<document><public><character name="Example Runner" playername="">
<race name="Human"/><heritage name=""/><creation><bp total="0" left="0"/></creation>
<karma total="0" left="0"/><cash total="5000"/>
<personal gender="" age="" hair="" eyes="" skin=""/>
<attributes>
<attribute name="Body" text="3" base="3" modified="3" minimum="1" augmentedmaximum="6"/>
<attribute name="Agility" text="3" base="3" modified="3" minimum="1" augmentedmaximum="6"/>
<attribute name="Reaction" text="3" base="3" modified="3" minimum="1" augmentedmaximum="6"/>
<attribute name="Strength" text="3" base="3" modified="3" minimum="1" augmentedmaximum="6"/>
<attribute name="Willpower" text="3" base="3" modified="3" minimum="1" augmentedmaximum="6"/>
<attribute name="Logic" text="3" base="3" modified="3" minimum="1" augmentedmaximum="6"/>
<attribute name="Intuition" text="3" base="3" modified="3" minimum="1" augmentedmaximum="6"/>
<attribute name="Charisma" text="3" base="3" modified="3" minimum="1" augmentedmaximum="6"/>
<attribute name="Edge" text="1" base="1" modified="1" minimum="1" augmentedmaximum="6"/>
<attribute name="Essence" text="6" base="6" modified="6" minimum="0" augmentedmaximum="6"/>
<attribute name="Initiative" text="6+1D6" base="6" modified="6" minimum="2" augmentedmaximum="12"/>
</attributes>
<movementtypes><movementtype name="Land Movement"><walking value="6"/><running value="12"/></movementtype></movementtypes>
<armorratings><armorrating name="Armor" rating="0"/></armorratings>
<reputations><reputation name="Street Cred" value="0"/><reputation name="Notoriety" value="0"/><reputation name="Public Awareness" value="0"/></reputations>
<qualities><positive/><negative/></qualities>
<skills><groups/><active/><knowledge/><language/></skills>
</character></public></document>`;

    private loadHeroLabsExample(): void {
        const html = $(this.element as HTMLElement);
        this.clearFileUpload();
        const textarea = html.find('#herolabs-input')[0] as HTMLTextAreaElement;
        if (textarea) {
            textarea.value = ActorImporter.HERO_LABS_EXAMPLE_XML;
            ui.notifications?.info(game.i18n.localize('SR5.Import.HeroLabs.ExampleLoaded') ?? 'Example XML loaded. Click "Import Character" to create the actor.');
        }
    }

    private async handleActorImport() {
        const html = $(this.element as HTMLElement);
        const activeTab = html.find('.import-tab.active').data('source');
        
        let actorData: ActorSchema;

        if (activeTab === 'herolabs') {
            // Hero Labs import
            actorData = await this.handleHeroLabsImport();
        } else {
            // Chummer import
            actorData = await this.handleChummerImport();
        }

        if (!actorData) {
            return; // Error already shown
        }

        const getCheckboxValue = (selector: string): boolean =>
            (html.find(selector)[0] as HTMLInputElement)?.checked ?? false;

        const getInputValue = (selector: string): string | null =>
            (html.find(selector)[0] as HTMLInputElement)?.value || null;

        const importOptions = {
            assignIcons: getCheckboxValue('#assign-icons'),
            folderId: getInputValue('#chummer-folder-select'),

            armor: getCheckboxValue('input[data-field="armor"]'),
            contacts: getCheckboxValue('input[data-field="contacts"]'),
            cyberware: getCheckboxValue('input[data-field="cyberware"]'),
            equipment: getCheckboxValue('input[data-field="gear"]'),
            lifestyles: getCheckboxValue('input[data-field="lifestyles"]'),
            powers: getCheckboxValue('input[data-field="powers"]'),
            qualities: getCheckboxValue('input[data-field="qualities"]'),
            spells: getCheckboxValue('input[data-field="spells"]'),
            vehicles: getCheckboxValue('input[data-field="vehicles"]'),
            weapons: getCheckboxValue('input[data-field="weapons"]'),
        };

        const spiritType = this.getSpiritType(actorData);
        if (spiritType)
            await SpiritImporter.import(actorData, spiritType, importOptions);
        else if (actorData.metatype_english?.toLowerCase().includes('sprite'))
            await SpriteImporter.import(actorData, importOptions);
        else
            await CharacterImporter.import(actorData, importOptions);

        await this.close();
    }

    private async handleChummerImport(): Promise<ActorSchema | null> {
        const html = $(this.element as HTMLElement);
        const textarea = html.find('#chummer-input')[0] as HTMLTextAreaElement;
        const jsonText = textarea?.value.trim();

        if (!jsonText) {
            ui.notifications?.warn(game.i18n.localize('SR5.Import.Chummer.NoDataError') || "Please paste Chummer JSON data to import.");
            return null;
        }

        try {
            const actorData = IH.getArray((JSON.parse(jsonText) as ActorFile).characters.character)[0];
            return actorData;
        } catch (e) {
            ui.notifications?.error(game.i18n.localize('SR5.Import.Chummer.InvalidJsonError') || "Invalid JSON. Please check your input.");
            console.error("JSON Parse Error:", e);
            return null;
        }
    }

    private async handleHeroLabsImport(): Promise<ActorSchema | null> {
        const html = $(this.element as HTMLElement);
        let heroLabsData: unknown = null;

        // Check if file was uploaded
        if (this._heroLabsFileContent) {
            try {
                if (this._heroLabsFileType === 'xml') {
                    // .por file - convert ArrayBuffer to string
                    const content = this._heroLabsFileContent instanceof ArrayBuffer
                        ? new TextDecoder().decode(this._heroLabsFileContent)
                        : this._heroLabsFileContent as string;
                    heroLabsData = content;
                } else {
                    // JSON file
                    const content = this._heroLabsFileContent instanceof ArrayBuffer
                        ? new TextDecoder().decode(this._heroLabsFileContent)
                        : this._heroLabsFileContent as string;
                    heroLabsData = JSON.parse(content);
                }
            } catch (error) {
                ui.notifications?.error(
                    game.i18n.format('SR5.Import.HeroLabs.ParseError',
                        error instanceof Error ? error.message : String(error))
                );
                return null;
            }
        } else {
            // Check textarea (XML or JSON)
            const textarea = html.find('#herolabs-input')[0] as HTMLTextAreaElement;
            const pastedText = textarea?.value.trim();

            if (!pastedText) {
                ui.notifications?.warn(game.i18n.localize('SR5.Import.HeroLabs.NoDataError'));
                return null;
            }

            if (pastedText.startsWith('<')) {
                heroLabsData = pastedText;
            } else {
                try {
                    heroLabsData = JSON.parse(pastedText);
                } catch (error) {
                    ui.notifications?.error(game.i18n.localize('SR5.Import.HeroLabs.InvalidJsonError'));
                    console.error("JSON Parse Error:", error);
                    return null;
                }
            }
        }

        // Validate and parse Hero Labs data
        try {
            validateHeroLabsData(heroLabsData);
            const actorData = await parseHeroLabsData(heroLabsData);
            return actorData;
        } catch (error) {
            ui.notifications?.error(
                game.i18n.format('SR5.Import.HeroLabs.ImportError',
                    error instanceof Error ? error.message : String(error))
            );
            console.error("Hero Labs Import Error:", error);
            return null;
        }
    }

    private getSpiritType(chummerChar: ActorSchema) {
        const spiritTypes = [
            'air', 'aircraft', 'airwave', 'ally', 'automotive', 'beasts', 'ceramic', 'earth', 'energy',
            'fire', 'guardian', 'guidance', 'homunculus', 'man', 'metal','plant', 'ship', 'task', 'train',
            'water', 'watcher', 'blood', 'muse', 'nightmare', 'shade', 'succubus', 'wraith',

            //shedim
            'shedim', 'hopper', 'blade_summoned', 'horror_show', 'unbreakable', 'master_shedim',

            // insect
            'caretaker', 'nymph', 'scout', 'soldier', 'worker', 'queen',

            "carcass", "corpse", "rot", "palefile", "detritus",

            // Howling Shadow
            "anarch", "arboreal", "blackjack", "boggle", "bugul", "chindi", "corpselight", "croki",
            "duende", "ejerian", "elvar", "erinyes", "green_man", "imp", "jarl", "kappa", "kokopelli",
            "morbi", "nocnitsa", "phantom", "preta", "stabber", "tungak", "vucub_caquix",
            
            // Aetherology
            'gum_toad', 'crawler', 'ghasts', 'vryghots', 'gremlin', 'anansi', 'tsuchigumo_warrior',

            // Horror Terrors
            'corps_cadavre',

            // Toxic
            'abomination', 'barren', 'noxious', 'nuclear', 'plague', 'sludge'
        ] as const;

        // Normalize the metatype string to a spirit type key
        const chummerType = chummerChar.metatype_english
            .replace(/\s*\(.*?\)\s*/g, '')
            .replace(/^Spirit of /, '')
            .replace(/ Spirit$/, '')
            .replace(/[\s-]/g, '_')
            .toLowerCase()
            .trim();

        return spiritTypes.find(v => RegExp(`\\b${v}\\b`, "i").test(chummerType));
    }
}
