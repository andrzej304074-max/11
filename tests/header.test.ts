import { describe, expect, it } from "vitest";

import { analyzeFixture, outputText, renderFixture } from "./helpers";
import { fixHeaderDiacritics } from "./util";

describe("kryterium 9: nazwa produktu nie powtarza się", () => {
  it("nagłówek jest jedynym wystąpieniem nazwy oferty", async () => {
    const [item] = await analyzeFixture("inpost.pdf");
    const [text] = await outputText(await renderFixture("inpost.pdf", true));
    const needle = "Szorty Sportowe";
    expect(text.match(new RegExp(needle, "g")) ?? []).toHaveLength(1);
    expect(item.titleFixed).toContain("Szorty Sportowe");
  });

  it("dwuwierszowa nazwa też nie wchodzi w kadr", async () => {
    const [text] = await outputText(await renderFixture("two-line-title.pdf", true));
    expect(text.match(/Spodnie Dresowe/g) ?? []).toHaveLength(1);
    // The label itself never contained the offer name, so without a header the
    // output must not mention it at all.
    const [plain] = await outputText(await renderFixture("two-line-title.pdf", false));
    expect(plain).not.toContain("Spodnie Dresowe");
  });
});

describe("kryterium 10: polskie znaki w nagłówku", () => {
  it("renderują się jako właściwe litery", async () => {
    const [text] = await outputText(await renderFixture("inpost.pdf", true));
    expect(text).toContain("Białymi");
    expect(text).not.toContain("Biaymi");
    expect(text).not.toMatch(/�/);
  });

  it("słownik podmian działa na całych słowach", () => {
    expect(fixHeaderDiacritics("Bluza Mska Biaymi")).toBe("Bluza Męska Białymi");
    expect(fixHeaderDiacritics("Mskie spodnie w Kratk")).toBe("Męskie spodnie w Kratkę");
    // Words outside the dictionary are left alone.
    expect(fixHeaderDiacritics("Sweter Bawelniany")).toBe("Sweter Bawelniany");
  });
});
