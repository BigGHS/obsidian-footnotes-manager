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
	isUnreferenced ? : boolean; // NEW: Track unreferenced footnotes
	isMultiSection ? : boolean; // NEW: Track footnotes that appear in multiple sections
	appearanceCount ? : number; // NEW: Track how many sections this footnote appears in
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
	isUnreferencedGroup ? : boolean; // NEW: Mark unreferenced group
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

// Interface for renumber options
interface RenumberOptions {
	fixGaps: boolean;
	removeUnreferenced: boolean;
}

// NEW: Enhanced Renumber Confirmation Modal
class EnhancedRenumberConfirmationModal extends Modal {
	plugin: FootnotesManagerPlugin;
	onConfirm: (options: RenumberOptions) => void;
	gaps: string[];
	unreferencedFootnotes: FootnoteData[];

	// Checkbox states
	private fixGapsCheckbox: HTMLInputElement | null = null;
	private removeUnreferencedCheckbox: HTMLInputElement | null = null;

	constructor(
		app: App,
		plugin: FootnotesManagerPlugin,
		gaps: string[],
		unreferencedFootnotes: FootnoteData[],
		onConfirm: (options: RenumberOptions) => void
	) {
		super(app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
		this.gaps = gaps;
		this.unreferencedFootnotes = unreferencedFootnotes;
	}

	onOpen() {
		const {
			contentEl
		} = this;
		contentEl.empty();

		// Title
		contentEl.createEl('h2', {
			text: 'Footnote Management Options'
		});

		// Description
		const desc = contentEl.createEl('p', {
			cls: 'renumber-description'
		});

		let descriptionText = 'The following issues were detected in your footnotes:';
		contentEl.createEl('p', {
			text: descriptionText
		});

		// Issues container
		const issuesContainer = contentEl.createEl('div', {
			cls: 'renumber-issues-container'
		});

		let hasIssues = false;

		// Condition 1: Number gaps
		if (this.gaps.length > 0) {
			hasIssues = true;
			const gapsSection = issuesContainer.createEl('div', {
				cls: 'renumber-issue-section'
			});

			const gapsCheckboxContainer = gapsSection.createEl('label', {
				cls: 'renumber-checkbox-container'
			});

			this.fixGapsCheckbox = gapsCheckboxContainer.createEl('input', {
				type: 'checkbox',
				cls: 'renumber-checkbox'
			});
			this.fixGapsCheckbox.checked = true; // Default to checked

			const gapsLabel = gapsCheckboxContainer.createEl('span', {
				text: `Fix numbering gaps: ${this.gaps.join(', ')}`,
				cls: 'renumber-checkbox-label'
			});

			const gapsDetail = gapsSection.createEl('p', {
				text: 'This will renumber all footnotes sequentially to remove gaps.',
				cls: 'renumber-issue-detail'
			});
		}

		// Condition 2: Unreferenced footnotes
		if (this.unreferencedFootnotes.length > 0) {
			hasIssues = true;
			const unreferencedSection = issuesContainer.createEl('div', {
				cls: 'renumber-issue-section'
			});

			const unreferencedCheckboxContainer = unreferencedSection.createEl('label', {
				cls: 'renumber-checkbox-container'
			});

			this.removeUnreferencedCheckbox = unreferencedCheckboxContainer.createEl('input', {
				type: 'checkbox',
				cls: 'renumber-checkbox'
			});
			this.removeUnreferencedCheckbox.checked = false; // Default to unchecked for safety

			const unreferencedNumbers = this.unreferencedFootnotes.map(f => f.number).join(', ');
			const unreferencedLabel = unreferencedCheckboxContainer.createEl('span', {
				text: `Remove unreferenced footnotes: [${unreferencedNumbers}]`,
				cls: 'renumber-checkbox-label'
			});

			const unreferencedDetail = unreferencedSection.createEl('p', {
				text: 'This will permanently delete footnote definitions that are not referenced in the text.',
				cls: 'renumber-issue-detail renumber-warning-text'
			});
		}

		if (!hasIssues) {
			contentEl.createEl('p', {
				text: 'No footnote issues found.',
				cls: 'renumber-no-issues'
			});

			const closeBtn = contentEl.createEl('button', {
				text: 'Close',
				cls: 'renumber-close-btn'
			});

			closeBtn.onclick = () => {
				this.close();
			};
			return;
		}

		// Warning
		const warning = contentEl.createEl('p', {
			cls: 'renumber-warning'
		});
		warning.innerHTML = '<strong>Warning:</strong> These actions cannot be undone. Please review your selections carefully.';

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

		// Button handlers
		confirmBtn.onclick = () => {
			const options: RenumberOptions = {
				fixGaps: this.fixGapsCheckbox?.checked || false,
				removeUnreferenced: this.removeUnreferencedCheckbox?.checked || false
			};

			// Validate that at least one option is selected
			if (!options.fixGaps && !options.removeUnreferenced) {
				// Show error message
				const existingError = contentEl.querySelector('.renumber-error');
				if (existingError) {
					existingError.remove();
				}

				const errorMsg = buttonContainer.createEl('p', {
					text: 'Please select at least one option to apply.',
					cls: 'renumber-error'
				});
				errorMsg.style.color = 'var(--text-error)';
				errorMsg.style.marginTop = '8px';
				return;
			}

			this.onConfirm(options);
			this.close();
		};

		cancelBtn.onclick = () => {
			this.close();
		};

		// Enable/disable confirm button based on selections
		const updateConfirmButton = () => {
			const hasSelection = (this.fixGapsCheckbox?.checked || false) ||
				(this.removeUnreferencedCheckbox?.checked || false);
			confirmBtn.disabled = !hasSelection;

			if (hasSelection) {
				confirmBtn.removeClass('disabled');
			} else {
				confirmBtn.addClass('disabled');
			}
		};

		// Add event listeners for checkboxes
		if (this.fixGapsCheckbox) {
			this.fixGapsCheckbox.addEventListener('change', updateConfirmButton);
		}
		if (this.removeUnreferencedCheckbox) {
			this.removeUnreferencedCheckbox.addEventListener('change', updateConfirmButton);
		}

		// Initial button state
		updateConfirmButton();
	}

	onClose() {
		const {
			contentEl
		} = this;
		contentEl.empty();
	}
}

// FootnotesView Class - Beginning
class FootnotesView extends ItemView {
	plugin: FootnotesManagerPlugin;
	private currentFile: TFile | null = null;
	private renderedGroups: RenderedGroup[] = [];
	private isCollapsed: boolean = false;
	private hasManualExpansions: boolean = false;
	private isNavigating: boolean = false;
	private pendingNavigation: string | null = null;
	private isListView: boolean = false;
	private cursorListener ? : () => void;
	private lastCursorCheck: number = 0;
	private cursorThrottleDelay: number = 300;
	private isProcessingCursor: boolean = false;
	private jumpingToFootnote: string | null = null;
	private lastJumpTime: number = 0;
	private jumpThrottleDelay: number = 500;
	private lastCheckedFootnote: string | null = null;
	private cursorCheckInProgress: boolean = false;

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
		// Clean up cursor listener
		this.removeCursorListener();
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

