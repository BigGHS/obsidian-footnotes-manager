// main.ts - Complete Footnotes Manager Plugin - ENHANCED WITH UNREFERENCED HANDLING
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
	Modal,
	setIcon,
	MarkdownRenderer
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
	isUnreferenced?: boolean; // NEW: Track unreferenced footnotes
	isMultiSection?: boolean; // NEW: Track footnotes that appear in multiple sections
	appearanceCount?: number; // NEW: Track how many sections this footnote appears in
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
	children ? : FootnoteGroup[];
	parent ? : FootnoteGroup;
	isCollapsed ? : boolean;
	isUnreferencedGroup?: boolean; // NEW: Mark unreferenced group
}

// Interface for tracking rendered groups
interface RenderedGroup {
	group: FootnoteGroup;
	collapseIcon: Element;
	contentElement: HTMLElement;
}

// NEW: Interface for orphaned references
interface OrphanedReference {
	number: string;
	line: number;
	startPos: number;
	endPos: number;
	fullMatch: string;
}

// NEW: Enhanced Renumber Confirmation Modal
class EnhancedRenumberConfirmationModal extends Modal {
	plugin: FootnotesManagerPlugin;
	onConfirm: (removeOrphaned: boolean, fillGaps: boolean) => void;
	gaps: string[];
	orphanedRefs: OrphanedReference[];

	constructor(app: App, plugin: FootnotesManagerPlugin, gaps: string[], orphanedRefs: OrphanedReference[], onConfirm: (removeOrphaned: boolean, fillGaps: boolean) => void) {
		super(app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
		this.gaps = gaps;
		this.orphanedRefs = orphanedRefs;
	}

	onOpen() {
		const {
			contentEl
		} = this;
		contentEl.empty();

		// Title
		contentEl.createEl('h2', {
			text: 'Renumber Footnotes'
		});

		// Description container
		const descContainer = contentEl.createEl('div', {
			cls: 'renumber-description-container'
		});

		let hasIssues = false;

		// Orphaned references section
		if (this.orphanedRefs.length > 0) {
			hasIssues = true;
			const orphanedSection = descContainer.createEl('div', {
				cls: 'renumber-section'
			});
			
			const orphanedTitle = orphanedSection.createEl('h3', {
				text: 'Orphaned References Found'
			});

			const orphanedDesc = orphanedSection.createEl('p');
			orphanedDesc.innerHTML = `Found ${this.orphanedRefs.length} reference(s) with no matching footnotes: <strong>[^${this.orphanedRefs.map(ref => ref.number).join('], [^')}]</strong>`;
		}

		// Gaps section
		if (this.gaps.length > 0) {
			hasIssues = true;
			const gapsSection = descContainer.createEl('div', {
				cls: 'renumber-section'
			});
			
			const gapsTitle = gapsSection.createEl('h3', {
				text: 'Numbering Gaps Found'
			});

			const gapsDesc = gapsSection.createEl('p');
			gapsDesc.innerHTML = `Found gaps in footnote numbering: <strong>${this.gaps.join(', ')}</strong>`;
		}

		if (!hasIssues) {
			descContainer.createEl('p', {
				text: 'No issues found with footnote numbering.',
				cls: 'renumber-no-issues'
			});
		}

		// Options section
		const optionsSection = contentEl.createEl('div', {
			cls: 'renumber-options'
		});

		optionsSection.createEl('h3', {
			text: 'Select actions to perform:'
		});

		let removeOrphanedCheckbox: HTMLInputElement | null = null;
		let fillGapsCheckbox: HTMLInputElement | null = null;

		// Orphaned references checkbox
		if (this.orphanedRefs.length > 0) {
			const orphanedOption = optionsSection.createEl('div', {
				cls: 'renumber-option'
			});

			removeOrphanedCheckbox = orphanedOption.createEl('input', {
				type: 'checkbox',
				attr: { id: 'remove-orphaned' }
			}) as HTMLInputElement;

			const orphanedLabel = orphanedOption.createEl('label', {
				attr: { for: 'remove-orphaned' },
				text: `Remove orphaned references (${this.orphanedRefs.length} found)`
			});
		}

		// Fill gaps checkbox
		if (this.gaps.length > 0) {
			const gapsOption = optionsSection.createEl('div', {
				cls: 'renumber-option'
			});

			fillGapsCheckbox = gapsOption.createEl('input', {
				type: 'checkbox',
				attr: { id: 'fill-gaps' }
			}) as HTMLInputElement;

			const gapsLabel = gapsOption.createEl('label', {
				attr: { for: 'fill-gaps' },
				text: `Fill numbering gaps (${this.gaps.length} found)`
			});
		}

		// Warning
		if (hasIssues) {
			const warning = contentEl.createEl('p', {
				cls: 'renumber-warning'
			});
			warning.innerHTML = '<strong>Warning:</strong> These actions cannot be undone. Make sure to save your work before proceeding.';
		}

		// Buttons
		const buttonContainer = contentEl.createEl('div', {
			cls: 'renumber-buttons'
		});

		const confirmBtn = buttonContainer.createEl('button', {
			text: 'Apply Selected Changes',
			cls: 'mod-cta'
		});

		const cancelBtn = buttonContainer.createEl('button', {
			text: 'Cancel'
		});

		// Initially disable confirm button if no issues
		if (!hasIssues) {
			confirmBtn.disabled = true;
		}

		// Button handlers
		confirmBtn.onclick = () => {
			const removeOrphaned = removeOrphanedCheckbox?.checked || false;
			const fillGaps = fillGapsCheckbox?.checked || false;

			if (!hasIssues || removeOrphaned || fillGaps) {
				this.onConfirm(removeOrphaned, fillGaps);
				this.close();
			}
		};

		cancelBtn.onclick = () => {
			this.close();
		};

		// Update button state when checkboxes change
		const updateButtonState = () => {
			if (!hasIssues) {
				confirmBtn.disabled = true;
				return;
			}

			const anyChecked = (removeOrphanedCheckbox?.checked || false) || (fillGapsCheckbox?.checked || false);
			confirmBtn.disabled = !anyChecked;
			confirmBtn.textContent = anyChecked ? 'Apply Selected Changes' : 'Select at least one option';
		};

		if (removeOrphanedCheckbox) {
			removeOrphanedCheckbox.addEventListener('change', updateButtonState);
		}
		if (fillGapsCheckbox) {
			fillGapsCheckbox.addEventListener('change', updateButtonState);
		}

		// Initial button state
		updateButtonState();
	}

	onClose() {
		const {
			contentEl
		} = this;
		contentEl.empty();
	}
}

// FootnotesView Class
class FootnotesView extends ItemView {
	plugin: FootnotesManagerPlugin;
	private currentFile: TFile | null = null;
	private renderedGroups: RenderedGroup[] = [];
	private isCollapsed: boolean = false;
	private hasManualExpansions: boolean = false;
	private isNavigating: boolean = false;
	private pendingNavigation: string | null = null;
	private isListView: boolean = false;

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

		const now = Date.now();
		const skipCheckTimestamp = (this as any).skipCheckTimestamp || 0;
		const lastRefreshCheck = (this as any).lastRefreshCheck || 0;
		const timeSinceSkipCheck = now - skipCheckTimestamp;
		const timeSinceLastRefresh = now - lastRefreshCheck;

		if (this.plugin.skipNextRefresh || now < this.plugin.skipRefreshUntil) {
			this.debug('Skipping FootnotesView refresh due to plugin skip flags');
			return;
		}

		if (timeSinceSkipCheck < 100 && this.plugin.skipRefreshUntil > now - 2000) {
			this.debug('Skipping FootnotesView refresh - too soon after skip check');
			return;
		}

		if (this.isNavigating || this.plugin.isNavigating) {
			this.debug('Skipping FootnotesView refresh - currently navigating');
			return;
		}

