import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Save, Lock, Activity, Sparkles, History, Zap, Pencil, Users, LogOut, Clock, Megaphone, Image as ImageIcon, Trophy, Terminal, PlayCircle, FileDown, Archive, ShoppingBag, Upload } from "lucide-react";
import { PastRankingsManager } from "@/components/PastRankings";

const ADMIN_PASS = "54321";
const ALLOWED_IP = "131.221.0.8";
const HEARTBEAT_TOLERANCE_MS = 70 * 60 * 1000;

type Session = {
  id: string;
  user_name: string;
  start_time: string;
  end_time: string | null;
  total_minutes: number | null;
  last_seen: string | null;
  multiplier?: number | null;
  event_name?: string | null;
};

type Setting = {
  id: string;
  key: string;
  multiplier: number;
  event_name: string | null;
  active: boolean;
};

type ShopItem = {
  id: string;
  title: string;
  description: string | null;
  price: number;
  type: string;
};

export function AdminPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [authed, setAuthed] = useState(false);
  const [pass, setPass] = useState("");
  const [active, setActive] = useState<Session[]>([]);
  const [history, setHistory] = useState<Session[]>([]);
  const [setting, setSetting] = useState<Setting | null>(null);
  const [eventName, setEventName] = useState("");
  const [multiplier, setMultiplier] = useState(2);
  const [eventActive, setEventActive] = useState(false);
  const [eventMinutes, setEventMinutes] = useState<number>(0);
  const [eventExpiresAt, setEventExpiresAt] = useState<string | null>(null);
  
  // Broadcast
  const [bcastMsg, setBcastMsg] = useState("");
  const [bcastMins, setBcastMins] = useState(10);
  const [bcastImg, setBcastImg] = useState("");
  const [bcastImgMins, setBcastImgMins] = useState(15);
  const [bcastFile, setBcastFile] = useState<File | null>(null);
  const [bcastFilePreview, setBcastFilePreview] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [bcasts, setBcasts] = useState<any[]>([]);

  // Shop & Economy Config
  const [hoursToCoinsRate, setHoursToCoinsRate] = useState<number>(10);
  const [coinsToHoursRate, setCoinsToHoursRate] = useState<number>(15);
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");

  // Gestión de Usuarios
  const [allUsers, setAllUsers] = useState<string[]>([]);
  const [editingUserOld, setEditingUserOld] = useState<string | null>(null);
  const [editingUserNew, setEditingUserNew] = useState("");

  // Restaurar Backup Excel
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Cierre de ciclo / temporada
  const [seasonConfirm, setSeasonConfirm] = useState(false);
  const [seasonRunning, setSeasonRunning] = useState(false);

  // Diagnóstico
  const [diagLogs, setDiagLogs] = useState<string[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagNow, setDiagNow] = useState(Date.now());

  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => setDiagNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [authed]);

  const loadAll = async () => {
    const [{ data: act }, { data: hist }, { data: s }, { data: bc }, { data: config }, { data: items }, { data: usersData }] = await Promise.all([
      supabase.from('sesiones').select("*").is("end_time", null).order("start_time", { ascending: false }),
      supabase.from('sesiones').select("*").not("end_time", "is", null).order("start_time", { ascending: false }).limit(100),
      supabase.from("settings").select("*").eq("key", "multiplier").maybeSingle(),
      (supabase as any).from("broadcasts").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("app_config").select("*"),
      supabase.from("shop_items").select("*"),
      supabase.from('sesiones').select("user_name"),
    ]);
    setActive((act ?? []) as Session[]);
    setHistory((hist ?? []) as Session[]);
    if (s) {
      setSetting(s as Setting);
      setMultiplier(Number(s.multiplier) || 1);
      setEventName(s.event_name ?? "");
      setEventActive(!!s.active);
      const exp = (s as any).expires_at as string | null;
      setEventExpiresAt(exp ?? null);
      if (exp) {
        const remainMin = Math.max(0, Math.round((new Date(exp).getTime() - Date.now()) / 60000));
        setEventMinutes(remainMin);
      }
    }
    setBcasts(bc ?? []);
    if (config) {
      const htc = config.find((c: any) => c.key === 'hours_to_coins_rate');
      const cth = config.find((c: any) => c.key === 'coins_to_hours_rate');
      if (htc) setHoursToCoinsRate(Number(htc.value));
      if (cth) setCoinsToHoursRate(Number(cth.value));
    }
    if (items) setShopItems(items as ShopItem[]);
    if (usersData) {
      const uniqueNames = Array.from(new Set(usersData.map((u: any) => u.user_name))).filter(Boolean) as string[];
      setAllUsers(uniqueNames.sort());
    }
  };

  useEffect(() => {
    if (authed) {
      loadAll();
      const t = setInterval(loadAll, 10000);
      return () => clearInterval(t);
    }
  }, [authed]);

  const tryAuth = () => {
    if (pass === ADMIN_PASS) setAuthed(true);
    else toast.error("Clave incorrecta");
  };

  // Funciones para Gestión de Usuarios
  const handleRenameUser = async (oldName: string) => {
    const newName = editingUserNew.trim();
    if (!newName) {
      toast.error("El nuevo nombre no puede estar vacío");
      return;
    }
    if (newName === oldName) {
      setEditingUserOld(null);
      return;
    }

    try {
      // Actualizar en sesiones
      await supabase.from('sesiones').update({ user_name: newName }).eq('user_name', oldName);
      // Actualizar en wallet
      await supabase.from('user_wallet').update({ user_name: newName }).eq('user_name', oldName);
      // Actualizar en inventario
      await supabase.from('user_inventory').update({ user_name: newName }).eq('user_name', oldName);
      // Actualizar en notificaciones
      await supabase.from('notifications').update({ user_name: newName }).eq('user_name', oldName);

      toast.success(`Usuario renombrado de "${oldName}" a "${newName}"`);
      setEditingUserOld(null);
      setEditingUserNew("");
      loadAll();
    } catch (e: any) {
      toast.error("Error al renombrar usuario: " + (e?.message ?? "desconocido"));
    }
  };

  const handleDeleteUser = async (userName: string) => {
    if (!confirm(`¿Estás seguro de eliminar a "${userName}" y TODOS sus registros (sesiones, inventario, wallet)?`)) return;

    try {
      await supabase.from('sesiones').delete().eq('user_name', userName);
      await supabase.from('user_wallet').delete().eq('user_name', userName);
      await supabase.from('user_inventory').delete().eq('user_name', userName);
      await supabase.from('notifications').delete().eq('user_name', userName);

      toast.success(`Usuario "${userName}" eliminado correctamente.`);
      loadAll();
    } catch (e: any) {
      toast.error("Error al eliminar usuario: " + (e?.message ?? "desconocido"));
    }
  };

  const handleRestoreBackup = async () => {
    if (!restoreFile) {
      toast.error("Selecciona un archivo .xlsx primero");
      return;
    }

    setRestoring(true);
    try {
      const XLSX = await import("xlsx");
      const dataBuffer = await restoreFile.arrayBuffer();
      const workbook = XLSX.read(dataBuffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (!rows || rows.length === 0) {
        throw new Error("El archivo está vacío o tiene un formato no válido.");
      }

      let insertedCount = 0;
      const nowIso = new Date().toISOString();

      for (const row of rows) {
        const userName = row["Nombre de Usuario"] || row["user_name"];
        const totalMinutes = row["Minutos Totales"] || (row["Horas Totales Acumuladas"] ? Math.round(row["Horas Totales Acumuladas"] * 60) : 0);

        if (userName && totalMinutes > 0) {
          const { error } = await supabase.from('sesiones').insert({
            user_name: userName,
            start_time: nowIso,
            end_time: nowIso,
            total_minutes: totalMinutes,
            last_seen: nowIso,
            multiplier: 1,
            event_name: "Restauración de Backup (.xlsx)",
          });

          if (!error) insertedCount++;
        }
      }

      toast.success(`¡Backup restaurado con éxito! Se cargaron ${insertedCount} registros al sistema.`);
      setRestoreFile(null);
      loadAll();
    } catch (e: any) {
      toast.error("Error al procesar el archivo: " + (e?.message ?? "desconocido"));
    } finally {
      setRestoring(false);
    }
  };

  const saveEvent = async () => {
    if (!setting) return;
    const expiresIso =
      eventActive && eventMinutes > 0
        ? new Date(Date.now() + eventMinutes * 60 * 1000).toISOString()
        : null;
    const { error } = await supabase
      .from("settings")
      .update({
        multiplier,
        event_name: eventName.trim() || null,
        active: eventActive,
        expires_at: expiresIso,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", setting.id);
    if (error) return toast.error("Error al guardar");
    setEventExpiresAt(expiresIso);
    toast.success("Configuración de evento guardada");
    loadAll();
  };

  const saveEconomyRates = async () => {
    const { error: err1 } = await supabase
      .from("app_config")
      .upsert({ key: "hours_to_coins_rate", value: hoursToCoinsRate });
    const { error: err2 } = await supabase
      .from("app_config")
      .upsert({ key: "coins_to_hours_rate", value: coinsToHoursRate });
    if (err1 || err2) return toast.error("Error al actualizar tasas");
    toast.success("Tasas de intercambio actualizadas");
    loadAll();
  };

  const createShopItem = async () => {
    if (!newItemTitle.trim() || !newItemPrice) return toast.error("Completa título y precio");
    const { error } = await supabase.from("shop_items").insert({
      title: newItemTitle.trim(),
      description: newItemDesc.trim() || null,
      price: parseFloat(newItemPrice),
      type: "activable",
    });
    if (error) return toast.error("Error al crear ítem");
    toast.success("Ítem agregado a la tienda");
    setNewItemTitle("");
    setNewItemDesc("");
    setNewItemPrice("");
    loadAll();
  };

  const updateShopItemPrice = async (id: string, newPrice: string) => {
    const priceNum = parseFloat(newPrice);
    if (isNaN(priceNum) || priceNum < 0) return toast.error("Precio inválido");

    const { error } = await supabase
      .from("shop_items")
      .update({ price: priceNum })
      .eq("id", id);

    if (error) return toast.error("Error al actualizar precio");
    toast.success("Precio actualizado con éxito");
    loadAll();
  };

  const deleteShopItem = async (id: string) => {
    const { error } = await supabase.from("shop_items").delete().eq("id", id);
    if (error) return toast.error("Error al eliminar");
    toast.success("Ítem eliminado");
    loadAll();
  };

  const kickUser = async (s: Session) => {
    if (!confirm(`¿Desconectar a ${s.user_name}?`)) return;
    const { data: setting } = await supabase
      .from("settings")
      .select("multiplier,event_name,active")
      .eq("key", "multiplier")
      .maybeSingle();
    const mult = setting?.active ? Number(setting.multiplier) || 1 : 1;
    const evName = setting?.active ? setting.event_name : null;
    const nowIso = new Date().toISOString();
    const raw = Math.max(1, Math.round((Date.now() - new Date(s.start_time).getTime()) / 60000));
    const minutes = Math.round(raw * mult);
    const { error } = await supabase
      .from('sesiones')
      .update({
        end_time: nowIso,
        total_minutes: minutes,
        last_seen: nowIso,
        multiplier: mult,
        event_name: evName,
      })
      .eq("id", s.id);
    if (error) return toast.error("Error al desconectar");
    toast.success(`👢 ${s.user_name} desconectado`);
    loadAll();
  };

  const adjustUserTime = async (name: string) => {
    const v = prompt(`Ajustar minutos para "${name}" (+sumar / -restar):`, "0");
    if (v == null) return;
    const delta = parseInt(v, 10);
    if (Number.isNaN(delta) || delta === 0) return toast.error("Valor inválido");
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('sesiones').insert({
      user_name: name,
      start_time: nowIso,
      end_time: nowIso,
      total_minutes: delta,
      last_seen: nowIso,
      multiplier: 1,
      event_name: delta >= 0 ? "Ajuste admin (+)" : "Penalización admin (−)",
    });
    if (error) return toast.error("Error al ajustar");
    toast.success(`⏱ ${name}: ${delta > 0 ? "+" : ""}${delta} min`);
    loadAll();
  };

  const sendTextBroadcast = async () => {
    const msg = bcastMsg.trim();
    if (!msg) return toast.error("Escribe un mensaje");
    if (bcastMins <= 0) return toast.error("Duración inválida");
    const expires = new Date(Date.now() + bcastMins * 60 * 1000).toISOString();
    const { error } = await (supabase as any).from("broadcasts").insert({
      type: "text",
      message: msg,
      expires_at: expires,
    });
    if (error) return toast.error("Error al enviar");
    toast.success(`📢 Mensaje enviado`);
    setBcastMsg("");
    loadAll();
  };

  const onPickFile = (f: File | null) => {
    setBcastFile(f);
    if (bcastFilePreview) URL.revokeObjectURL(bcastFilePreview);
    setBcastFilePreview(f ? URL.createObjectURL(f) : "");
  };

  const sendImageBroadcast = async () => {
    if (bcastImgMins <= 0) return toast.error("Duración inválida");
    let url = bcastImg.trim();

    if (bcastFile) {
      setUploading(true);
      try {
        const ext = bcastFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("announcements_images")
          .upload(path, bcastFile, {
            cacheControl: "3600",
            upsert: false,
            contentType: bcastFile.type || undefined,
          });
        if (upErr) {
          setUploading(false);
          return toast.error("Error al subir: " + upErr.message);
        }
        const { data: pub } = supabase.storage
          .from("announcements_images")
          .getPublicUrl(path);
        url = pub.publicUrl;
      } catch (e: any) {
        setUploading(false);
        return toast.error("Error al subir: " + (e?.message ?? "desconocido"));
      }
      setUploading(false);
    }

    if (!url) return toast.error("Subí un archivo o pegá una URL");

    const expires = new Date(Date.now() + bcastImgMins * 60 * 1000).toISOString();
    const { error } = await (supabase as any).from("broadcasts").insert({
      type: "image",
      image_url: url,
      expires_at: expires,
    });
    if (error) return toast.error("Error al enviar");
    toast.success(`🖼 Pop-up enviado`);
    setBcastImg("");
    onPickFile(null);
    loadAll();
  };

  const deleteBroadcast = async (id: string) => {
    const { error } = await (supabase as any).from("broadcasts").delete().eq("id", id);
    if (error) return toast.error("Error");
    toast.success("Eliminado");
    loadAll();
  };

  const closeSeason = async () => {
    setSeasonRunning(true);
    try {
      const { data: all, error: readErr } = await supabase
        .from('sesiones')
        .select("*")
        .order("start_time", { ascending: true });
      if (readErr) throw readErr;
      const rows = (all ?? []) as Session[];

      const byUser = new Map<string, { minutes: number; days: Set<string>; lastIp: string }>();
      for (const s of rows) {
        const entry = byUser.get(s.user_name) ?? { minutes: 0, days: new Set<string>(), lastIp: ALLOWED_IP };
        entry.minutes += s.total_minutes ?? 0;
        entry.days.add(new Date(s.start_time).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
        byUser.set(s.user_name, entry);
      }
      const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
      const streakOf = (days: Set<string>) => {
        let streak = 0;
        const cursor = new Date();
        if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
        while (days.has(dayKey(cursor))) {
          streak++;
          cursor.setDate(cursor.getDate() - 1);
        }
        return streak;
      };

      const table = Array.from(byUser, ([user_name, v]) => ({ user_name, ...v }))
        .sort((a, b) => b.minutes - a.minutes)
        .map((r, i) => ({
          "Posición": i + 1,
          "Nombre de Usuario": r.user_name,
          "Horas Totales Acumuladas": Math.round((r.minutes / 60) * 100) / 100,
          "Minutos Totales": r.minutes,
          "Racha Actual (Días)": streakOf(r.days),
          "IP Última Conexión": r.lastIp,
        }));

      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(table);
      ws["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Ranking");
      const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
      XLSX.writeFile(wb, `Ranking_Cierre_${stamp}.xlsx`);

      const nowIso = new Date().toISOString();
      const openOnes = rows.filter((s) => s.end_time == null);
      for (const s of openOnes) {
        await supabase.from('sesiones').update({ end_time: nowIso, total_minutes: 0 }).eq("id", s.id);
      }

      const { error: resetErr } = await supabase
        .from('sesiones')
        .update({ total_minutes: 0 })
        .not("total_minutes", "is", null);
      if (resetErr) throw resetErr;

      setSeasonConfirm(false);
      toast.success("¡Ranking exportado con éxito y base de datos reiniciada!");
      loadAll();
    } catch (e: any) {
      toast.error("Error en el cierre: " + (e?.message ?? "desconocido"));
    } finally {
      setSeasonRunning(false);
    }
  };

  const ranking = (() => {
    const map = new Map<string, number>();
    for (const s of [...active, ...history]) {
      if (s.total_minutes != null) map.set(s.user_name, (map.get(s.user_name) ?? 0) + (s.total_minutes ?? 0));
    }
    return Array.from(map, ([user_name, minutes]) => ({ user_name, minutes })).sort((a, b) => b.minutes - a.minutes);
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Panel de Administración
          </DialogTitle>
        </DialogHeader>

        {!authed ? (
          <div className="space-y-3">
            <Label>Clave de acceso</Label>
            <Input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tryAuth()}
              autoFocus
            />
            <Button onClick={tryAuth} className="w-full">Ingresar</Button>
          </div>
        ) : (
          <Tabs defaultValue="live">
            <TabsList className="grid w-full grid-cols-10 text-[11px]">
              <TabsTrigger value="live"><Activity className="mr-1 h-3 w-3" />Vivo</TabsTrigger>
              <TabsTrigger value="ranking"><Trophy className="mr-1 h-3 w-3" />Ranking</TabsTrigger>
              <TabsTrigger value="broadcast"><Megaphone className="mr-1 h-3 w-3" />Broad.</TabsTrigger>
              <TabsTrigger value="event"><Sparkles className="mr-1 h-3 w-3" />Evento</TabsTrigger>
              <TabsTrigger value="shop"><ShoppingBag className="mr-1 h-3 w-3" />Tienda</TabsTrigger>
              <TabsTrigger value="restore"><Upload className="mr-1 h-3 w-3" />Restaurar</TabsTrigger>
              <TabsTrigger value="users"><Users className="mr-1 h-3 w-3" />Users</TabsTrigger>
              <TabsTrigger value="history"><History className="mr-1 h-3 w-3" />Hist.</TabsTrigger>
              <TabsTrigger value="past"><Archive className="mr-1 h-3 w-3" />Archivo</TabsTrigger>
              <TabsTrigger value="diag"><Terminal className="mr-1 h-3 w-3" />Diag</TabsTrigger>
            </TabsList>

            <TabsContent value="live" className="mt-4 space-y-3">
              <Button
                onClick={async () => {
                  if (!confirm("¿Desconectar a todos?")) return;
                  const { data: sessions } = await supabase.from('sesiones').select("*").is("end_time", null);
                  if (!sessions) return;
                  const nowIso = new Date().toISOString();
                  for (const sess of sessions) {
                    const raw = Math.max(1, Math.round((Date.now() - new Date(sess.start_time).getTime()) / 60000));
                    await supabase.from('sesiones').update({ end_time: nowIso, total_minutes: raw, last_seen: nowIso }).eq("id", sess.id);
                  }
                  toast.success("Todos desconectados");
                  loadAll();
                }}
                variant="destructive"
                className="w-full font-bold uppercase tracking-wider"
                size="lg"
              >
                <Zap className="mr-2 h-5 w-5" /> Desconectar a Todos
              </Button>
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold">Sesiones activas ({active.length})</h3>
                {active.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nadie conectado.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {active.map((s) => {
                      const mins = Math.floor((Date.now() - new Date(s.start_time).getTime()) / 60000);
                      return (
                        <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{s.user_name}</div>
                            <div className="text-xs text-muted-foreground">
                              Inicio: {new Date(s.start_time).toLocaleTimeString()} · {mins} min
                            </div>
                          </div>
                          <Button size="sm" variant="destructive" onClick={() => kickUser(s)} className="h-7 px-2 text-xs">
                            <LogOut className="mr-1 h-3 w-3" /> Kick
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="ranking" className="mt-4 space-y-3">
              <Button
                onClick={() => setSeasonConfirm(true)}
                variant="destructive"
                size="lg"
                className="w-full font-bold uppercase tracking-wider"
              >
                <FileDown className="mr-2 h-5 w-5" /> Descargar Ranking (.xlsx) y Resetear
              </Button>

              <AlertDialog open={seasonConfirm} onOpenChange={setSeasonConfirm}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Cerrar el ciclo/temporada?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Se descargará el ranking actual en Excel y luego todos los contadores volverán a 0.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={seasonRunning}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        closeSeason();
                      }}
                      disabled={seasonRunning}
                    >
                      {seasonRunning ? "Procesando…" : "Descargar y resetear"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold">Ranking · Ajuste manual ({ranking.length})</h3>
                {ranking.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {ranking.map((r, i) => {
                      const h = Math.floor(r.minutes / 60);
                      const m = r.minutes % 60;
                      return (
                        <li key={r.user_name} className="flex items-center justify-between gap-2 py-2 text-sm">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                            <span className="truncate font-medium">{r.user_name}</span>
                          </div>
                          <span className="font-mono tabular-nums text-xs text-muted-foreground">
                            {h}h {String(m).padStart(2, "0")}m
                          </span>
                          <Button size="sm" variant="outline" onClick={() => adjustUserTime(r.user_name)} className="h-7 px-2 text-xs">
                            <Clock className="mr-1 h-3 w-3" /> Ajustar
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="broadcast" className="mt-4 space-y-4">
              <Card className="p-4 space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Megaphone className="h-4 w-4" /> Mensaje de texto (banner)
                </h3>
                <Input
                  placeholder="Ej: ¡Cierra a las 22:00!"
                  value={bcastMsg}
                  onChange={(e) => setBcastMsg(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Duración (min)</Label>
                  <Input
                    type="number"
                    min={1}
                    className="w-24"
                    value={bcastMins}
                    onChange={(e) => setBcastMins(parseInt(e.target.value, 10) || 1)}
                  />
                  <Button onClick={sendTextBroadcast} className="ml-auto">Enviar</Button>
                </div>
              </Card>

              <Card className="p-4 space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ImageIcon className="h-4 w-4" /> Pop-up de imagen
                </h3>
                <label
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f && f.type.startsWith("image/")) onPickFile(f);
                  }}
                  className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border p-4 text-center text-xs text-muted-foreground cursor-pointer hover:bg-muted/40"
                >
                  <ImageIcon className="h-5 w-5" />
                  <span>Arrastrá una imagen aquí o hacé click</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {bcastFile && (
                  <div className="flex items-center gap-2 rounded-md border p-2">
                    <img src={bcastFilePreview} alt="preview" className="h-16 w-16 rounded object-cover" />
                    <div className="min-w-0 flex-1 text-xs truncate">{bcastFile.name}</div>
                    <Button size="sm" variant="ghost" onClick={() => onPickFile(null)}>Quitar</Button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Duración (min)</Label>
                  <Input
                    type="number"
                    min={1}
                    className="w-24"
                    value={bcastImgMins}
                    onChange={(e) => setBcastImgMins(parseInt(e.target.value, 10) || 1)}
                  />
                  <Button onClick={sendImageBroadcast} disabled={uploading} className="ml-auto">
                    {uploading ? "Subiendo..." : "Enviar Imagen"}
                  </Button>
                </div>
              </Card>

              {bcasts.length > 0 && (
                <Card className="p-4 space-y-2">
                  <h3 className="text-sm font-semibold">Anuncios activos / recientes</h3>
                  <div className="space-y-2">
                    {bcasts.map((b) => (
                      <div key={b.id} className="flex items-center justify-between gap-2 border p-2 rounded text-xs">
                        <div>
                          <span className="font-bold uppercase">{b.type}</span> · Expira: {new Date(b.expires_at).toLocaleTimeString()}
                        </div>
                        <Button size="sm" variant="destructive" onClick={() => deleteBroadcast(b.id)} className="h-6 px-2">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="event" className="mt-4 space-y-4">
              <Card className="p-4 space-y-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4" /> Configurar Multiplicador / Evento
                </h3>
                <div className="space-y-2">
                  <Label>Nombre del evento</Label>
                  <Input
                    placeholder="Ej: Mes de Exámenes"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Multiplicador</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="1"
                      value={multiplier}
                      onChange={(e) => setMultiplier(parseFloat(e.target.value) || 1)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Duración (min, 0 = indefinido)</Label>
                    <Input
                      type="number"
                      min="0"
                      value={eventMinutes}
                      onChange={(e) => setEventMinutes(parseInt(e.target.value, 10) || 0)}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-base">Activar Evento</Label>
                    <div className="text-xs text-muted-foreground">Aplica el multiplicador a las sesiones</div>
                  </div>
                  <Switch checked={eventActive} onCheckedChange={setEventActive} />
                </div>
                <Button onClick={saveEvent} className="w-full">
                  <Save className="mr-2 h-4 w-4" /> Guardar Configuración
                </Button>
              </Card>
            </TabsContent>

            <TabsContent value="shop" className="mt-4 space-y-4">
              <Card className="p-4 space-y-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ShoppingBag className="h-4 w-4" /> Tipo de Cambio (Economía)
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">1 Hora de estudio da (Monedas)</Label>
                    <Input
                      type="number"
                      value={hoursToCoinsRate}
                      onChange={(e) => setHoursToCoinsRate(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Comprar 1 Hora cuesta (Monedas)</Label>
                    <Input
                      type="number"
                      value={coinsToHoursRate}
                      onChange={(e) => setCoinsToHoursRate(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <Button onClick={saveEconomyRates} size="sm">Guardar Tasas</Button>
              </Card>

              <Card className="p-4 space-y-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ShoppingBag className="h-4 w-4" /> Gestión y Precios de Ítems
                </h3>
                
                <div className="space-y-3 border-b pb-4">
                  <h4 className="text-xs font-bold uppercase text-muted-foreground">Crear nuevo ítem</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      placeholder="Título"
                      value={newItemTitle}
                      onChange={(e) => setNewItemTitle(e.target.value)}
                    />
                    <Input
                      placeholder="Descripción"
                      value={newItemDesc}
                      onChange={(e) => setNewItemDesc(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="Precio (🪙)"
                        value={newItemPrice}
                        onChange={(e) => setNewItemPrice(e.target.value)}
                      />
                      <Button onClick={createShopItem}>Crear</Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase text-muted-foreground">Ítems actuales en la tienda</h4>
                  {shopItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay ítems registrados.</p>
                  ) : (
                    <div className="space-y-2">
                      {shopItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 border p-2 rounded-lg text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold truncate">{item.title}</div>
                            <div className="text-xs text-muted-foreground truncate">{item.description || "Sin descripción"}</div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">🪙</span>
                            <Input
                              type="number"
                              defaultValue={item.price}
                              className="w-20 h-8 text-xs font-mono"
                              onBlur={(e) => {
                                if (Number(e.target.value) !== item.price) {
                                  updateShopItemPrice(item.id, e.target.value);
                                }
                              }}
                            />
                            <Button 
                              size="sm" 
                              variant="destructive" 
                              onClick={() => deleteShopItem(item.id)}
                              className="h-8 px-2"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="restore" className="mt-4 space-y-4">
              <Card className="p-4 space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Upload className="h-4 w-4" /> Restaurar Backup de Ranking (.xlsx)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Subí un archivo Excel exportado previamente para reinsertar las horas acumuladas al sistema actual.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                  />
                  <Button onClick={handleRestoreBackup} disabled={restoring || !restoreFile}>
                    {restoring ? "Restaurando..." : "Restaurar Backup"}
                  </Button>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="users" className="mt-4 space-y-4">
              <Card className="p-4 space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> Gestión de Usuarios ({allUsers.length})
                </h3>
                <p className="text-xs text-muted-foreground">
                  Aquí puedes cambiar el nombre de un usuario (se actualizará en todo el sistema) o eliminarlo por completo.
                </p>

                {allUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay usuarios registrados.</p>
                ) : (
                  <ul className="divide-y divide-border max-h-72 overflow-y-auto space-y-2 pr-1">
                    {allUsers.map((userName) => (
                      <li key={userName} className="flex items-center justify-between gap-2 pt-2 text-sm">
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          {editingUserOld === userName ? (
                            <div className="flex items-center gap-2 flex-1">
                              <Input
                                defaultValue={userName}
                                onChange={(e) => setEditingUserNew(e.target.value)}
                                className="h-8 text-xs"
                                autoFocus
                              />
                              <Button size="sm" onClick={() => handleRenameUser(userName)} className="h-8 px-2 text-xs">
                                <Save className="h-3 w-3 mr-1" /> Guardar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingUserOld(null)} className="h-8 px-2 text-xs">
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <span className="font-medium truncate">{userName}</span>
                          )}
                        </div>

                        {editingUserOld !== userName && (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingUserOld(userName);
                                setEditingUserNew(userName);
                              }}
                              className="h-7 px-2 text-xs"
                            >
                              <Pencil className="h-3 w-3 mr-1" /> Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeleteUser(userName)}
                              className="h-7 px-2 text-xs"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="history" className="mt-4 space-y-4">
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-2">Historial de Sesiones</h3>
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin historial registrado.</p>
                ) : (
                  <ul className="divide-y divide-border text-xs max-h-60 overflow-y-auto">
                    {history.slice(0, 30).map((h) => (
                      <li key={h.id} className="py-2 flex justify-between">
                        <span className="font-medium">{h.user_name}</span>
                        <span className="text-muted-foreground">{h.total_minutes ?? 0} min · {new Date(h.start_time).toLocaleDateString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="past" className="mt-4 space-y-4">
              <PastRankingsManager />
            </TabsContent>

            <TabsContent value="diag" className="mt-4 space-y-4">
              <Card className="p-4 space-y-2">
                <h3 className="text-sm font-semibold">Diagnóstico del Sistema</h3>
                <p className="text-xs text-muted-foreground">Monitoreo de estado de conexiones y red Supabase.</p>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}