		const header = container.createEl('div', {
			cls: 'footnotes-header'
		});
		const titleRow = header.createEl('div', {
			cls: 'footnotes-title-row'
		});
		titleRow.createEl('h4', {
			text: 'Footnotes',
			cls: 'footnotes-title'
		});

		const controlsContainer = titleRow.createEl('div', {
			cls: 'footnotes-controls'
		});

		const navBtn = controlsContainer.createEl('button', {
			cls: 'footnotes-control-btn nav-btn',
			attr: {
				title: 'Jump to footnotes section'
			}
		});
		setIcon(navBtn, 'footprints');

		const returnBtn = controlsContainer.createEl('button', {
			cls: 'footnotes-control-btn return-btn',
			attr: {
				title: 'Return to last edit position'
			}
		});
		setIcon(returnBtn, 'file-text');

		const renumberBtn = controlsContainer.createEl('button', {
			cls: 'footnotes-control-btn renumber-btn',
			attr: {
				title: 'Renumber footnotes (remove gaps)'
			}
		});
		setIcon(renumberBtn, 'list-ordered');

		const listViewBtn = controlsContainer.createEl('button', {
			cls: 'footnotes-control-btn list-view-btn',
			attr: {
				title: 'Toggle between outline and list view'
			}
		});
		setIcon(listViewBtn, this.isListView ? 'list' : 'list-tree');

		let toggleAllBtn: HTMLButtonElement | undefined;
		if (!this.isListView) {
			toggleAllBtn = controlsContainer.createEl('button', {
				cls: 'footnotes-toggle-btn',
				attr: {
					title: 'Toggle collapse/expand all sections'
				}
			});
			setIcon(toggleAllBtn, this.isCollapsed ? 'plus' : 'minus');
		}

