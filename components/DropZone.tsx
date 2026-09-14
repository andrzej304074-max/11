"use client";

import { useRef, useState } from "react";

export function DropZone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const accept = (list: FileList | null) => {
    if (!list) return;
    const pdfs = Array.from(list).filter(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length) onFiles(pdfs);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!disabled) accept(event.dataTransfer.files);
      }}
      onClick={() => !disabled && input.current?.click()}
      className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
        over ? "border-neutral-900 bg-white" : "border-neutral-300 bg-white/60"
      } ${disabled ? "pointer-events-none opacity-50" : "hover:border-neutral-500"}`}
    >
      <p className="text-base font-medium">Przeciągnij tu PDF-y z etykietami</p>
      <p className="mt-1 text-sm text-neutral-500">albo kliknij, żeby wybrać pliki — można wiele naraz</p>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
