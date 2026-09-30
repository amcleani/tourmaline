// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Bibliography, citationVariables, normalisePath } from "../src/vault/bibliography";
import { displayName, latexToText, parseBibtex, parseFileField, parseNames } from "../src/vault/bibtex";

describe("latexToText", () => {
  it.each([
    ["Grounding {Generalizations}", "Grounding Generalizations"],
    ["Je\\v{r}ábek", "Jeřábek"],
    ["Andr\\'e and Zolt\\'an", "André and Zoltán"],
    ["No{\\^{u}}s", "Noûs"],
    ["Comesa\\~na", "Comesaña"],
    ["Hirvel\\\"a", "Hirvelä"],
    ["Andr{\\'e}ka", "Andréka"],
    ["{\\'\\i}", "í"],
    ["{\\O}ystein", "Øystein"],
    ["Taylor {\\&} Francis", "Taylor & Francis"],
    ["\\textit{Principia} and \\emph{Mathematica}", "Principia and Mathematica"],
    ["pages 1--2 and a---b", "pages 1–2 and a—b"],
    ["``quoted''", "“quoted”"],
    ["The {$\\lambda$}-calculus", "The $\\lambda$-calculus"],
    ["a\n   b", "a b"],
    ["Stra{\\ss}e", "Straße"],
  ])("%s", (input, expected) => {
    expect(latexToText(input)).toBe(expected);
  });
});

describe("parseNames", () => {
  const names = (raw: string) => parseNames(raw).map(displayName);
  it("reads the three BibTeX forms", () => {
    expect(names("Bacon, Andrew and Dorr, Cian")).toEqual(["Andrew Bacon", "Cian Dorr"]);
    expect(names("Ludwig van Beethoven")).toEqual(["Ludwig van Beethoven"]);
    expect(parseNames("van Fraassen, Bas C.")[0]).toMatchObject({ von: "van", last: "Fraassen", first: "Bas C." });
    expect(parseNames("King, Jr, Martin Luther")[0]).toMatchObject({ last: "King", jr: "Jr", first: "Martin Luther" });
    expect(names("Picado, Jorge and Pultr, Aleš")).toEqual(["Jorge Picado", "Aleš Pultr"]);
  });
  it("keeps braced names whole", () => {
    expect(names("{Ionin Tania} and {Matushansky Ora}")).toEqual(["Ionin Tania", "Matushansky Ora"]);
    expect(names("{\\O}ystein Linnebo")).toEqual(["Øystein Linnebo"]);
    expect(names("{Barnes and Noble}")).toEqual(["Barnes and Noble"]);
  });
});

describe("parseBibtex", () => {
  const bib = String.raw`
% a comment
@String{spr = "Springer"}
@Article{Goodman2023GG,
  author    = {Goodman, Jeremy},
  journal   = {Journal of Philosophical Logic},
  title     = {Grounding {Generalizations}},
  year      = {2023},
  month     = mar,
  publisher = spr # { Verlag},
  doi       = {10.1007/s10992-022-09689-x},
  file      = {:Goodman2023GG - Grounding Generalizations.pdf:PDF},
}
@Book{broken, title = {unclosed
@Book{After2020, title = "Still {read}", year = 2020}
@Comment{jabref-meta: databaseType:bibtex;}
@Comment{jabref-meta: fileDirectory:C\:\\Papers;}
`;
  const db = parseBibtex(bib);

  it("reads entries, macros and concatenation", () => {
    const e = db.entries.find((x) => x.key === "Goodman2023GG")!;
    expect(e.type).toBe("article");
    expect(e.fields.title).toBe("Grounding Generalizations");
    expect(e.fields.publisher).toBe("Springer Verlag");
    expect(e.fields.month).toBe("March");
    expect(e.fields.doi).toBe("10.1007/s10992-022-09689-x");
    expect(e.authors.map(displayName)).toEqual(["Jeremy Goodman"]);
  });

  it("skips a broken entry and carries on", () => {
    expect(db.entries.map((e) => e.key)).toEqual(["Goodman2023GG", "After2020"]);
    expect(db.entries[1].fields).toMatchObject({ title: "Still read", year: "2020" });
    expect(db.errors).toHaveLength(1);
    expect(db.errors[0]).toMatch(/^line 14:/);
  });

  it("reads JabRef's file directory", () => {
    expect(db.fileDirectory).toBe("C:\\Papers");
  });
});

