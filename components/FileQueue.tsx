"use client";

export type QueueFile = { name: string; size: number };

export function FileQueue({
  files,
  onMove,
  onRemove,
  disabled,
}: {
  files: QueueFile[];
  onMove: (index: number, delta: number) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {files.map((file, index) => (
        <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <span className="w-6 tabular-nums text-neutral-400">{index + 1}.</span>
          <span className="flex-1 truncate">{file.name}</span>
          <span className="tabular-nums text-neutral-400">{(file.size / 1024).toFixed(0)} kB</span>
          <button
            type="button"
            disabled={disabled || index === 0}
            onClick={() => onMove(index, -1)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-30"
            aria-label="Przesuń w górę"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={disabled || index === files.length - 1}
            onClick={() => onMove(index, 1)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs disabled:opacity-30"
            aria-label="Przesuń w dół"
          >
            ↓
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(index)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-red-700 disabled:opacity-30"
          >
            Usuń
          </button>
        </li>
      ))}
    </ul>
  );
}
