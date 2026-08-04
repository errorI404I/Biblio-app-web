import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Archive, Loader2, Trash2, Trophy, Upload } from "lucide-react";

export type PastRanking = {
  id: string;
  title: string;
  rows: Record<string, unknown>[];
  created_at: string;
};

const db = supabase as unknown as {
  from: (t: string) => any;
};

export async function fetchPastRankings(): Promise<PastRanking[]> {
  const { data, error } = await db
    .from("past_rankings")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as PastRanking[];
}

function guessKeys(rows: Record<string, unknown>[]) {
  const keys = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  return Array.from(keys);
}

/** Tabla de solo lectura con la estética del ranking en vivo (sin indicadores online). */
export function PastRankingTable({ ranking }: { ranking: PastRanking }) {
  const rows = Array.isArray(ranking.rows) ? ranking.rows : [];
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Este ranking no tiene datos.</p>;
  }
  const keys = guessKeys(rows);
  const posKey = keys.find((k) => /pos|#|puesto|rank/i.test(k));
  const nameKey = keys.find((k) => /nombre|usuario|user|name|jugador/i.test(k)) ?? keys[0];
  const restKeys = keys.filter((k) => k !== posKey && k !== nameKey);

  return (
    <ul className="divide-y divide-border">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {posKey ? String(r[posKey] ?? i + 1) : i + 1}
            </span>
            <span className="truncate font-medium">{String(r[nameKey] ?? "—")}</span>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-1 text-right">
            {restKeys.map((k) => (
              <span key={k} className="font-mono tabular-nums text-xs text-muted-foreground">
                <span className="mr-1 font-sans text-[10px] uppercase opacity-70">{k}</span>
                {String(r[k] ?? "")}
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Vista pública: selector de temporada + tabla histórica. */
export function PastRankingsPublic() {
  const [items, setItems] = useState<PastRanking[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchPastRankings().then((d) => {
      if (!alive) return;
      setItems(d);
      setSelected((s) => s ?? d[0]?.id ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <Card className="p-8 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <Archive className="mx-auto mb-2 h-6 w-6 opacity-60" />
        Todavía no hay temporadas archivadas.
      </Card>
    );
  }

  const current = items.find((i) => i.id === selected) ?? items[0];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Temporadas pasadas</h2>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {items.map((it) => (
          <Button
            key={it.id}
            size="sm"
            variant={it.id === current.id ? "default" : "outline"}
            className="text-xs"
            onClick={() => setSelected(it.id)}
          >
            {it.title}
          </Button>
        ))}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Archivado el {new Date(current.created_at).toLocaleDateString()} · solo lectura
      </p>
      <PastRankingTable ranking={current} />
    </Card>
  );
}

/** Módulo de administración: subir .xlsx y eliminar rankings antiguos. */
export function PastRankingsManager() {
  const [items, setItems] = useState<PastRanking[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => setItems(await fetchPastRankings()), []);
  useEffect(() => {
    load();
  }, [load]);

  const upload = async () => {
    if (!file) return toast.error("Elegí un archivo .xlsx");
    if (!title.trim()) return toast.error("Poné un título para la edición");
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
      if (rows.length === 0) throw new Error("El archivo no tiene filas.");
      const { error } = await db.from("past_rankings").insert({ title: title.trim(), rows });
      if (error) throw error;
      toast.success(`Ranking "${title.trim()}" archivado (${rows.length} filas).`);
      setTitle("");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo procesar el archivo.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await db.from("past_rankings").delete().eq("id", id);
    if (error) return toast.error("No se pudo eliminar.");
    toast.success("Ranking eliminado.");
    load();
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Archive className="h-4 w-4" /> Gestor de Rankings Antiguos
        </h3>
        <div className="space-y-1">
          <Label className="text-xs">Título de la edición</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Temporada 1 - Julio 2026"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Archivo Excel</Label>
          <Input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
        </div>
        <Button onClick={upload} disabled={busy} className="w-full">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Subir y archivar
        </Button>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Archivados ({items.length})</h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin rankings antiguos.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{it.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {(it.rows?.length ?? 0)} filas · {new Date(it.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Button size="sm" variant="destructive" onClick={() => remove(it.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
