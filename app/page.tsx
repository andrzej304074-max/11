"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CropEditor } from "@/components/CropEditor";
import { DropZone } from "@/components/DropZone";
import { FileQueue } from "@/components/FileQueue";
import { LabelCard, type CardState } from "@/components/LabelCard";
import {
  type AnalyzeProgress,
  type PagePreview,
  type Source,
  analyze,
  cleanup,
  generate,
  pagePreview,
} from "@/lib/client";
import { printPdf } from "@/lib/print";
import type { GenerateItem, PtRect } from "@/lib/types";

type Editing = { id: string; preview: PagePreview } | null;

export default function Home() {
  const [sources, setSources] = useState<Source[]>([]);
  const [cards, setCards] = useState<CardState[]>([]);
  const [previews, setPreviews] = useState<Record<string, PagePreview>>({});
  const [withHeader, setWithHeader] = useState(true);
  const [busy, setBusy] = useState<null | "analyze" | "generate" | "print" | "preview">(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  /** Set when a run finished cleanly but found nothing, so the screen says so. */
  const [empty, setEmpty] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  const selected = useMemo(() => cards.filter((card) => card.include).length, [cards]);

  // The uploaded originals hold third-party personal data: drop them if the
  // user walks away without generating anything.
  const live = useRef<Source[]>([]);
  live.current = sources;
  useEffect(() => {
    const drop = () => void cleanup(live.current);
    window.addEventListener("pagehide", drop);
    return () => window.removeEventListener("pagehide", drop);
  }, []);

  const addFiles = (files: File[]) => {
    setSources((current) => [...current, ...files.map((file) => ({ file }))]);
    setCards([]);
  };

  /** Keeps already-analyzed cards pointing at the right file after a reorder. */
  const remapCards = (map: (fileIndex: number) => number | null) => {
    setCards((current) =>
      current
        .map((card) => {
          const next = map(card.fileIndex);
          return next === null ? null : { ...card, fileIndex: next };
        })
        .filter((card): card is CardState => card !== null)
        .sort((a, b) => a.fileIndex - b.fileIndex || a.pageIndex - b.pageIndex || a.id.localeCompare(b.id)),
    );
  };

  const moveFile = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= sources.length) return;
    setSources((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    remapCards((fileIndex) => (fileIndex === index ? target : fileIndex === target ? index : fileIndex));
  };

  const removeFile = (index: number) => {
    void cleanup([sources[index]]);
    setSources((current) => current.filter((_, i) => i !== index));
    remapCards((fileIndex) =>
      fileIndex === index ? null : fileIndex > index ? fileIndex - 1 : fileIndex,
    );
    setPreviews({});
  };

  const runAnalyze = async () => {
    setBusy("analyze");
    setError(null);
    setProgress({ done: 0, total: 0 });
    setEmpty(false);
    setCards([]);
    setPreviews({});
    try {
      // Cards land as each slice of pages comes back, so a long batch shows
      // something within a second or two instead of after the whole run.
      const found = await analyze(
        sources,
        (items) =>
          setCards((current) => [
            ...current,
            ...items.map((item) => ({
              ...item,
              include: item.kind !== "qr-only",
              edited: false,
              detectedRotate: item.rotate,
            })),
          ]),
        setProgress,
      );
      // Finishing with nothing is not success: without this the screen would
      // just drop back to the idle button as if the click never happened.
      setEmpty(found.length === 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analiza nie powiodła się");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const update = useCallback((id: string, patch: Partial<CardState>) => {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  }, []);

  const openCropEditor = async (card: CardState) => {
    const key = `${card.fileIndex}-${card.pageIndex}`;
    setBusy("preview");
    setError(null);
    try {
      const preview = previews[key] ?? (await pagePreview(sources[card.fileIndex], card.pageIndex));
      setPreviews((current) => ({ ...current, [key]: preview }));
      setEditing({ id: card.id, preview });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się wczytać podglądu strony");
    } finally {
      setBusy(null);
    }
  };

  const runGenerate = async (target: "download" | "print") => {
    setBusy(target === "print" ? "print" : "generate");
    setError(null);
    try {
      const items: GenerateItem[] = cards.map((card, index) => ({
        id: card.id,
        fileIndex: card.fileIndex,
        pageIndex: card.pageIndex,
        crop: card.crop,
        rotate: card.rotate,
        titleFixed: card.titleFixed,
        include: card.include,
        order: index,
        padMm: card.padMm,
      }));
      const blob = await generate(sources, items, withHeader);
      if (target === "print") {
        printPdf(blob);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "etykiety-100x150.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Generowanie nie powiodło się");
    } finally {
      setBusy(null);
    }
  };

  const editingCard = cards.find((card) => card.id === editing?.id);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Etykiety kurierskie na 100 × 150 mm</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Wrzuć PDF-y z Vinted lub podobnej platformy. Aplikacja przytnie, obróci i przeskaluje każdą
          etykietę, a na końcu odda jeden plik do druku.
        </p>
      </header>

      <div className="space-y-4">
        <DropZone onFiles={addFiles} disabled={busy !== null} />
        <FileQueue
          files={sources.map((source) => ({ name: source.file.name, size: source.file.size }))}
          onMove={moveFile}
          onRemove={removeFile}
          disabled={busy !== null}
        />

        {sources.length > 0 && (cards.length === 0 || busy === "analyze") && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runAnalyze}
              disabled={busy !== null}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === "analyze" ? "Analizuję…" : "Analizuj etykiety"}
            </button>
            {progress && progress.total > 0 && (
              <>
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full bg-neutral-900 transition-[width] duration-300"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
                <span className="text-sm text-neutral-500">
                  strona {progress.done} z {progress.total}
                </span>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
        )}

        {empty && !error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Nie znalazłem żadnej etykiety w tych plikach.</p>
            <p className="mt-1">
              Analiza przeszła bez błędu, ale każda strona wyszła pusta. Najczęstsza przyczyna to PDF
              będący skanem albo plik zabezpieczony hasłem. Sprawdź, czy strony w ogóle wyświetlają się
              w podglądzie.
            </p>
          </div>
        )}
      </div>

      {cards.length > 0 && (
        <section className="mt-8">
          <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-4 border-b border-neutral-200 bg-[#f6f6f4]/95 px-4 py-3 backdrop-blur">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withHeader}
                onChange={(event) => setWithHeader(event.target.checked)}
                className="h-4 w-4"
              />
              dodaj nazwy produktów
            </label>
            <button
              type="button"
              onClick={() => setCards((current) => current.map((card) => ({ ...card, include: selected !== current.length })))}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            >
              {selected === cards.length ? "Odznacz wszystkie" : "Zaznacz wszystkie"}
            </button>
            <span className="text-sm text-neutral-500">
              zaznaczono {selected} z {cards.length}
            </span>
            <button
              type="button"
              onClick={() => void runGenerate("print")}
              disabled={busy !== null || selected === 0}
              className="ml-auto rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {busy === "print" ? "Przygotowuję…" : "Drukuj"}
            </button>
            <button
              type="button"
              onClick={() => void runGenerate("download")}
              disabled={busy !== null || selected === 0}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === "generate" ? "Generuję…" : "Generuj PDF"}
            </button>
          </div>

          <p className="mb-5 text-xs text-neutral-600">
            „Drukuj” otwiera okno drukowania od razu, „Generuj PDF” pobiera plik. W obu wypadkach
            ustaw rozmiar papieru 100 × 150 mm i skalę 100%, nie „dopasuj do rozmiaru”. Wydrukuj
            najpierw jedną stronę na próbę.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => (
              <LabelCard
                key={card.id}
                item={card}
                preview={previews[`${card.fileIndex}-${card.pageIndex}`]}
                onToggle={() => update(card.id, { include: !card.include })}
                onRotate={(delta) =>
                  update(card.id, { rotate: (((card.rotate + delta + 360) % 360) as 0 | 90 | 180 | 270) })
                }
                onTitle={(value) => update(card.id, { titleFixed: value })}
                onEditCrop={() => void openCropEditor(card)}
              />
            ))}
          </div>
        </section>
      )}

      {editing && editingCard && (
        <CropEditor
          preview={editing.preview}
          crop={editingCard.crop}
          onChange={(crop: PtRect) => update(editingCard.id, { crop, edited: true })}
          onClose={() => setEditing(null)}
        />
      )}

      <footer className="mt-12 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        Etykiety zawierają dane osobowe odbiorców: pliki są przetwarzane wyłącznie w pamięci, nie trafiają
        na dysk, a kopie wysłane do przechowalni są kasowane zaraz po zbudowaniu wyniku. Nie zapisujemy
        nazw, adresów ani żadnej analityki zdarzeń z zawartości plików.
      </footer>
    </main>
  );
}