		if (timeSinceLastRefresh < 100 && this.plugin.skipRefreshUntil > now - 3000) {
			this.debug('Skipping FootnotesView refresh - too frequent');
			return;
		}

		(this as any).lastRefreshCheck = now;

		this.debug('Proceeding with FootnotesView refresh');
		const container = this.containerEl.children[1];
		container.empty();

		const header = container.createEl('div', { cls: 'footnotes-header' });
		const titleRow = header.createEl('div', { cls: 'footnotes-title-row' });
		titleRow.createEl('h4', { text: 'Footnotes', cls: 'footnotes-title' });
	
		const controlsContainer = titleRow.createEl('div', { cls: 'footnotes-controls' });
	
		const navBtn = controlsContainer.createEl('button', { 
			cls: 'footnotes-control-btn nav-btn',
			attr: { title: 'Jump to footnotes section' }
		});
		setIcon(navBtn, 'footprints');
	
		const returnBtn = controlsContainer.createEl('button', { 
			cls: 'footnotes-control-btn return-btn',
			attr: { title: 'Return to last edit position' }
		});
		setIcon(returnBtn, 'file-text');
	
		const renumberBtn = controlsContainer.createEl('button', { 
			cls: 'footnotes-control-btn renumber-btn',
			attr: { title: 'Renumber footnotes (remove gaps)' }
		});
		setIcon(renumberBtn, 'list-ordered');
	
		const listViewBtn = controlsContainer.createEl('button', { 
			cls: 'footnotes-control-btn list-view-btn',
			attr: { title: 'Toggle between outline and list view' }
		});
		setIcon(listViewBtn, this.isListView ? 'list' : 'list-tree');
	
		let toggleAllBtn: HTMLButtonElement | undefined;
		if (!this.isListView) {
			toggleAllBtn = controlsContainer.createEl('button', { 
				cls: 'footnotes-toggle-btn',
				attr: { title: 'Toggle collapse/expand all sections' }
			});
			setIcon(toggleAllBtn, this.isCollapsed ? 'plus' : 'minus');
		}
	
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
		setIcon(clearSearchBtn, 'x');

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
	
		if (currentFile) {
			this.currentFile = currentFile;
		}

		this.setupNavigationButtons(navBtn, returnBtn, renumberBtn, listViewBtn, activeView, currentFile);

		if (!activeView && !currentFile) {
			container.createEl('div', { 
				text: 'No active markdown file', 
				cls: 'footnotes-empty' 
			});
			this.disableControls(toggleAllBtn, navBtn, returnBtn, renumberBtn, searchInput, listViewBtn);
			return;
		}

		let content = '';
	
		if (activeView) {
			content = activeView.editor.getValue();
			this.processFootnotes(content, container, toggleAllBtn, toggleAllBtn, searchInput, clearSearchBtn, navBtn, returnBtn, renumberBtn, listViewBtn);
		} else if (currentFile) {
			this.app.vault.read(currentFile).then(fileContent => {
				this.processFootnotes(fileContent, container, toggleAllBtn, toggleAllBtn, searchInput, clearSearchBtn, navBtn, returnBtn, renumberBtn, listViewBtn);
			});
		}
	}

	private setupNavigationButtons(
		navBtn: HTMLButtonElement, 
		returnBtn: HTMLButtonElement, 
		renumberBtn: HTMLButtonElement,
		listViewBtn: HTMLButtonElement,
		activeView: MarkdownView | null,
		currentFile: TFile | null
	) {
		navBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.plugin.setSkipRefreshPeriod(1000);
			setTimeout(() => {
				this.plugin.jumpToFootnotesSection();
			}, 10);
		};

		returnBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.plugin.setSkipRefreshPeriod(1000);
			setTimeout(() => {
				this.plugin.returnToLastEditPosition();
			}, 10);
		};

		renumberBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.plugin.setSkipRefreshPeriod(1000);
			setTimeout(() => {
				this.plugin.renumberFootnotes();
			}, 10);
		};

		listViewBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.isListView = !this.isListView;
			setIcon(listViewBtn, this.isListView ? 'list' : 'heading');
			listViewBtn.setAttribute('title', this.isListView ? 
				'Switch to outline view (grouped by headings)' : 
				'Switch to list view (simple list)'
			);
			this.refresh();
		};
	}

	private disableControls(
		toggleBtn?: HTMLButtonElement, 
		navBtn?: HTMLButtonElement, 
		returnBtn?: HTMLButtonElement, 
		renumberBtn?: HTMLButtonElement,
		searchInput?: HTMLInputElement,
		listViewBtn?: HTMLButtonElement
	) {
		if (toggleBtn) toggleBtn.disabled = true;
		if (navBtn) navBtn.disabled = true;
		if (returnBtn) returnBtn.disabled = true;
		if (renumberBtn) renumberBtn.disabled = true;
		if (searchInput) searchInput.disabled = true;
		if (listViewBtn) listViewBtn.disabled = true;
	}

	// UPDATED: processFootnotes method with unreferenced footnotes handling
	private processFootnotes(
	    content: string,
	    container: Element,
	    toggleBtn?: HTMLButtonElement,
	    toggleIcon?: HTMLElement,
	    searchInput?: HTMLInputElement,
	    clearSearchBtn?: HTMLButtonElement,
	    navBtn?: HTMLButtonElement,
	    returnBtn?: HTMLButtonElement,
	    renumberBtn?: HTMLButtonElement,
	    listViewBtn?: HTMLButtonElement
	) {
	    this.debug('Processing footnotes for content of length:', content.length, 'isListView:', this.isListView);

	    const currentStates = new Map<string, boolean>();
	    this.renderedGroups.forEach(rendered => {
	        if (rendered.group.header) {
	            const key = `${rendered.group.header.level}-${rendered.group.header.text}`;
	            currentStates.set(key, !rendered.group.isCollapsed);
	        }
	    });

	    this.renderedGroups = [];

	    const footnotes = this.plugin.extractFootnotes(content);

	    this.debug('Found', footnotes.length, 'footnotes');

	    if (footnotes.length === 0) {
	        container.createEl('div', {
	            text: 'No footnotes found',
	            cls: 'footnotes-empty'
	        });

	        this.disableControls(toggleBtn, navBtn, returnBtn, renumberBtn, searchInput, listViewBtn);
	        return;
	    }

	    // Enable controls when we have footnotes
	    if (toggleBtn) toggleBtn.disabled = false;
	    if (searchInput) searchInput.disabled = false;
	    if (navBtn) navBtn.disabled = false;
	    if (returnBtn) returnBtn.disabled = false;
	    if (renumberBtn) renumberBtn.disabled = false;
	    if (listViewBtn) listViewBtn.disabled = false;

	    const footnotesList = container.createEl('div', {
	        cls: 'footnotes-list'
	    });

	    // MOVED: Set up search functionality for BOTH view modes
	    if (searchInput && clearSearchBtn) {
	        let searchTimeout: number | null = null;
	        let currentSearchTerm = '';

	        const performSearch = () => {
	            const searchTerm = searchInput.value.toLowerCase().trim();
	            currentSearchTerm = searchTerm;
            
	            // Clear current content
	            footnotesList.empty();
            
	            if (this.isListView) {
	                // Filter and render list view
	                this.filterAndRenderListView(footnotes, footnotesList, searchTerm);
	            } else {
	                // Filter and render outline view (existing functionality)
	                const headers = this.plugin.extractHeaders(content);
	                const footnoteGroups = this.plugin.groupFootnotesByHeaders(footnotes, headers);
	                this.filterFootnotes(footnotesList, footnoteGroups, searchTerm);
	            }

	            if (searchTerm) {
	                clearSearchBtn.style.display = 'block';
	            } else {
	                clearSearchBtn.style.display = 'none';
	            }
	        };

	        (this as any).currentSearchTerm = '';

	        searchInput.addEventListener('input', () => {
	            this.debug('Search input changed:', searchInput.value);
	            if (searchTimeout) {
	                window.clearTimeout(searchTimeout);
	            }
	            searchTimeout = window.setTimeout(() => {
	                (this as any).currentSearchTerm = searchInput.value.toLowerCase().trim();
	                performSearch();
	            }, 300);
	        });

	        clearSearchBtn.addEventListener('click', () => {
	            this.debug('Clear search clicked');
	            searchInput.value = '';
	            (this as any).currentSearchTerm = '';
	            performSearch();
	            searchInput.focus();
	        });

	        clearSearchBtn.style.display = 'none';
	    }

	    // Render initial view based on mode
	    if (this.isListView) {
	        this.debug('Rendering in list view mode');
	        this.renderListView(footnotes, footnotesList);
	    } else {
	        this.debug('Rendering in outline view mode');
	        // Process headers and create groups for outline view
	        const headers = this.plugin.extractHeaders(content);
	        const footnoteGroups = this.plugin.groupFootnotesByHeaders(footnotes, headers);

	        this.debug('Found', footnoteGroups.length, 'groups');

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
	                this.toggleAllGroups(toggleBtn);
	            };

	            this.updateToggleButton(toggleBtn);
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
	    }

	    this.debug('Rendered groups count:', this.renderedGroups.length);
	    this.debug('Initial collapsed state:', this.isCollapsed, 'hasManualExpansions:', this.hasManualExpansions);
	}

	private restoreExpansionStates(groups: FootnoteGroup[], states: Map < string, boolean > ) {
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
						setIcon(rendered.collapseIcon as HTMLElement, group.isCollapsed ? 'chevron-right' : 'chevron-down');
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
					isCollapsed: false,
					isUnreferencedGroup: group.isUnreferencedGroup
				};

				filtered.push(filteredGroup);
			}
		});

		return filtered;
	}

	private renderListView(footnotes: FootnoteData[], container: Element) {
		this.debug('Rendering list view with', footnotes.length, 'footnotes');

		// Sort footnotes by their first reference position (document order), unreferenced at end
		const sortedFootnotes = [...footnotes].sort((a, b) => {
			if (a.isUnreferenced && !b.isUnreferenced) return 1;
			if (!a.isUnreferenced && b.isUnreferenced) return -1;
			if (a.isUnreferenced && b.isUnreferenced) return 0;

			const aFirstRef = a.references[0];
			const bFirstRef = b.references[0];
			if (!aFirstRef || !bFirstRef) return 0;
			return aFirstRef.startPos - bFirstRef.startPos;
		});

		sortedFootnotes.forEach((footnote, index) => {
			const footnoteContainer = container.createEl('div', {
				cls: 'footnote-list-item'
			});

			const sequenceEl = footnoteContainer.createEl('div', {
				cls: 'footnote-sequence',
				text: `${index + 1}.`
			});

			this.createFootnoteElement(footnote, footnoteContainer);
		});

		this.debug('List view rendered successfully');
	}

	private renderFootnoteGroup(group: FootnoteGroup, container: Element, depth: number) {
		const headerSection = container.createEl('div', {
			cls: 'footnote-header-section'
		});
		headerSection.style.marginLeft = `${depth * 12}px`;

		const headerEl = headerSection.createEl('div', {
			cls: group.isUnreferencedGroup ? 'footnote-header footnote-unreferenced-header' : 'footnote-header'
		});

		const collapseIcon = headerEl.createEl('span', {
			cls: 'footnote-collapse-icon'
		});
		const hasChildren = (group.children && group.children.length > 0) || group.footnotes.length > 0;

		if (hasChildren) {
			setIcon(collapseIcon, group.isCollapsed ? 'chevron-right' : 'chevron-down');
			collapseIcon.style.visibility = 'visible';
		} else {
			collapseIcon.style.visibility = 'hidden';
		}

		const headerText = headerEl.createEl('span', {
			cls: 'footnote-header-text'
		});
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

		const groupContent = headerSection.createEl('div', {
			cls: 'footnote-group-content'
		});
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

		// NEW: Different behavior for unreferenced group
		if (group.header && !group.isUnreferencedGroup) {
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
			const groupFootnotes = groupContent.createEl('div', {
				cls: 'footnote-group-footnotes'
			});
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
			setIcon(icon as HTMLElement, 'chevron-right');
			content.style.display = 'none';
		} else {
			setIcon(icon as HTMLElement, 'chevron-down');
			content.style.display = 'block';
			this.hasManualExpansions = true;
		}

		if (group.isCollapsed && group.children) {
			this.collapseAllChildren(group);
		}

		this.debug('Group toggled, hasManualExpansions:', this.hasManualExpansions);
	}

	private toggleAllGroups(toggleBtn: HTMLElement) {
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
		this.updateToggleButton(toggleBtn);

		this.debug('toggleAllGroups completed, new state:', this.isCollapsed);
	}

	private updateToggleButton(toggleBtn: HTMLElement) {
		if (this.isCollapsed) {
			setIcon(toggleBtn, 'plus');
			toggleBtn.setAttribute('title', 'Expand all sections');
		} else {
			setIcon(toggleBtn, 'minus');
			toggleBtn.setAttribute('title', 'Collapse all sections');
		}
	}

	private collapseAllGroups(allGroups: FootnoteGroup[]) {
		this.debug('Collapsing all groups to top level overview');

		this.renderedGroups.forEach(rendered => {
			const hasContent = (rendered.group.children && rendered.group.children.length > 0) || rendered.group.footnotes.length > 0;

			if (hasContent) {
				rendered.group.isCollapsed = true;
				setIcon(rendered.collapseIcon as HTMLElement, 'chevron-right');
				rendered.contentElement.style.display = 'none';
			}
		});
	}

	private expandAllGroups(allGroups: FootnoteGroup[]) {
		this.debug('Expanding all groups');
		this.renderedGroups.forEach(rendered => {
			rendered.group.isCollapsed = false;
			setIcon(rendered.collapseIcon as HTMLElement, 'chevron-down');
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

	// UPDATED: createFootnoteElement with unreferenced handling
	private createFootnoteElement(footnote: FootnoteData, container: Element) {
	    const footnoteEl = container.createEl('div', { cls: 'footnote-item' });
	    
	    // NEW: Add unreferenced class if applicable
	    if (footnote.isUnreferenced) {
	        footnoteEl.addClass('footnote-unreferenced');
	    }
    
	    // Footnote number and reference count/status
	    const headerEl = footnoteEl.createEl('div', { cls: 'footnote-header-info' });
	    
	    const numberContainer = headerEl.createEl('div', { cls: 'footnote-number-container' });
	    const numberEl = numberContainer.createEl('span', { 
	        cls: 'footnote-number',
	        text: `[${footnote.number}]`
	    });
	    
	    // NEW: Add copy icon for multi-section footnotes
	    if (footnote.isMultiSection) {
	        const copyIcon = numberContainer.createEl('span', { 
	            cls: 'footnote-multi-section-icon',
	            attr: { title: `This footnote appears in ${footnote.appearanceCount} sections` }
	        });
	        setIcon(copyIcon, 'copy');
	    }
    
	    // NEW: Show "Unreferenced" instead of reference count for unreferenced footnotes
	    const countEl = headerEl.createEl('span', { 
	        cls: footnote.isUnreferenced ? 'footnote-unreferenced-indicator' : 'footnote-ref-count',
	        text: footnote.isUnreferenced ? 'Unreferenced' : `${footnote.referenceCount} ref${footnote.referenceCount !== 1 ? 's' : ''}`
	    });

	    const contentEl = footnoteEl.createEl('div', { cls: 'footnote-content' });
    
	    const isMultiLine = footnote.content.includes('\n');
    
	    let textEl: HTMLElement;
	    let displayEl: HTMLElement;
    
	    if (isMultiLine) {
	        displayEl = contentEl.createEl('div', { 
	            cls: 'footnote-text footnote-display'
	        });
        
	        textEl = contentEl.createEl('textarea', { 
	            cls: 'footnote-text footnote-textarea footnote-edit',
	            attr: { 
	                spellcheck: 'false',
	                rows: (footnote.content.split('\n').length + 1).toString()
	            }
	        }) as HTMLTextAreaElement;
	        (textEl as HTMLTextAreaElement).value = footnote.content || '';
        
	        textEl.style.display = 'none';
	    } else {
	        displayEl = contentEl.createEl('div', { 
	            cls: 'footnote-text footnote-display'
	        });
        
	        textEl = contentEl.createEl('div', { 
	            cls: 'footnote-text footnote-edit',
	            attr: { contenteditable: 'true', spellcheck: 'false' }
	        });
	        textEl.textContent = footnote.content || '(empty footnote)';
        
	        textEl.style.display = 'none';
	    }
    
	    this.renderFootnoteMarkdown(footnote.content || '(empty footnote)', displayEl);
    
	    const currentSearchTerm = (this as any).currentSearchTerm || '';
	    if (currentSearchTerm && footnote.content.toLowerCase().includes(currentSearchTerm)) {
	        this.highlightSearchInElement(displayEl, currentSearchTerm);
	    }

	    // NEW: Only show references section for referenced footnotes
	    if (!footnote.isUnreferenced && footnote.references.length > 0) {
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
                
	                const navId = `reference-${footnote.number}-${index}`;
	                this.pendingNavigation = navId;
	                this.plugin.setSkipRefreshPeriod(2000);
                
	                this.plugin.highlightFootnoteInEditor(footnote, index);
                
	                setTimeout(() => {
	                    if (this.pendingNavigation === navId) {
	                        this.debug('Executing delayed navigation for reference:', footnote.number, index);
	                        this.plugin.highlightFootnoteInEditor(footnote, index);
	                        this.pendingNavigation = null;
	                    }
	                }, 50);
                
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
    
	    // NEW: Only show save/cancel buttons for referenced footnotes
	    let saveBtn: HTMLButtonElement | undefined;
	    let cancelBtn: HTMLButtonElement | undefined;
	    
	    if (!footnote.isUnreferenced) {
		    saveBtn = actionsEl.createEl('button', { 
		        text: 'Save', 
		        cls: 'footnote-btn footnote-save-btn' 
		    });
		    saveBtn.style.display = 'none';
	    
		    cancelBtn = actionsEl.createEl('button', { 
		        text: 'Cancel', 
		        cls: 'footnote-btn footnote-cancel-btn' 
		    });
		    cancelBtn.style.display = 'none';
	    }

	    // Delete button (always present)
	    const deleteBtn = actionsEl.createEl('button', { 
	        cls: 'footnote-btn footnote-delete-btn',
	        attr: { title: 'Delete footnote' }
	    });
	    deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"/></svg>`;

	    let originalText = footnote.content;
	    let isEditing = false;

	    // NEW: Only setup editing for referenced footnotes
	    if (!footnote.isUnreferenced && saveBtn && cancelBtn) {
		    const handleInput = () => {
		        if (!isEditing) {
		            isEditing = true;
		            saveBtn!.style.display = 'inline-block';
		            cancelBtn!.style.display = 'inline-block';
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
	            
		            this.renderFootnoteMarkdown(newText, displayEl);
		        }
		        exitEditMode();
		    };

		    const cancelEdit = () => {
		        if (textEl.tagName === 'TEXTAREA') {
		            (textEl as HTMLTextAreaElement).value = originalText;
		        } else {
		            textEl.textContent = originalText;
		        }
		        exitEditMode();
		    };

		    const exitEditMode = () => {
		        isEditing = false;
		        saveBtn!.style.display = 'none';
		        cancelBtn!.style.display = 'none';
		        deleteBtn.style.display = 'inline-block';
		        footnoteEl.removeClass('footnote-editing');
	        
		        displayEl.style.display = 'block';
		        textEl.style.display = 'none';
		        textEl.blur();
		    };

		    const enterEditMode = () => {
		        isEditing = true;
		        saveBtn!.style.display = 'inline-block';
		        cancelBtn!.style.display = 'inline-block';
		        deleteBtn.style.display = 'none';
		        footnoteEl.addClass('footnote-editing');
	        
		        displayEl.style.display = 'none';
		        textEl.style.display = 'block';
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
		    };

		    saveBtn.addEventListener('click', (e) => {
		        e.stopPropagation();
		        saveFootnote();
		    });

		    cancelBtn.addEventListener('click', (e) => {
		        e.stopPropagation();
		        cancelEdit();
		    });

		    // Click to edit functionality for referenced footnotes
		    footnoteEl.addEventListener('click', (e) => {
		        this.debug('Footnote clicked, isEditing:', isEditing, 'target:', e.target);
	        
		        if (isEditing) return;
	        
		        const target = e.target as HTMLElement;
		        if (target.tagName === 'BUTTON' || target.closest('button')) {
		            this.debug('Click was on button, ignoring');
		            return;
		        }
	        
		        if (target === displayEl || displayEl.contains(target)) {
		            this.debug('Clicked on display element, entering edit mode');
		            e.preventDefault();
		            e.stopPropagation();
		            enterEditMode();
		            return;
		        }
	        
		        if (target === textEl) {
		            this.debug('Clicked on text element, entering edit mode');
		            e.preventDefault();
		            e.stopPropagation();
		            enterEditMode();
		            return;
		        }
	        
		        // Default click behavior - jump to footnote definition
		        this.debug('Calling jumpToFootnoteDefinition');
		        e.preventDefault();
		        e.stopPropagation();

		        this.pendingNavigation = `footnote-${footnote.number}`;
		        this.plugin.setSkipRefreshPeriod(2000);
	        
		        this.jumpToFootnoteDefinition(footnote);
	        
		        setTimeout(() => {
		            if (this.pendingNavigation === `footnote-${footnote.number}`) {
		                this.debug('Executing delayed navigation for footnote:', footnote.number);
		                this.jumpToFootnoteDefinition(footnote);
		                this.pendingNavigation = null;
		            }
		        }, 50);
	        
		        setTimeout(() => {
		            if (this.pendingNavigation === `footnote-${footnote.number}`) {
		                this.pendingNavigation = null;
		            }
		        }, 1000);
		    });
	    } else {
	    	// NEW: For unreferenced footnotes, only allow navigation to definition
	    	footnoteEl.addEventListener('click', (e) => {
		        const target = e.target as HTMLElement;
		        if (target.tagName === 'BUTTON' || target.closest('button')) {
		            return;
		        }
	        
		        e.preventDefault();
		        e.stopPropagation();

		        this.pendingNavigation = `footnote-${footnote.number}`;
		        this.plugin.setSkipRefreshPeriod(2000);
	        
		        this.jumpToFootnoteDefinition(footnote);
	        
		        setTimeout(() => {
		            if (this.pendingNavigation === `footnote-${footnote.number}`) {
		                this.jumpToFootnoteDefinition(footnote);
		                this.pendingNavigation = null;
		            }
		        }, 50);
	        
		        setTimeout(() => {
		            if (this.pendingNavigation === `footnote-${footnote.number}`) {
		                this.pendingNavigation = null;
		            }
		        }, 1000);
		    });
	    }

	    deleteBtn.addEventListener('click', (e) => {
	        e.stopPropagation();
        
	        // NEW: Different confirmation messages for unreferenced vs referenced footnotes
	        let confirmMessage;
	        if (footnote.isUnreferenced) {
	        	confirmMessage = `Are you sure you want to delete unreferenced footnote [${footnote.number}]?\n\nThis will delete the footnote definition.`;
	        } else if (footnote.referenceCount === 1) {
	            confirmMessage = `Are you sure you want to delete footnote [${footnote.number}]?\n\nThis will delete both the reference and the footnote definition.`;
	        } else {
	            confirmMessage = `Are you sure you want to delete footnote [${footnote.number}]?\n\nThis footnote has ${footnote.referenceCount} references. Only the first reference will be deleted. The footnote definition will be preserved.`;
	        }
        
	        const confirmDelete = confirm(confirmMessage);
	        if (confirmDelete) {
	            this.deleteFootnoteFromEditor(footnote);
	        }
	    });

	    footnoteEl.addEventListener('mouseleave', () => {
	        footnoteEl.removeClass('footnote-item-hover');
	    });
	}

	private jumpToFootnoteDefinition(footnote: FootnoteData) {
		this.debug('jumpToFootnoteDefinition called for footnote:', footnote.number);

		let activeEditor: Editor | null = null;

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

		const content = activeEditor.getValue();
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.match(new RegExp(`^\\s*\\[\\^${footnote.number}\\]:`))) {
				this.debug('Found footnote definition at line:', i);
				activeEditor.setCursor({
					line: i,
					ch: 0
				});
				activeEditor.scrollIntoView({
					from: {
						line: i,
						ch: 0
					},
					to: {
						line: i,
						ch: 0
					}
				}, true);
				activeEditor.focus();
				new Notice(`Jumped to footnote [${footnote.number}] definition`);
				return;
			}
		}

		new Notice(`Could not find definition for footnote [${footnote.number}]`);
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
		const { referencedFootnotes } = this.plugin.extractFootnotesWithUnreferenced(currentContent);

		const matchingFootnote = referencedFootnotes.find(f => f.number === footnote.number);

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

		// NEW: Handle unreferenced footnotes differently
		if (footnote.isUnreferenced) {
			this.performUnreferencedFootnoteDeletion(editor, footnote);
			return;
		}

		const { referencedFootnotes } = this.plugin.extractFootnotesWithUnreferenced(currentContent);
		const matchingFootnote = referencedFootnotes.find(f => f.number === footnote.number);

		if (!matchingFootnote) {
			this.debug('Could not find matching footnote to delete');
			this.refresh();
			return;
		}

		if (matchingFootnote.referenceCount === 1) {
			this.performFullFootnoteDeletion(editor, matchingFootnote);
		} else {
			this.performReferenceOnlyDeletion(editor, matchingFootnote);
		}
	}

	// NEW: Method to delete unreferenced footnotes
	private performUnreferencedFootnoteDeletion(editor: any, footnote: FootnoteData) {
		const content = editor.getValue();
		
		// Just delete the definition since there are no references
		const before = content.substring(0, footnote.definition.startPos);
		const after = content.substring(footnote.definition.endPos);
		
		let newContent = before + after;
		
		// Clean up any double newlines left behind
		newContent = newContent.replace(/\n\n\n+/g, '\n\n');
		
		editor.setValue(newContent);
		new Notice(`Unreferenced footnote [${footnote.number}] deleted`);

		setTimeout(() => {
			this.refresh();
		}, 100);
	}

	private performFullFootnoteDeletion(editor: any, footnote: FootnoteData) {
		let content = editor.getValue();

		const deletions: Array < {
			startPos: number,
			endPos: number
		} > = [];

		deletions.push({
			startPos: footnote.definition.startPos,
			endPos: footnote.definition.endPos
		});

		footnote.references.forEach(ref => {
			deletions.push({
				startPos: ref.startPos,
				endPos: ref.endPos
			});
		});

		deletions.sort((a, b) => b.startPos - a.startPos);

		deletions.forEach(deletion => {
			const before = content.substring(0, deletion.startPos);
			const after = content.substring(deletion.endPos);
			content = before + after;
		});

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
	
	private async renderFootnoteMarkdown(content: string, element: HTMLElement) {
	    element.empty();
    
	    if (!content || content.trim() === '') {
	        element.createEl('span', { 
	            text: '(empty footnote)', 
	            cls: 'footnote-empty-placeholder' 
	        });
	        return;
	    }
    
	    try {
	        await MarkdownRenderer.renderMarkdown(
	            content, 
	            element, 
	            '', 
	            this
	        );
        
	        if (!content.includes('\n')) {
	            const paragraphs = element.querySelectorAll('p');
	            if (paragraphs.length === 1) {
	                const p = paragraphs[0];
	                p.replaceWith(...Array.from(p.childNodes));
	            }
	        }
	    } catch (error) {
	        this.debug('Error rendering markdown:', error);
	        element.textContent = content;
	    }
	}

	private highlightSearchInElement(element: HTMLElement, searchTerm: string) {
	    if (!searchTerm) return;
    
	    const walker = document.createTreeWalker(
	        element,
	        NodeFilter.SHOW_TEXT,
	        null
	    );
    
	    const textNodes: Text[] = [];
	    let node;
    
	    while (node = walker.nextNode()) {
	        textNodes.push(node as Text);
	    }
    
	    textNodes.forEach(textNode => {
	        const text = textNode.textContent || '';
	        if (text.toLowerCase().includes(searchTerm.toLowerCase())) {
	            const highlightedHTML = this.highlightSearchText(text, searchTerm);
	            const span = document.createElement('span');
	            span.innerHTML = highlightedHTML;
	            textNode.replaceWith(span);
	        }
	    });
	}
	
	// ADD: New method to filter and render list view with search
	private filterAndRenderListView(footnotes: FootnoteData[], container: Element, searchTerm: string) {
	    this.debug('Filtering list view with search term:', searchTerm);

	    let filteredFootnotes = footnotes;
    
	    if (searchTerm) {
	        filteredFootnotes = footnotes.filter(footnote =>
	            footnote.content.toLowerCase().includes(searchTerm) ||
	            footnote.number.toLowerCase().includes(searchTerm)
	        );
        
	        this.debug('Filtered to', filteredFootnotes.length, 'footnotes');
	    }

	    if (filteredFootnotes.length === 0 && searchTerm) {
	        container.createEl('div', {
	            text: 'No matching footnotes found',
	            cls: 'footnotes-empty'
	        });
	        return;
	    }

	    // Sort footnotes by their first reference position (document order)
	    const sortedFootnotes = [...filteredFootnotes].sort((a, b) => {
	        const aFirstRef = a.references[0];
	        const bFirstRef = b.references[0];
	        if (!aFirstRef || !bFirstRef) return 0;
	        return aFirstRef.startPos - bFirstRef.startPos;
	    });

	    // Create list items with search highlighting
	    sortedFootnotes.forEach((footnote, index) => {
	        const footnoteContainer = container.createEl('div', {
	            cls: 'footnote-list-item'
	        });

	        // Add sequence number for list view
	        const sequenceEl = footnoteContainer.createEl('div', {
	            cls: 'footnote-sequence',
	            text: `${index + 1}.`
	        });

	        // Create the footnote element with search highlighting
	        this.createFootnoteElementWithSearch(footnote, footnoteContainer, searchTerm);
	    });

	    this.debug('List view rendered with search successfully');
	}

	// ADD: New method to create footnote element with search highlighting
	private createFootnoteElementWithSearch(footnote: FootnoteData, container: Element, searchTerm: string) {
	    // Store the search term for highlighting
	    (this as any).currentSearchTerm = searchTerm;
    
	    // Use existing createFootnoteElement method
	    this.createFootnoteElement(footnote, container);
    
	    // Apply search highlighting if there's a search term
	    if (searchTerm) {
	        const footnoteEl = container.querySelector('.footnote-item');
	        if (footnoteEl) {
	            this.highlightSearchInFootnoteElement(footnoteEl as HTMLElement, searchTerm);
	        }
	    }
	}

	// ADD: New method to highlight search terms in footnote elements
	private highlightSearchInFootnoteElement(element: HTMLElement, searchTerm: string) {
	    if (!searchTerm) return;
    
	    // Find text nodes and apply highlighting
	    const walker = document.createTreeWalker(
	        element,
	        NodeFilter.SHOW_TEXT,
	        {
	            acceptNode: (node) => {
	                // Skip if parent is a script or style element
	                const parent = node.parentElement;
	                if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
	                    return NodeFilter.FILTER_REJECT;
	                }
	                return NodeFilter.FILTER_ACCEPT;
	            }
	        }
	    );
    
	    const textNodes: Text[] = [];
	    let node;
    
	    while (node = walker.nextNode()) {
	        textNodes.push(node as Text);
	    }
    
	    textNodes.forEach(textNode => {
	        const text = textNode.textContent || '';
	        const lowerText = text.toLowerCase();
	        const lowerSearchTerm = searchTerm.toLowerCase();
        
	        if (lowerText.includes(lowerSearchTerm)) {
	            const highlightedHTML = this.highlightSearchText(text, searchTerm);
	            const span = document.createElement('span');
	            span.innerHTML = highlightedHTML;
	            textNode.replaceWith(span);
	        }
	    });
	}
}

export default class FootnotesManagerPlugin extends Plugin {
	settings: FootnotesManagerSettings;
	private refreshTimeout: number | null = null;
	public skipNextRefresh: boolean = false;
	private allHeaders: HeaderData[] = [];
	private lastEditPosition: EditorPosition | null = null;
	public skipRefreshUntil: number = 0;
	public isNavigating: boolean = false;

	private debug(message: string, ...args: any[]) {
		if (this.settings.debugMode) {
			console.log(`[Footnotes Manager] ${message}`, ...args);
		}
	}

	async onload() {
		await this.loadSettings();

		this.registerView(
			FOOTNOTES_VIEW_TYPE,
			(leaf) => new FootnotesView(leaf, this)
		);

		this.addRibbonIcon('hash', 'Toggle Footnotes Panel', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'toggle-footnotes-panel',
			name: 'Toggle Footnotes Panel',
			callback: () => {
				this.activateView();
			}
		});

		this.addCommand({
			id: 'insert-footnote',
			name: 'Insert footnote',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.insertFootnote(editor);
			}
		});

		this.addCommand({
			id: 'jump-to-footnotes',
			name: 'Jump to footnotes section',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.jumpToFootnotesSection(editor);
			}
		});

		this.addCommand({
			id: 'return-to-edit-position',
			name: 'Return to last edit position',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.returnToLastEditPosition(editor);
			}
		});

		this.addSettingTab(new FootnotesManagerSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				if (this.skipNextRefresh || Date.now() < this.skipRefreshUntil || this.isNavigating) {
					this.debug('Skipping refresh on active-leaf-change due to skip flags, skipNextRefresh:', this.skipNextRefresh, 'isNavigating:', this.isNavigating);
					return;
				}
				this.refreshFootnotesView();
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor) => {
				if (!this.skipNextRefresh) {
					this.debounceRefresh();
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor) => {
				if (!this.skipNextRefresh) {
					this.lastEditPosition = editor.getCursor();
				}
			})
		);

		if (this.settings.openOnStart) {
			this.app.workspace.onLayoutReady(() => {
				this.activateView();
			});
		}
	}

	insertFootnote(editor: Editor) {
		const content = editor.getValue();
		const { referencedFootnotes } = this.extractFootnotesWithUnreferenced(content);

		const existingNumbers = referencedFootnotes.map(f => parseInt(f.number)).filter(n => !isNaN(n)).sort((a, b) => a - b);
		let nextNumber = 1;
		for (const num of existingNumbers) {
			if (num === nextNumber) {
				nextNumber++;
			} else {
				break;
			}
		}

		const cursor = editor.getCursor();
		const footnoteRef = `[^${nextNumber}]`;
		editor.replaceRange(footnoteRef, cursor);

		const lines = content.split('\n');
		let insertPos = lines.length;

		let footnotesStartLine = -1;
		for (let i = lines.length - 1; i >= 0; i--) {
			if (lines[i].match(/^\[\^[\w-]+\]:/)) {
				footnotesStartLine = i;
				break;
			}
		}

		if (footnotesStartLine === -1) {
			if (lines[lines.length - 1].trim() !== '') {
				editor.setValue(content + '\n\n');
			} else {
				editor.setValue(content + '\n');
			}
			insertPos = editor.lineCount();
		} else {
			insertPos = footnotesStartLine + 1;
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
		editor.replaceRange('\n' + footnoteDefinition, {
			line: insertPos,
			ch: 0
		});

		editor.setCursor({
			line: insertPos + 1,
			ch: footnoteDefinition.length
		});

		this.refreshFootnotesView();
		new Notice(`Footnote ${nextNumber} inserted`);
	}

	jumpToFootnotesSection(editor ? : Editor) {
		this.debug('jumpToFootnotesSection called, editor provided:', !!editor);

		let activeEditor = editor;
		let targetFile: TFile | null = null;

		if (!activeEditor) {
			this.debug('No editor provided, getting file from footnotes view');

			const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
			if (footnoteLeaves.length > 0) {
				const footnoteView = footnoteLeaves[0].view as FootnotesView;
				targetFile = (footnoteView as any).currentFile;
				this.debug('Got target file from footnotes view:', !!targetFile);
			}

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

		if (!activeEditor || typeof activeEditor.getCursor !== 'function') {
			this.debug('Editor is invalid or missing getCursor method');
			new Notice('Unable to access editor');
			return;
		}

		try {
			this.lastEditPosition = activeEditor.getCursor();
			this.debug('Stored last edit position:', this.lastEditPosition);

			const content = activeEditor.getValue();
			const lines = content.split('\n');

			this.debug('Document has', lines.length, 'lines, content length:', content.length);
			this.debug('Searching for footnote definitions...');

			let foundFootnoteAt = -1;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

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
				activeEditor.setCursor({
					line: foundFootnoteAt,
					ch: 0
				});
				activeEditor.scrollIntoView({
					from: {
						line: foundFootnoteAt,
						ch: 0
					},
					to: {
						line: foundFootnoteAt,
						ch: 0
					}
				}, true);
				new Notice('Jumped to footnotes section. Use return button to go back.');
				return;
			} else {
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (line.match(/^#{1,6}\s+(Notes?|Footnotes?)\s*$/i)) {
						this.debug(`Found Notes/Footnotes heading at line ${i + 1}:`, line);
						activeEditor.setCursor({
							line: i,
							ch: 0
						});
						activeEditor.scrollIntoView({
							from: {
								line: i,
								ch: 0
							},
							to: {
								line: i,
								ch: 0
							}
						}, true);
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

	returnToLastEditPosition(editor ? : Editor) {
		this.debug('returnToLastEditPosition called, editor provided:', !!editor);

		let activeEditor = editor;
		let targetFile: TFile | null = null;

		if (!activeEditor) {
			this.debug('No editor provided, getting file from footnotes view');

			const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
			if (footnoteLeaves.length > 0) {
				const footnoteView = footnoteLeaves[0].view as FootnotesView;
				targetFile = (footnoteView as any).currentFile;
				this.debug('Got target file from footnotes view:', !!targetFile);
			}

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

		if (!activeEditor || typeof activeEditor.setCursor !== 'function') {
			this.debug('Editor is invalid or missing setCursor method');
			new Notice('Unable to access editor');
			return;
		}

		try {
			if (this.lastEditPosition) {
				this.debug('Attempting to return to stored position:', this.lastEditPosition);
				activeEditor.setCursor(this.lastEditPosition);
				activeEditor.scrollIntoView({
					from: this.lastEditPosition,
					to: this.lastEditPosition
				}, true);

				activeEditor.focus();

				new Notice('Returned to last edit position');
				this.debug('Successfully returned to position:', this.lastEditPosition);
			} else {
				this.debug('No lastEditPosition stored, finding first editable line');
				const firstEditableLine = this.findFirstEditableLine(activeEditor);
				const defaultPosition = {
					line: firstEditableLine,
					ch: 0
				};

				activeEditor.setCursor(defaultPosition);
				activeEditor.scrollIntoView({
					from: defaultPosition,
					to: defaultPosition
				}, true);
				activeEditor.focus();

				new Notice('Jumped to start of content');
				this.debug('Moved to first editable line:', firstEditableLine);
			}
		} catch (error) {
			this.debug('Error in returnToLastEditPosition:', error);
			new Notice('Error accessing editor: ' + error.message);
		}
	}

	private findFirstEditableLine(editor: Editor): number {
		const content = editor.getValue();
		const lines = content.split('\n');

		this.debug('Finding first editable line in document with', lines.length, 'lines');

		if (lines[0] && lines[0].trim() === '---') {
			this.debug('Document starts with frontmatter, looking for end');

			for (let i = 1; i < lines.length; i++) {
				if (lines[i].trim() === '---') {
					this.debug('Found end of frontmatter at line', i);

					for (let j = i + 1; j < lines.length; j++) {
						if (lines[j].trim() !== '') {
							this.debug('First content line after frontmatter:', j);
							return j;
						}
					}

					return i + 1;
				}
			}

			this.debug('Frontmatter missing closing ---, defaulting to line 1');
			return 1;
		}

		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() !== '') {
				this.debug('First non-empty line found at:', i);
				return i;
			}
		}

		this.debug('Document appears empty, defaulting to line 0');
		return 0;
	}

	public setSkipRefreshPeriod(milliseconds: number = 1000) {
		this.skipNextRefresh = true;
		this.skipRefreshUntil = Date.now() + milliseconds;
		this.debug('Set skip refresh period until:', this.skipRefreshUntil);

		setTimeout(() => {
			this.skipNextRefresh = false;
			this.debug('Cleared skipNextRefresh flag');
		}, milliseconds);
	}

	debounceRefresh() {
		this.debug('debounceRefresh called, skipNextRefresh:', this.skipNextRefresh, 'skipRefreshUntil:', this.skipRefreshUntil, 'isNavigating:', this.isNavigating, 'now:', Date.now());

		if (this.skipNextRefresh || Date.now() < this.skipRefreshUntil || this.isNavigating) {
			this.debug('Skipping refresh due to skip flags');
			return;
		}

		if (this.refreshTimeout) {
			window.clearTimeout(this.refreshTimeout);
		}
		this.refreshTimeout = window.setTimeout(() => {
			if (this.skipNextRefresh || Date.now() < this.skipRefreshUntil || this.isNavigating) {
				this.debug('Skipping delayed refresh due to skip flags');
				return;
			}
			this.debug('Executing delayed refresh');
			this.refreshFootnotesView();
		}, 500);
	}

	async activateView() {
		const {
			workspace
		} = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);

		if (leaves.length > 0) {
			leaf = leaves[0];
			workspace.revealLeaf(leaf);
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: FOOTNOTES_VIEW_TYPE,
					active: true
				});
			}
		}

		this.refreshFootnotesView();
	}

	refreshFootnotesView() {
		if (this.skipNextRefresh || Date.now() < this.skipRefreshUntil || this.isNavigating) {
			this.debug('Skipping footnotes view refresh due to skip flags, skipNextRefresh:', this.skipNextRefresh, 'now:', Date.now(), 'skipUntil:', this.skipRefreshUntil, 'isNavigating:', this.isNavigating);
			return;
		}

		this.debug('Proceeding with footnotes view refresh');
		const leaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
		leaves.forEach(leaf => {
			if (leaf.view instanceof FootnotesView) {
				(leaf.view as any).skipCheckTimestamp = Date.now();
				(leaf.view as any).lastRefreshCheck = Date.now();
				leaf.view.refresh();
			}
		});
	}

	// NEW: Enhanced extractFootnotes method that separates referenced and unreferenced footnotes
	extractFootnotesWithUnreferenced(content: string): { referencedFootnotes: FootnoteData[], unreferencedFootnotes: FootnoteData[] } {
		const footnoteDefinitions = new Map < string, FootnoteDefinition > ();
		const footnoteReferences = new Map < string, FootnoteReference[] > ();

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

			footnoteDefinitions.set(number, definition);
		}

		// Extract footnote references
		const referenceRegex = /\[\^([\w-]+)\]/g;
		while ((match = referenceRegex.exec(content)) !== null) {
			const number = match[1];
			const startPos = match.index;
			const endPos = match.index + match[0].length;

			// Check if this match is actually a definition by looking at the context
			const beforeMatch = content.substring(Math.max(0, startPos - 10), startPos);
			const afterMatch = content.substring(endPos, endPos + 2);

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

			if (!footnoteReferences.has(number)) {
				footnoteReferences.set(number, []);
			}
			footnoteReferences.get(number)!.push(reference);
		}

		// Separate referenced and unreferenced footnotes
		const referencedFootnotes: FootnoteData[] = [];
		const unreferencedFootnotes: FootnoteData[] = [];

		footnoteDefinitions.forEach((definition, number) => {
			const references = footnoteReferences.get(number) || [];
			const footnoteData: FootnoteData = {
				number,
				content: definition.content,
				definition,
				references,
				referenceCount: references.length,
				isUnreferenced: references.length === 0
			};

			if (references.length === 0) {
				unreferencedFootnotes.push(footnoteData);
			} else {
				referencedFootnotes.push(footnoteData);
			}
		});

		this.debug('Extracted footnotes:', {
			referenced: referencedFootnotes.length,
			unreferenced: unreferencedFootnotes.length
		});

		return { referencedFootnotes, unreferencedFootnotes };
	}

	// Keep the original method for backward compatibility
	extractFootnotes(content: string): FootnoteData[] {
		const { referencedFootnotes, unreferencedFootnotes } = this.extractFootnotesWithUnreferenced(content);
		return [...referencedFootnotes, ...unreferencedFootnotes];
	}

	// NEW: Method to find orphaned references (references without definitions)
	findOrphanedReferences(content: string): OrphanedReference[] {
		const footnoteDefinitions = new Set < string > ();
		const orphanedReferences: OrphanedReference[] = [];

		// First pass: collect all footnote definition numbers
		const definitionRegex = /^\[\^([\w-]+)\]:\s*(.*)$/gm;
		let match;
		while ((match = definitionRegex.exec(content)) !== null) {
			footnoteDefinitions.add(match[1]);
		}

		// Second pass: find references without definitions
		const referenceRegex = /\[\^([\w-]+)\]/g;
		while ((match = referenceRegex.exec(content)) !== null) {
			const number = match[1];
			const startPos = match.index;
			const endPos = match.index + match[0].length;

			// Skip if this is actually a definition
			const beforeMatch = content.substring(Math.max(0, startPos - 10), startPos);
			const afterMatch = content.substring(endPos, endPos + 2);
			const lineStart = beforeMatch.lastIndexOf('\n');
			const textBeforeOnLine = lineStart >= 0 ? beforeMatch.substring(lineStart + 1) : beforeMatch;

			if (textBeforeOnLine.trim() === '' && afterMatch.startsWith(':')) {
				continue;
			}

			// Check if this reference has no corresponding definition
			if (!footnoteDefinitions.has(number)) {
				const beforeReference = content.substring(0, startPos);
				const line = (beforeReference.match(/\n/g) || []).length;

				orphanedReferences.push({
					number,
					line,
					startPos,
					endPos,
					fullMatch: match[0]
				});
			}
		}

		return orphanedReferences;
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
		
		// NEW: Track which sections each footnote appears in
		const footnoteSectionMap = new Map<string, Set<HeaderData | null>>();

		footnotes.forEach(footnote => {
			// Process each reference to determine which sections it belongs to
			footnote.references.forEach(ref => {
				let nearestHeader: HeaderData | null = null;

				for (let i = sortedHeaders.length - 1; i >= 0; i--) {
					if (sortedHeaders[i].line < ref.line) {
						nearestHeader = sortedHeaders[i];
						break;
					}
				}

				// Track which sections this footnote appears in
				if (!footnoteSectionMap.has(footnote.number)) {
					footnoteSectionMap.set(footnote.number, new Set());
				}
				footnoteSectionMap.get(footnote.number)!.add(nearestHeader);
			});
		});

		// NEW: Mark footnotes that appear in multiple sections and set appearance count
		footnotes.forEach(footnote => {
			const sections = footnoteSectionMap.get(footnote.number);
			if (sections) {
				footnote.appearanceCount = sections.size;
				footnote.isMultiSection = sections.size > 1;
			}
		});

		// NEW: Create footnote copies for each section they appear in
		footnotes.forEach(footnote => {
			const sections = footnoteSectionMap.get(footnote.number);
			if (!sections) return;

			sections.forEach(nearestHeader => {
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

				// Create a copy of the footnote for this section
				const footnoteForSection: FootnoteData = {
					...footnote,
					// Filter references to only include those in this section
					references: footnote.references.filter(ref => {
						let refHeader: HeaderData | null = null;
						for (let i = sortedHeaders.length - 1; i >= 0; i--) {
							if (sortedHeaders[i].line < ref.line) {
								refHeader = sortedHeaders[i];
								break;
							}
						}
						return (refHeader === null && nearestHeader === null) ||
							   (refHeader !== null && nearestHeader !== null && refHeader.line === nearestHeader.line);
					})
				};

				group.footnotes.push(footnoteForSection);
			});
		});

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
		const footnoteGroupsByHeaderLine = new Map < number,
			FootnoteGroup > ();
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

		this.app.workspace.getLeaf().openFile(file).then(() => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return;

			const editor = activeView.editor;
			const content = editor.getValue();
			const { referencedFootnotes } = this.extractFootnotesWithUnreferenced(content);

			const match = referencedFootnotes.find(f => f.number === footnote.number);
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
			editor.scrollIntoView({
					from: cursorPos,
					to: cursorPos
				},
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

			editor.setCursor({
				line: match.line,
				ch: 0
			});
			editor.scrollIntoView({
				from: {
					line: match.line,
					ch: 0
				},
				to: {
					line: match.line,
					ch: 0
				}
			}, true);
		});
	}

	// NEW: Enhanced renumberFootnotes method
	renumberFootnotes() {
		this.debug('renumberFootnotes called');
	
		let activeEditor: Editor | null = null;
		let targetFile: TFile | null = null;

		this.debug('Getting file from footnotes view');

		const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
		if (footnoteLeaves.length > 0) {
			const footnoteView = footnoteLeaves[0].view as FootnotesView;
			targetFile = (footnoteView as any).currentFile;
			this.debug('Got target file from footnotes view:', !!targetFile);
		}

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

		if (!activeEditor || typeof activeEditor.getValue !== 'function') {
			this.debug('Editor is invalid or missing getValue method');
			new Notice('Unable to access editor');
			return;
		}

		try {
			const content = activeEditor.getValue();
			
			// NEW: Check for both gaps and orphaned references
			const { referencedFootnotes } = this.extractFootnotesWithUnreferenced(content);
			const orphanedRefs = this.findOrphanedReferences(content);
		
			if (referencedFootnotes.length === 0 && orphanedRefs.length === 0) {
				new Notice('No footnotes found to renumber');
				return;
			}

			// Check for gaps in referenced footnotes
			const sortedNumbers = referencedFootnotes.map(f => parseInt(f.number)).filter(n => !isNaN(n)).sort((a, b) => a - b);
			const gaps: string[] = [];
		
			if (sortedNumbers.length > 0) {
				for (let i = 1; i < sortedNumbers[sortedNumbers.length - 1]; i++) {
					if (!sortedNumbers.includes(i)) {
						gaps.push(i.toString());
					}
				}
			}

			// Show enhanced confirmation modal
			new EnhancedRenumberConfirmationModal(
				this.app, 
				this, 
				gaps, 
				orphanedRefs,
				(removeOrphaned: boolean, fillGaps: boolean) => {
					this.performEnhancedRenumbering(activeEditor!, referencedFootnotes, orphanedRefs, removeOrphaned, fillGaps);
				}
			).open();
		
		} catch (error) {
			this.debug('Error in renumberFootnotes:', error);
			new Notice('Error accessing document: ' + error.message);
		}
	}

	// NEW: Enhanced renumbering method
	private performEnhancedRenumbering(
		editor: Editor, 
		footnotes: FootnoteData[], 
		orphanedRefs: OrphanedReference[],
		removeOrphaned: boolean,
		fillGaps: boolean
	) {
		let content = editor.getValue();

		// Step 1: Remove orphaned references if requested
		if (removeOrphaned && orphanedRefs.length > 0) {
			// Sort by position (descending) to maintain positions during deletion
			const sortedOrphaned = [...orphanedRefs].sort((a, b) => b.startPos - a.startPos);
			
			sortedOrphaned.forEach(ref => {
				const before = content.substring(0, ref.startPos);
				const after = content.substring(ref.endPos);
				content = before + after;
			});

			// Clean up any double spaces left behind
			content = content.replace(/  +/g, ' ');
			
			new Notice(`Removed ${orphanedRefs.length} orphaned reference(s)`);
		}

		// Step 2: Fill gaps if requested
		if (fillGaps && footnotes.length > 0) {
			// Re-extract footnotes from the updated content (in case orphaned refs were removed)
			const { referencedFootnotes: updatedFootnotes } = this.extractFootnotesWithUnreferenced(content);
			
			// Sort footnotes by their first reference position to maintain order
			const sortedFootnotes = [...updatedFootnotes].sort((a, b) => {
				const aFirstRef = a.references[0];
				const bFirstRef = b.references[0];
				if (!aFirstRef || !bFirstRef) return 0;
				return aFirstRef.startPos - bFirstRef.startPos;
			});

			// Create mapping from old numbers to new numbers
			const numberMapping = new Map < string, string > ();
			sortedFootnotes.forEach((footnote, index) => {
				numberMapping.set(footnote.number, (index + 1).toString());
			});

			// Replace all references and definitions (work backwards to maintain positions)
			const allReplacements: Array < {
				startPos: number,
				endPos: number,
				newText: string
			} > = [];

			// Collect all replacements
			updatedFootnotes.forEach(footnote => {
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

			new Notice(`Footnotes renumbered successfully`);
		}

		// Apply the final content
		editor.setValue(content);
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
		const {
			containerEl
		} = this;

		containerEl.empty();

		containerEl.createEl('h2', {
			text: 'Footnotes Manager Settings'
		});

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
		const instructionsEl = containerEl.createEl('div', {
			cls: 'footnotes-instructions'
		});
		instructionsEl.createEl('h3', {
			text: 'How to use Footnotes Manager:'
		});
		const instructionsList = instructionsEl.createEl('ol');
		instructionsList.createEl('li', {
			text: 'Click the hash (⌗) icon in the ribbon or use the command palette to toggle the footnotes panel'
		});
		instructionsList.createEl('li', {
			text: 'Switch between outline view (grouped by headers) and list view using the view toggle button'
		});
		instructionsList.createEl('li', {
			text: 'Click on footnote content to edit it inline (referenced footnotes only)'
		});
		instructionsList.createEl('li', {
			text: 'Use the reference buttons to jump to specific footnote references in the text'
		});
		instructionsList.createEl('li', {
			text: 'Delete footnotes safely - unreferenced footnotes delete only the definition'
		});
		instructionsList.createEl('li', {
			text: 'Use the enhanced renumber button to remove orphaned references and fill gaps'
		});
		instructionsList.createEl('li', {
			text: 'Unreferenced footnotes appear in a special "Unreferenced" section in outline view'
		});
	}
}