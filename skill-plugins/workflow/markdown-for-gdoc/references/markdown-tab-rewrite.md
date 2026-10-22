# After a tab rewrite from markdown

Load this file right after a tool rewrites a whole tab from markdown (the
sole full-replace case in `SKILL.md`). Two things often look wrong then.
Fix the first. Check the second before you "fix" it.

## Rule 1: give wide tables fixed column widths

This rule covers every table in the rewritten tab. When you only rewrite
the tab from markdown you were given, keep each table's rows and columns as
they are, and fix only the widths (below). When you write the markdown, or
the user asks you to change it, keep tables at 5 columns or fewer (the
Tables section of `SKILL.md`), unless the user asks for more.

The rewrite tool can leave column widths that add up to more than the text
width. Then the last columns are cut off in the editor.

For each table with 5 or more columns, and for any table whose widths add
up to more than the text width:

1. Read the tab with `documents.get` and `includeTabsContent: true`. Find
   the text width: the tab's `documentStyle.pageSize.width` minus
   `marginLeft` and `marginRight`, all in `PT`. In landscape
   (`flipPageOrientation` is `true`), use `pageSize.height` instead. If the
   table's section sets its own margins or `flipPageOrientation` (the
   `sectionStyle` of the last section break before the table), use those.
   A pageless tab has `documentStyle.documentFormat.documentMode` set to
   `PAGELESS`. There, use the total width of a table in a sibling tab whose
   last column is not cut off, or ask the user.
2. Split the text width across the columns. Give longer text a wider
   column. Round each width down to whole points, and add what is left to
   the widest column. The widths must add up to the text width.
3. Send one `updateTableColumnProperties` request per column, with
   `columnIndices: [i]` and `widthType: "FIXED_WIDTH"`. One request sets
   the same width on every column it lists. Put all the requests in one
   `batchUpdate`. The request shape is in Rule 4 of
   [`child-tab-inserts.md`](child-tab-inserts.md).
4. Read the structure again. Check that the widths add up to the text width.

## Rule 2: check bold in the API before you re-apply it

A light body font can hide bold. Bold text with a
`weightedFontFamily.weight` under 400 (a light font) renders at weight 400.
Then `**bold**` labels look like plain text in a screenshot, although the
bold is set.

1. Read every text run in the label with `documents.get` and
   `includeTabsContent: true` (or `docs_get_structured` with the `tab_id`).
   Without `includeTabsContent`, `documents.get` returns the first tab, not
   yours. Check `textRun.textStyle.bold`. The markdown export and the
   screenshot are not proof.
2. Find the font. A run often has no `weightedFontFamily` of its own. Then
   read it from that tab's `namedStyles` entry for the paragraph's
   `namedStyleType`. If that entry does not set it, use the `NORMAL_TEXT`
   entry. Do the same for the other tab in step 3.
3. If `bold` is `true`, or step 5 found it set by the named style, open an
   existing tab in the same doc that uses the same
   `weightedFontFamily.fontFamily` and has bold text. Compare its
   screenshot with yours. If its bold looks the same, your bold is correct.
   Do not re-apply it, and do not change the font. With no such tab, trust
   the API value.
4. If the other tab's bold looks heavier, compare `weightedFontFamily`
   (`fontFamily` and `weight`) on both runs, found as in step 2. Do not
   re-apply bold. Tell the user what differs.
5. If `bold` is missing, check the paragraph's named style in
   `namedStyles` first. If that style sets bold, the text is bold: do
   steps 3 and 4, then skip to step 6. If not, or if `bold` is `false`,
   apply it with `updateTextStyle` over the label's exact range,
   `range: {startIndex, endIndex, tabId}`, with `textStyle: {bold: true}`
   and `fields: "bold"`. A range without `tabId` writes to the first tab.
   Then read the run again.
6. If the user wants a stronger bold, ask before you change the font or its
   weight.

## Then verify

Both rules are the Fix step (step 3) of the visual verification loop in
`SKILL.md`. After both, restart the loop at step 1: a structured read of
the whole tab, then the every-page screenshot sweep. Repeat until every page
passes. No column may be cut off at the right edge.
