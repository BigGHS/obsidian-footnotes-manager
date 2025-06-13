# Footnotes Manager Plugin for Obsidian

The Footnotes Manager is a powerful and intuitive Obsidian plugin designed to streamline the management of footnotes in your markdown documents. It provides a dedicated sidebar panel for viewing, editing, and navigating footnotes, with advanced features like hierarchical grouping, search functionality, and footnote renumbering.

## Features

- **Dedicated Footnotes Panel**: View all footnotes in a clean, organized sidebar panel, grouped by document headers.
- **Inline Editing**: Edit footnote content directly in the panel with support for single-line and multi-line footnotes.
- **Navigation Tools**:
  - Jump to footnote definitions or references in the editor.
  - Navigate to the footnotes section or return to your last edit position.
  - Click headers in the panel to jump to their location in the document.
- **Search Functionality**: Quickly find footnotes by searching their content or numbers, with highlighted matches.
- **Hierarchical Organization**: Footnotes are automatically grouped under document headers, with collapsible sections for better organization.
- **Footnote Renumbering**: Remove gaps in footnote numbering with a single click, ensuring sequential numbering.
- **Safe Deletion**: Delete footnotes with confirmation prompts, handling single or multiple references appropriately.
- **Customizable Settings**:
  - Toggle panel opening on startup.
  - Set default collapsed/expanded view for sections.
  - Enable debug mode for troubleshooting.
- **Responsive Design**: Optimized for various screen sizes with accessible, modern styling.

## Installation

1. **Manual Installation Only**:
   - Download the latest release from the GitHub repository.
   - Extract the files (`main.js`, `manifest.json`, `styles.css`) to your vault's plugins directory: `<vault>/.obsidian/plugins/obsidian-footnotes-manager/`.
   - Enable the plugin in `Settings > Community Plugins`.

## Usage

### Opening the Panel
- Click the hash (`⌗`) icon in the ribbon (left sidebar).
- Use the command palette (`Ctrl/Cmd + P`) and select "Toggle Footnotes Panel".
- Enable "Open panel on startup" in settings for automatic opening.

### Viewing Footnotes
- Footnotes are displayed in the panel, grouped by document headers.
- Expand/collapse sections using the toggle button or individual collapse icons.
- Click a footnote to jump to its definition or edit its content inline.
- Use reference buttons to navigate to specific footnote references in the text.

### Editing Footnotes
- Click footnote content to enter edit mode.
- Save changes with the "Save" button or `Enter` (single-line) / `Ctrl+Enter` (multi-line).
- Cancel edits with the "Cancel" button or `Esc`.
- Delete footnotes using the trash icon, with confirmation prompts.

### Inserting Footnotes
- Use the command palette and select "Insert footnote" or bind a hotkey.
- A new footnote reference (`[^n]`) is inserted at the cursor, and a definition (`[^n]: `) is added to the footnotes section.

### Navigation
- Use the chevron-right button to jump to the footnotes section.
- Use the chevron-left button to return to your last edit position.
- Click header names to navigate to their location in the document.

### Searching
- Type in the search bar to filter footnotes by content or number.
- Clear the search using the "×" button.
- Matching text is highlighted in the results.

### Renumbering
- Click the renumber button (three horizontal lines) to remove gaps in footnote numbering.
- Confirm the action in the modal, which lists detected gaps.
- All references and definitions are updated to sequential numbers.

## Settings

Access settings in `Settings > Community Plugins > Footnotes Manager > Plugin Settings`:

- **Open panel on startup**: Automatically show the panel when Obsidian starts.
- **Default collapsed view**: Start with sections collapsed to show only headers.
- **Debug mode**: Enable console logging for troubleshooting.

## Development

### Building the Plugin
1. Clone the repository: `git clone <repository-url>`.
2. Install dependencies: `npm install`.
3. Build the plugin: `npm run build`.
4. Copy the output files (`main.js`, `styles.css`, `manifest.json`) to your Obsidian plugins directory.

### Contributing
- Submit issues or feature requests on the GitHub repository.
- Fork the repository, create a branch, and submit a pull request with your changes.
- Ensure code follows TypeScript conventions and includes appropriate documentation.

### File Structure
- `main.ts`: Core plugin logic, including the FootnotesView and plugin functionality.
- `styles.css`: Styling for the panel, buttons, and modal.
- `manifest.json`: Plugin metadata (not included here).

## Known Issues
- Rapid editor changes may occasionally cause the panel to refresh unnecessarily. Debouncing is implemented to mitigate this.
- Complex markdown documents with unusual footnote formats may require additional parsing logic.

## Roadmap
- Add support for custom footnote formats.
- Add export functionality for footnote lists.

## License
This plugin is licensed under the MIT License. See the GitHub repository for details.

## Acknowledgements
- Built with the Obsidian API and TypeScript.
- Inspired by the needs of academic and technical writers for efficient footnote management.

For support, please open an issue on the [GitHub repository](<insert-repository-url-here>). Enjoy managing your footnotes with ease!