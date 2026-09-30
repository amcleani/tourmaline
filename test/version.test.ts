import { looksLikeSamePaper } from "../src/annotations/version";

const paper =
  "grounding generalizations we study how generic statements such as tigers have stripes are grounded in facts about " +
  "individual tigers and argue that the grounding relation is not a matter of statistical prevalence but of the " +
  "normal functioning of the kind we develop a semantics on which generics quantify over normal instances and show " +
  "how this handles striking and characterizing generics alike before turning to objections from the literature";

describe("looksLikeSamePaper", () => {
  it("accepts a revised version of the same text", () => {
    const revised = paper.replace("we develop a semantics", "in section 3 we develop a new semantics") + " and a new appendix";
    expect(looksLikeSamePaper(paper, revised)).toBe(true);
  });

  it("rejects a different paper", () => {
    const other =
      "column aware reading order for scholarly documents readers of scholarly documents expect text to flow down the " +
      "left column and then down the right one with titles abstracts and wide figures interrupting that flow where " +
      "they sit on the page software that extracts text often gets this wrong we describe a simple model of column";
    expect(looksLikeSamePaper(paper, other)).toBe(false);
  });

  it("assumes the same paper when there is too little text to tell", () => {
    expect(looksLikeSamePaper("", paper)).toBe(true);
    expect(looksLikeSamePaper("figure 1", "table 2")).toBe(true);
  });
});
