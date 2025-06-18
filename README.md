# Footnotes Manager Plugin for Obsidian

The Footnotes Manager is a powerful and intuitive Obsidian plugin designed to streamline the management of footnotes in your markdown documents. It provides a dedicated sidebar panel for viewing, editing, and navigating footnotes, with advanced features like hierarchical grouping, multi-section footnote support, unreferenced footnote detection, and enhanced renumbering capabilities.

## Features

### 📚 **Two View Modes**
- **Outline View**: Footnotes organized hierarchically by document headers with collapsible sections
- **List View**: Simple sequential display of all footnotes in document order
- **Easy Toggle**: Switch between views instantly with the view toggle button

### 🔗 **Multi-Section Footnote Support**
- **Cross-section visibility**: Footnotes referenced in multiple sections appear in ALL relevant sections
- **Visual indicator**: Copy icon next to footnote numbers indicates multi-section footnotes
- **Section-specific references**: Each section shows only the references from that specific section
- **Full functionality**: Edit, delete, and navigate from any section where the footnote appears

### ⚠️ **Unreferenced Footnote Detection**
- **Special section**: Unreferenced footnotes appear in a dedicated "Unreferenced" section in outline view
- **Visual indicators**: Red text and borders clearly identify unreferenced footnotes
- **Delete-only mode**: Unreferenced footnotes can only be deleted (no editing to prevent orphaned content)
- **Clear labeling**: "Unreferenced" badge replaces reference count for these footnotes

### ✏️ **Inline Editing**
- Edit footnote content directly in the panel with support for single-line and multi-line footnotes
- Real-time editing with auto-save functionality
- Click any footnote to start editing immediately (referenced footnotes only)
- **Markdown rendering**: Footnote content displays with full markdown formatting

### 🧭 **Advanced Navigation**
- **Jump to footnotes section** or return to your last edit position with dedicated buttons
- **Click headers** in the panel to jump to their location in the document
- **Reference buttons** for each footnote to navigate to specific references in the text
- **Click footnotes** to jump directly to their definitions

### 🔍 **Search Functionality**
- Search footnotes by content or number with real-time filtering
- Highlighted search matches in results
- Clear search with one click

### 📋 **Smart Organization**
- **Hierarchical grouping** by document headers with collapsible sections
- **Reference counting** showing how many times each footnote is used
- **Document order** preserved in list view mode
- **Multi-section display** ensures footnotes appear wherever they're referenced

### 🔧 **Enhanced Footnote Management**
- **Insert new footnotes** with automatic numbering
- **Enhanced renumber dialog** with selective options:
  - Remove orphaned references (references without matching footnotes)
  - Fill gaps in footnote numbering
  - Choose either, both, or cancel operation
- **Safe deletion** with smart handling of single vs multiple references vs unreferenced footnotes
- **Bulk operations** for managing large documents