describe("parseFileField", () => {
  it("reads JabRef's escaped links", () => {
    expect(
      parseFileField(
        String.raw`Full Text PDF:https\://link.springer.com/x.pdf:application/pdf;:Warren2022QVSCa“Q.pdf:PDF`,
      ),
    ).toEqual([
      { description: "Full Text PDF", link: "https://link.springer.com/x.pdf", type: "application/pdf" },
      { description: "", link: "Warren2022QVSCa“Q.pdf", type: "PDF" },
    ]);
    expect(parseFileField(String.raw`:C\:\\Users\\me\\a.pdf:PDF`)[0].link).toBe("C:\\Users\\me\\a.pdf");
    expect(parseFileField("plain.pdf")[0].link).toBe("plain.pdf");
    // Newer JabRef: the source URL comes fourth.
    expect(parseFileField(String.raw`Full Text PDF:Bacon2024 - M.pdf:PDF:https\://link.springer.com/x.pdf`)).toEqual([
      { description: "Full Text PDF", link: "Bacon2024 - M.pdf", type: "PDF" },
    ]);
  });
});

describe("Bibliography", () => {
  const text = String.raw`
@Article{Goodman2023GG, title = {Grounding}, author = {Goodman, Jeremy}, year = {2023},
  file = {:Goodman2023GG - Grounding Generalizations.pdf:PDF}}
@Article{Goodman2017RINS, title = {Realism about Intentional Nonsense}, author = {Goodman, Jeremy}, year = {2017}}
@Article{Lewis1997FD, title = {Finkish Dispositions}, author = {Lewis, David}, year = {1997},
  file = {:sub/lewis.pdf:PDF;Online:https\://example.com/lewis.pdf:URL}}
@InCollection{BaconDorrC, author = {Bacon, Andrew and Dorr, Cian}, title = {Classicism}, year = {2024},
  booktitle = {Higher-order {Metaphysics}}, pages = {109--190}}
@Article{Kripke1975, title = {Outline of a Theory of Truth}, author = {Kripke, Saul}, year = {forthcoming}}
`;
  const bib = new Bibliography(text, "C:\\Vault\\Library\\database.bib");

  it("matches a PDF by the entry's file field", () => {
    expect(bib.match("C:\\Vault\\Library\\sub\\lewis.pdf")).toEqual({ citekey: "Lewis1997FD", by: "file field" });
    expect(bib.match("c:/vault/library/Goodman2023GG - Grounding Generalizations.pdf")?.citekey).toBe("Goodman2023GG");
    // Moved elsewhere, same name.
    expect(bib.match("D:\\Downloads\\lewis.pdf")?.citekey).toBe("Lewis1997FD");
  });

  it("matches a PDF by a citekey at the start of its name", () => {
    expect(bib.match("C:\\x\\Goodman2017RINS - Realism.pdf")).toEqual({ citekey: "Goodman2017RINS", by: "file name" });
    expect(bib.match("C:\\x\\BaconDorrC.pdf")).toEqual({ citekey: "BaconDorrC", by: "file name" });
    expect(bib.match("C:\\x\\bacondorrc.pdf")?.citekey).toBe("BaconDorrC");
    expect(bib.match("C:\\x\\Goodman2023 other.pdf")).toBeNull();
    expect(bib.match("C:\\x\\unrelated.pdf")).toBeNull();
  });

  it("searches by citekey, title, author and year", () => {
    expect(bib.search("goodman").map((e) => e.key).sort()).toEqual(["Goodman2017RINS", "Goodman2023GG"]);
    expect(bib.search("goodman 2017").map((e) => e.key)).toEqual(["Goodman2017RINS"]);
    expect(bib.search("finkish")[0].key).toBe("Lewis1997FD");
    expect(bib.search("bacondorr")[0].key).toBe("BaconDorrC");
  });

  it("gives the Citations plugin's template variables", () => {
    const v = citationVariables(bib.get("BaconDorrC")!);
    expect(v).toMatchObject({
      citekey: "BaconDorrC",
      title: "Classicism",
      authorString: "Andrew Bacon, Cian Dorr",
      containerTitle: "Higher-order Metaphysics",
      page: "109–190",
      year: "2024",
      zoteroSelectURI: "zotero://select/items/@BaconDorrC",
    });
    expect(citationVariables(bib.get("Kripke1975")!).year).toBe("forthcoming");
  });

  it("normalises paths", () => {
    expect(normalisePath("C:\\A\\b\\..\\c\\.\\D.pdf")).toBe("c:/a/c/d.pdf");
  });
});

