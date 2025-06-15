// main.ts - Complete Footnotes Manager Plugin - FIXED VERSION
import { 
	App, 
	Editor, 
	MarkdownView, 
	Plugin, 
	PluginSettingTab, 
	Setting, 
	WorkspaceLeaf, 
	ItemView,
	TFile,
	EditorPosition,
	Notice,
	Modal
} from 'obsidian';

// Plugin settings interface
interface FootnotesManagerSettings {
	openOnStart: boolean;
	debugMode: boolean;
	defaultCollapsed: boolean;
}

const DEFAULT_SETTINGS: FootnotesManagerSettings = {
	openOnStart: true,
	debugMode: false,
	defaultCollapsed: true
}

// View type constant
export const FOOTNOTES_VIEW_TYPE = 'footnotes-manager-view';

// Interface for footnote reference data
interface FootnoteReference {
	number: string;
	line: number;
	startPos: number;
	endPos: number;
	fullMatch: string;
}

// Interface for footnote definition data
interface FootnoteDefinition {
	number: string;
	content: string;
	line: number;
	startPos: number;
	endPos: number;
	fullMatch: string;
}

// Interface for footnote data combining references and definition
interface FootnoteData {
	number: string;
	content: string;
	definition: FootnoteDefinition;
	references: FootnoteReference[];
	referenceCount: number;
}

// Interface for header data
interface HeaderData {
	text: string;
	level: number;
	line: number;
}

// Interface for grouped footnotes
interface FootnoteGroup {
	header: HeaderData | null;
	footnotes: FootnoteData[];
	children?: FootnoteGroup[];
	parent?: FootnoteGroup;
	isCollapsed?: boolean;
}

// Interface for tracking rendered groups
interface RenderedGroup {
	group: FootnoteGroup;
	collapseIcon: Element;
	contentElement: HTMLElement;
}

// Renumber Confirmation Modal
class RenumberConfirmationModal extends Modal {
	plugin: FootnotesManagerPlugin;
	onConfirm: () => void;
	gaps: string[];
	
	constructor(app: App, plugin: FootnotesManagerPlugin, gaps: string[], onConfirm: () => void) {
		super(app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
		this.gaps = gaps;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Title
		contentEl.createEl('h2', { text: 'Renumber Footnotes' });

		// Description
		const desc = contentEl.createEl('p', { cls: 'renumber-description' });
		desc.innerHTML = `This will remove gaps in footnote numbering. The following gaps were detected: <strong>${this.gaps.join(', ')}</strong>`;

		// Warning
		const warning = contentEl.createEl('p', { cls: 'renumber-warning' });
		warning.innerHTML = '<strong>Warning:</strong> This action cannot be undone. All footnote references and definitions will be renumbered sequentially.';

		// Buttons
		const buttonContainer = contentEl.createEl('div', { cls: 'renumber-buttons' });
		
		const confirmBtn = buttonContainer.createEl('button', { 
			text: 'Renumber Footnotes', 
			cls: 'mod-cta'
		});
		
		const cancelBtn = buttonContainer.createEl('button', { 
			text: 'Cancel'
		});

		// Button handlers
		confirmBtn.onclick = () => {
			this.onConfirm();
			this.close();
		};

		cancelBtn.onclick = () => {
			this.close();
		};
	}
}

export default class FootnotesManagerPlugin extends Plugin {
	settings: FootnotesManagerSettings;
	private refreshTimeout: number | null = null;
	public skipNextRefresh: boolean = false;
	private allHeaders: HeaderData[] = [];
	private lastEditPosition: EditorPosition | null = null;
	public skipRefreshUntil: number = 0; // ADDED: Timestamp-based skip mechanism
	public isNavigating: boolean = false; // ADDED: Global navigation state

	private debug(message: string, ...args: any[]) {
		if (this.settings.debugMode) {
			console.log(`[Footnotes Manager] ${message}`, ...args);
		}
	}

	async onload() {
		await this.loadSettings();

		// Register the custom view
		this.registerView(
			FOOTNOTES_VIEW_TYPE,
			(leaf) => new FootnotesView(leaf, this)
		);

		// Add ribbon icon to toggle footnotes panel
		this.addRibbonIcon('hash', 'Toggle Footnotes Panel', () => {
			this.activateView();
		});

		// Add command to toggle footnotes panel
		this.addCommand({
			id: 'toggle-footnotes-panel',
			name: 'Toggle Footnotes Panel',
			callback: () => {
				this.activateView();
			}
		});

		// Add command to insert footnote
		this.addCommand({
			id: 'insert-footnote',
			name: 'Insert footnote',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.insertFootnote(editor);
			}
		});

		// Add command to jump to footnotes section
		this.addCommand({
			id: 'jump-to-footnotes',
			name: 'Jump to footnotes section',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.jumpToFootnotesSection(editor);
			}
		});