		const searchContainer = header.createEl('div', {
			cls: 'footnotes-search-container'
		});
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
			attr: {
				title: 'Clear search'
			}
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
		toggleBtn ? : HTMLButtonElement,
		navBtn ? : HTMLButtonElement,
		returnBtn ? : HTMLButtonElement,
		renumberBtn ? : HTMLButtonElement,
		searchInput ? : HTMLInputElement,
		listViewBtn ? : HTMLButtonElement
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
		toggleBtn ? : HTMLButtonElement,
		toggleIcon ? : HTMLElement,
		searchInput ? : HTMLInputElement,
		clearSearchBtn ? : HTMLButtonElement,
		navBtn ? : HTMLButtonElement,
		returnBtn ? : HTMLButtonElement,
		renumberBtn ? : HTMLButtonElement,
		listViewBtn ? : HTMLButtonElement
	) {
		this.debug('Processing footnotes for content of length:', content.length, 'isListView:', this.isListView);

		const currentStates = new Map < string,
			boolean > ();
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

		// Set up search functionality for BOTH view modes
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
			cls: 'footnote-header'
		});

		// Add special styling for unreferenced group
		if (group.header && group.header.line === -1) {
			headerEl.addClass('footnote-unreferenced-header');
		}

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

		// Handle click events for headers (skip for unreferenced group since it's virtual)
		if (group.header && group.header.line !== -1) {
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

	// UPDATED: createFootnoteElement with fixed click behavior
	private createFootnoteElement(footnote: FootnoteData, container: Element) {
		const footnoteEl = container.createEl('div', {
			cls: 'footnote-item'
		});

		// NEW: Add unreferenced class if applicable
		if (footnote.isUnreferenced) {
			footnoteEl.addClass('footnote-unreferenced');
		}

		// Footnote number and reference count/status
		const headerEl = footnoteEl.createEl('div', {
			cls: 'footnote-header-info'
		});

		const numberContainer = headerEl.createEl('div', {
			cls: 'footnote-number-container'
		});
		const numberEl = numberContainer.createEl('span', {
			cls: 'footnote-number',
			text: `[${footnote.number}]`
		});

		// NEW: Add copy icon for multi-section footnotes
		if (footnote.isMultiSection) {
			const copyIcon = numberContainer.createEl('span', {
				cls: 'footnote-multi-section-icon',
				attr: {
					title: `This footnote appears in ${footnote.appearanceCount} sections`
				}
			});
			setIcon(copyIcon, 'copy');
		}

		// NEW: Show "Unreferenced" instead of reference count for unreferenced footnotes
		const countEl = headerEl.createEl('span', {
			cls: footnote.isUnreferenced ? 'footnote-unreferenced-indicator' : 'footnote-ref-count',
			text: footnote.isUnreferenced ? 'Unreferenced' : `${footnote.referenceCount} ref${footnote.referenceCount !== 1 ? 's' : ''}`
		});

		const contentEl = footnoteEl.createEl('div', {
			cls: 'footnote-content'
		});

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
				attr: {
					contenteditable: 'true',
					spellcheck: 'false'
				}
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
			const referencesEl = contentEl.createEl('div', {
				cls: 'footnote-references'
			});
			referencesEl.createEl('span', {
				cls: 'footnote-references-label',
				text: 'References:'
			});

			footnote.references.forEach((ref, index) => {
				const refEl = referencesEl.createEl('button', {
					cls: 'footnote-reference-btn',
					text: `Line ${ref.line + 1}`,
					attr: {
						title: `Go to reference ${index + 1} on line ${ref.line + 1}`
					}
				});

				refEl.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();

					this.debug('Reference button clicked for footnote:', footnote.number, 'index:', index);

					// Ensure we have the current file reference
					this.debug('Refreshing current file reference before navigation');
					const activeFile = this.app.workspace.getActiveFile();
					if (activeFile) {
						this.currentFile = activeFile;
						this.debug('Updated currentFile to active file:', activeFile.path);
					}

					// Set a focused skip period to prevent interference
					this.plugin.setSkipRefreshPeriod(1500);

					// Call the navigation method directly without any delays
					this.plugin.highlightFootnoteInEditor(footnote, index);
				});
			});
		}

		// Action buttons container
		const actionsEl = footnoteEl.createEl('div', {
			cls: 'footnote-actions'
		});

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
			attr: {
				title: 'Delete footnote'
			}
		});
		deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"/></svg>`;

		// FIXED: Add specific click handler for footnote number to jump to definition
		numberEl.addEventListener('click', (e) => {
			this.debug('Footnote number clicked, jumping to definition');
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

			// FIXED: Click to edit functionality - only for footnote content display
			displayEl.addEventListener('click', (e) => {
				this.debug('Footnote content clicked, entering edit mode');
				e.preventDefault();
				e.stopPropagation();
				enterEditMode();
			});

			// FIXED: Remove general click handler that was jumping to definition
			// The footnote element no longer has a general click handler that jumps to definition
			// Only the footnote number and reference buttons will jump to the main text
		} else {
			// NEW: For unreferenced footnotes, only footnote number allows navigation to definition
			// No general click handler on the footnote element
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
		const {
			referencedFootnotes
		} = this.plugin.extractFootnotesWithUnreferenced(currentContent);

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

		const {
			referencedFootnotes
		} = this.plugin.extractFootnotesWithUnreferenced(currentContent);
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
	extractFootnotesWithUnreferenced(content: string): {
		referencedFootnotes: FootnoteData[],
		unreferencedFootnotes: FootnoteData[]
	} {
		const footnoteDefinitions = new Map < string,
			FootnoteDefinition > ();
		const footnoteReferences = new Map < string,
			FootnoteReference[] > ();

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
			footnoteReferences.get(number) !.push(reference);
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

		return {
			referencedFootnotes,
			unreferencedFootnotes
		};
	}

	// Keep the original method for backward compatibility
	extractFootnotes(content: string): FootnoteData[] {
		const {
			referencedFootnotes,
			unreferencedFootnotes
		} = this.extractFootnotesWithUnreferenced(content);
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

		// Separate referenced and unreferenced footnotes
		const referencedFootnotes = footnotes.filter(f => f.references.length > 0);
		const unreferencedFootnotes = footnotes.filter(f => f.references.length === 0);

		// Process referenced footnotes (existing logic)
		referencedFootnotes.forEach(footnote => {
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

		// Add unreferenced footnotes to a special "Unreferenced" group
		if (unreferencedFootnotes.length > 0) {
			const unreferencedGroup: FootnoteGroup = {
				header: {
					text: "Unreferenced Footnotes",
					level: 1, // Make it a top-level heading
					line: -1 // Special line number to indicate it's virtual
				},
				footnotes: unreferencedFootnotes
			};
			groups.push(unreferencedGroup);
		}

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

		// Sort groups by header line (unreferenced group goes last)
		groups.sort((a, b) => {
			if (a.header === null && b.header === null) return 0;
			if (a.header === null) return -1;
			if (b.header === null) return 1;

			// Put unreferenced group at the end
			if (a.header.line === -1) return 1;
			if (b.header.line === -1) return -1;

			return a.header.line - b.header.line;
		});

		return this.buildHierarchicalGroups(groups);
	}

	private buildHierarchicalGroups(flatGroups: FootnoteGroup[]): FootnoteGroup[] {
		const footnoteGroupsByHeaderLine = new Map < number,
			FootnoteGroup > ();
		let noHeaderGroup: FootnoteGroup | null = null;
		let unreferencedGroup: FootnoteGroup | null = null;

		flatGroups.forEach((group: FootnoteGroup) => {
			if (group.header) {
				if (group.header.line === -1) {
					// This is the unreferenced group
					unreferencedGroup = group;
				} else {
					footnoteGroupsByHeaderLine.set(group.header.line, group);
				}
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

		// Add unreferenced group at the end
		if (unreferencedGroup) {
			allGroups.push(unreferencedGroup);
		}

		const result: FootnoteGroup[] = [];
		const stack: FootnoteGroup[] = [];

		for (const group of allGroups) {
			if (!group.header) {
				result.push(group);
				continue;
			}

			// Handle the special unreferenced group
			if (group.header.line === -1) {
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
		this.debug('=== highlightFootnoteInEditor START ===');
		this.debug('footnote:', footnote.number, 'referenceIndex:', referenceIndex);

		// Get the file that the footnotes panel is currently showing
		const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
		let targetFile: TFile | null = null;

		this.debug('Found footnote leaves:', footnoteLeaves.length);

		if (footnoteLeaves.length > 0) {
			const footnoteView = footnoteLeaves[0].view as FootnotesView;
			targetFile = (footnoteView as any).currentFile;
			this.debug('Panel currentFile:', targetFile?.path);
		}

		// Fallback to active file if panel doesn't have a file
		if (!targetFile) {
			targetFile = this.app.workspace.getActiveFile();
			this.debug('Fallback to active file:', targetFile?.path);
		}

		if (!targetFile) {
			new Notice('No active markdown file found');
			this.debug('No target file found');
			return;
		}

		this.debug('Final target file:', targetFile.path);

		// Find the editor for this file
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		this.debug('Searching through', leaves.length, 'markdown leaves');

		let targetEditor: Editor | null = null;
		let targetLeaf: WorkspaceLeaf | null = null;

		for (const leaf of leaves) {
			const view = leaf.view as MarkdownView;
			this.debug('Checking leaf with file:', view.file?.path);

			if (view.file === targetFile) {
				targetEditor = view.editor;
				targetLeaf = leaf;
				this.debug('FOUND matching editor for:', targetFile.path);
				break;
			}
		}

		if (!targetEditor || !targetLeaf) {
			new Notice('Could not find editor for footnote navigation');
			this.debug('No matching editor found');
			return;
		}

		// Make sure the target leaf is active (this prevents focus issues)
		this.app.workspace.setActiveLeaf(targetLeaf);
		this.debug('Making target leaf active');

		// Get current content and extract footnotes
		const content = targetEditor.getValue();
		this.debug('Got content, length:', content.length);

		const footnotes = this.extractFootnotes(content);
		this.debug('Extracted footnotes count:', footnotes.length);

		const match = footnotes.find(f => f.number === footnote.number);
		if (!match) {
			new Notice(`Footnote [${footnote.number}] not found in current document`);
			this.debug('Footnote not found in extracted footnotes');
			return;
		}

		this.debug('Found footnote, references count:', match.references.length);

		if (!match.references[referenceIndex]) {
			new Notice(`Reference ${referenceIndex + 1} not found for footnote [${footnote.number}]`);
			this.debug('Reference index out of bounds');
			return;
		}

		const reference = match.references[referenceIndex];
		this.debug('Using reference:', reference);

		// Calculate cursor position more accurately
		const beforeReference = content.substring(0, reference.startPos);
		const startLine = (beforeReference.match(/\n/g) || []).length;
		const lastNewlinePos = beforeReference.lastIndexOf('\n');
		const referenceStartInLine = lastNewlinePos === -1 ? reference.startPos : reference.startPos - lastNewlinePos - 1;

		const cursorPos = {
			line: startLine,
			ch: referenceStartInLine
		};

		this.debug('Calculated cursor position:', cursorPos);

		// Set cursor and scroll
		this.debug('Setting cursor...');
		targetEditor.setCursor(cursorPos);

		this.debug('Scrolling into view...');
		targetEditor.scrollIntoView({
			from: cursorPos,
			to: cursorPos
		}, true);

		this.debug('Focusing editor...');
		targetEditor.focus();

		// FIXED: Always show the success notice immediately
		const referenceNumber = referenceIndex + 1;
		const totalReferences = match.references.length;
		new Notice(`Jumped to footnote [${footnote.number}] reference ${referenceNumber}/${totalReferences} on line ${startLine + 1}`);

		this.debug('Navigation completed successfully');
		this.debug('=== highlightFootnoteInEditor END ===');
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

		// Get editor (existing logic)
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
			const footnotes = this.extractFootnotes(content);

			if (footnotes.length === 0) {
				new Notice('No footnotes found to process');
				return;
			}

			// Check for gaps in numbering
			const referencedFootnotes = footnotes.filter(f => f.references.length > 0);
			const sortedNumbers = referencedFootnotes.map(f => parseInt(f.number)).filter(n => !isNaN(n)).sort((a, b) => a - b);
			const gaps: string[] = [];

			for (let i = 1; i < sortedNumbers[sortedNumbers.length - 1]; i++) {
				if (!sortedNumbers.includes(i)) {
					gaps.push(i.toString());
				}
			}

			// Check for unreferenced footnotes
			const unreferencedFootnotes = footnotes.filter(f => f.references.length === 0);

			// If no issues found
			if (gaps.length === 0 && unreferencedFootnotes.length === 0) {
				new Notice('No footnote issues found - numbering is sequential and all footnotes are referenced');
				return;
			}

			// Show enhanced confirmation modal
			new EnhancedRenumberConfirmationModal(
				this.app,
				this,
				gaps,
				unreferencedFootnotes,
				(options: RenumberOptions) => {
					this.performEnhancedRenumbering(activeEditor!, footnotes, options);
				}
			).open();

		} catch (error) {
			this.debug('Error in renumberFootnotes:', error);
			new Notice('Error accessing document: ' + error.message);
		}
	}

	private performEnhancedRenumbering(editor: Editor, footnotes: FootnoteData[], options: RenumberOptions) {
		let content = editor.getValue();
		let processedFootnotes = [...footnotes];

		// Step 1: Remove unreferenced footnotes if requested
		if (options.removeUnreferenced) {
			const unreferencedFootnotes = processedFootnotes.filter(f => f.references.length === 0);

			// Sort by position (descending) to maintain positions during deletion
			const sortedForDeletion = unreferencedFootnotes.sort((a, b) => b.definition.startPos - a.definition.startPos);

			// Remove unreferenced footnote definitions
			sortedForDeletion.forEach(footnote => {
				const before = content.substring(0, footnote.definition.startPos);
				const after = content.substring(footnote.definition.endPos);
				content = before + after;

				// Adjust positions of remaining footnotes
				const positionChange = footnote.definition.endPos - footnote.definition.startPos;
				processedFootnotes.forEach(remaining => {
					if (remaining.definition.startPos > footnote.definition.startPos) {
						remaining.definition.startPos -= positionChange;
						remaining.definition.endPos -= positionChange;
					}
					remaining.references.forEach(ref => {
						if (ref.startPos > footnote.definition.startPos) {
							ref.startPos -= positionChange;
							ref.endPos -= positionChange;
						}
					});
				});
			});

			// Remove unreferenced footnotes from our working set
			processedFootnotes = processedFootnotes.filter(f => f.references.length > 0);

			// Update the content for further processing
			editor.setValue(content);
			content = editor.getValue();

			// Re-extract footnotes to get accurate positions after deletion
			processedFootnotes = this.extractFootnotes(content);
		}

		// Step 2: Fix gaps if requested
		if (options.fixGaps && processedFootnotes.length > 0) {
			// Sort footnotes by their first reference position to maintain order
			const sortedFootnotes = [...processedFootnotes].sort((a, b) => {
				const aFirstRef = a.references[0];
				const bFirstRef = b.references[0];
				if (!aFirstRef || !bFirstRef) return 0;
				return aFirstRef.startPos - bFirstRef.startPos;
			});

			// Create mapping from old numbers to new numbers
			const numberMapping = new Map < string,
				string > ();
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
			processedFootnotes.forEach(footnote => {
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
		}

		// Provide feedback
		let message = 'Footnote processing completed:';
		const actions: string[] = [];

		if (options.removeUnreferenced) {
			const unreferencedCount = footnotes.filter(f => f.references.length === 0).length;
			actions.push(`${unreferencedCount} unreferenced footnote(s) removed`);
		}

		if (options.fixGaps) {
			actions.push('footnote numbering gaps fixed');
		}

		if (actions.length > 0) {
			message += ' ' + actions.join(', ');
		}

		new Notice(message);
		this.refreshFootnotesView();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private handleCursorPositionChange(editor: Editor) {
		this.debug('handleCursorPositionChange called');

		if (this.cursorCheckTimeout) {
			window.clearTimeout(this.cursorCheckTimeout);
		}

		this.cursorCheckTimeout = window.setTimeout(() => {
			this.checkCursorInFootnoteReference();
		}, 200);
	}

	public checkCursorInFootnoteReference() {
		this.debug('checkCursorInFootnoteReference called');

		if (this.cursorCheckInProgress) {
			this.debug('Cursor check already in progress, skipping');
			return;
		}

		this.cursorCheckInProgress = true;

		try {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) {
				this.debug('No active markdown view found');
				return;
			}

			const editor = activeView.editor;
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);

			this.debug('Cursor position:', cursor, 'Line content:', line, 'Cursor ch:', cursor.ch);

			const footnoteRegex = /\[\^([\w-]+)\]/g;
			let match;
			let currentFootnote: string | null = null;

			while ((match = footnoteRegex.exec(line)) !== null) {
				const startPos = match.index;
				const endPos = match.index + match[0].length;

				this.debug('Found footnote reference:', match[0], 'at positions', startPos, '-', endPos);

				if (cursor.ch >= startPos && cursor.ch <= endPos) {
					currentFootnote = match[1];
					this.debug('Cursor is within footnote reference:', currentFootnote);
					break;
				}
			}

			if (currentFootnote && currentFootnote !== this.lastCheckedFootnote) {
				this.debug('jumpToFootnoteInPanel called for footnote:', currentFootnote);
				this.lastCheckedFootnote = currentFootnote;

				const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
				this.debug('Found footnote view leaves:', footnoteLeaves.length);

				if (footnoteLeaves.length > 0) {
					const footnoteView = footnoteLeaves[0].view as FootnotesView;
					footnoteView.jumpToFootnote(currentFootnote);
				}
			} else if (!currentFootnote) {
				this.debug('No footnote reference found at cursor position');
				this.lastCheckedFootnote = null;
			}
		} finally {
			setTimeout(() => {
				this.cursorCheckInProgress = false;
			}, 50);
		}
	}

	private jumpToFootnoteInPanel(footnoteNumber: string) {
		this.debug('jumpToFootnoteInPanel called for footnote:', footnoteNumber);

		const leaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
		this.debug('Found footnote view leaves:', leaves.length);

		if (leaves.length === 0) return;

		const footnoteView = leaves[0].view as FootnotesView;
		footnoteView.jumpToFootnote(footnoteNumber);
	}

	private setupCursorListener() {
		this.debug('Setting up cursor listener');

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			this.debug('No active markdown view found');
			return;
		}

		const editor = activeView.editor;
		const editorEl = (editor as any).cm?.dom || (editor as any).containerEl;

		if (!editorEl) {
			this.debug('Could not find editor element');
			return;
		}

		this.debug('Found editor element, adding click and keyup listeners');

		// Remove existing listeners to prevent duplicates
		editorEl.removeEventListener('click', this.handleCursorEvent);
		editorEl.removeEventListener('keyup', this.handleCursorEvent);

		// Add new listeners
		editorEl.addEventListener('click', this.handleCursorEvent);
		editorEl.addEventListener('keyup', this.handleCursorEvent);
	}

	private handleCursorEvent = () => {
		this.debug('Cursor event triggered');

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		this.handleCursorPositionChange(activeView.editor);
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
} // ADD: New method to filter and render list view with search
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
		NodeFilter.SHOW_TEXT, {
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

// ADD this new method to FootnotesView class
private refreshCurrentFileReference() {
	this.debug('Refreshing current file reference before navigation');

	// Update currentFile to the most recent active file
	const activeFile = this.app.workspace.getActiveFile();
	const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

	if (activeView && activeView.file) {
		this.currentFile = activeView.file;
		this.debug('Updated currentFile to active view file:', this.currentFile?.path);
	} else if (activeFile) {
		this.currentFile = activeFile;
		this.debug('Updated currentFile to active file:', this.currentFile?.path);
	}
}

private expandSectionContaining(footnoteElement: HTMLElement) {
	this.debug('Expanding section containing footnote');

	// Find the parent group section
	let currentElement: HTMLElement | null = footnoteElement;

	while (currentElement && currentElement !== this.containerEl) {
		// Look for footnote group content containers
		if (currentElement.classList.contains('footnote-group-content')) {
			// Check if this section is collapsed
			if (currentElement.style.display === 'none') {
				this.debug('Found collapsed section, expanding it');

				// Show the content
				currentElement.style.display = 'block';

				// Find the corresponding collapse icon and update it
				const headerSection = currentElement.parentElement;
				if (headerSection) {
					const collapseIcon = headerSection.querySelector('.footnote-collapse-icon');
					if (collapseIcon) {
						// Update the icon to show expanded state
						const iconEl = collapseIcon.querySelector('svg');
						if (iconEl) {
							// Clear existing icon and set chevron-down
							iconEl.innerHTML = `<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
						}
					}
				}

				// Update the group's collapsed state in the rendered groups
				this.renderedGroups.forEach(rendered => {
					if (rendered.contentElement === currentElement) {
						rendered.group.isCollapsed = false;
						this.hasManualExpansions = true;
						this.debug('Updated group collapsed state');
					}
				});
			}
		}

		currentElement = currentElement.parentElement as HTMLElement;
	}
}

// ADD ALL THE CURSOR TRACKING METHODS HERE:
private setupCursorListener() {
	this.debug('Setting up cursor listener');

	// Clean up existing listener
	if (this.cursorListener) {
		this.removeCursorListener();
	}

	const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView) {
		this.debug('No active markdown view found');
		return;
	}

	const editorElement = activeView.contentEl.querySelector('.cm-editor .cm-scroller');
	if (!editorElement) {
		this.debug('No editor element found');
		return;
	}

	this.debug('Found editor element, adding click and keyup listeners');

	// Create throttled cursor handler
	this.cursorListener = this.throttle(() => {
		this.handleCursorPositionChange();
	}, this.cursorThrottleDelay);

	// Add event listeners for cursor position changes
	editorElement.addEventListener('click', this.cursorListener);
	editorElement.addEventListener('keyup', this.cursorListener);
}

private removeCursorListener() {
	if (!this.cursorListener) return;

	const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
	if (activeView) {
		const editorElement = activeView.contentEl.querySelector('.cm-editor .cm-scroller');
		if (editorElement) {
			editorElement.removeEventListener('click', this.cursorListener);
			editorElement.removeEventListener('keyup', this.cursorListener);
		}
	}
	this.cursorListener = undefined;
}

private handleCursorPositionChange() {
	this.debug('handleCursorPositionChange called');

	// Prevent overlapping cursor processing
	if (this.isProcessingCursor) {
		this.debug('Cursor processing already in progress, skipping');
		return;
	}

	const now = Date.now();
	if (now - this.lastCursorCheck < this.cursorThrottleDelay) {
		return; // Throttle rapid cursor changes
	}

	this.isProcessingCursor = true;
	this.lastCursorCheck = now;

	try {
		this.plugin.checkCursorInFootnoteReference();
	} finally {
		// Reset processing flag after a short delay
		setTimeout(() => {
			this.isProcessingCursor = false;
		}, 100);
	}
}

private throttle < T extends(...args: any[]) => any > (func: T, delay: number): T {
	let timeoutId: number | null = null;
	let lastExecTime = 0;

	return ((...args: any[]) => {
		const now = Date.now();

		if (now - lastExecTime >= delay) {
			func(...args);
			lastExecTime = now;
		} else {
			if (timeoutId) {
				window.clearTimeout(timeoutId);
			}
			timeoutId = window.setTimeout(() => {
				func(...args);
				lastExecTime = Date.now();
				timeoutId = null;
			}, delay - (now - lastExecTime));
		}
	}) as T;
}

private expandSectionContainingFootnote(footnoteEl: HTMLElement, callback ? : () => void) {
	this.debug('Expanding section containing footnote');

	const sectionsToExpand: Array < {
		element: HTMLElement,
		rendered: RenderedGroup
	} > = [];

	// Find all parent sections that might be collapsed
	let currentElement: HTMLElement | null = footnoteEl;

	while (currentElement && currentElement !== this.containerEl) {
		// Check if this is a collapsible content element
		if (currentElement.classList.contains('footnote-group-content')) {
			const groupHeader = currentElement.previousElementSibling;
			if (groupHeader && groupHeader.classList.contains('footnote-header')) {
				// Check if this section is collapsed
				if (currentElement.style.display === 'none') {
					this.debug('Found collapsed section, preparing to expand');

					// Find the corresponding group in our rendered groups
					for (const rendered of this.renderedGroups) {
						if (rendered.contentElement === currentElement) {
							sectionsToExpand.push({
								element: currentElement,
								rendered
							});
							break;
						}
					}
				}
			}
		}

		currentElement = currentElement.parentElement;
	}

	// Expand sections from top to bottom (parent to child)
	sectionsToExpand.reverse().forEach((section, index) => {
		setTimeout(() => {
			section.rendered.group.isCollapsed = false;
			setIcon(section.rendered.collapseIcon as HTMLElement, 'chevron-down');
			section.element.style.display = 'block';
			this.hasManualExpansions = true;
			this.debug('Updated group collapsed state');

			// Call callback after last expansion
			if (index === sectionsToExpand.length - 1 && callback) {
				callback();
			}
		}, index * 50); // Stagger expansions
	});

	// If no sections to expand, call callback immediately
	if (sectionsToExpand.length === 0 && callback) {
		callback();
	}
}

private scrollToFootnote(footnoteEl: HTMLElement) {
	const container = this.containerEl.children[1];
	const containerRect = container.getBoundingClientRect();
	const footnoteRect = footnoteEl.getBoundingClientRect();

	// Calculate the scroll position to center the footnote in the view
	const currentScroll = container.scrollTop;
	const targetScroll = currentScroll + (footnoteRect.top - containerRect.top) - (containerRect.height / 3);

	this.debug('Scrolling container. Current scroll:', currentScroll, 'Target scroll:', targetScroll);

	container.scrollTo({
		top: Math.max(0, targetScroll),
		behavior: 'smooth'
	});
}

private highlightFootnote(footnoteEl: HTMLElement) {
	// Remove any existing highlights first
	this.containerEl.querySelectorAll('.footnote-item-hover').forEach(el => {
		el.classList.remove('footnote-item-hover');
	});

	// Add highlight class
	footnoteEl.classList.add('footnote-item-hover');

	// Remove highlight after a delay
	setTimeout(() => {
		footnoteEl.classList.remove('footnote-item-hover');
	}, 1500);

	this.debug('Highlighting applied, scroll initiated');
}

jumpToFootnote(footnoteNumber: string) {
	this.debug('FootnotesView.jumpToFootnote called for:', footnoteNumber);

	// Find all footnote number elements
	const footnoteElements = this.containerEl.querySelectorAll('.footnote-number');
	this.debug('Found footnote elements:', footnoteElements.length);

	let targetElement: Element | null = null;

	// Search for the matching footnote number
	footnoteElements.forEach((element) => {
		const numberText = element.textContent?.trim();
		this.debug('Checking footnote number element:', numberText);

		if (numberText === `[${footnoteNumber}]`) {
			this.debug('Found matching footnote, expanding section and scrolling');
			targetElement = element;
			return;
		}
	});

	if (!targetElement) {
		this.debug('Footnote not found:', footnoteNumber);
		return;
	}

	// Find the footnote item container
	const footnoteItem = targetElement.closest('.footnote-item');
	if (!footnoteItem) {
		this.debug('Could not find footnote item container');
		return;
	}

	// Check if the footnote is in a collapsed section and expand it
	let currentElement = footnoteItem.parentElement;
	while (currentElement && currentElement !== this.containerEl) {
		if (currentElement.classList.contains('footnote-group-content')) {
			if (currentElement.style.display === 'none') {
				this.debug('Expanding section containing footnote');
				currentElement.style.display = 'block';

				// Find and update the collapse icon
				const headerSection = currentElement.parentElement?.querySelector('.footnote-header');
				if (headerSection) {
					const collapseIcon = headerSection.querySelector('.footnote-collapse-icon');
					if (collapseIcon) {
						// Update the icon to show expanded state
						collapseIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
					}
				}
			}
		}
		currentElement = currentElement.parentElement;
	}

	// Get the scrollable container (the main footnotes panel container)
	const scrollContainer = this.containerEl.children[1]; // This should be the main content container

	if (!scrollContainer) {
		this.debug('Could not find scroll container');
		return;
	}

	// Calculate the scroll position
	const containerRect = scrollContainer.getBoundingClientRect();
	const footnoteRect = footnoteItem.getBoundingClientRect();

	// Calculate the target scroll position
	// We need to account for the sticky header height
	const stickyHeader = this.containerEl.querySelector('.footnotes-header');
	const headerHeight = stickyHeader ? stickyHeader.getBoundingClientRect().height : 80;

	// We want the footnote to appear below the sticky header, with some padding
	const currentScrollTop = scrollContainer.scrollTop;
	const relativeTop = footnoteRect.top - containerRect.top;
	const targetScrollTop = currentScrollTop + relativeTop - headerHeight - 20; // header height + 20px padding

	this.debug('Scrolling container. Current scroll:', currentScrollTop, 'Target scroll:', targetScrollTop);

	// Apply highlighting to the footnote
	footnoteItem.classList.add('footnote-item-hover');

	// Perform the scroll with smooth behavior
	scrollContainer.scrollTo({
		top: Math.max(0, targetScrollTop), // Ensure we don't scroll to negative position
		behavior: 'smooth'
	});

	this.debug('Highlighting applied, scroll initiated');

	// Remove highlighting after a short delay
	setTimeout(() => {
		footnoteItem.classList.remove('footnote-item-hover');
	}, 2000);
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
	private cursorCheckTimeout: number | null = null;
	private lastCheckedFootnote: string | null = null;
	private cursorCheckInProgress: boolean = false;

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
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.setupCursorListener();
			})
		);

		// Also call it initially
		this.app.workspace.onLayoutReady(() => {
			this.setupCursorListener();
		});
	}

	insertFootnote(editor: Editor) {
		const content = editor.getValue();
		const {
			referencedFootnotes
		} = this.extractFootnotesWithUnreferenced(content);

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
	extractFootnotesWithUnreferenced(content: string): {
		referencedFootnotes: FootnoteData[],
		unreferencedFootnotes: FootnoteData[]
	} {
		const footnoteDefinitions = new Map < string,
			FootnoteDefinition > ();
		const footnoteReferences = new Map < string,
			FootnoteReference[] > ();

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
			footnoteReferences.get(number) !.push(reference);
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

		return {
			referencedFootnotes,
			unreferencedFootnotes
		};
	}

	// Keep the original method for backward compatibility
	extractFootnotes(content: string): FootnoteData[] {
		const {
			referencedFootnotes,
			unreferencedFootnotes
		} = this.extractFootnotesWithUnreferenced(content);
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

		// Separate referenced and unreferenced footnotes
		const referencedFootnotes = footnotes.filter(f => f.references.length > 0);
		const unreferencedFootnotes = footnotes.filter(f => f.references.length === 0);

		// Process referenced footnotes (existing logic)
		referencedFootnotes.forEach(footnote => {
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

		// Add unreferenced footnotes to a special "Unreferenced" group
		if (unreferencedFootnotes.length > 0) {
			const unreferencedGroup: FootnoteGroup = {
				header: {
					text: "Unreferenced Footnotes",
					level: 1, // Make it a top-level heading
					line: -1 // Special line number to indicate it's virtual
				},
				footnotes: unreferencedFootnotes
			};
			groups.push(unreferencedGroup);
		}

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

		// Sort groups by header line (unreferenced group goes last)
		groups.sort((a, b) => {
			if (a.header === null && b.header === null) return 0;
			if (a.header === null) return -1;
			if (b.header === null) return 1;

			// Put unreferenced group at the end
			if (a.header.line === -1) return 1;
			if (b.header.line === -1) return -1;

			return a.header.line - b.header.line;
		});

		return this.buildHierarchicalGroups(groups);
	}

	private buildHierarchicalGroups(flatGroups: FootnoteGroup[]): FootnoteGroup[] {
		const footnoteGroupsByHeaderLine = new Map < number,
			FootnoteGroup > ();
		let noHeaderGroup: FootnoteGroup | null = null;
		let unreferencedGroup: FootnoteGroup | null = null;

		flatGroups.forEach((group: FootnoteGroup) => {
			if (group.header) {
				if (group.header.line === -1) {
					// This is the unreferenced group
					unreferencedGroup = group;
				} else {
					footnoteGroupsByHeaderLine.set(group.header.line, group);
				}
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

		// Add unreferenced group at the end
		if (unreferencedGroup) {
			allGroups.push(unreferencedGroup);
		}

		const result: FootnoteGroup[] = [];
		const stack: FootnoteGroup[] = [];

		for (const group of allGroups) {
			if (!group.header) {
				result.push(group);
				continue;
			}

			// Handle the special unreferenced group
			if (group.header.line === -1) {
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
		this.debug('=== highlightFootnoteInEditor START ===');
		this.debug('footnote:', footnote.number, 'referenceIndex:', referenceIndex);

		// Get the file that the footnotes panel is currently showing
		const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
		let targetFile: TFile | null = null;

		this.debug('Found footnote leaves:', footnoteLeaves.length);

		if (footnoteLeaves.length > 0) {
			const footnoteView = footnoteLeaves[0].view as FootnotesView;
			targetFile = (footnoteView as any).currentFile;
			this.debug('Panel currentFile:', targetFile?.path);
		}

		// Fallback to active file if panel doesn't have a file
		if (!targetFile) {
			targetFile = this.app.workspace.getActiveFile();
			this.debug('Fallback to active file:', targetFile?.path);
		}

		if (!targetFile) {
			new Notice('No active markdown file found');
			this.debug('No target file found');
			return;
		}

		this.debug('Final target file:', targetFile.path);

		// Find the editor for this file
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		this.debug('Searching through', leaves.length, 'markdown leaves');

		let targetEditor: Editor | null = null;
		let targetLeaf: WorkspaceLeaf | null = null;

		for (const leaf of leaves) {
			const view = leaf.view as MarkdownView;
			this.debug('Checking leaf with file:', view.file?.path);

			if (view.file === targetFile) {
				targetEditor = view.editor;
				targetLeaf = leaf;
				this.debug('FOUND matching editor for:', targetFile.path);
				break;
			}
		}

		if (!targetEditor || !targetLeaf) {
			new Notice('Could not find editor for footnote navigation');
			this.debug('No matching editor found');
			return;
		}

		// Make sure the target leaf is active (this prevents focus issues)
		this.app.workspace.setActiveLeaf(targetLeaf);
		this.debug('Making target leaf active');

		// Get current content and extract footnotes
		const content = targetEditor.getValue();
		this.debug('Got content, length:', content.length);

		const footnotes = this.extractFootnotes(content);
		this.debug('Extracted footnotes count:', footnotes.length);

		const match = footnotes.find(f => f.number === footnote.number);
		if (!match) {
			new Notice(`Footnote [${footnote.number}] not found in current document`);
			this.debug('Footnote not found in extracted footnotes');
			return;
		}

		this.debug('Found footnote, references count:', match.references.length);

		if (!match.references[referenceIndex]) {
			new Notice(`Reference ${referenceIndex + 1} not found for footnote [${footnote.number}]`);
			this.debug('Reference index out of bounds');
			return;
		}

		const reference = match.references[referenceIndex];
		this.debug('Using reference:', reference);

		// Calculate cursor position more accurately
		const beforeReference = content.substring(0, reference.startPos);
		const startLine = (beforeReference.match(/\n/g) || []).length;
		const lastNewlinePos = beforeReference.lastIndexOf('\n');
		const referenceStartInLine = lastNewlinePos === -1 ? reference.startPos : reference.startPos - lastNewlinePos - 1;

		const cursorPos = {
			line: startLine,
			ch: referenceStartInLine
		};

		this.debug('Calculated cursor position:', cursorPos);

		// Set cursor and scroll
		this.debug('Setting cursor...');
		targetEditor.setCursor(cursorPos);

		this.debug('Scrolling into view...');
		targetEditor.scrollIntoView({
			from: cursorPos,
			to: cursorPos
		}, true);

		this.debug('Focusing editor...');
		targetEditor.focus();

		// FIXED: Always show the success notice immediately
		const referenceNumber = referenceIndex + 1;
		const totalReferences = match.references.length;
		new Notice(`Jumped to footnote [${footnote.number}] reference ${referenceNumber}/${totalReferences} on line ${startLine + 1}`);

		this.debug('Navigation completed successfully');
		this.debug('=== highlightFootnoteInEditor END ===');
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

		// Get editor (existing logic)
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
			const footnotes = this.extractFootnotes(content);

			if (footnotes.length === 0) {
				new Notice('No footnotes found to process');
				return;
			}

			// Check for gaps in numbering
			const referencedFootnotes = footnotes.filter(f => f.references.length > 0);
			const sortedNumbers = referencedFootnotes.map(f => parseInt(f.number)).filter(n => !isNaN(n)).sort((a, b) => a - b);
			const gaps: string[] = [];

			for (let i = 1; i < sortedNumbers[sortedNumbers.length - 1]; i++) {
				if (!sortedNumbers.includes(i)) {
					gaps.push(i.toString());
				}
			}

			// Check for unreferenced footnotes
			const unreferencedFootnotes = footnotes.filter(f => f.references.length === 0);

			// If no issues found
			if (gaps.length === 0 && unreferencedFootnotes.length === 0) {
				new Notice('No footnote issues found - numbering is sequential and all footnotes are referenced');
				return;
			}

			// Show enhanced confirmation modal
			new EnhancedRenumberConfirmationModal(
				this.app,
				this,
				gaps,
				unreferencedFootnotes,
				(options: RenumberOptions) => {
					this.performEnhancedRenumbering(activeEditor!, footnotes, options);
				}
			).open();

		} catch (error) {
			this.debug('Error in renumberFootnotes:', error);
			new Notice('Error accessing document: ' + error.message);
		}
	}

	private performEnhancedRenumbering(editor: Editor, footnotes: FootnoteData[], options: RenumberOptions) {
		let content = editor.getValue();
		let processedFootnotes = [...footnotes];

		// Step 1: Remove unreferenced footnotes if requested
		if (options.removeUnreferenced) {
			const unreferencedFootnotes = processedFootnotes.filter(f => f.references.length === 0);

			// Sort by position (descending) to maintain positions during deletion
			const sortedForDeletion = unreferencedFootnotes.sort((a, b) => b.definition.startPos - a.definition.startPos);

			// Remove unreferenced footnote definitions
			sortedForDeletion.forEach(footnote => {
				const before = content.substring(0, footnote.definition.startPos);
				const after = content.substring(footnote.definition.endPos);
				content = before + after;

				// Adjust positions of remaining footnotes
				const positionChange = footnote.definition.endPos - footnote.definition.startPos;
				processedFootnotes.forEach(remaining => {
					if (remaining.definition.startPos > footnote.definition.startPos) {
						remaining.definition.startPos -= positionChange;
						remaining.definition.endPos -= positionChange;
					}
					remaining.references.forEach(ref => {
						if (ref.startPos > footnote.definition.startPos) {
							ref.startPos -= positionChange;
							ref.endPos -= positionChange;
						}
					});
				});
			});

			// Remove unreferenced footnotes from our working set
			processedFootnotes = processedFootnotes.filter(f => f.references.length > 0);

			// Update the content for further processing
			editor.setValue(content);
			content = editor.getValue();

			// Re-extract footnotes to get accurate positions after deletion
			processedFootnotes = this.extractFootnotes(content);
		}

		// Step 2: Fix gaps if requested
		if (options.fixGaps && processedFootnotes.length > 0) {
			// Sort footnotes by their first reference position to maintain order
			const sortedFootnotes = [...processedFootnotes].sort((a, b) => {
				const aFirstRef = a.references[0];
				const bFirstRef = b.references[0];
				if (!aFirstRef || !bFirstRef) return 0;
				return aFirstRef.startPos - bFirstRef.startPos;
			});

			// Create mapping from old numbers to new numbers
			const numberMapping = new Map < string,
				string > ();
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
			processedFootnotes.forEach(footnote => {
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
		}

		// Provide feedback
		let message = 'Footnote processing completed:';
		const actions: string[] = [];

		if (options.removeUnreferenced) {
			const unreferencedCount = footnotes.filter(f => f.references.length === 0).length;
			actions.push(`${unreferencedCount} unreferenced footnote(s) removed`);
		}

		if (options.fixGaps) {
			actions.push('footnote numbering gaps fixed');
		}

		if (actions.length > 0) {
			message += ' ' + actions.join(', ');
		}

		new Notice(message);
		this.refreshFootnotesView();
	}
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private handleCursorPositionChange(editor: Editor) {
		this.debug('handleCursorPositionChange called');

		if (this.cursorCheckTimeout) {
			window.clearTimeout(this.cursorCheckTimeout);
		}

		this.cursorCheckTimeout = window.setTimeout(() => {
			this.checkCursorInFootnoteReference();
		}, 200);
	}

	public checkCursorInFootnoteReference() {
		this.debug('checkCursorInFootnoteReference called');

		if (this.cursorCheckInProgress) {
			this.debug('Cursor check already in progress, skipping');
			return;
		}

		this.cursorCheckInProgress = true;

		try {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) {
				this.debug('No active markdown view found');
				return;
			}

			const editor = activeView.editor;
			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);

			this.debug('Cursor position:', cursor, 'Line content:', line, 'Cursor ch:', cursor.ch);

			const footnoteRegex = /\[\^([\w-]+)\]/g;
			let match;
			let currentFootnote: string | null = null;

			while ((match = footnoteRegex.exec(line)) !== null) {
				const startPos = match.index;
				const endPos = match.index + match[0].length;

				this.debug('Found footnote reference:', match[0], 'at positions', startPos, '-', endPos);

				if (cursor.ch >= startPos && cursor.ch <= endPos) {
					currentFootnote = match[1];
					this.debug('Cursor is within footnote reference:', currentFootnote);
					break;
				}
			}

			if (currentFootnote && currentFootnote !== this.lastCheckedFootnote) {
				this.debug('jumpToFootnoteInPanel called for footnote:', currentFootnote);
				this.lastCheckedFootnote = currentFootnote;

				const footnoteLeaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
				this.debug('Found footnote view leaves:', footnoteLeaves.length);

				if (footnoteLeaves.length > 0) {
					const footnoteView = footnoteLeaves[0].view as FootnotesView;
					footnoteView.jumpToFootnote(currentFootnote);
				}
			} else if (!currentFootnote) {
				this.debug('No footnote reference found at cursor position');
				this.lastCheckedFootnote = null;
			}
		} finally {
			setTimeout(() => {
				this.cursorCheckInProgress = false;
			}, 50);
		}
	}

	private jumpToFootnoteInPanel(footnoteNumber: string) {
		this.debug('jumpToFootnoteInPanel called for footnote:', footnoteNumber);

		const leaves = this.app.workspace.getLeavesOfType(FOOTNOTES_VIEW_TYPE);
		this.debug('Found footnote view leaves:', leaves.length);

		if (leaves.length === 0) return;

		const footnoteView = leaves[0].view as FootnotesView;
		footnoteView.jumpToFootnote(footnoteNumber);
	}

	private setupCursorListener() {
		this.debug('Setting up cursor listener');

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			this.debug('No active markdown view found');
			return;
		}

		const editor = activeView.editor;
		const editorEl = (editor as any).cm?.dom || (editor as any).containerEl;

		if (!editorEl) {
			this.debug('Could not find editor element');
			return;
		}

		this.debug('Found editor element, adding click and keyup listeners');

		// Remove existing listeners to prevent duplicates
		editorEl.removeEventListener('click', this.handleCursorEvent);
		editorEl.removeEventListener('keyup', this.handleCursorEvent);

		// Add new listeners
		editorEl.addEventListener('click', this.handleCursorEvent);
		editorEl.addEventListener('keyup', this.handleCursorEvent);
	}

	private handleCursorEvent = () => {
		this.debug('Cursor event triggered');

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;

		this.handleCursorPositionChange(activeView.editor);
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