### 🎨 **Modern Interface**
- **Sticky header** that stays visible while scrolling (like Obsidian's outline view)
- **Modern icons** using Obsidian's native icon system
- **Responsive design** optimized for various screen sizes
- **Accessible styling** with proper contrast and semantic markup

## Installation

### Manual Installation (Recommended)
1. Download the latest release files (`main.js`, `manifest.json`, `styles.css`)
2. Create folder: `<vault>/.obsidian/plugins/obsidian-footnotes-manager/`
3. Copy the files to this folder
4. Enable the plugin in `Settings > Community Plugins`

### Development Installation
1. Clone this repository to your vault's plugins directory
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Enable the plugin in Obsidian settings

## Usage

### Opening the Panel
- **Ribbon Icon**: Click the hash (`⌗`) icon in the left sidebar
- **Command Palette**: Use `Ctrl/Cmd + P` and select "Toggle Footnotes Panel"
- **Auto-open**: Enable "Open panel on startup" in settings

### View Modes
- **Outline View** (default): Footnotes grouped by document headers with expand/collapse functionality
- **List View**: Simple numbered list showing footnotes in document order
- **Toggle**: Use the list/heading icon button to switch between modes

### Working with Footnotes

#### **Referenced Footnotes**
- **View**: All footnotes are displayed with reference counts and content preview
- **Edit**: Click any footnote content to edit inline with markdown support
- **Navigate**: Use reference buttons to jump to specific footnote references
- **Multi-section**: Footnotes appear in all sections where they're used (marked with copy icon)

#### **Unreferenced Footnotes**
- **Special section**: Appear in "Unreferenced" section at bottom of outline view
- **Visual indicators**: Red "Unreferenced" badge and subtle red styling
- **Delete-only**: Can only be deleted (no editing to maintain document integrity)
- **Navigation**: Click to jump to footnote definition

#### **Footnote Operations**
- **Insert**: Use command palette "Insert footnote" or assign a hotkey
- **Delete**: Click the trash icon with different confirmations based on footnote type
- **Renumber**: Enhanced dialog with selective gap filling and orphaned reference removal

### Navigation Tools
- **📍 Jump to footnotes**: Navigate to the footnotes section in your document
- **↩️ Return**: Go back to your last editing position
- **🔢 Renumber**: Enhanced dialog for cleaning up footnote numbering issues
- **👁️ View toggle**: Switch between outline and list views
- **🔍 Search**: Filter footnotes by content or number

### Enhanced Renumbering
The renumber function now provides granular control with checkboxes for:
- **Remove orphaned references**: Delete references that have no matching footnote definitions
- **Fill numbering gaps**: Renumber footnotes sequentially to remove gaps
- **Selective operation**: Choose either, both, or cancel based on your needs

### Search Features
- **Real-time filtering**: Type to instantly filter footnotes
- **Highlight matches**: Search terms are highlighted in results
- **Clear search**: Click the × button to reset
- **Search scope**: Searches both footnote content and numbers

### Organization Features
- **Hierarchical grouping**: Footnotes automatically grouped under document headers
- **Multi-section support**: Same footnote appears in all relevant sections
- **Collapsible sections**: Expand/collapse groups with ▶/▼ icons
- **Bulk collapse/expand**: Use +/- button to toggle all sections
- **Reference tracking**: See how many references each footnote has
- **Unreferenced detection**: Special handling for footnotes without references

## Settings

Access settings in `Settings > Community Plugins > Footnotes Manager`:

- **Open panel on startup**: Automatically show the panel when Obsidian starts
- **Default collapsed view**: Start with sections collapsed in outline view
- **Debug mode**: Enable console logging for troubleshooting

## Keyboard Shortcuts

### Editing Footnotes
- **Enter**: Save single-line footnote edits
- **Ctrl/Cmd + Enter**: Save multi-line footnote edits
- **Escape**: Cancel editing and revert changes

### Recommended Hotkeys (assign in Obsidian settings)
- **Insert footnote**: e.g., `Ctrl + Shift + F`
- **Toggle footnotes panel**: e.g., `Ctrl + Shift + N`
- **Jump to footnotes**: e.g., `Ctrl + Shift + J`

## Tips and Best Practices

### Organization
- Use clear, descriptive headers to organize your footnotes effectively
- Multi-section footnotes will appear under all relevant headers automatically
- Use the search function to quickly find specific footnotes in large documents
- Check the "Unreferenced" section periodically to clean up unused footnotes

### Editing
- Click directly on footnote content to edit (referenced footnotes only)
- Use multi-line editing for longer footnotes with full markdown support
- The plugin automatically handles footnote formatting and rendering
- Unreferenced footnotes are read-only to prevent creating orphaned content

### Navigation
- Use reference buttons to check all uses of a footnote across sections
- Copy icon indicates footnotes that appear in multiple sections
- Click headers to quickly navigate to document sections
- Use the return button after jumping to footnotes section

### Management
- Use the enhanced renumber function to clean up both gaps and orphaned references
- Check reference counts to identify unused or heavily-referenced footnotes
- Multi-section footnotes show their total usage across all sections
- Use search to audit footnote content and find duplicates

## Advanced Features

### Multi-Section Footnotes
When the same footnote is referenced in multiple sections:
- The footnote appears in **all relevant sections** in outline view
- A **copy icon** indicates multi-section footnotes
- Each section shows only **its own references**
- **Full editing capability** is available from any section
- **Tooltip** shows total number of sections where footnote appears

### Unreferenced Footnote Handling
- Automatically detected and grouped in special "Unreferenced" section
- **Visual indicators**: Red text and subtle styling for easy identification
- **Safe deletion**: Only delete option available (no editing)
- **Clear separation**: Keeps unreferenced footnotes organized separately

### Enhanced Renumbering
- **Orphaned reference detection**: Finds references without matching definitions
- **Gap analysis**: Identifies missing numbers in sequence
- **Selective correction**: Choose which issues to fix with checkboxes
- **Confirmation dialogs**: Clear explanations of what will be changed

## File Structure

```
obsidian-footnotes-manager/
├── main.ts          # Core plugin logic and FootnotesView class
├── styles.css       # Complete styling including multi-section support
├── manifest.json    # Plugin metadata
├── README.md        # Documentation
└── LICENSE          # MIT License
```

## Development

### Building the Plugin
```bash
npm install
npm run build
```

### Development Mode
```bash
npm run dev
```

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes with appropriate tests
4. Submit a pull request with clear description

### Code Structure
- **FootnotesView**: Main UI component handling the sidebar panel
- **FootnotesManagerPlugin**: Core plugin class with footnote processing logic
- **Enhanced Modal components**: Confirmation dialogs and user interactions
- **Multi-section support**: Logic for detecting and displaying cross-section footnotes
- **CSS styling**: Modern, accessible design matching Obsidian's aesthetic

## Known Issues & Limitations

- Complex markdown documents with unusual footnote formats may require manual adjustment
- Performance may be affected with documents containing hundreds of footnotes
- Plugin works best with standard markdown footnote syntax: `[^number]` and `[^number]: content`
- Multi-section footnotes create visual duplicates (by design) which may increase visual complexity

## Roadmap

- **Export functionality**: Export footnote lists in various formats
- **Custom footnote formats**: Support for non-numeric footnote identifiers
- **Footnote templates**: Quick insertion of formatted footnotes
- **Cross-document footnotes**: Link footnotes across multiple files
- **Advanced search**: RegEx support and content filtering
- **Footnote analytics**: Usage statistics and duplicate detection

## Troubleshooting

### Panel Not Showing
- Check that the plugin is enabled in Community Plugins
- Try toggling the panel with the ribbon icon or command palette
- Restart Obsidian if the panel doesn't appear

### Footnotes Not Detected
- Ensure footnotes follow standard markdown syntax: `[^1]` and `[^1]: content`
- Check that footnote definitions are properly formatted
- Try refreshing the panel by switching files

### Multi-Section Issues
- If footnotes don't appear in expected sections, check header structure
- Ensure references are properly placed within sections
- Copy icon should appear for footnotes with multiple references

### Performance Issues
- Enable debug mode to identify bottlenecks
- Consider splitting very large documents with many footnotes
- Check console for error messages

### Unreferenced Footnotes
- Check the "Unreferenced" section at bottom of outline view
- Verify footnote definitions exist in the document
- Use enhanced renumber to clean up orphaned references

## Support

For issues, feature requests, or questions:
- Open an issue on the GitHub repository
- Check existing issues for similar problems
- Provide clear reproduction steps and system information

## License

This plugin is licensed under the MIT License. See the LICENSE file for details.

## Release Notes

### Version 1.2.0 (Current) - Multi-Section & Unreferenced Footnotes Support
**🆕 Major New Features:**
- **Multi-Section Footnotes**: Footnotes now appear in ALL sections where they're referenced
- **Copy Icon Indicator**: Visual indicator (Lucide copy icon) for multi-section footnotes
- **Unreferenced Footnote Detection**: Special "Unreferenced" section in outline view
- **Enhanced Renumber Dialog**: Selective options for orphaned references and gap filling

**🔧 Advanced Improvements:**
- **Smart Section Analysis**: Footnotes analyzed per reference to determine section placement
- **Filtered References**: Each section shows only its own footnote references
- **Visual Indicators**: Red styling and "Unreferenced" badges for orphaned footnotes
- **Selective Deletion**: Different confirmation dialogs based on footnote type

**🎨 UI/UX Enhancements:**
- **Subtle Styling**: Unreferenced footnotes use normal backgrounds with red text indicators
- **Tooltip Support**: Hover information for multi-section footnotes
- **Enhanced Modals**: Checkbox-based renumber dialog with clear options
- **Improved Accessibility**: Better contrast and semantic markup

### Version 1.1.0 - Enhanced UI & List View
**🆕 New Features:**
- **List View Mode**: Toggle between hierarchical outline view and simple sequential list view
- **Sticky Header**: Header controls now stay visible while scrolling
- **Modern Icons**: All buttons now use Obsidian's native `setIcon` system for consistency
- **Enhanced Navigation**: Improved button styling and tooltips

**🔧 Improvements:**
- **Better Performance**: Optimized refresh logic and duplicate prevention
- **Code Quality**: Eliminated duplicate methods and improved TypeScript structure
- **UI Polish**: Enhanced button spacing, hover effects, and visual feedback
- **Accessibility**: Better contrast and semantic markup throughout

### Version 1.0.0 - Initial Release
**🎉 Core Features:**
- Hierarchical footnote organization by document headers
- Inline footnote editing with auto-save
- Search functionality with highlighted matches
- Safe footnote deletion with reference counting
- Footnote renumbering to remove gaps
- Navigation tools (jump to footnotes, return to edit position)
- Collapsible sections with expand/collapse all
- Reference tracking and navigation
- Modern responsive design
- Comprehensive settings panel

## Acknowledgements

- Built with the Obsidian API and TypeScript
- Inspired by academic and technical writing workflows
- Designed for efficient footnote management in long-form content
- Uses Lucide icons for consistent visual design

---

**Enjoy efficient footnote management with the Footnotes Manager plugin!** 📝