# After a tab rewrite from markdown

Load this file right after a tool rewrites a whole tab from markdown (the
sole full-replace case in `SKILL.md`). Two things often look wrong then.
Fix the first. Check the second before you "fix" it.

## Rule 1: give wide tables fixed column widths

When you write the markdown yourself, keep tables at 5 columns or fewer
(Tables in `SKILL.md`). This rule is for the tables the markdown already
has, kept as they are.

The rewrite tool can leave column widths that add up to more than the text
width. Then the last columns are cut off in the editor.

For each table with 5 or more columns, and for any table whose widths add
up to more than the text width:

1. Read the tab with `documents.get` and `includeTabsContent: true`. Find
   the text width: the tab's `documentStyle.pageSize.width` minus
   `marginLeft` and `marginRight`, all in `PT`. In a pageless tab
   (`documentStyle.documentFormat.documentMode` is `PAGELESS`), use the
   total width of an existing table instead, or ask the user.
2. Split the text width across the columns. Give longer text a wider
   column. Round each width to whole points, and add the remainder to the
   widest column. The widths must add up to the text width.
3. Send one `updateTableColumnProperties` request per column, with
   `columnIndices: [i]` and `widthType: "FIXED_WIDTH"`. One request sets
   the same width on every column it lists. Put all the requests in one
   `batchUpdate`. The request shape is in Rule 4 of
   [`child-tab-inserts.md`](child-tab-inserts.md).
4. Read the structure again. Check that the widths add up to the text width.

## Rule 2: check bold in the API before you re-apply it

Some body fonts have a subtle bold. Bold text with a
`weightedFontFamily.weight` under 400 (a light font) renders at weight 400.
Then `**bold**` labels look like plain text in a screenshot, although the
bold is set.

1. Read the label's text run with `documents.get` and
   `includeTabsContent: true` (or `docs_get_structured` with the `tab_id`).
   Without that flag, you read the first tab, not yours. Check
   `textRun.textStyle.bold`. The markdown export and the screenshot are not
   proof.
2. If `bold` is `true`, open an existing tab in the same doc that uses the
   same `weightedFontFamily.fontFamily` and has bold text. Compare its
   screenshot with yours. If its bold looks the same, your bold is correct.
   Do not re-apply it, and do not change the font. With no such tab, trust
   the API value.
3. If the other tab's bold looks heavier, compare `weightedFontFamily`
   (`fontFamily` and `weight`) on both runs. Do not re-apply bold. Tell the
   user what differs.
4. If `bold` is missing or `false`, apply it with `updateTextStyle` over the
   label's exact range: `textStyle: {bold: true}`, `fields: "bold"`. Then
   read the run again.
5. If the user wants a stronger bold, ask before you change the font or its
   weight.

## Then verify

Run the visual verification loop in `SKILL.md` once, after both rules: a
structured read of the whole tab, then the every-page screenshot sweep. No
column may be cut off at the right edge.
