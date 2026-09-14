"use client";

import { useCallback, useMemo, useState } from "react";

import { CropEditor } from "@/components/CropEditor";
import { DropZone } from "@/components/DropZone";
import { FileQueue } from "@/components/FileQueue";
import { LabelCard, type CardState } from "@/components/LabelCard";
import { type PagePreview, type Source, analyze, cleanup, generate, pagePreview } from "@/lib/client";
import type { GenerateItem, PtRect } from "@/lib/types";

type Editing = { id: string; preview: PagePreview } | null;

export default function Home() {
  const [sources, setSources] = useState<Source[]>([]);
  const [cards, setCards] = useState<CardState[]>([]);
  const [previews, setPreviews] = useState<Record<string, PagePreview>>({});
  const [withHeader, setWithHeader] = useState(true);
  const [busy, setBusy] = useState<null | "analyze" | "generate" | "preview">(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  const selected = useMemo(() => cards.filter((card) => card.include).length, [cards]);

  const addFiles = (files: File[]) => {
    setSources((current) => [...current, ...files.map((file) => ({ file }))]);
    setCards([]);
  };

  const moveFile = (index: number, delta: number) => {
    setSources((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setCards([]);
  };

  const removeFile = (index: number) => {
    setSources((current) => {
      void cleanup([current[index]]);
      return current.filter((_, i) => i !== index);
    });
    setCards([]);
  };

  const runAnalyze = async () => {
    setBusy("analyze");
    setError(null);
    try {
      const items = await analyze(sources);
      setCards(
        items.map((item) => ({
          ...item,
          include: item.kind !== "qr-only",
          edited: false,
          detectedRotate: item.rotate,
        })),
      );
      setPreviews({});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analiza nie powiodła się");
    } finally {
      setBusy(null);
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

  const runGenerate = async () => {
    setBusy("generate");
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

        {sources.length > 0 && cards.length === 0 && (
          <button
            type="button"
            onClick={runAnalyze}
            disabled={busy !== null}
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "analyze" ? "Analizuję…" : "Analizuj etykiety"}
          </button>
        )}

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
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
              onClick={runGenerate}
              disabled={busy !== null || selected === 0}
              className="ml-auto rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === "generate" ? "Generuję…" : "Generuj PDF"}
            </button>
          </div>

          <p className="mb-5 text-xs text-neutral-600">
            Drukuj z Podglądu, rozmiar papieru 100 × 150 mm, skala 100%, nie „dopasuj do rozmiaru”.
            Wydrukuj najpierw jedną stronę na próbę.
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