// The user's own bibliography and the literature notes the Citations plugin
// made from it: Tourmaline must give the same title, authors and year.
const VAULT = "C:/Users/amcle/Documents/Academia";
describe.skipIf(!existsSync(join(VAULT, "Library/database.bib")))("the user's JabRef bibliography", () => {
  const path = join(VAULT, "Library/database.bib");
  const bib = new Bibliography(readFileSync(path, "utf8"), path);

  it("reads every entry", () => {
    expect(bib.errors).toEqual([]);
    expect(bib.entries.size).toBeGreaterThan(1000);
  });

  it("matches every PDF an entry links to", () => {
    expect(bib.match(join(VAULT, "Library/Goodman2023GG - Grounding Generalizations.pdf"))?.citekey).toBe("Goodman2023GG");
    expect(bib.match(join(VAULT, "Library/BaconDorrC.pdf"))?.citekey).toBe("BaconDorrC");
    const wrong: string[] = [];
    let checked = 0;
    for (const entry of bib.entries.values()) {
      for (const f of entry.raw.file ? parseFileField(entry.raw.file) : []) {
        const path = /^[a-zA-Z]:/.test(f.link) ? f.link : join(VAULT, "Library", f.link);
        if (!f.link.toLowerCase().endsWith(".pdf") || !existsSync(path)) continue;
        checked++;
        const match = bib.match(path);
        // Two entries sharing one PDF can only match one of them.
        if (match?.citekey !== entry.key && !bib.get(match?.citekey ?? "")?.raw.file?.includes(f.link)) {
          wrong.push(`${f.link}: ${match?.citekey}, not ${entry.key}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(wrong).toEqual([]);
  });

  it("agrees with the notes the Citations plugin created", () => {
    const folder = join(VAULT, "Obsidian/Library");
    let compared = 0;
    const differences: string[] = [];
    for (const name of readdirSync(folder)) {
      const key = /^@(.+)\.md$/.exec(name)?.[1];
      const entry = key && bib.get(key);
      if (!entry) continue;
      const head = readFileSync(join(folder, name), "utf8").split(/\r?\n---/)[0];
      const title = /^Title: "(.*)"$/m.exec(head)?.[1];
      const author = /^Author: "\[\[(.*)\]\]"$/m.exec(head)?.[1];
      if (title === undefined || author === undefined) continue; // edited by hand
      compared++;
      const v = citationVariables(entry);
      // Titles have since been recased in JabRef, so case is ignored; a
      // missing author renders as "".
      const same = (a: unknown, b: string) => String(a ?? "").toLowerCase() === b.toLowerCase();
      if (!same(v.title, title)) differences.push(`${key} title: ${JSON.stringify(v.title)} vs ${JSON.stringify(title)}`);
      if (!same(v.authorString, author)) differences.push(`${key} author: ${JSON.stringify(v.authorString)} vs ${JSON.stringify(author)}`);
    }
    expect(compared).toBeGreaterThan(50);
    expect(differences).toEqual([]);
  });
});
