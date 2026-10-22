# Child-tab inserts: text and tables

Load this file before you add text or a table to a child or non-default tab.
Common MCP tools put new content in the wrong place there, or give it the
wrong style. A tool that reports success can still be wrong.

## Known traps

- An append tool (for example `write_document` with `mode: append` and a
  `tab_id`) can write at index 1 of the tab, above its title. Every new
  paragraph then takes the title's `HEADING_1` style.
- A table tool (for example `insert_table` with a `tab_id`) leaves an empty
  paragraph before the table. That paragraph and every cell take the style of
  the heading next to it, so the table text shows at heading size.
- The same table tool gives every column one fixed width. A table with fewer
  columns comes out narrower than the others and sits centered.

## Rule 1: insert at an explicit index, then read back

Do not trust an append tool on a child tab. Use raw `documents.batchUpdate`.

1. Read the tab: `documents.get` with `includeTabsContent: true`, or
   `docs_get_structured` with the `tab_id`. Save the tab text and the title's
   `named_style`. The insert point is the tab's last newline: `endIndex - 1`
   of the last body element.
2. Send `insertText` with `location: {index, tabId}` at that index.
3. Read the structure again before any style call. Check that the new text
   starts at the insert point and that the title is unchanged.

If the new text landed somewhere else (for example at index 1):

1. Check that the text in the misplaced range is exactly the text you
   inserted. Then delete only that range with `deleteContentRange`
   (`range: {startIndex, endIndex, tabId}`).
2. Read again. Check that the tab text and the title's `named_style` match
   your first read.
3. Insert again with Rule 1.

## Rule 2: reset inherited styles first

New paragraphs take the list and the named style of the paragraph they split
from. Over the whole new range, in this order:

1. `deleteParagraphBullets`.
2. `updateParagraphStyle` with `paragraphStyle: {namedStyleType: "NORMAL_TEXT"}`
   and `fields: "namedStyleType"`.
3. Only then apply the styles you want: `HEADING_2` on section titles,
   bullets with `createParagraphBullets`, links with `updateTextStyle`.

Style requests do not move indices. Text and table inserts move every later
index, so read the structure again after each insert.

## Rule 3: fix styles around and inside each new table

`insertTable` with `location: {index, tabId}` also adds a newline before the
table. After each table insert:

1. Read the structure. Find the table and the empty paragraph before it.
2. Send `updateParagraphStyle` with `NORMAL_TEXT` over the empty paragraph
   and over the whole table range. Every cell paragraph is then `NORMAL_TEXT`.
3. Bold each header cell by its text range: from the cell's `startIndex + 1`
   to its paragraph's `endIndex - 1`. Use `updateTextStyle` with
   `textStyle: {bold: true}` and `fields: "bold"`.

## Rule 4: match the table widths

Set the column widths of every new table so that the total width matches the
other tables in the tab.

1. Read `tableStyle.tableColumnProperties` of an existing table in the tab
   and add up the widths. If the tab has no other table, or its widths are
   not set (evenly distributed), use the page text width: the tab's
   `documentStyle` page width minus the left and right margins.
2. Send `updateTableColumnProperties` with
   `tableStartLocation: {index, tabId}`, the `columnIndices`, and
   `tableColumnProperties: {widthType: "FIXED_WIDTH", width: {magnitude, unit: "PT"}}`
   with `fields: "width,widthType"`.

## Then verify

Run the visual verification loop in `SKILL.md`: a structured read of the whole
tab, then the every-page screenshot sweep.
