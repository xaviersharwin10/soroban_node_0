import { useRef } from "react";
import { Upload } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}

export function ContractInput({ value, onChange, disabled }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange((ev.target?.result as string) ?? "");
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-400 uppercase tracking-widest">
          Contract Source
        </label>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-green-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Upload size={12} />
          Upload .rs file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".rs"
          className="hidden"
          onChange={handleFile}
        />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        placeholder="// Paste your Soroban smart contract code here..."
        className="w-full h-80 resize-y rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-green-400 placeholder-gray-700 font-mono focus:outline-none focus:border-green-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
