#!/usr/bin/env node
// Measured UI/UX rankings for any web page. Each ranking prints a 0-100 score and its findings.
//
//   node rankings.cjs <ranking|all|shots> <url> [<url> ...] [--min 95] [--json] [--out DIR]
//
// Rankings: axe (axe-core WCAG 2.2 AA + best practice), targets (44 px on touch, 24 px WCAG 2.5.8),
// contrast (text, both themes), state (selected controls differ by 3:1, WCAG 1.4.11), keyboard (every
// control by Tab, a visible ring, never under a sticky bar), motion (Reduce motion, dark scheme),
// readability (12 px floor, 15 px paragraphs and <= 90 characters a line on a phone).
// `shots` writes phone and desktop screenshots in both themes to --out (default ./ui-shots) for the
// design panel (references/design-panel.md). Name a view by appending #label: http://x/page.html#page.
//
// Needs playwright and axe-core: run it with NODE_PATH pointing at a folder that has both (SKILL.md).
// Chrome: CHROME_PATH, else Playwright's own browser.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i < 0 ? dflt : args.splice(i, 2)[1];
};
const json = args.includes("--json") && args.splice(args.indexOf("--json"), 1);
const MIN = Number(flag("--min", 0));
const OUT = flag("--out", "ui-shots");
const [ranking, ...urls] = args;
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const VIEWS = urls.map((u) => [u.replace(/^https?:\/\/[^/]+\//, "") || "/", u]);

async function open(browser, url, size, scheme = "light", extra = {}) {
  const ctx = await browser.newContext({ viewport: SIZES[size], colorScheme: scheme, ...extra });
  const p = await ctx.newPage();
  await p.goto(url);
  await p.evaluate(() => {
    try {
      localStorage.clear();
    } catch (_e) {}
  }); // each view from a clean start
  await p.goto(url);
  await p.waitForTimeout(300);
  return p;
}

// Runs in the page: relative luminance of any CSS color Chrome computes (rgb(), rgba(), color(srgb ...)).
const COLOR = `
  window.__lum = c => {
    let m = c.match(/color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)(?: \\/ ([\\d.]+))?\\)/);
    let rgb, a;
    if (m) { rgb = [m[1], m[2], m[3]].map(Number); a = m[4] === undefined ? 1 : +m[4]; }
    else { const n = (c.match(/[\\d.]+/g) || ['0', '0', '0']).map(Number); rgb = n.slice(0, 3).map(v => v / 255); a = n[3] ?? 1; }
    const [r, g, b] = rgb.map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return [.2126 * r + .7152 * g + .0722 * b, a];
  };
  window.__bg = e => { for (; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (__lum(c)[1] > .5) return c; }
    return getComputedStyle(document.body).backgroundColor; };
  window.__ratio = (x, y) => { const [a] = __lum(x), [b] = __lum(y); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
`;
const CONTROLS = 'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

const rankings = {
  async axe(browser) {
    const src = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
    const out = [];
    for (const [name, url] of VIEWS)
      for (const scheme of ["light", "dark"]) {
        const p = await open(browser, url, "desktop", scheme);
        await p.addScriptTag({ content: src });
        const r = await p.evaluate(() =>
          axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] }),
        );
        for (const v of r.violations)
          out.push(`${name} ${scheme}: ${v.impact} ${v.id} (${v.nodes.length}) ${v.nodes[0].target.join(" ")}`);
        await p.context().close();
      }
    return { score: Math.max(0, 100 - out.length * 5), findings: out };
  },
  async targets(browser) {
    const out = [];
    let n = 0;
    for (const [name, url] of VIEWS) {
      const p = await open(browser, url, "phone", "light", { hasTouch: true, isMobile: true });
      const all = await p.evaluate(
        (sel) =>
          [...document.querySelectorAll(sel)]
            .filter(
              (e) =>
                e.offsetParent !== null &&
                !e.disabled &&
                !e.closest("[inert]") &&
                // a link inside a sentence is exempt (WCAG 2.5.8 "inline")
                !(
                  e.tagName === "A" &&
                  getComputedStyle(e).display === "inline" &&
                  e.parentElement.textContent.trim().length > e.textContent.trim().length + 20
                ),
            )
            .map((e) => {
              const r = (e.closest("label") || e).getBoundingClientRect(); // a label is its control's target
              return {
                t: (e.getAttribute("aria-label") || e.textContent || e.id || e.tagName).trim().slice(0, 24),
                w: Math.round(r.width),
                h: Math.round(r.height),
              };
            }),
        CONTROLS,
      );
      n += all.length;
      for (const s of all)
        if (s.w < 44 || s.h < 44)
          out.push(`${name}: "${s.t}" ${s.w}x${s.h}${s.w < 24 || s.h < 24 ? " (under WCAG 24)" : ""}`);
      await p.context().close();
    }
    return { score: Math.round(100 * (1 - out.length / Math.max(1, n))), findings: out };
  },
  async contrast(browser) {
    const out = [];
    let n = 0;
    for (const [name, url] of VIEWS)
      for (const scheme of ["light", "dark"]) {
        const p = await open(browser, url, "desktop", scheme);
        await p.addScriptTag({ content: COLOR });
        const r = await p.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((e) => e.offsetParent && [...e.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim()))
            .filter((e) => {
              const st = getComputedStyle(e);
              return st.visibility !== "hidden" && +st.opacity !== 0;
            })
            .map((e) => {
              const st = getComputedStyle(e),
                fs = parseFloat(st.fontSize);
              const big = fs >= 24 || (fs >= 18.66 && +st.fontWeight >= 700);
              return {
                t: e.textContent.trim().slice(0, 30),
                ratio: Math.round(__ratio(st.color, __bg(e)) * 10) / 10,
                need: big ? 3 : 4.5,
              };
            }),
        );
        n += r.length;
        for (const x of r) if (x.ratio < x.need) out.push(`${name} ${scheme}: "${x.t}" ${x.ratio}:1 (needs ${x.need})`);
        await p.context().close();
      }
    return { score: Math.round(100 * (1 - out.length / Math.max(1, n))), findings: out };
  },
  async state(browser) {
    const out = [];
    let n = 0;
    for (const [name, url] of VIEWS)
      for (const scheme of ["light", "dark"]) {
        const p = await open(browser, url, "desktop", scheme);
        await p.addScriptTag({ content: COLOR });
        const r = await p.evaluate(() => {
          const res = [];
          for (const on of document.querySelectorAll(
            "[aria-pressed=true], [aria-selected=true], [aria-current]:not([aria-current=false])",
          )) {
            if (!on.offsetParent) continue;
            const off = [...on.parentElement.children].find(
              (x) =>
                x !== on && x.offsetParent && !x.matches("[aria-pressed=true], [aria-selected=true], [aria-current]"),
            );
            if (!off) continue;
            const bg = __ratio(__bg(on), __bg(off)),
              fg = __ratio(getComputedStyle(on).color, getComputedStyle(off).color);
            res.push({ t: on.textContent.trim().slice(0, 20), r: Math.round(Math.max(bg, fg) * 10) / 10 });
          }
          return res;
        });
        for (const x of r) {
          n++;
          if (x.r < 3) out.push(`${name} ${scheme}: selected "${x.t}" differs by ${x.r}:1 (needs 3)`);
        }
        await p.context().close();
      }
    return { score: n ? Math.round(100 * (1 - out.length / n)) : 100, findings: out };
  },
  async keyboard(browser) {
    const out = [];
    let n = 0;
    for (const [name, url] of VIEWS) {
      const p = await open(browser, url, "desktop");
      const count = await p.evaluate(
        (sel) =>
          [...document.querySelectorAll(sel)]
            .filter((e) => e.offsetParent !== null && !e.disabled && !e.closest("[inert]"))
            .map((e, i) => (e.dataset.kbk = i)).length,
        CONTROLS,
      );
      const seen = new Set();
      for (let i = 0; i < count + 5; i++) {
        await p.keyboard.press("Tab");
        const f = await p.evaluate(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          const st = getComputedStyle(e);
          const ring = (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0) || st.boxShadow !== "none";
          // a sticky or fixed bar at the top must not cover the focused control (skip links sit above it)
          const top = e.getBoundingClientRect().top;
          const bars = [...document.querySelectorAll("body *")].filter(
            (b) =>
              ["sticky", "fixed"].includes(getComputedStyle(b).position) &&
              b.getBoundingClientRect().top <= 0 &&
              b.offsetHeight < innerHeight / 2 &&
              !b.contains(e),
          );
          const covered =
            !/skip/i.test(e.className) &&
            bars.some((b) => top < b.getBoundingClientRect().bottom - 2 && +getComputedStyle(b).zIndex >= 0);
          return { k: e.dataset.kbk ?? e.outerHTML.slice(0, 60), ring, covered };
        });
        if (!f || seen.has(f.k)) continue;
        seen.add(f.k);
        n++;
        if (!f.ring) out.push(`${name}: no visible focus on control ${f.k}`);
        if (f.covered) out.push(`${name}: focused control ${f.k} is under a sticky bar`);
      }
      if (seen.size < count) out.push(`${name}: ${count - seen.size} of ${count} controls not reached by Tab`);
      await p.context().close();
    }
    return { score: Math.round(100 * (1 - out.length / Math.max(1, n))), findings: out };
  },
  async motion(browser) {
    const out = [];
    for (const [name, url] of VIEWS) {
      const p = await open(browser, url, "desktop", "light", { reducedMotion: "reduce" });
      const moving = await p.evaluate(() =>
        [...document.querySelectorAll("*")]
          .filter((e) => {
            const s = getComputedStyle(e);
            return (
              parseFloat(s.transitionDuration) > 0 ||
              (s.animationName !== "none" && parseFloat(s.animationDuration) > 0)
            );
          })
          .map(
            (e) => e.tagName + (e.className && typeof e.className === "string" ? `.${e.className.split(" ")[0]}` : ""),
          )
          .slice(0, 5),
      );
      if (moving.length) out.push(`${name}: motion with Reduce motion on: ${[...new Set(moving)].join(", ")}`);
      await p.context().close();
      const d = await open(browser, url, "desktop", "dark");
      const bg = await d.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const m = (bg.match(/[\d.]+/g) || []).map(Number);
      if (m.length >= 3 && (m[0] + m[1] + m[2] > 300 || bg.startsWith("rgba(0, 0, 0, 0)")))
        out.push(`${name}: body not dark in the dark scheme (${bg})`);
      await d.context().close();
    }
    return { score: Math.max(0, 100 - out.length * 10), findings: out };
  },
  async readability(browser) {
    const out = [];
    let n = 0;
    for (const [name, url] of VIEWS) {
      const p = await open(browser, url, "phone");
      const r = await p.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter(
            (e) => e.offsetParent && [...e.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim().length > 1),
          )
          .map((e) => {
            const fs = parseFloat(getComputedStyle(e).fontSize);
            return {
              t: e.textContent.trim().slice(0, 30),
              fs,
              ch: Math.round(e.getBoundingClientRect().width / (fs * 0.5)),
              long: e.textContent.trim().length > 60,
            };
          }),
      );
      for (const x of r) {
        n++;
        if (x.fs < 12) out.push(`${name}: "${x.t}" ${x.fs}px (under 12)`);
        else if (x.long && x.fs < 15) out.push(`${name}: paragraph "${x.t}" ${x.fs}px (under 15)`);
        if (x.long && x.ch > 90) out.push(`${name}: "${x.t}" about ${x.ch} characters a line`);
      }
      await p.context().close();
    }
    return { score: Math.round(100 * (1 - out.length / Math.max(1, n))), findings: out };
  },
  async shots(browser) {
    // not a ranking: the screenshots the design panel rates
    fs.mkdirSync(OUT, { recursive: true });
    const files = [];
    for (const [name, url] of VIEWS)
      for (const [size, scheme] of [
        ["desktop", "light"],
        ["desktop", "dark"],
        ["phone", "light"],
        ["phone", "dark"],
      ]) {
        const p = await open(browser, url, size, scheme);
        const file = path.join(OUT, `${name.replace(/[^\w.-]+/g, "_")}-${size}-${scheme}.png`);
        await p.screenshot({ path: file });
        files.push(file);
        await p.context().close();
      }
    return { score: 100, findings: files };
  },
};
const MEASURED = ["axe", "targets", "contrast", "state", "keyboard", "motion", "readability"];

(async () => {
  if ((!rankings[ranking] && ranking !== "all") || !urls.length) {
    console.error(
      `Usage: node rankings.cjs <${MEASURED.join("|")}|all|shots> <url> [...] [--min 95] [--json] [--out DIR]`,
    );
    process.exit(2);
  }
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const results = {};
  for (const r of ranking === "all" ? MEASURED : [ranking]) results[r] = await rankings[r](browser);
  await browser.close();
  if (json) console.log(JSON.stringify(results, null, 2));
  else
    for (const [r, v] of Object.entries(results)) {
      console.log(`${r}: ${v.score}/100, ${v.findings.length} finding(s)`);
      for (const f of v.findings.slice(0, 40)) console.log(`  ${f}`);
    }
  process.exit(Object.entries(results).some(([r, v]) => r !== "shots" && v.score < MIN) ? 1 : 0);
})();