		// Add command to return to last edit position
		this.addCommand({
			id: 'return-to-edit-position',
			name: 'Return to last edit position',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.returnToLastEditPosition(editor);
			}
		});

		// Add settings tab
		this.addSettingTab(new FootnotesManagerSettingTab(this.app, this));

		// Listen for file changes to update footnotes panel
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				// ENHANCED: Check all skip conditions including global navigation state
				if (this.skipNextRefresh || Date.now() < this.skipRefreshUntil || this.isNavigating) {
					this.debug('Skipping refresh on active-leaf-change due to skip flags, skipNextRefresh:', this.skipNextRefresh, 'isNavigating:', this.isNavigating);
					return;
				}
				this.refreshFootnotesView();
			})
		);

		// Listen for editor changes
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor) => {
				// FIXED: Don't refresh on every editor change, only on content changes
				// This prevents unnecessary refreshes when buttons are clicked
				if (!this.skipNextRefresh) {
					this.debounceRefresh();
				}
			})
		);

		// FIXED: Track cursor position separately without triggering refresh
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor) => {
				if (!this.skipNextRefresh) {
					this.lastEditPosition = editor.getCursor();
				}
			})
		);

		// Open footnotes panel on startup if setting is enabled
		if (this.settings.openOnStart) {
			this.app.workspace.onLayoutReady(() => {
				this.activateView();
			});
		}
	}

	insertFootnote(editor: Editor) {
		const content = editor.getValue();
		const footnotes = this.extractFootnotes(content);
		
		// Find next available footnote number
		const existingNumbers = footnotes.map(f => parseInt(f.number)).filter(n => !isNaN(n)).sort((a, b) => a - b);
		let nextNumber = 1;
		for (const num of existingNumbers) {
			if (num === nextNumber) {
				nextNumber++;
			} else {
				break;
			}
		}

		// Insert footnote reference at cursor
		const cursor = editor.getCursor();
		const footnoteRef = `[^${nextNumber}]`;
		editor.replaceRange(footnoteRef, cursor);

		// Add footnote definition at end of document
		const lines = content.split('\n');
		let insertPos = lines.length;
		
		// Find existing footnotes section or create one
		let footnotesStartLine = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			if (lines[i].match(/^\[\^[\w-]+\]:/)) {
				footnotesStartLine = i;
				break;
			}
		}

		if (footnotesStartLine === -1) {
			// No footnotes exist, add some spacing and create new section
			if (lines[lines.length - 1].trim() !== '') {
				editor.setValue(content + '\n\n');
			} else {
				editor.setValue(content + '\n');
			}
			insertPos = editor.lineCount();
		} else {
			// Insert after last footnote
			insertPos = footnotesStartLine + 1;
			// Find the actual end of footnotes
			for (let i = footnotesStartLine + 1; i < lines.length; i++) {
				if (lines[i].match(/^\[\^[\w-]+\]:/) || lines[i].trim() === '') {
					if (lines[i].match(/^\[\^[\w-]+\]:/)) {
						insertPos = i + 1;
					}
				} else if (lines[i].trim() !== '') {
					break;
				}
			}
		}

		const footnoteDefinition = `[^${nextNumber}]: `;
		editor.replaceRange('\n' + footnoteDefinition, { line: insertPos, ch: 0 });
		
		// Position cursor after the footnote definition colon and space
		editor.setCursor({ line: insertPos + 1, ch: footnoteDefinition.length });
		
		this.refreshFootnotesView();
		new Notice(`Footnote ${nextNumber} inserted`);
	}

	jumpToFootnotesSection(editor?: Editor) {
	    this.debug('jumpToFootnotesSection called, editor provided:', !!editor);
    
	    // Try to get editor from parameter
	    let activeEditor = editor;
	    let targetFile: TFile | null = null;
    
	    if (!activeEditor) {
	        this.debug('No editor provided, getting file from footnotes view');
        
	        // Get the file that the footnotes panel is currently showing
	        const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
	        if (footnoteLeaves.length > 0) {
	            const footnoteView = footnoteLeaves[0].view as FootnotesView;
	            targetFile = (footnoteView as any).currentFile;
	            this.debug('Got target file from footnotes view:', !!targetFile);
	        }
        
	        // If we have a target file, find its editor
	        if (targetFile) {
	            const leaves = this.app.workspace.getLeavesOfType('markdown');
	            for (const leaf of leaves) {
	                const view = leaf.view as MarkdownView;
	                if (view.file === targetFile) {
	                    activeEditor = view.editor;
	                    this.debug('Found editor for target file');
	                    break;
	                }
	            }
	        }
        
	        // Fallback to previous method if that didn't work
	        if (!activeEditor) {
	            this.debug('Fallback: searching for any active view');
	            let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            
	            if (!activeView) {
	                const leaves = this.app.workspace.getLeavesOfType('markdown');
	                if (leaves.length > 0) {
	                    activeView = leaves[0].view as MarkdownView;
	                }
	            }
            
	            if (!activeView) {
	                new Notice('No markdown editor found. Please click in a markdown document first.');
	                return;
	            }
            
	            activeEditor = activeView.editor;
	        }
	    }

	    // Double-check that we have a valid editor
	    if (!activeEditor || typeof activeEditor.getCursor !== 'function') {
	        this.debug('Editor is invalid or missing getCursor method');
	        new Notice('Unable to access editor');
	        return;
	    }

	    try {
	        // Store current position
	        this.lastEditPosition = activeEditor.getCursor();
	        this.debug('Stored last edit position:', this.lastEditPosition);
        
	        const content = activeEditor.getValue();
	        const lines = content.split('\n');
        
	        this.debug('Document has', lines.length, 'lines, content length:', content.length);
	        this.debug('Searching for footnote definitions...');
        
	        // Find first footnote definition with flexible whitespace handling
	        let foundFootnoteAt = -1;
	        for (let i = 0; i < lines.length; i++) {
	            const line = lines[i];
            
	            // More flexible pattern - allow whitespace before [^ and look for ]:
	            if (line.match(/^\s*\[\^[\w-]+\]:/)) {
	                this.debug(`Found footnote definition at line ${i + 1}:`, line.trim().substring(0, 100));
	                if (foundFootnoteAt === -1) {
	                    foundFootnoteAt = i;
	                }
	            }
	        }

	        this.debug(`Total footnote definitions found: ${foundFootnoteAt >= 0 ? 'at least 1' : 'none'}`);

	        if (foundFootnoteAt >= 0) {
	            this.debug('Jumping to first footnote at line', foundFootnoteAt + 1);
	            activeEditor.setCursor({ line: foundFootnoteAt, ch: 0 });
	            activeEditor.scrollIntoView({ from: { line: foundFootnoteAt, ch: 0 }, to: { line: foundFootnoteAt, ch: 0 } }, true);
	            new Notice('Jumped to footnotes section. Use return button to go back.');
	            return;
	        } else {
	            // If still not found, let's search for the "Notes" or "Footnotes" heading
	            for (let i = 0; i < lines.length; i++) {
	                const line = lines[i];
	                if (line.match(/^#{1,6}\s+(Notes?|Footnotes?)\s*$/i)) {
	                    this.debug(`Found Notes/Footnotes heading at line ${i + 1}:`, line);
	                    activeEditor.setCursor({ line: i, ch: 0 });
	                    activeEditor.scrollIntoView({ from: { line: i, ch: 0 }, to: { line: i, ch: 0 } }, true);
	                    new Notice('Jumped to Notes section. Use return button to go back.');
	                    return;
	                }
	            }
            
	            new Notice('No footnote definitions or Notes section found');
	        }
	    } catch (error) {
	        this.debug('Error in jumpToFootnotesSection:', error);
	        new Notice('Error accessing editor: ' + error.message);
	    }
	}
	
	returnToLastEditPosition(editor?: Editor) {
	    this.debug('returnToLastEditPosition called, editor provided:', !!editor);
    
	    // Try to get editor from parameter
	    let activeEditor = editor;
	    let targetFile: TFile | null = null;
    
	    if (!activeEditor) {
	        this.debug('No editor provided, getting file from footnotes view');
        
	        // Get the file that the footnotes panel is currently showing
	        const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
	        if (footnoteLeaves.length > 0) {
	            const footnoteView = footnoteLeaves[0].view as FootnotesView;
	            targetFile = (footnoteView as any).currentFile;
	            this.debug('Got target file from footnotes view:', !!targetFile);
	        }
        
	        // If we have a target file, find its editor
	        if (targetFile) {
	            const leaves = this.app.workspace.getLeavesOfType('markdown');
	            for (const leaf of leaves) {
	                const view = leaf.view as MarkdownView;
	                if (view.file === targetFile) {
	                    activeEditor = view.editor;
	                    this.debug('Found editor for target file');
	                    break;
	                }
	            }
	        }
        
	        // Fallback to previous method if that didn't work
	        if (!activeEditor) {
	            this.debug('Fallback: searching for any active view');
	            let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            
	            if (!activeView) {
	                const leaves = this.app.workspace.getLeavesOfType('markdown');
	                if (leaves.length > 0) {
	                    activeView = leaves[0].view as MarkdownView;
	                }
	            }
            
	            if (!activeView) {
	                new Notice('No markdown editor found. Please click in a markdown document first.');
	                return;
	            }
            
	            activeEditor = activeView.editor;
	        }
	    }

	    // Double-check that we have a valid editor
	    if (!activeEditor || typeof activeEditor.setCursor !== 'function') {
	        this.debug('Editor is invalid or missing setCursor method');
	        new Notice('Unable to access editor');
	        return;
	    }

	    try {
	        if (this.lastEditPosition) {
	            this.debug('Attempting to return to stored position:', this.lastEditPosition);
	            activeEditor.setCursor(this.lastEditPosition);
	            activeEditor.scrollIntoView({ from: this.lastEditPosition, to: this.lastEditPosition }, true);
            
	            // Focus the editor so the cursor is visible
	            activeEditor.focus();
            
	            new Notice('Returned to last edit position');
	            this.debug('Successfully returned to position:', this.lastEditPosition);
	        } else {
	            // ENHANCEMENT: No stored position, find first editable line after frontmatter
	            this.debug('No lastEditPosition stored, finding first editable line');
	            const firstEditableLine = this.findFirstEditableLine(activeEditor);
	            const defaultPosition = { line: firstEditableLine, ch: 0 };
	            
	            activeEditor.setCursor(defaultPosition);
	            activeEditor.scrollIntoView({ from: defaultPosition, to: defaultPosition }, true);
	            activeEditor.focus();
            
	            new Notice('Jumped to start of content');
	            this.debug('Moved to first editable line:', firstEditableLine);
	        }
	    } catch (error) {
	        this.debug('Error in returnToLastEditPosition:', error);
	        new Notice('Error accessing editor: ' + error.message);
	    }
	}
	
	// ENHANCEMENT: Helper method to find first editable line after frontmatter/properties
	private findFirstEditableLine(editor: Editor): number {
		const content = editor.getValue();
		const lines = content.split('\n');
		
		this.debug('Finding first editable line in document with', lines.length, 'lines');
		
		// Check if document starts with frontmatter (YAML properties)
		if (lines[0] && lines[0].trim() === '---') {
			this.debug('Document starts with frontmatter, looking for end');
			
			// Find the closing --- of frontmatter
			for (let i = 1; i < lines.length; i++) {
				if (lines[i].trim() === '---') {
					this.debug('Found end of frontmatter at line', i);
					
					// Skip any empty lines after frontmatter
					for (let j = i + 1; j < lines.length; j++) {
						if (lines[j].trim() !== '') {
							this.debug('First content line after frontmatter:', j);
							return j;
						}
					}
					
					// If no content found after frontmatter, return line after frontmatter
					return i + 1;
				}
			}
			
			// If frontmatter doesn't have closing ---, return after first line
			this.debug('Frontmatter missing closing ---, defaulting to line 1');
			return 1;
		}
		
		// No frontmatter, find first non-empty line
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() !== '') {
				this.debug('First non-empty line found at:', i);
				return i;
			}
		}
		
		// Document is empty or all whitespace, return line 0
		this.debug('Document appears empty, defaulting to line 0');
		return 0;
	}
	
	// ADDED: Helper method to set skip period more robustly
	public setSkipRefreshPeriod(milliseconds: number = 1000) {
		this.skipNextRefresh = true;
		this.skipRefreshUntil = Date.now() + milliseconds;
		this.debug('Set skip refresh period until:', this.skipRefreshUntil);
		
		// Clear the boolean flag after the period ends
		setTimeout(() => {
			this.skipNextRefresh = false;
			this.debug('Cleared skipNextRefresh flag');
		}, milliseconds);
	}
	
	debounceRefresh() {
		this.debug('debounceRefresh called, skipNextRefresh:', this.skipNextRefresh, 'skipRefreshUntil:', this.skipRefreshUntil, 'isNavigating:', this.isNavigating, 'now:', Date.now());
		
		// ENHANCED: Check all skip conditions including global navigation state
		if (this.skipNextRefresh || Date.now() < this.skipRefreshUntil || this.isNavigating) {
			this.debug('Skipping refresh due to skip flags');
			return;
		}
		
		if (this.refreshTimeout) {
			window.clearTimeout(this.refreshTimeout);
		}
		this.refreshTimeout = window.setTimeout(() => {
			// Double-check skip conditions before actually refreshing
			if (this.skipNextRefresh || Date.now() < this.skipRefreshUntil || this.isNavigating) {
				this.debug('Skipping delayed refresh due to skip flags');
				return;
			}
			this.debug('Executing delayed refresh');
			this.refreshFootnotesView();
		}, 500);
	}

	async activateView() {
		const { workspace } = this.app;
		
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0];
			workspace.revealLeaf(leaf);
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: FOOTNOTES_VIEW_TYPE, active: true });
			}
		}

		this.refreshFootnotesView();
	}

	refreshFootnotesView() {
		// ENHANCED: Check all skip conditions including global navigation state
		if (this.skipNextRefresh || Date.now() < this.skipRefreshUntil || this.isNavigating) {
			this.debug('Skipping footnotes view refresh due to skip flags, skipNextRefresh:', this.skipNextRefresh, 'now:', Date.now(), 'skipUntil:', this.skipRefreshUntil, 'isNavigating:', this.isNavigating);
			return;
		}
		
		this.debug('Proceeding with footnotes view refresh');
		const leaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
		leaves.forEach(leaf => {
			if (leaf.view instanceof FootnotesView) {
				// ENHANCED: Pass skip info to the view and set a protection flag
				(leaf.view as any).skipCheckTimestamp = Date.now();
				(leaf.view as any).lastRefreshCheck = Date.now();
				leaf.view.refresh();
			}
		});
	}

	// FIXED: Improved extractFootnotes method to properly exclude definitions from references
	extractFootnotes(content: string): FootnoteData[] {
		const footnoteMap = new Map<string, FootnoteData>();
		
		// Extract footnote definitions first
		const definitionRegex = /^\[\^([\w-]+)\]:\s*(.*)$/gm;
		let match;
		while ((match = definitionRegex.exec(content)) !== null) {
			const number = match[1];
			const contentText = match[2];
			const startPos = match.index;
			const endPos = match.index + match[0].length;
			
			const beforeDefinition = content.substring(0, startPos);
			const line = (beforeDefinition.match(/\n/g) || []).length;
			
			const definition: FootnoteDefinition = {
				number,
				content: contentText,
				line,
				startPos,
				endPos,
				fullMatch: match[0]
			};

			footnoteMap.set(number, {
				number,
				content: contentText,
				definition,
				references: [],
				referenceCount: 0
			});
		}

		// FIXED: Extract footnote references with better exclusion of definitions
		const referenceRegex = /\[\^([\w-]+)\]/g;
		while ((match = referenceRegex.exec(content)) !== null) {
			const number = match[1];
			const startPos = match.index;
			const endPos = match.index + match[0].length;
			
			// FIXED: Better check to exclude definitions
			// Check if this match is actually a definition by looking at the context
			const beforeMatch = content.substring(Math.max(0, startPos - 10), startPos);
			const afterMatch = content.substring(endPos, endPos + 2);
			
			// Skip if this is at the start of a line (possibly with whitespace) and followed by ':'
			// This indicates it's a definition, not a reference
			const lineStart = beforeMatch.lastIndexOf('\n');
			const textBeforeOnLine = lineStart >= 0 ? beforeMatch.substring(lineStart + 1) : beforeMatch;
			
			if (textBeforeOnLine.trim() === '' && afterMatch.startsWith(':')) {
				this.debug('Skipping footnote definition (not a reference):', match[0]);
				continue;
			}
			
			const beforeReference = content.substring(0, startPos);
			const line = (beforeReference.match(/\n/g) || []).length;
			
			const reference: FootnoteReference = {
				number,
				line,
				startPos,
				endPos,
				fullMatch: match[0]
			};

			if (footnoteMap.has(number)) {
				footnoteMap.get(number)!.references.push(reference);
				footnoteMap.get(number)!.referenceCount++;
				this.debug('Added reference for footnote', number, 'at line', line + 1);
			} else {
				this.debug('Found reference for footnote', number, 'but no definition exists');
			}
		}

		const result = Array.from(footnoteMap.values()).filter(f => f.definition);
		this.debug('Final footnote extraction results:', result.map(f => ({
			number: f.number,
			referenceCount: f.referenceCount,
			references: f.references.map(r => `line ${r.line + 1}`)
		})));
		
		return result;
	}

	extractHeaders(content: string): HeaderData[] {
		const lines = content.split('\n');
		const headers: HeaderData[] = [];
		const headerRegex = /^(#{1,6})\s+(.+)$/;
		
		lines.forEach((line: string, lineIndex: number) => {
			const match = headerRegex.exec(line.trim());
			if (match) {
				headers.push({
					text: match[2].trim(),
					level: match[1].length,
					line: lineIndex
				});
			}
		});
		
		return headers;
	}

	groupFootnotesByHeaders(footnotes: FootnoteData[], headers: HeaderData[]): FootnoteGroup[] {
		this.allHeaders = headers;
		
		const groups: FootnoteGroup[] = [];
		const sortedHeaders = [...headers].sort((a, b) => a.line - b.line);
		
		footnotes.forEach(footnote => {
			// Find the header for the first reference of this footnote
			const firstRef = footnote.references[0];
			if (!firstRef) return;
			
			let nearestHeader: HeaderData | null = null;
			
			for (let i = sortedHeaders.length - 1; i >= 0; i--) {
				if (sortedHeaders[i].line < firstRef.line) {
					nearestHeader = sortedHeaders[i];
					break;
				}
			}
			
			let group = groups.find(g => 
				(g.header === null && nearestHeader === null) ||
				(g.header !== null && nearestHeader !== null && g.header.line === nearestHeader.line)
			);
			
			if (!group) {
				group = {
					header: nearestHeader,
					footnotes: []
				};
				groups.push(group);
			}
			
			group.footnotes.push(footnote);
		});
		
		// Sort footnotes within each group by number
		groups.forEach(group => {
			group.footnotes.sort((a, b) => {
				const aNum = parseInt(a.number);
				const bNum = parseInt(b.number);
				if (isNaN(aNum) || isNaN(bNum)) {
					return a.number.localeCompare(b.number);
				}
				return aNum - bNum;
			});
		});
		
		groups.sort((a, b) => {
			if (a.header === null && b.header === null) return 0;
			if (a.header === null) return -1;
			if (b.header === null) return 1;
			return a.header.line - b.header.line;
		});
		
		return this.buildHierarchicalGroups(groups);
	}

	private buildHierarchicalGroups(flatGroups: FootnoteGroup[]): FootnoteGroup[] {
		const footnoteGroupsByHeaderLine = new Map<number, FootnoteGroup>();
		let noHeaderGroup: FootnoteGroup | null = null;
		
		flatGroups.forEach((group: FootnoteGroup) => {
			if (group.header) {
				footnoteGroupsByHeaderLine.set(group.header.line, group);
			} else {
				noHeaderGroup = group;
			}
		});
		
		const allGroups: FootnoteGroup[] = [];
		
		if (noHeaderGroup) {
			allGroups.push(noHeaderGroup);
		}
		
		const sortedHeaders = this.allHeaders.sort((a: HeaderData, b: HeaderData) => a.line - b.line);
		
		sortedHeaders.forEach((header: HeaderData) => {
			const existingGroup = footnoteGroupsByHeaderLine.get(header.line);
			if (existingGroup) {
				allGroups.push(existingGroup);
			} else {
				allGroups.push({
					header: header,
					footnotes: []
				});
			}
		});
		
		const result: FootnoteGroup[] = [];
		const stack: FootnoteGroup[] = [];
		
		for (const group of allGroups) {
			if (!group.header) {
				result.push(group);
				continue;
			}
			
			while (stack.length > 0 && stack[stack.length - 1].header!.level >= group.header.level) {
				stack.pop();
			}
			
			if (stack.length > 0) {
				const parent = stack[stack.length - 1];
				if (!parent.children) {
					parent.children = [];
				}
				parent.children.push(group);
				group.parent = parent;
			} else {
				result.push(group);
			}
			
			stack.push(group);
		}
		
		return result;
	}

	highlightFootnoteInEditor(footnote: FootnoteData, referenceIndex: number = 0) {
		this.debug('highlightFootnoteInEditor called', footnote, referenceIndex);

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No active markdown file');
			return;
		}

		// FIXED: Don't use skipNextRefresh here, since it's already set by caller
		this.app.workspace.getLeaf().openFile(file).then(() => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return;

			const editor = activeView.editor;
			const content = editor.getValue();
			const footnotes = this.extractFootnotes(content);
			
			const match = footnotes.find(f => f.number === footnote.number);
			if (!match || !match.references[referenceIndex]) {
				new Notice('Footnote reference not found');
				return;
			}
			
			const reference = match.references[referenceIndex];
			const beforeReference = content.substring(0, reference.startPos);
			const startLine = (beforeReference.match(/\n/g) || []).length;
			const startLineContent = content.split('\n')[startLine];
			const referenceStartInLine = beforeReference.length - beforeReference.lastIndexOf('\n') - 1;
			
			const cursorPos = { 
				line: startLine, 
				ch: referenceStartInLine
			};
			
			editor.setCursor(cursorPos);
			editor.scrollIntoView(
				{ from: cursorPos, to: cursorPos },
				true
			);
			editor.focus();
		});
	}

	highlightHeaderInEditor(header: HeaderData) {
		this.debug('highlightHeaderInEditor called', header);
	
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No active markdown file');
			return;
		}

		this.app.workspace.getLeaf().openFile(file).then(() => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return;

			const editor = activeView.editor;
			const headers = this.extractHeaders(editor.getValue());
			const match = headers.find(h => h.text === header.text && h.level === header.level);

			if (!match) return;

			editor.setCursor({ line: match.line, ch: 0 });
			editor.scrollIntoView({ from: { line: match.line, ch: 0 }, to: { line: match.line, ch: 0 } }, true);
		});
	}

	renumberFootnotes() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('No active markdown file');
			return;
		}

		const editor = activeView.editor;
		const content = editor.getValue();
		const footnotes = this.extractFootnotes(content);
		
		if (footnotes.length === 0) {
			new Notice('No footnotes found to renumber');
			return;
		}

		// Sort footnotes by number to identify gaps
		const sortedNumbers = footnotes.map(f => parseInt(f.number)).filter(n => !isNaN(n)).sort((a, b) => a - b);
		const gaps: string[] = [];
		
		for (let i = 1; i < sortedNumbers[sortedNumbers.length - 1]; i++) {
			if (!sortedNumbers.includes(i)) {
				gaps.push(i.toString());
			}
		}

		if (gaps.length === 0) {
			new Notice('No gaps found in footnote numbering');
			return;
		}

		// Show confirmation modal
		new RenumberConfirmationModal(this.app, this, gaps, () => {
			this.performRenumbering(editor, footnotes);
		}).open();
	}

	private performRenumbering(editor: Editor, footnotes: FootnoteData[]) {
		let content = editor.getValue();
		
		// Sort footnotes by their first reference position to maintain order
		const sortedFootnotes = [...footnotes].sort((a, b) => {
			const aFirstRef = a.references[0];
			const bFirstRef = b.references[0];
			if (!aFirstRef || !bFirstRef) return 0;
			return aFirstRef.startPos - bFirstRef.startPos;
		});

		// Create mapping from old numbers to new numbers
		const numberMapping = new Map<string, string>();
		sortedFootnotes.forEach((footnote, index) => {
			numberMapping.set(footnote.number, (index + 1).toString());
		});

		// Replace all references and definitions (work backwards to maintain positions)
		const allReplacements: Array<{startPos: number, endPos: number, newText: string}> = [];

		// Collect all replacements
		footnotes.forEach(footnote => {
			const newNumber = numberMapping.get(footnote.number);
			if (!newNumber) return;

			// Add definition replacement
			allReplacements.push({
				startPos: footnote.definition.startPos,
				endPos: footnote.definition.endPos,
				newText: `[^${newNumber}]: ${footnote.definition.content}`
			});

			// Add reference replacements
			footnote.references.forEach(ref => {
				allReplacements.push({
					startPos: ref.startPos,
					endPos: ref.endPos,
					newText: `[^${newNumber}]`
				});
			});
		});

		// Sort replacements by position (descending) to maintain positions
		allReplacements.sort((a, b) => b.startPos - a.startPos);

		// Apply replacements
		allReplacements.forEach(replacement => {
			const before = content.substring(0, replacement.startPos);
			const after = content.substring(replacement.endPos);
			content = before + replacement.newText + after;
		});

		editor.setValue(content);
		new Notice(`Footnotes renumbered successfully`);
		this.refreshFootnotesView();
	}

	onunload() {
		// Cleanup code goes here
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// Settings tab class
class FootnotesManagerSettingTab extends PluginSettingTab {
	plugin: FootnotesManagerPlugin;

	constructor(app: App, plugin: FootnotesManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Footnotes Manager Settings' });

		new Setting(containerEl)
			.setName('Open panel on startup')
			.setDesc('Automatically open the footnotes panel when Obsidian starts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.openOnStart)
				.onChange(async (value) => {
					this.plugin.settings.openOnStart = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default collapsed view')
			.setDesc('Start with footnotes panel in collapsed state (showing only headers)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.defaultCollapsed)
				.onChange(async (value) => {
					this.plugin.settings.defaultCollapsed = value;
					await this.plugin.saveSettings();
					this.plugin.refreshFootnotesView();
				}));

		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('Enable debug logging in the developer console (for troubleshooting)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));

		// Usage Instructions
		const instructionsEl = containerEl.createEl('div', { cls: 'footnotes-instructions' });
		instructionsEl.createEl('h3', { text: 'How to use Footnotes Manager:' });
		const instructionsList = instructionsEl.createEl('ol');
		instructionsList.createEl('li', { text: 'Click the hash (⌗) icon in the ribbon or use the command palette to toggle the footnotes panel' });
		instructionsList.createEl('li', { text: 'View footnotes organized by document sections (headers)' });
		instructionsList.createEl('li', { text: 'Click on footnote content to edit it inline' });
		instructionsList.createEl('li', { text: 'Use the reference buttons to jump to specific footnote references in the text' });
		instructionsList.createEl('li', { text: 'Delete footnotes safely - single references delete completely, multiple references delete one at a time' });
		instructionsList.createEl('li', { text: 'Use the renumber button to clean up gaps in footnote numbering' });
		instructionsList.createEl('li', { text: 'Use navigation buttons to jump to footnotes section and return to your editing position' });
	}
}

// FootnotesView Class
class FootnotesView extends ItemView {
	plugin: FootnotesManagerPlugin;
	private currentFile: TFile | null = null;
	private renderedGroups: RenderedGroup[] = [];
	private isCollapsed: boolean = false;
	private hasManualExpansions: boolean = false;
	private isNavigating: boolean = false; // ADDED: Track navigation state
	private pendingNavigation: string | null = null; // ADDED: Track pending navigation

	constructor(leaf: WorkspaceLeaf, plugin: FootnotesManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.isCollapsed = plugin.settings.defaultCollapsed;
	}

	private debug(message: string, ...args: any[]) {
		if (this.plugin.settings.debugMode) {
			console.log(`[Footnotes View] ${message}`, ...args);
		}
	}

	getViewType() {
		return FOOTNOTES_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Footnotes';
	}

	getIcon() {
		return 'hash';
	}

	async onOpen() {
		this.refresh();
	}

	async onClose() {
		// Nothing to clean up
	}

	refresh() {
		this.debug('FootnotesView.refresh called');
		
		// ENHANCED: Multiple levels of skip checking
		const now = Date.now();
		const skipCheckTimestamp = (this as any).skipCheckTimestamp || 0;
		const lastRefreshCheck = (this as any).lastRefreshCheck || 0;
		const timeSinceSkipCheck = now - skipCheckTimestamp;
		const timeSinceLastRefresh = now - lastRefreshCheck;
		
		// Check plugin skip conditions
		if (this.plugin.skipNextRefresh || now < this.plugin.skipRefreshUntil) {
			this.debug('Skipping FootnotesView refresh due to plugin skip flags, skipNextRefresh:', this.plugin.skipNextRefresh, 'now:', now, 'skipUntil:', this.plugin.skipRefreshUntil);
			return;
		}
		
		// ENHANCED: Additional protection - if this refresh was called very recently after a skip check, 
		// it might be from a different event source during the skip period
		if (timeSinceSkipCheck < 100 && this.plugin.skipRefreshUntil > now - 2000) {
			this.debug('Skipping FootnotesView refresh - too soon after skip check, likely from different event source');
			return;
		}
		
		// ENHANCED: Don't refresh if we're in the middle of navigation (check both local and global state)
		if (this.isNavigating || this.plugin.isNavigating) {
			this.debug('Skipping FootnotesView refresh - currently navigating (local:', this.isNavigating, 'global:', this.plugin.isNavigating, ')');
			return;
		}
		
		// ENHANCED: Prevent rapid-fire refreshes (minimum 100ms between refreshes during potential navigation periods)
		if (timeSinceLastRefresh < 100 && this.plugin.skipRefreshUntil > now - 3000) {
			this.debug('Skipping FootnotesView refresh - too frequent, timeSinceLastRefresh:', timeSinceLastRefresh);
			return;
		}
		
		// Set the last refresh timestamp
		(this as any).lastRefreshCheck = now;
		
		this.debug('Proceeding with FootnotesView refresh');
		const container = this.containerEl.children[1];
		container.empty();

		// Add header with controls
		const header = container.createEl('div', { cls: 'footnotes-header' });
		
		// Title and controls container
		const titleRow = header.createEl('div', { cls: 'footnotes-title-row' });
		titleRow.createEl('h4', { text: 'Footnotes', cls: 'footnotes-title' });
		
		// Controls container
		const controlsContainer = titleRow.createEl('div', { cls: 'footnotes-controls' });
		
		// Navigate to footnotes button
		const navBtn = controlsContainer.createEl('button', { 
			cls: 'footnotes-control-btn nav-btn',
			attr: { title: 'Jump to footnotes section' }
		});
		navBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
		
		// Return to edit position button
		const returnBtn = controlsContainer.createEl('button', { 
			cls: 'footnotes-control-btn return-btn',
			attr: { title: 'Return to last edit position' }
		});
		returnBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;
		
		// Renumber footnotes button
		const renumberBtn = controlsContainer.createEl('button', { 
			cls: 'footnotes-control-btn renumber-btn',
			attr: { title: 'Renumber footnotes (remove gaps)' }
		});
		renumberBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M7 12h10m-7 6h4"/></svg>`;
		
		// Toggle button for collapse/expand all
		const toggleAllBtn = controlsContainer.createEl('button', { 
			cls: 'footnotes-toggle-btn',
			attr: { title: 'Toggle collapse/expand all sections' }
		});
		
		const toggleIcon = toggleAllBtn.createEl('span', { cls: 'footnotes-toggle-icon' });
		toggleIcon.innerHTML = this.isCollapsed ? '+' : '-';
		
		// Add search container below the title row
		const searchContainer = header.createEl('div', { cls: 'footnotes-search-container' });
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			cls: 'footnotes-search-input',
			attr: { 
				placeholder: 'Search footnotes...',
				spellcheck: 'false'
			}
		});
		
		const clearSearchBtn = searchContainer.createEl('button', {
			cls: 'footnotes-clear-search',
			attr: { title: 'Clear search' }
		});
		clearSearchBtn.innerHTML = '×';

		// FIXED: Get active file and set up navigation immediately
		let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		let currentFile = this.app.workspace.getActiveFile();
		
		this.debug('Active view:', !!activeView, 'Current file:', !!currentFile);
		
		// Try to find the correct editor for the current file
		if (!activeView && currentFile) {
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of leaves) {
				const view = leaf.view as MarkdownView;
				if (view.file === currentFile) {
					activeView = view;
					this.debug('Found view for current file');
					break;
				}
			}
		}
		
		// Use stored current file if available
		if (!activeView && this.currentFile) {
			this.debug('Using stored current file');
			currentFile = this.currentFile;
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			for (const leaf of leaves) {
				const view = leaf.view as MarkdownView;
				if (view.file === currentFile) {
					activeView = view;
					break;
				}
			}
		}
		
		if (currentFile) {
			this.currentFile = currentFile;
		}

		// FIXED: Set up navigation button handlers immediately with proper context
		this.setupNavigationButtons(navBtn, returnBtn, renumberBtn, activeView, currentFile);

		// Get content and process footnotes
		if (!activeView && !currentFile) {
			this.debug('No active markdown view or file found');
			container.createEl('div', { 
				text: 'No active markdown file', 
				cls: 'footnotes-empty' 
			});
			
			this.disableControls(toggleAllBtn, navBtn, returnBtn, renumberBtn, searchInput);
			return;
		}

		this.debug('Getting file content');
		let content = '';
		
		if (activeView) {
			content = activeView.editor.getValue();
			this.debug('Got content from active view');
			this.processFootnotes(content, container, toggleAllBtn, toggleIcon, searchInput, clearSearchBtn, navBtn, returnBtn, renumberBtn);
		} else if (currentFile) {
			this.app.vault.read(currentFile).then(fileContent => {
				this.debug('Got content from file read');
				this.processFootnotes(fileContent, container, toggleAllBtn, toggleIcon, searchInput, clearSearchBtn, navBtn, returnBtn, renumberBtn);
			});
		}
	}

	// FIXED: New method to set up navigation buttons with proper context
	private setupNavigationButtons(
		navBtn: HTMLButtonElement, 
		returnBtn: HTMLButtonElement, 
		renumberBtn: HTMLButtonElement,
		activeView: MarkdownView | null,
		currentFile: TFile | null
	) {
		navBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.debug('Nav button clicked with activeView:', !!activeView, 'currentFile:', !!currentFile);
			
			// ENHANCED: Use robust skip period
			this.plugin.setSkipRefreshPeriod(1000);
			
			setTimeout(() => {
				this.plugin.jumpToFootnotesSection();
			}, 10);
		};

		returnBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.debug('Return button clicked with activeView:', !!activeView, 'currentFile:', !!currentFile);
			
			// ENHANCED: Use robust skip period
			this.plugin.setSkipRefreshPeriod(1000);
			
			setTimeout(() => {
				this.plugin.returnToLastEditPosition();
			}, 10);
		};

		renumberBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.debug('Renumber button clicked with activeView:', !!activeView, 'currentFile:', !!currentFile);
			
			// ENHANCED: Use robust skip period
			this.plugin.setSkipRefreshPeriod(1000);
			
			setTimeout(() => {
				this.plugin.renumberFootnotes();
			}, 10);
		};
	}

	private disableControls(
		toggleBtn?: HTMLButtonElement, 
		navBtn?: HTMLButtonElement, 
		returnBtn?: HTMLButtonElement, 
		renumberBtn?: HTMLButtonElement,
		searchInput?: HTMLInputElement
	) {
		if (toggleBtn) toggleBtn.disabled = true;
		if (navBtn) navBtn.disabled = true;
		if (returnBtn) returnBtn.disabled = true;
		if (renumberBtn) renumberBtn.disabled = true;
		if (searchInput) searchInput.disabled = true;
	}

	private processFootnotes(
		content: string, 
		container: Element, 
		toggleBtn?: HTMLButtonElement, 
		toggleIcon?: HTMLElement, 
		searchInput?: HTMLInputElement, 
		clearSearchBtn?: HTMLButtonElement,
		navBtn?: HTMLButtonElement,
		returnBtn?: HTMLButtonElement,
		renumberBtn?: HTMLButtonElement
	) {
		this.debug('Processing footnotes for content of length:', content.length);
		
		const currentStates = new Map<string, boolean>();
		this.renderedGroups.forEach(rendered => {
			if (rendered.group.header) {
				const key = `${rendered.group.header.level}-${rendered.group.header.text}`;
				currentStates.set(key, !rendered.group.isCollapsed);
			}
		});
		
		this.renderedGroups = [];
		
		const footnotes = this.plugin.extractFootnotes(content);
		const headers = this.plugin.extractHeaders(content);
		const footnoteGroups = this.plugin.groupFootnotesByHeaders(footnotes, headers);
		
		this.debug('Found', footnotes.length, 'footnotes in', footnoteGroups.length, 'groups');

		if (footnotes.length === 0) {
			container.createEl('div', { 
				text: 'No footnotes found', 
				cls: 'footnotes-empty' 
			});
			
			this.disableControls(toggleBtn, navBtn, returnBtn, renumberBtn, searchInput);
			return;
		}

		// Enable controls when we have footnotes
		if (toggleBtn) toggleBtn.disabled = false;
		if (searchInput) searchInput.disabled = false;
		if (navBtn) navBtn.disabled = false;
		if (returnBtn) returnBtn.disabled = false;
		if (renumberBtn) renumberBtn.disabled = false;

		const footnotesList = container.createEl('div', { cls: 'footnotes-list' });

		const allGroups: FootnoteGroup[] = [];
		const collectAllGroups = (groups: FootnoteGroup[]) => {
			groups.forEach(group => {
				allGroups.push(group);
				if (group.children) {
					collectAllGroups(group.children);
				}
			});
		};
		collectAllGroups(footnoteGroups);

		if (toggleBtn && toggleIcon) {
			toggleBtn.onclick = (e) => {
				this.debug('Toggle button clicked, current state:', this.isCollapsed);
				e.preventDefault();
				e.stopPropagation();
				this.toggleAllGroups(toggleIcon);
			};
			
			this.updateToggleButton(toggleIcon);
		}

		if (searchInput && clearSearchBtn) {
			let searchTimeout: number | null = null;
			let currentSearchTerm = '';
			
			const performSearch = () => {
				const searchTerm = searchInput.value.toLowerCase().trim();
				currentSearchTerm = searchTerm;
				this.filterFootnotes(footnotesList, footnoteGroups, searchTerm);
				
				if (searchTerm) {
					clearSearchBtn.style.display = 'block';
				} else {
					clearSearchBtn.style.display = 'none';
				}
			};
			
			(this as any).currentSearchTerm = '';
			
			searchInput.addEventListener('input', () => {
				if (searchTimeout) {
					window.clearTimeout(searchTimeout);
				}
				searchTimeout = window.setTimeout(() => {
					(this as any).currentSearchTerm = searchInput.value.toLowerCase().trim();
					performSearch();
				}, 300);
			});
			
			clearSearchBtn.addEventListener('click', () => {
				searchInput.value = '';
				(this as any).currentSearchTerm = '';
				performSearch();
				searchInput.focus();
			});
			
			clearSearchBtn.style.display = 'none';
		}

		footnoteGroups.forEach(group => {
			if (this.isCollapsed && !this.hasManualExpansions) {
				this.setGroupCollapsedRecursively(group, true);
			}
			this.renderFootnoteGroup(group, footnotesList, 0);
		});
		
		if (this.hasManualExpansions && currentStates.size > 0) {
			this.restoreExpansionStates(footnoteGroups, currentStates);
		}
		
		this.debug('Rendered groups count:', this.renderedGroups.length);
		this.debug('Initial collapsed state:', this.isCollapsed, 'hasManualExpansions:', this.hasManualExpansions);
	}

	private restoreExpansionStates(groups: FootnoteGroup[], states: Map<string, boolean>) {
		const restoreGroup = (group: FootnoteGroup) => {
			if (group.header) {
				const key = `${group.header.level}-${group.header.text}`;
				const wasExpanded = states.get(key);
				if (wasExpanded !== undefined) {
					group.isCollapsed = !wasExpanded;
					
					const rendered = this.renderedGroups.find(r => 
						r.group.header && 
						r.group.header.level === group.header!.level && 
						r.group.header.text === group.header!.text
					);
					if (rendered) {
						rendered.collapseIcon.textContent = group.isCollapsed ? '▶' : '▼';
						rendered.contentElement.style.display = group.isCollapsed ? 'none' : 'block';
					}
				}
			}
			
			if (group.children) {
				group.children.forEach(restoreGroup);
			}
		};
		
		groups.forEach(restoreGroup);
	}

	private setGroupCollapsedRecursively(group: FootnoteGroup, collapsed: boolean) {
		group.isCollapsed = collapsed;
		if (group.children) {
			group.children.forEach(child => {
				this.setGroupCollapsedRecursively(child, collapsed);
			});
		}
	}

	private highlightSearchText(text: string, searchTerm: string): string {
		if (!searchTerm) return text;
	
		const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
		return text.replace(regex, '<mark class="search-highlight">$1</mark>');
	}

	private filterFootnotes(footnotesList: Element, footnoteGroups: FootnoteGroup[], searchTerm: string) {
		footnotesList.empty();
		
		if (!searchTerm) {
			footnoteGroups.forEach(group => {
				this.renderFootnoteGroup(group, footnotesList, 0);
			});
			return;
		}
		
		const filteredGroups = this.filterGroupsRecursively(footnoteGroups, searchTerm);
		
		if (filteredGroups.length === 0) {
			footnotesList.createEl('div', {
				text: 'No matching footnotes found',
				cls: 'footnotes-empty'
			});
			return;
		}
		
		filteredGroups.forEach(group => {
			this.renderFootnoteGroup(group, footnotesList, 0);
		});
	}
	
	private filterGroupsRecursively(groups: FootnoteGroup[], searchTerm: string): FootnoteGroup[] {
		const filtered: FootnoteGroup[] = [];
		
		groups.forEach(group => {
			const headerMatches = group.header?.text.toLowerCase().includes(searchTerm) || false;
			
			const matchingFootnotes = group.footnotes.filter(footnote => 
				footnote.content.toLowerCase().includes(searchTerm) ||
				footnote.number.toLowerCase().includes(searchTerm)
			);
			
			const filteredChildren = group.children ? 
				this.filterGroupsRecursively(group.children, searchTerm) : [];
			
			if (headerMatches || matchingFootnotes.length > 0 || filteredChildren.length > 0) {
				const filteredGroup: FootnoteGroup = {
					header: group.header,
					footnotes: headerMatches ? group.footnotes : matchingFootnotes,
					children: filteredChildren.length > 0 ? filteredChildren : undefined,
					parent: group.parent,
					isCollapsed: false
				};
				
				filtered.push(filteredGroup);
			}
		});
		
		return filtered;
	}

	private renderFootnoteGroup(group: FootnoteGroup, container: Element, depth: number) {
		const headerSection = container.createEl('div', { cls: 'footnote-header-section' });
		headerSection.style.marginLeft = `${depth * 12}px`;
		
		const headerEl = headerSection.createEl('div', { cls: 'footnote-header' });
		
		const collapseIcon = headerEl.createEl('span', { cls: 'footnote-collapse-icon' });
		const hasChildren = (group.children && group.children.length > 0) || group.footnotes.length > 0;
		
		if (hasChildren) {
			collapseIcon.textContent = group.isCollapsed ? '▶' : '▼';
			collapseIcon.style.visibility = 'visible';
		} else {
			collapseIcon.style.visibility = 'hidden';
		}
		
		const headerText = headerEl.createEl('span', { cls: 'footnote-header-text' });
		if (group.header) {
			const totalFootnotes = this.countTotalFootnotes(group);
			if (totalFootnotes > 0) {
				headerText.textContent = `${group.header.text} (${totalFootnotes})`;
			} else {
				headerText.textContent = group.header.text;
			}
		} else {
			headerText.textContent = `No Header (${group.footnotes.length})`;
		}
		
		const groupContent = headerSection.createEl('div', { cls: 'footnote-group-content' });
		if (group.isCollapsed) {
			groupContent.style.display = 'none';
		}
		
		if (hasChildren) {
			this.renderedGroups.push({
				group: group,
				collapseIcon: collapseIcon,
				contentElement: groupContent
			});
		}
		
		if (hasChildren) {
			collapseIcon.addEventListener('click', (e) => {
				this.debug('Collapse icon clicked for group:', group.header?.text || 'No Header');
				e.preventDefault();
				e.stopPropagation();
				this.toggleGroupCollapse(group, collapseIcon, groupContent);
			});
		}
		
		if (group.header) {
			headerText.addEventListener('click', (e) => {
				this.debug('Header text clicked, navigating to:', group.header!.text);
				e.preventDefault();
				e.stopPropagation();
				
				this.plugin.skipNextRefresh = true;
				this.plugin.highlightHeaderInEditor(group.header!);
				
				setTimeout(() => {
					this.plugin.skipNextRefresh = false;
				}, 100);
				
				return false;
			});
			
			headerEl.addEventListener('click', (e) => {
				if (e.target === collapseIcon || e.target === headerText) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				return false;
			});
		}

		if (group.footnotes.length > 0) {
			const groupFootnotes = groupContent.createEl('div', { cls: 'footnote-group-footnotes' });
			group.footnotes.forEach(footnote => {
				this.createFootnoteElement(footnote, groupFootnotes);
			});
		}

		if (group.children) {
			group.children.forEach(childGroup => {
				this.renderFootnoteGroup(childGroup, groupContent, depth + 1);
			});
		}
	}

	private countTotalFootnotes(group: FootnoteGroup): number {
		let total = group.footnotes.length;
		if (group.children) {
			group.children.forEach((child: FootnoteGroup) => {
				total += this.countTotalFootnotes(child);
			});
		}
		return total;
	}

	private toggleGroupCollapse(group: FootnoteGroup, icon: Element, content: HTMLElement) {
		group.isCollapsed = !group.isCollapsed;
		
		if (group.isCollapsed) {
			icon.textContent = '▶';
			content.style.display = 'none';
		} else {
			icon.textContent = '▼';
			content.style.display = 'block';
			this.hasManualExpansions = true;
		}

		if (group.isCollapsed && group.children) {
			this.collapseAllChildren(group);
		}
		
		this.debug('Group toggled, hasManualExpansions:', this.hasManualExpansions);
	}

	private toggleAllGroups(toggleIcon: HTMLElement) {
		this.debug('toggleAllGroups called, current state:', this.isCollapsed);
		
		if (this.isCollapsed) {
			this.debug('Expanding all groups');
			this.expandAllGroups([]);
			this.hasManualExpansions = false;
		} else {
			this.debug('Collapsing all groups to top level overview');
			this.collapseAllGroups([]);
			this.hasManualExpansions = false;
		}
		
		this.isCollapsed = !this.isCollapsed;
		this.updateToggleButton(toggleIcon);
		
		this.debug('toggleAllGroups completed, new state:', this.isCollapsed);
	}
	
	private updateToggleButton(toggleIcon: HTMLElement) {
		if (this.isCollapsed) {
			toggleIcon.innerHTML = '+';
			toggleIcon.parentElement!.setAttribute('title', 'Expand all sections');
		} else {
			toggleIcon.innerHTML = '-';
			toggleIcon.parentElement!.setAttribute('title', 'Collapse all sections');
		}
	}

	private collapseAllGroups(allGroups: FootnoteGroup[]) {
		this.debug('Collapsing all groups to top level overview');
		
		this.renderedGroups.forEach(rendered => {
			const hasContent = (rendered.group.children && rendered.group.children.length > 0) || rendered.group.footnotes.length > 0;
			
			if (hasContent) {
				rendered.group.isCollapsed = true;
				rendered.collapseIcon.textContent = '▶';
				rendered.contentElement.style.display = 'none';
			}
		});
	}

	private expandAllGroups(allGroups: FootnoteGroup[]) {
		this.debug('Expanding all groups');
		this.renderedGroups.forEach(rendered => {
			rendered.group.isCollapsed = false;
			rendered.collapseIcon.textContent = '▼';
			rendered.contentElement.style.display = 'block';
		});
	}

	private collapseAllChildren(group: FootnoteGroup) {
		if (group.children) {
			group.children.forEach((child: FootnoteGroup) => {
				child.isCollapsed = true;
				this.collapseAllChildren(child);
			});
		}
	}

	private createFootnoteElement(footnote: FootnoteData, container: Element) {
		const footnoteEl = container.createEl('div', { cls: 'footnote-item' });
		
		// Footnote number and reference count
		const headerEl = footnoteEl.createEl('div', { cls: 'footnote-header-info' });
		const numberEl = headerEl.createEl('span', { 
			cls: 'footnote-number',
			text: `[${footnote.number}]`
		});
		
		const countEl = headerEl.createEl('span', { 
			cls: 'footnote-ref-count',
			text: `${footnote.referenceCount} ref${footnote.referenceCount !== 1 ? 's' : ''}`
		});

		const contentEl = footnoteEl.createEl('div', { cls: 'footnote-content' });
		
		const isMultiLine = footnote.content.includes('\n');
		
		let textEl: HTMLElement;
		if (isMultiLine) {
			textEl = contentEl.createEl('textarea', { 
				cls: 'footnote-text footnote-textarea',
				attr: { 
					spellcheck: 'false',
					rows: (footnote.content.split('\n').length + 1).toString()
				}
			}) as HTMLTextAreaElement;
			(textEl as HTMLTextAreaElement).value = footnote.content || '';
		} else {
			textEl = contentEl.createEl('div', { 
				cls: 'footnote-text',
				attr: { contenteditable: 'true', spellcheck: 'false' }
			});
			textEl.textContent = footnote.content || '(empty footnote)';
		}
		
		const currentSearchTerm = (this as any).currentSearchTerm || '';
		if (currentSearchTerm && footnote.content.toLowerCase().includes(currentSearchTerm) && !isMultiLine) {
			if (textEl.tagName === 'DIV') {
				textEl.innerHTML = this.highlightSearchText(footnote.content || '(empty footnote)', currentSearchTerm);
			}
		}

		// References section
		if (footnote.references.length > 0) {
			const referencesEl = contentEl.createEl('div', { cls: 'footnote-references' });
			referencesEl.createEl('span', { 
				cls: 'footnote-references-label',
				text: 'References:'
			});

			footnote.references.forEach((ref, index) => {
				const refEl = referencesEl.createEl('button', { 
					cls: 'footnote-reference-btn',
					text: `Line ${ref.line + 1}`,
					attr: { title: `Go to reference ${index + 1} on line ${ref.line + 1}` }
				});
				
				refEl.addEventListener('click', (e) => {
					e.stopPropagation();
					
					// ENHANCED: Set pending navigation and execute immediately + delayed
					const navId = `reference-${footnote.number}-${index}`;
					this.pendingNavigation = navId;
					this.plugin.setSkipRefreshPeriod(2000);
					
					// Execute navigation immediately
					this.plugin.highlightFootnoteInEditor(footnote, index);
					
					// ENHANCED: Also set up delayed execution in case the immediate one gets interrupted
					setTimeout(() => {
						if (this.pendingNavigation === navId) {
							this.debug('Executing delayed navigation for reference:', footnote.number, index);
							this.plugin.highlightFootnoteInEditor(footnote, index);
							this.pendingNavigation = null;
						}
					}, 50);
					
					// Clear pending navigation after delay
					setTimeout(() => {
						if (this.pendingNavigation === navId) {
							this.pendingNavigation = null;
						}
					}, 1000);
				});
			});
		}

		// Action buttons container
		const actionsEl = footnoteEl.createEl('div', { cls: 'footnote-actions' });
		
		// Save button (initially hidden)
		const saveBtn = actionsEl.createEl('button', { 
			text: 'Save', 
			cls: 'footnote-btn footnote-save-btn' 
		});
		saveBtn.style.display = 'none';
		
		// Cancel button (initially hidden)
		const cancelBtn = actionsEl.createEl('button', { 
			text: 'Cancel', 
			cls: 'footnote-btn footnote-cancel-btn' 
		});
		cancelBtn.style.display = 'none';

		// Delete button
		const deleteBtn = actionsEl.createEl('button', { 
			cls: 'footnote-btn footnote-delete-btn',
			attr: { title: 'Delete footnote' }
		});
		deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"/></svg>`;

		let originalText = footnote.content;
		let isEditing = false;

		const handleInput = () => {
			if (!isEditing) {
				isEditing = true;
				saveBtn.style.display = 'inline-block';
				cancelBtn.style.display = 'inline-block';
				deleteBtn.style.display = 'none';
				footnoteEl.addClass('footnote-editing');
			}
		};

		if (textEl.tagName === 'TEXTAREA') {
			(textEl as HTMLTextAreaElement).addEventListener('input', handleInput);
			
			const autoResize = () => {
				const textarea = textEl as HTMLTextAreaElement;
				textarea.style.height = 'auto';
				textarea.style.height = textarea.scrollHeight + 'px';
			};
			
			(textEl as HTMLTextAreaElement).addEventListener('input', autoResize);
			setTimeout(autoResize, 0);
		} else {
			textEl.addEventListener('input', handleInput);
		}

		const handleKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey && textEl.tagName !== 'TEXTAREA') {
				e.preventDefault();
				saveFootnote();
			} else if (e.key === 'Enter' && e.ctrlKey && textEl.tagName === 'TEXTAREA') {
				e.preventDefault();
				saveFootnote();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				cancelEdit();
			}
		};

		textEl.addEventListener('keydown', handleKeydown);

		const saveFootnote = () => {
			let newText: string;
			if (textEl.tagName === 'TEXTAREA') {
				newText = (textEl as HTMLTextAreaElement).value.trim();
			} else {
				newText = textEl.textContent?.trim() || '';
			}
			
			if (newText !== originalText) {
				this.updateFootnoteInEditor(footnote, newText);
				originalText = newText;
			}
			exitEditMode();
		};

		const cancelEdit = () => {
			if (textEl.tagName === 'TEXTAREA') {
				(textEl as HTMLTextAreaElement).value = originalText;
			} else {
				if (currentSearchTerm && originalText.toLowerCase().includes(currentSearchTerm)) {
					textEl.innerHTML = this.highlightSearchText(originalText, currentSearchTerm);
				} else {
					textEl.textContent = originalText;
				}
			}
			exitEditMode();
		};

		const exitEditMode = () => {
			isEditing = false;
			saveBtn.style.display = 'none';
			cancelBtn.style.display = 'none';
			deleteBtn.style.display = 'inline-block';
			footnoteEl.removeClass('footnote-editing');
			textEl.blur();
		};

		saveBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			saveFootnote();
		});

		cancelBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			cancelEdit();
		});

		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			
			let confirmMessage = `Are you sure you want to delete footnote [${footnote.number}]?`;
			if (footnote.referenceCount === 1) {
				confirmMessage += '\n\nThis will delete both the reference and the footnote definition.';
			} else {
				confirmMessage += `\n\nThis footnote has ${footnote.referenceCount} references. Only the first reference will be deleted. The footnote definition will be preserved.`;
			}
			
			const confirmDelete = confirm(confirmMessage);
			if (confirmDelete) {
				this.deleteFootnoteFromEditor(footnote);
			}
		});

		// Click to edit functionality
		footnoteEl.addEventListener('click', (e) => {
			this.debug('Footnote clicked, isEditing:', isEditing, 'target:', e.target);
			
			if (isEditing) return;
			
			const target = e.target as HTMLElement;
			if (target.tagName === 'BUTTON' || target.closest('button')) {
				this.debug('Click was on button, ignoring');
				return;
			}
			
			if (target === textEl) {
				this.debug('Clicked on text element, entering edit mode');
				e.preventDefault();
				e.stopPropagation();
				
				isEditing = true;
				saveBtn.style.display = 'inline-block';
				cancelBtn.style.display = 'inline-block';
				deleteBtn.style.display = 'none';
				footnoteEl.addClass('footnote-editing');
				
				textEl.focus();
				
				if (textEl.tagName === 'TEXTAREA') {
					(textEl as HTMLTextAreaElement).select();
				} else {
					const range = document.createRange();
					range.selectNodeContents(textEl);
					const selection = window.getSelection();
					if (selection) {
						selection.removeAllRanges();
						selection.addRange(range);
					}
				}
				
				return;
			}
			
			// Default click behavior - jump to footnote definition
			this.debug('Calling jumpToFootnoteDefinition');
			e.preventDefault();
			e.stopPropagation();

			// ENHANCED: Set pending navigation to ensure it happens even if refresh occurs
			this.pendingNavigation = `footnote-${footnote.number}`;
			this.plugin.setSkipRefreshPeriod(2000);
			
			// Execute navigation immediately and also set up delayed execution
			this.jumpToFootnoteDefinition(footnote);
			
			// ENHANCED: Also set up delayed execution in case the immediate one gets interrupted
			setTimeout(() => {
				if (this.pendingNavigation === `footnote-${footnote.number}`) {
					this.debug('Executing delayed navigation for footnote:', footnote.number);
					this.jumpToFootnoteDefinition(footnote);
					this.pendingNavigation = null;
				}
			}, 50);
			
			// Clear pending navigation after a reasonable delay
			setTimeout(() => {
				if (this.pendingNavigation === `footnote-${footnote.number}`) {
					this.pendingNavigation = null;
				}
			}, 1000);
		});

            footnoteEl.addEventListener('mouseleave', () => {
                    footnoteEl.removeClass('footnote-item-hover');
            });
        }

        updateFootnoteInEditor(footnote: FootnoteData, newContent: string) {
            this.debug('updateFootnoteInEditor called with:', newContent);

            let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            let currentFile = this.app.workspace.getActiveFile();

            if (!activeView && currentFile) {
                const leaves = this.app.workspace.getLeavesOfType('markdown');
                for (const leaf of leaves) {
                    const view = leaf.view as MarkdownView;
                    if (view.file === currentFile) {
                        activeView = view;
                        break;
                    }
                }
            }

            if (!activeView && this.currentFile) {
                currentFile = this.currentFile;
                const leaves = this.app.workspace.getLeavesOfType('markdown');
                for (const leaf of leaves) {
                    const view = leaf.view as MarkdownView;
                    if (view.file === currentFile) {
                        activeView = view;
                        break;
                    }
                }
            }

            if (!activeView) {
                this.debug('No active view found for updating footnote');
                return;
            }

            const editor = activeView.editor;
            const currentContent = editor.getValue();
            const currentFootnotes = this.plugin.extractFootnotes(currentContent);

            const matchingFootnote = currentFootnotes.find(f => f.number === footnote.number);

            if (!matchingFootnote) {
                this.debug('Could not find matching footnote in current content');
                this.refresh();
                return;
            }

            this.debug('Found matching footnote with current positions:', matchingFootnote);
            this.performFootnoteUpdate(editor, matchingFootnote, newContent);
        }

        private performFootnoteUpdate(editor: any, footnote: FootnoteData, newContent: string) {
            const content = editor.getValue();

            const beforeDefinition = content.substring(0, footnote.definition.startPos);
            const afterDefinition = content.substring(footnote.definition.endPos);

            const newDefinition = `[^${footnote.number}]: ${newContent}`;

            this.debug('Replacing footnote definition at positions', footnote.definition.startPos, '-', footnote.definition.endPos);
            this.debug('Old definition:', footnote.definition.fullMatch);
            this.debug('New definition:', newDefinition);

            const newContentFinal = beforeDefinition + newDefinition + afterDefinition;
            editor.setValue(newContentFinal);

            new Notice('Footnote updated');

            setTimeout(() => {
                this.debug('Refreshing view after footnote update');
                this.refresh();
            }, 100);
        }

        deleteFootnoteFromEditor(footnote: FootnoteData) {
            this.debug('deleteFootnoteFromEditor called for:', footnote);

            let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            let currentFile = this.app.workspace.getActiveFile();

            if (!activeView && currentFile) {
                const leaves = this.app.workspace.getLeavesOfType('markdown');
                for (const leaf of leaves) {
                    const view = leaf.view as MarkdownView;
                    if (view.file === currentFile) {
                        activeView = view;
                        break;
                    }
                }
            }

            if (!activeView && this.currentFile) {
                currentFile = this.currentFile;
                const leaves = this.app.workspace.getLeavesOfType('markdown');
                for (const leaf of leaves) {
                    const view = leaf.view as MarkdownView;
                    if (view.file === currentFile) {
                        activeView = view;
                        break;
                    }
                }
            }

            if (!activeView) {
                this.debug('No active view found for deleting footnote');
                return;
            }

            const editor = activeView.editor;
            const currentContent = editor.getValue();
            const currentFootnotes = this.plugin.extractFootnotes(currentContent);

            const matchingFootnote = currentFootnotes.find(f => f.number === footnote.number);

            if (!matchingFootnote) {
                this.debug('Could not find matching footnote to delete');
                this.refresh();
                return;
            }

            if (matchingFootnote.referenceCount === 1) {
                // Delete both reference and definition
                this.debug('Deleting single reference and definition for footnote', footnote.number);
                this.performFullFootnoteDeletion(editor, matchingFootnote);
            } else {
                // Delete only the first reference
                this.debug('Deleting first reference only for footnote', footnote.number);
                this.performReferenceOnlyDeletion(editor, matchingFootnote);
            }
        }

        private performFullFootnoteDeletion(editor: any, footnote: FootnoteData) {
            let content = editor.getValue();

            // Collect all positions to delete (work backwards to maintain positions)
            const deletions: Array<{startPos: number, endPos: number}> = [];

            // Add definition deletion
            deletions.push({
                startPos: footnote.definition.startPos,
                endPos: footnote.definition.endPos
            });

            // Add all reference deletions
            footnote.references.forEach(ref => {
                deletions.push({
                    startPos: ref.startPos,
                    endPos: ref.endPos
                });
            });

            // Sort by position (descending) to maintain positions during deletion
            deletions.sort((a, b) => b.startPos - a.startPos);

            // Apply deletions
            deletions.forEach(deletion => {
                const before = content.substring(0, deletion.startPos);
                const after = content.substring(deletion.endPos);
                content = before + after;
            });

            // Clean up any double spaces or empty lines left behind
            content = content.replace(/\n\n\n+/g, '\n\n');
            content = content.replace(/  +/g, ' ');

            editor.setValue(content);
            new Notice(`Footnote [${footnote.number}] deleted completely`);

            setTimeout(() => {
                this.refresh();
            }, 100);
        }

        private performReferenceOnlyDeletion(editor: any, footnote: FootnoteData) {
            const content = editor.getValue();

            // Delete only the first reference
            const firstRef = footnote.references[0];
            const before = content.substring(0, firstRef.startPos);
            const after = content.substring(firstRef.endPos);

            const newContent = before + after;
            const finalContent = newContent.replace(/  +/g, ' ');

            editor.setValue(finalContent);
            new Notice(`One reference to footnote [${footnote.number}] deleted`);

            setTimeout(() => {
                this.refresh();
            }, 100);
        }

        private jumpToFootnoteDefinition(footnote: FootnoteData) {
            this.debug('jumpToFootnoteDefinition called for footnote:', footnote.number);

            let activeEditor: Editor | null = null;

            // Get the correct editor for the current file
            let currentFile = this.app.workspace.getActiveFile();
            if (!currentFile && this.currentFile) {
                currentFile = this.currentFile;
            }

            if (currentFile) {
                const leaves = this.app.workspace.getLeavesOfType('markdown');
                for (const leaf of leaves) {
                    const view = leaf.view as MarkdownView;
                    if (view.file === currentFile) {
                        activeEditor = view.editor;
                        break;
                    }
                }
            }

            if (!activeEditor) {
                new Notice('Could not find editor to navigate to footnote');
                return;
            }

            // Navigate to the footnote definition immediately
            const content = activeEditor.getValue();
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.match(new RegExp(`^\\s*\\[\\^${footnote.number}\\]:`))) {
                    this.debug('Found footnote definition at line:', i);
                    activeEditor.setCursor({ line: i, ch: 0 });
                    activeEditor.scrollIntoView({ from: { line: i, ch: 0 }, to: { line: i, ch: 0 } }, true);
                    activeEditor.focus();
                    new Notice(`Jumped to footnote [${footnote.number}] definition`);
                    return;
                }
            }

            new Notice(`Could not find definition for footnote [${footnote.number}]`);
        }
    }
