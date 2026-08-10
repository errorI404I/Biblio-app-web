import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wifi, WifiOff, LogIn, LogOut, Trophy, Loader2, Sparkles, Archive } from "lucide-react";
import { PastRankingsPublic } from "@/components/PastRankings";

import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { AdminPanel } from "@/components/AdminPanel";
import { BroadcastBanner, BroadcastImageModal } from "@/components/BroadcastDisplay";

export const Route = createFileRoute("/")({
  component: Index,
});

const ALLOWED_IP = "131.221.0.8";
const STORAGE_KEY = "horasbiblio_user_name";
const HEARTBEAT_MS = 60 * 60 * 1000; // 1 hora (guardado progresivo)
const OFFLINE_GRACE_MS = 60 * 1000; // 1 minuto
const OPEN_HOUR_AR = 7;   // 07:00 hs apertura
const CLOSE_HOUR_AR = 20; // 20:00 hs cierre general

// Argentina = UTC-3 (sin DST)
function getArgHour(d: Date = new Date()) {
  return (d.getUTCHours() + 24 - 3) % 24;
}
function isWithinOpenHours(d: Date = new Date()) {
  const h = getArgHour(d);
  return h >= OPEN_HOUR_AR && h < CLOSE_HOUR_AR;
}
// Próximo 20:00 AR (UTC = 23:00) en ms
function msToNextClose() {
  const now = Date.now();
  const t = new Date();
  t.setUTCHours(CLOSE_HOUR_AR + 3, 0, 0, 0);
  if (t.getTime() <= now) t.setUTCDate(t.getUTCDate() + 1);
  return t.getTime() - now;
}
// Devuelve el ISO del 20:00 AR del día actual (o el más reciente ya pasado)
function lastCloseIso() {
  const t = new Date();
  t.setUTCHours(CLOSE_HOUR_AR + 3, 0, 0, 0);
  if (t.getTime() > Date.now()) t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString();
}

type Session = {
  id: string;
  user_name: string;
  start_time: string;
  end_time: string | null;
  total_minutes: number | null;
  last_seen?: string | null;
};

type ActiveEvent = { multiplier: number; event_name: string | null; active: boolean; expires_at: string | null };

async function fetchPublicIp(signal?: AbortSignal): Promise<string | null> {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal });
    const d = await r.json();
    return d.ip ?? null;
  } catch {
    return null;
  }
}

async function getActiveMultiplier(userName?: string): Promise<ActiveEvent> {
  const { data } = await supabase
    .from("settings")
    .select("multiplier,event_name,active,expires_at" as any)
    .eq("key", "multiplier")
    .maybeSingle();
    
  let activeMult = 1;
  let activeName: string | null = null;
  let activeExpires: string | null = null;
  let isGlobalActive = false;

  if (data && (data as any).active) {
    const expiresAt = (data as any).expires_at as string | null;
    if (!expiresAt || new Date(expiresAt).getTime() > Date.now()) {
      activeMult = Number((data as any).multiplier) || 1;
      activeName = (data as any).event_name;
      activeExpires = expiresAt;
      isGlobalActive = true;
    } else {
      await supabase
        .from("settings")
        .update({ active: false, expires_at: null, updated_at: new Date().toISOString() } as any)
        .eq("key", "multiplier");
    }
  }

  // Verificación dinámica de multiplicadores activos del usuario desde el servidor/inventario y catálogo
  if (userName) {
    const { data: userInv } = await supabase
      .from("user_inventory")
      .select("item_id, expires_at, is_active")
      .eq("user_name", userName)
      .eq("is_active", true);

    if (userInv && userInv.length > 0) {
      // Traer la configuración de los ítems desde shop_items para evaluar dinámicamente
      const { data: shopCatalog } = await supabase
        .from("shop_items")
        .select("id, name, effect_type, effect_value");

      const catalogMap = new Map(shopCatalog?.map(item => [item.id, item]) || []);
      const nowTime = Date.now();

      for (const inv of userInv) {
        if (inv.expires_at && new Date(inv.expires_at).getTime() <= nowTime) {
          // Desactivar automáticamente si expiró
          await supabase
            .from("user_inventory")
            .update({ is_active: false })
            .eq("user_name", userName)
            .eq("item_id", inv.item_id);
          continue;
        }

        const itemConfig = catalogMap.get(inv.item_id);
        if (itemConfig && itemConfig.effect_type === 'multiplier') {
          const multValue = Number(itemConfig.effect_value?.multiplier) || 2;
          if (multValue > activeMult) {
            activeMult = multValue;
            activeName = `${itemConfig.name} ⚡`;
            activeExpires = inv.expires_at;
            isGlobalActive = true;
          }
        }
      }
    }
  }

  return {
    multiplier: activeMult,
    event_name: activeName,
    active: isGlobalActive,
    expires_at: activeExpires,
  };
}

