# After a tab rewrite from markdown

Load this file right after a tool rewrites a whole tab from markdown (the
sole full-replace case in `SKILL.md`). Two things often look wrong then.
Fix the first. Check the second before you "fix" it.

## Rule 1: give wide tables fixed column widths

A table with 5 or more columns gets default column widths. They can add up
to more than the text width, so the last columns are cut off in the editor.

For each table with 5 or more columns:

1. Read the tab with `documents.get` and `includeTabsContent: true`. Find
   the text width: the tab's `documentStyle.pageSize.width` minus
   `marginLeft` and `marginRight`, all in `PT`.
2. Split the text width across the columns. Give longer text a wider
   column. The widths must add up to the text width exactly.
3. Set every column with `updateTableColumnProperties` and
   `widthType: "FIXED_WIDTH"`. The request shape is in Rule 4 of
   [`child-tab-inserts.md`](child-tab-inserts.md).
4. Read the structure again. Check that the widths add up to the text width.
5. Re-check in the browser with the every-page screenshot sweep. No column
   may be cut off at the right edge.

## Rule 2: check bold in the API before you re-apply it

Some body fonts have a subtle bold weight. Then `**bold**` labels can look
like plain text in a screenshot, although the bold is set.

1. Read the label's text run with `documents.get`. Check
   `textRun.textStyle.bold`. The markdown export and the screenshot are not
   proof.
2. If `bold` is `true`, open an existing tab in the same doc and font that
   has bold text. Compare its screenshot with yours. If its bold looks the
   same, your bold is correct. Do not re-apply it, and do not change the font.
   With no such tab, trust the API value.
3. If `bold` is missing or `false`, apply it with `updateTextStyle` over the
   label's exact range: `textStyle: {bold: true}`, `fields: "bold"`. Then
   read the run again.
4. If the user wants a stronger bold, ask before you change the font or its
   weight.
