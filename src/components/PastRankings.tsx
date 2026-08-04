import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Archive, Calendar, Loader2, Trash2, Trophy, Upload } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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

/** Tabla de solo lectura responsiva (ajustada para mobile y web). */
export function PastRankingTable({ ranking }: { ranking: PastRanking }) {
  const rows = Array.isArray(ranking.rows) ? ranking.rows : [];
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Este ranking no tiene datos.</p>;
  }
  const keys = guessKeys(rows);
  const posKey = keys.find((k) => /pos|#|puesto|rank/i.test(k));
  const nameKey = keys.find((k) => /nombre|usuario|user|name|jugador/i.test(k)) ?? keys[0];
  const restKeys = keys.filter((k) => k !== posKey && k !== nameKey);

  return (
    <ul className="divide-y divide-border/40 space-y-1">
      {rows.map((r, i) => {
        const position = posKey ? String(r[posKey] ?? i + 1) : i + 1;
        
        return (
          <li key={i} className="flex items-center justify-between gap-3 py-2 px-1 rounded-lg hover:bg-muted/20 transition-colors">
            {/* LADO IZQUIERDO: Posición + Nombre */}
            <div className="flex min-w-0 items-center gap-3">
              {/* Círculo de posición fijo sin solapamiento */}
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  i === 0
                    ? "bg-amber-400 text-slate-950"
                    : i === 1
                    ? "bg-slate-300 text-slate-950"
                    : i === 2
                    ? "bg-amber-700 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {position}
              </span>
              <span className="truncate text-sm font-medium text-foreground">
                {String(r[nameKey] ?? "—")}
              </span>
            </div>

            {/* LADO DERECHO: Métricas (se ocultan campos secundarios en pantallas muy chicas) */}
            <div className="flex shrink-0 items-center gap-2 text-right">
              {restKeys.map((k) => {
                const isIpOrStreak = /ip|racha|conexion/i.test(k);
                return (
                  <span
                    key={k}
                    className={`font-mono text-xs tabular-nums text-muted-foreground ${
                      isIpOrStreak ? "hidden sm:inline-block" : ""
                    }`}
                  >
                    <span className="mr-1 font-sans text-[9px] uppercase opacity-60">{k}:</span>
                    {String(r[k] ?? "")}
                  </span>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Vista pública: Acordeón desplegable con los rankings históricos. */
export function PastRankingsPublic() {
  const [items, setItems] = useState<PastRanking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchPastRankings().then((d) => {
      if (!alive) return;
      setItems(d);
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

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-border/50 pb-3">
        <Trophy className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Temporadas pasadas</h2>
      </div>

      {/* ACORDEÓN DESPLEGABLE */}
      <Accordion type="single" collapsible className="w-full space-y-2">
        {items.map((item) => (
          <AccordionItem
            key={item.id}
            value={item.id}
            className="border border-border/60 rounded-xl px-3 sm:px-4 overflow-hidden bg-card"
          >
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full text-left gap-1 pr-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold text-sm sm:text-base">{item.title}</span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Archivado el {new Date(item.created_at).toLocaleDateString()}
                </span>
              </div>
            </AccordionTrigger>

            <AccordionContent className="pt-2 pb-4 border-t border-border/40">
              <PastRankingTable ranking={item} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
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