async function closeSessionAt(sessionId: string, startTime: string, endIso: string, userName?: string) {
  const rawMinutes = Math.max(
    1,
    Math.round((new Date(endIso).getTime() - new Date(startTime).getTime()) / 60000)
  );
  const ev = await getActiveMultiplier(userName);
  const minutes = Math.round(rawMinutes * ev.multiplier);
  await supabase
    .from('sesiones')
    .update({
      end_time: endIso,
      total_minutes: minutes,
      last_seen: endIso,
      multiplier: ev.multiplier,
      event_name: ev.active ? ev.event_name : null,
    })
    .eq("id", sessionId);
  return minutes;
}

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function massCloseAt(endIso: string) {
  const { data: sessions } = await supabase
    .from('sesiones')
    .select("id,start_time,user_name")
    .is("end_time", null);
  if (!sessions || sessions.length === 0) return 0;
  
  const endMs = new Date(endIso).getTime();
  let count = 0;
  for (const s of sessions) {
    const ev = await getActiveMultiplier(s.user_name);
    const raw = Math.max(
      1,
      Math.round((endMs - new Date(s.start_time).getTime()) / 60000)
    );
    const minutes = Math.round(raw * ev.multiplier);
    const { error } = await supabase
      .from('sesiones')
      .update({
        end_time: endIso,
        total_minutes: minutes,
        last_seen: endIso,
        multiplier: ev.multiplier,
        event_name: ev.active ? ev.event_name : null,
      })
      .eq("id", s.id)
      .is("end_time", null);
    if (!error) count++;
  }
  return count;
}

// --- LÓGICA DE RACHA CON EXENCIÓN DE FINES DE SEMANA ---
function calculateStreak(sessions: { start_time?: string | null }[]): number {
  if (!sessions || sessions.length === 0) return 0;

  const uniqueDates = Array.from(
    new Set(
      sessions.map((s) => {
        const rawDate = s.start_time;
        if (!rawDate) return null;
        return new Date(rawDate).toISOString().split("T")[0];
      }).filter(Boolean)
    )
  ).sort((a, b) => (b! > a! ? 1 : -1)) as string[];

  if (uniqueDates.length === 0) return 0;

  const isWeekend = (dateStr: string) => {
    const day = new Date(dateStr + "T00:00:00").getDay();
    return day === 0 || day === 6;
  };

  const getPreviousDayStr = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };

  let streak = 0;
  const todayStr = new Date().toISOString().split("T")[0];
  
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split("T")[0];

  let latestDate = uniqueDates[0];

  if (latestDate !== todayStr && latestDate !== yesterdayStr) {
    const todayObj = new Date(todayStr + "T00:00:00");
    const latestObj = new Date(latestDate + "T00:00:00");
    const diffTime = Math.abs(todayObj.getTime() - latestObj.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let validWeekendGap = true;
    let checkDate = todayStr;
    for (let d = 0; d < diffDays - 1; d++) {
      checkDate = getPreviousDayStr(checkDate);
      if (!isWeekend(checkDate)) {
        validWeekendGap = false;
        break;
      }
    }

    if (!validWeekendGap) return 0;
  }

  let expectedDateStr = latestDate;
  for (let i = 0; i < uniqueDates.length; i++) {
    if (uniqueDates[i] === expectedDateStr) {
      streak++;
      expectedDateStr = getPreviousDayStr(expectedDateStr);
    } else {
      let found = false;
      let tempDate = expectedDateStr;
      
      for (let w = 0; w < 2; w++) {
        tempDate = getPreviousDayStr(tempDate);
        if (isWeekend(tempDate) && uniqueDates[i] === tempDate) {
          streak++;
          expectedDateStr = getPreviousDayStr(tempDate);
          found = true;
          break;
        }
      }

      if (!found) {
        break;
      } else {
        i--; 
      }
    }
  }

  return streak;
}

function Index() {
  const [ip, setIp] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [leaders, setLeaders] = useState<
    {
      user_name: string;
      minutes: number;
      online: boolean;
      streak: number;
      mainBadge: string | null;
      temporalBadges: string[];
    }[]
  >([]);
  const [onlyOnline, setOnlyOnline] = useState(false);
  const [lastVerified, setLastVerified] = useState<number | null>(null);
  const [verifiedFlash, setVerifiedFlash] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [activeEvent, setActiveEvent] = useState<ActiveEvent>({ multiplier: 1, event_name: null, active: false, expires_at: null });
  const [insult, setInsult] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estados para el Screamer en la Web (dinámico desde la BD)
  const [screamerActive, setScreamerActive] = useState(false);
  const [screamerData, setScreamerData] = useState<{ image: string; isSurprise: boolean } | null>(null);

  // Función para comprobar y disparar el Screamer web al hacer Check-in consultando la galería dinámica
  const checkAndTriggerScreamerWeb = async (name: string) => {
    try {
      const { data, error } = await supabase
        .from('pending_punishments')
        .select('*')
        .eq('target_user', name)
        .eq('triggered', false)
        .limit(1)
        .maybeSingle();

      if (error || !data) return;

      await supabase
        .from('pending_punishments')
        .update({ triggered: true })
        .eq('id', data.id);

      // Carga dinámica de imágenes de screamer desde la base de datos
      const { data: galleryItems } = await supabase
        .from('screamer_gallery')
        .select('image_url, is_surprise')
        .eq('active', true);

      if (!galleryItems || galleryItems.length === 0) return;

      const randomScreamer = galleryItems[Math.floor(Math.random() * galleryItems.length)];

      setScreamerData({ image: randomScreamer.image_url, is_surprise: randomScreamer.is_surprise });
      setScreamerActive(true);
    } catch (err) {
      console.error('Error al comprobar sustos pendientes en web:', err);
    }
  };

  // Hotkey Ctrl+Shift+A
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        setAdminOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Live event banner — poll every 5s
  useEffect(() => {
    const load = () => getActiveMultiplier(userName).then(setActiveEvent);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [userName]);

  // Ticker dedicado al countdown del evento (1s)
  const [eventNow, setEventNow] = useState(Date.now());
  useEffect(() => {
    if (!activeEvent.active || !activeEvent.expires_at) return;
    const t = setInterval(() => setEventNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeEvent.active, activeEvent.expires_at]);

  useEffect(() => {
    if (!activeEvent.active || !activeEvent.expires_at) return;
    const remaining = new Date(activeEvent.expires_at).getTime() - eventNow;
    if (remaining <= 0) {
      getActiveMultiplier(userName).then(setActiveEvent);
    }
  }, [eventNow, activeEvent.active, activeEvent.expires_at, userName]);

  const isAllowed = ip === ALLOWED_IP;
  const activeSessionRef = useRef<Session | null>(null);
  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  // Load saved name
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setUserName(saved);
  }, []);

  // Fetch IP
  useEffect(() => {
    fetchPublicIp().then((v) => {
      setIp(v);
      setIpLoading(false);
    });
  }, []);

  // Tick clock
  useEffect(() => {
    if (!activeSession) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeSession]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const systemOpen = isWithinOpenHours(new Date(now));

  const loadLeaders = useCallback(async () => {
    const [{ data: sessionsData }, { data: inventoryData }, { data: shopCatalog }] = await Promise.all([
      supabase.from('sesiones').select("user_name,total_minutes,end_time,start_time"),
      supabase.from('user_inventory').select("user_name,item_id,is_active,expires_at"),
      supabase.from('shop_items').select("id, name, effect_type, effect_value")
    ]);
    if (!sessionsData) return;
    
    const minutesMap = new Map<string, number>();
    const onlineSet = new Set<string>();
    const userSessionsMap = new Map<string, { start_time?: string | null }[]>();

    for (const r of sessionsData) {
      if (r.total_minutes != null) {
        minutesMap.set(r.user_name, (minutesMap.get(r.user_name) ?? 0) + (r.total_minutes ?? 0));
      }
      if (r.end_time === null) onlineSet.add(r.user_name);

      const userList = userSessionsMap.get(r.user_name) ?? [];
      userList.push({ start_time: r.start_time });
      userSessionsMap.set(r.user_name, userList);
    }

    const catalogMap = new Map(shopCatalog?.map(item => [item.id, item]) || []);
    const userBadgesMap = new Map<string, { mainBadge: string | null; temporalBadges: string[] }>();
    const singleUseItems = new Set(['ruleta_extra']);

    if (inventoryData) {
      const userItemsMap = new Map<string, { item_id: string; is_active: boolean | null; expires_at?: string | null }[]>();
      
      for (const inv of inventoryData) {
        if (singleUseItems.has(inv.item_id)) continue;
        if (inv.expires_at && new Date(inv.expires_at).getTime() <= Date.now()) {
          continue; 
        }
        
        const list = userItemsMap.get(inv.user_name) ?? [];
        list.push(inv);
        userItemsMap.set(inv.user_name, list);
      }

      for (const [userNameKey, items] of userItemsMap.entries()) {
        let mainBadge: string | null = null;
        const temporalBadges: string[] = [];

        for (const inv of items) {
          const itemDef = catalogMap.get(inv.item_id);
          if (!itemDef) continue;

          let label = '';
          let isMain = false;

          // Renderizado dinámico según el effect_type definido en la base de datos
          if (itemDef.effect_type === 'badge') {
            label = itemDef.effect_value?.badge_text || itemDef.name;
            isMain = true;
          } else if (itemDef.effect_type === 'multiplier' && inv.is_active) {
            label = `${itemDef.name} (x${itemDef.effect_value?.multiplier || 2})`;
          } else if (itemDef.effect_type === 'protect_streak') {
            label = `☕ ${itemDef.name}`;
          }

          if (!label) continue;

          if (isMain) {
            mainBadge = label;
          } else {
            temporalBadges.push(label);
          }
        }

        userBadgesMap.set(userNameKey, { mainBadge, temporalBadges });
      }
    }

    const names = new Set<string>([...minutesMap.keys(), ...onlineSet]);
    const arr = Array.from(names, (user_name) => {
      const userSessions = userSessionsMap.get(user_name) ?? [];
      const streak = calculateStreak(userSessions);
      const badges = userBadgesMap.get(user_name) ?? { mainBadge: null, temporalBadges: [] };
      return {
        user_name,
        minutes: minutesMap.get(user_name) ?? 0,
        online: onlineSet.has(user_name),
        streak,
        mainBadge: badges.mainBadge,
        temporalBadges: badges.temporalBadges,
      };
    }).sort((a, b) => b.minutes - a.minutes);
    setLeaders(arr);
  }, []);

  const checkActiveSession = useCallback(async (name: string) => {
    if (!name) return;
    const { data: openRows } = await supabase
      .from('sesiones')
      .select("*")
      .eq("user_name", name)
      .is("end_time", null)
      .order("start_time", { ascending: false });
    if (!openRows || openRows.length === 0) {
      setActiveSession(null);
      return;
    }
    const staleAfter = HEARTBEAT_MS + OFFLINE_GRACE_MS + 30_000;
    const nowMs = Date.now();
    let restored: Session | null = null;
    for (const row of openRows) {
      const lastSeenMs = row.last_seen
        ? new Date(row.last_seen).getTime()
        : new Date(row.start_time).getTime();
      const isFresh = !restored && (nowMs - lastSeenMs) <= staleAfter;
      if (isFresh) {
        restored = row as Session;
        continue;
      }
      const stalePenalty = nowMs - lastSeenMs > staleAfter;
      if (stalePenalty && row.last_seen) {
        await closeSessionAt(row.id, row.start_time, row.last_seen, name);
      } else {
        await supabase
          .from('sesiones')
          .update({ end_time: row.start_time, total_minutes: 0, last_seen: row.start_time })
          .eq("id", row.id)
          .is("end_time", null);
      }
    }
    if (restored) {
      setActiveSession(restored);
      setLastVerified(new Date(restored.last_seen ?? restored.start_time).getTime());
    } else {
      setActiveSession(null);
      loadLeaders();
    }
  }, [loadLeaders]);

  useEffect(() => {
    if (userName) checkActiveSession(userName);
  }, [userName, checkActiveSession]);

  useEffect(() => {
    loadLeaders();
  }, [loadLeaders]);

  useEffect(() => {
    const channel = supabase
      .channel("sessions-leaderboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions" },
        () => loadLeaders()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadLeaders]);

  useEffect(() => {
    let cancelled = false;
    const fire = async () => {
      if (cancelled) return;
      const endIso = lastCloseIso();
      const closed = await massCloseAt(endIso);
      if (closed > 0) {
        toast.message(`🚨 Cierre 20:00 hs · ${closed} sesiones aseguradas en el ranking.`);
      }
      setActiveSession(null);
      loadLeaders();
    };
    const schedule = () => {
      const ms = msToNextClose();
      return setTimeout(async () => {
        await fire();
        if (!cancelled) timer = schedule();
      }, ms);
    };
    let timer = schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadLeaders]);

  const handleCheckIn = async () => {
    const name = userName.trim();
    if (!name) {
      toast.error("Ingresa tu nombre");
      return;
    }
    if (!isAllowed) return;
    if (!isWithinOpenHours()) {
      toast.error("El sistema está cerrado", {
        description: `El horario de conexión es de ${String(OPEN_HOUR_AR).padStart(2, "0")}:00 a ${String(CLOSE_HOUR_AR).padStart(2, "0")}:00 hs. ¡A descansar!`,
      });
      return;
    }
    localStorage.setItem(STORAGE_KEY, name);
    setBusy(true);

    const { data: orphans } = await supabase
      .from('sesiones')
      .select("id,start_time,last_seen")
      .eq("user_name", name)
      .is("end_time", null);
    if (orphans && orphans.length > 0) {
      await Promise.all(
        orphans.map((o) =>
          supabase
            .from('sesiones')
            .update({ end_time: o.start_time, total_minutes: 0, last_seen: o.start_time })
            .eq("id", o.id)
            .is("end_time", null)
        )
      );
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('sesiones')
      .insert({ user_name: name, start_time: nowIso, last_seen: nowIso })
      .select()
      .single();
    setBusy(false);
    if (error) {
      toast.error("Error al hacer check-in");
      return;
    }
    setActiveSession(data);
    setLastVerified(Date.now());
    
    await checkAndTriggerScreamerWeb(name);

    toast.success(`Check-in registrado, ${name}`);
  };

  const handleCheckOut = async () => {
    if (!activeSession) return;
    setBusy(true);
    const currentIp = await fetchPublicIp();
    setIp(currentIp);
    if (currentIp !== ALLOWED_IP) {
      const lastValidIso =
        activeSession.last_seen ??
        new Date(lastVerified ?? new Date(activeSession.start_time).getTime()).toISOString();
      const minutes = await closeSessionAt(
        activeSession.id,
        activeSession.start_time,
        lastValidIso,
        userName
      );
      setBusy(false);
      setActiveSession(null);
      setInsult(
        `¡Sos un fantasma! ¿Qué intentás inventar horas desde tu casa? Tramposo de cuarta. Solo te quedan ${minutes} min (los del último chequeo válido en la red).`
      );
      loadLeaders();
      return;
    }
    const minutes = await closeSessionAt(
      activeSession.id,
      activeSession.start_time,
      new Date().toISOString(),
      userName
    );
    setBusy(false);
    setActiveSession(null);
    toast.success(`Check-out: ${minutes} min registrados`);
    loadLeaders();
  };

  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;

    const runHeartbeat = async () => {
      const session = activeSessionRef.current;
      if (!session) return;

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const start = Date.now();
        await new Promise((res) => setTimeout(res, OFFLINE_GRACE_MS));
        if (cancelled) return;
        if (!navigator.onLine && Date.now() - start >= OFFLINE_GRACE_MS) {
          const lastSeenIso =
            session.last_seen ?? new Date(lastVerified ?? Date.now()).toISOString();
          try {
            await closeSessionAt(session.id, session.start_time, lastSeenIso, userName);
          } catch {}
          setActiveSession(null);
          toast.error("Sesión finalizada: se perdió la conexión a internet.");
          loadLeaders();
          return;
        }
      }

      const currentIp = await fetchPublicIp();
      if (cancelled) return;

      if (currentIp !== ALLOWED_IP) {
        const lastValidIso =
          session.last_seen ??
          new Date(lastVerified ?? new Date(session.start_time).getTime()).toISOString();
        const minutes = await closeSessionAt(
          session.id,
          session.start_time,
          lastValidIso,
          userName
        );
        setIp(currentIp);
        setActiveSession(null);
        toast.error("Sesión finalizada: Ya no te encuentras en la red autorizada", {
          description: `Se registraron ${minutes} minutos (hasta el último chequeo válido).`,
        });
        loadLeaders();
        return;
      }

      const nowIso = new Date().toISOString();
      await supabase.from('sesiones').update({ last_seen: nowIso }).eq("id", session.id);
      if (cancelled) return;
      setIp(currentIp);
      setLastVerified(Date.now());
      setActiveSession((s) => (s ? { ...s, last_seen: nowIso } : s));
      setVerifiedFlash(true);
      setTimeout(() => setVerifiedFlash(false), 2500);
    };

    const msToNextHour = () => {
      const n = new Date();
      const next = new Date(n);
      next.setHours(n.getHours() + 1, 0, 0, 0);
      return next.getTime() - n.getTime();
    };

    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      runHeartbeat();
      interval = setInterval(runHeartbeat, 60 * 60 * 1000);
    }, msToNextHour());

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [activeSession, loadLeaders, lastVerified, userName]);

  useEffect(() => {
    if (!activeSession) return;
    const handler = () => {
      const session = activeSessionRef.current;
      if (!session) return;
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/sessions?id=eq.${session.id}`;
        fetch(url, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ last_seen: new Date().toISOString() }),
          keepalive: true,
        });
      } catch {}
    };
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
    };
  }, [activeSession]);

  const elapsed = activeSession
    ? now - new Date(activeSession.start_time).getTime()
    : 0;

  const startLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => setAdminOpen(true), 1500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster theme="dark" position="top-center" />
      <AdminPanel open={adminOpen} onOpenChange={setAdminOpen} />
      <BroadcastImageModal />

      {/* MODAL WEB DEL SCREAMER */}
      {screamerActive && screamerData && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-6 animate-in fade-in">
          <div className="max-w-xl w-full flex flex-col items-center text-center">
            <img 
              src={screamerData.image} 
              alt="Susto" 
              className="max-h-[60vh] w-full rounded-2xl object-cover border-4 border-red-600 shadow-[0_0_30px_rgba(220,38,38,0.7)] mb-6"
            />
            <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-tight text-red-500 mb-6 animate-pulse">
              {screamerData.isSurprise ? '😱 ¡¡SORPRESA TERRORÍFICA (1 en 100)!! 😱' : '👻 ¡Te han enviado un susto en el check-in! 👻'}
            </h2>
            <Button
              variant="destructive"
              size="lg"
              className="bg-red-600 hover:bg-red-700 font-black px-8 py-4 text-lg"
              onClick={() => setScreamerActive(false)}
            >
              ¡Superar trauma y continuar!
            </Button>
          </div>
        </div>
      )}

      {insult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6 animate-in fade-in"
          onClick={() => setInsult(null)}
        >
          <div className="max-w-xl rounded-2xl border-4 border-destructive bg-destructive/10 p-8 text-center animate-pulse">
            <div className="text-6xl">👻🚫</div>
            <h2 className="mt-4 text-3xl sm:text-5xl font-black uppercase tracking-tight text-destructive">
              ¡Tramposo detectado!
            </h2>
            <p className="mt-4 text-lg sm:text-xl font-semibold">{insult}</p>
            <Button
              variant="destructive"
              size="lg"
              className="mt-6"
              onClick={() => setInsult(null)}
            >
              Acepto mi vergüenza
            </Button>
          </div>
        </div>
      )}
      <div
        className="absolute inset-0 -z-10 opacity-60"
        style={{ background: "var(--gradient-hero)" }}
      />
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <header className="mb-8 text-center">
          <h1
            className="text-4xl sm:text-5xl font-bold tracking-tight cursor-pointer select-none"
            onPointerDown={startLongPress}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
            onPointerCancel={cancelLongPress}
          >
            Horas <span className="text-primary">biblio</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Registro de tiempo de conexión Wi-Fi
          </p>
        </header>

        {activeEvent.active && activeEvent.multiplier > 1 && (() => {
          const expMs = activeEvent.expires_at ? new Date(activeEvent.expires_at).getTime() : null;
          const remainMs = expMs ? Math.max(0, expMs - eventNow) : null;
          if (expMs && remainMs === 0) return null;
          const fmt = (ms: number) => {
            const total = Math.floor(ms / 1000);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            return h > 0
              ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
              : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
          };
          return (
            <div
              className="mb-6 rounded-xl border border-primary/40 p-4 text-center animate-pulse transition-opacity duration-500"
              style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
            >
              <div className="flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-wider text-primary">
                <Sparkles className="h-4 w-4" /> ¡Evento activo!
              </div>
              <p className="mt-1 text-base font-semibold">
                {activeEvent.event_name ?? "Evento especial"} — Las horas valen{" "}
                <span className="text-primary">x{activeEvent.multiplier}</span> más
              </p>
              {remainMs != null ? (
                <div className="mt-2 inline-block rounded-md border border-primary/30 bg-background/60 px-3 py-1 font-mono text-lg font-bold tabular-nums text-primary">
                  ⏳ {fmt(remainMs)}
                </div>
              ) : (
                <div className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
                  Evento Activo
                </div>
              )}
            </div>
          );
        })()}

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="leaders" onClick={loadLeaders}>
              <Trophy className="mr-2 h-4 w-4" /> En Vivo
            </TabsTrigger>
            <TabsTrigger value="past">
              <Archive className="mr-2 h-4 w-4" /> Historial
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-6 space-y-4">
            <Card className="p-5">
              <div className="flex items-center gap-3">
                {ipLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : isAllowed ? (
                  <Wifi className="h-5 w-5 text-primary" />
                ) : (
                  <WifiOff className="h-5 w-5 text-destructive" />
                )}
                <div className="flex-1">
                  <div className="font-semibold">
                    {ipLoading
                      ? "Verificando red..."
                      : isAllowed
                        ? "Conectado a la red autorizada"
                        : "Red no autorizada"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ip ? `IP: ${ip}` : "Sin IP"}
                  </div>
                </div>
                <span
                  className={`h-3 w-3 rounded-full ${
                    isAllowed ? "bg-primary shadow-[0_0_12px_var(--color-primary)]" : "bg-destructive"
                  }`}
                />
              </div>
              {!ipLoading && !isAllowed && (
                <p className="mt-3 text-sm text-destructive">
                  No estás conectado a la red Wi-Fi autorizada.
                </p>
              )}
            </Card>

            <Card
              className="p-6 text-center"
              style={activeSession ? { boxShadow: "var(--shadow-glow)" } : undefined}
            >
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                {activeSession ? "Sesión activa" : "Sin sesión"}
              </div>
              <div className="mt-2 font-mono text-5xl sm:text-6xl font-bold tabular-nums">
                {activeSession ? formatDuration(elapsed) : "00:00:00"}
              </div>
              {activeSession && (
                <div className="mt-2 text-sm text-muted-foreground">
                  {activeSession.user_name} · desde{" "}
                  {new Date(activeSession.start_time).toLocaleTimeString()}
                </div>
              )}
              {activeSession && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs">
                  <span
                    className={`inline-block h-2 w-2 rounded-full transition-all duration-500 ${
                      verifiedFlash
                        ? "bg-primary shadow-[0_0_12px_var(--color-primary)] scale-125"
                        : "bg-primary/50"
                    }`}
                  />
                  <span className="text-muted-foreground">
                    {verifiedFlash
                      ? "Conexión verificada"
                      : lastVerified
                        ? `Última verificación: ${new Date(lastVerified).toLocaleTimeString()}`
                        : "Esperando verificación..."}
                  </span>
                </div>
              )}
              {activeSession && (() => {
                const nextHour = new Date(now);
                nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
                const ms = nextHour.getTime() - now;
                const m = Math.floor(ms / 60000);
                const s = Math.floor((ms % 60000) / 1000);
                return (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Próximo control automático en{" "}
                    <span className="font-mono tabular-nums text-primary">
                      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
                    </span>{" "}
                    ({nextHour.getHours().toString().padStart(2, "0")}:00)
                  </div>
                );
              })()}
            </Card>

            <Card className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium">Tu nombre</label>
                <Input
                  className="mt-1.5"
                  placeholder="Ej. María Pérez"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  disabled={!!activeSession}
                />
              </div>

              {activeSession ? (
                <Button
                  onClick={handleCheckOut}
                  disabled={busy}
                  variant="destructive"
                  className="w-full"
                  size="lg"
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-4 w-4" />
                  )}
                  Check-out
                </Button>
              ) : (
                <>
                  {!systemOpen && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-center text-sm">
                      🌙 <span className="font-semibold">Sistema cerrado.</span> Horario de conexión: {String(OPEN_HOUR_AR).padStart(2, "0")}:00 a {String(CLOSE_HOUR_AR).padStart(2, "0")}:00 hs. ¡A descansar!
                    </div>
                  )}
                  <Button
                    onClick={handleCheckIn}
                    disabled={!isAllowed || busy || !userName.trim() || !systemOpen}
                    className="w-full"
                    size="lg"
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="mr-2 h-4 w-4" />
                    )}
                    Check-in
                  </Button>
                </>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="leaders" className="mt-6">
            <BroadcastBanner />
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Trophy className="h-5 w-5 text-primary" /> Ranking
                </h2>
                <Button
                  type="button"
                  variant={onlyOnline ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOnlyOnline((v) => !v)}
                  className="text-xs"
                >
                  <span className="relative mr-2 flex h-2 w-2">
                    {onlyOnline && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    )}
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  {onlyOnline ? "Solo conectados" : "Ver todos"}
                </Button>
              </div>
              {(() => {
                const visible = onlyOnline ? leaders.filter((l) => l.online) : leaders;
                if (visible.length === 0) {
                  return (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {onlyOnline ? "Nadie conectado ahora." : "Aún no hay registros completados."}
                    </p>
                  );
                }
                return (
                  <ul className="divide-y divide-border">
                    {visible.map((l, i) => {
                      const h = Math.floor(l.minutes / 60);
                      const m = l.minutes % 60;
                      return (
                        <li
                          key={l.user_name}
                          className="flex items-center justify-between py-3"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                                i === 0
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {i + 1}
                            </span>
                            
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{l.user_name}</span>

                                {l.streak > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.2 rounded-full">
                                    🔥 {l.streak} {l.streak === 1 ? "día" : "días"}
                                  </span>
                                )}

                                {l.online ? (
                                  <span className="relative flex h-3 w-3" title="Conectado ahora">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                                    <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.9)]" />
                                  </span>
                                ) : (
                                  <span
                                    className="h-3 w-3 rounded-full bg-muted-foreground/40"
                                    title="Desconectado"
                                  />
                                )}
                              </div>

                              {(l.mainBadge || l.temporalBadges.length > 0) && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  {l.mainBadge && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-black text-yellow-300 bg-yellow-500/20 px-2.5 py-0.5 rounded-full border border-yellow-400/50 shadow-[0_0_10px_rgba(234,179,8,0.3)] animate-pulse">
                                      {l.mainBadge}
                                    </span>
                                  )}
                                  
                                  {l.temporalBadges.map((badgeText, idx) => (
                                    <span key={idx} className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-300 bg-sky-500/15 px-2 py-0.5 rounded-full border border-sky-500/30">
                                      {badgeText}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <span className="font-mono tabular-nums text-sm">
                            {h}h {String(m).padStart(2, "0")}m
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </Card>
          </TabsContent>

          <TabsContent value="past" className="mt-6">
            <PastRankingsPublic />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}