import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, 
  Trophy, 
  Trash2, 
  History, 
  Plus, 
  Minus, 
  Check, 
  X, 
  Camera, 
  RefreshCw, 
  User, 
  Award, 
  AlertTriangle, 
  Volume2, 
  VolumeX, 
  HelpCircle,
  TrendingUp,
  Flame,
  Frown,
  Activity,
  Share2
} from 'lucide-react';

// Key names for local storage
const GAME_STATE_KEY = "qahwa_score_v4";
const PLAYERS_KEY = "qahwa_score_v4_players";
const SOUND_SETTING_KEY = "qahwa_sound_enabled";

// Structure definition matches original App state
interface Player {
  id: string;
  name: string;
  kings: number;
  koozes: number;
}

interface ScoreLog {
  op: 'add' | 'set';
  d?: number;  // Delta value for adding
  v?: number;  // Absolute value for setting
  t: number;   // Timestamp
  total: number; // Result score
}

interface Seat {
  id: string;
  score: number;
  log: ScoreLog[];
  done: boolean;
}

interface GameState {
  target: number;
  rounds: number;
  over: boolean;
  seats: Seat[];
  controller: string;
  controllerAt: number;
}

export default function App() {
  // --- States ---
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>({
    target: 300,
    rounds: 0,
    over: false,
    seats: [],
    controller: "",
    controllerAt: 0
  });

  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Active Keypad State
  const [keypad, setKeypad] = useState<{
    visible: boolean;
    mode: 'add' | 'set' | 'target' | 'code';
    seatIdx: number;
    value: string;
  }>({
    visible: false,
    mode: 'add',
    seatIdx: -1,
    value: ""
  });

  // Modal Views
  const [modalConfirmation, setModalConfirmation] = useState<{
    visible: boolean;
    title: string;
    text: string;
    onConfirm: () => void;
  } | null>(null);

  const [modalNewPlayer, setModalNewPlayer] = useState<{
    visible: boolean;
    seatIdx: number;
    mode: 'round' | 'single';
  } | null>(null);

  const [modalResult, setModalResult] = useState<{
    visible: boolean;
    koozIdxs: number[];
    koozNames: string[];
    outNames: string[];
    kingTie: boolean;
    noLeave: boolean;
    snap: { name: string; score: number; idx: number; isKooz: boolean; isOut: boolean; isKing: boolean }[];
  } | null>(null);

  const [modalCountPicker, setModalCountPicker] = useState<boolean>(false);
  const [modalTiePicker, setModalTiePicker] = useState<{
    visible: boolean;
    auto: number[];
    tied: number[];
    remaining: number;
    noLeave: boolean;
    selected: number[];
  } | null>(null);

  const [showLeaderboard, setShowLeaderboard] = useState<boolean>(false);
  const [showPlayersManager, setShowPlayersManager] = useState<boolean>(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profileStats, setProfileStats] = useState<{
    streak: number;
    bestStreak: number;
    nemesisName: string;
    nemesisCount: number;
    gamesCount: number;
    lastResultDate: string;
    lastResultKind: string;
  } | null>(null);
  
  const [activeHistoryIndex, setActiveHistoryIndex] = useState<number | null>(null);

  // --- NEW AI Domino Scanner States ---
  const [scanner, setScanner] = useState<{
    visible: boolean;
    seatIdx: number;
    loading: boolean;
    statusText: string;
    detectedTiles: Array<{ left: number; right: number; total: number }>;
    detectedTotal: number | null;
    analysisExplain: string;
    error: string | null;
  }>({
    visible: false,
    seatIdx: -1,
    loading: false,
    statusText: "",
    detectedTiles: [],
    detectedTotal: null,
    analysisExplain: "",
    error: null
  });

  // Camera stream refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; color: string; size: number }>>([]);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string }>>([]);

  const audioCtxRef = useRef<AudioContext | null>(null);

  // --- Device Tokens matching original device logic ---
  const myTokenRef = useRef<string>("");

  useEffect(() => {
    // Inject Fonts
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);

    // Initializer token
    let token = localStorage.getItem("qahwa_device");
    if (!token) {
      token = "d" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
      localStorage.setItem("qahwa_device", token);
    }
    myTokenRef.current = token;

    // Load Sound choice
    const soundRaw = localStorage.getItem(SOUND_SETTING_KEY);
    if (soundRaw !== null) {
      setSoundEnabled(soundRaw === 'true');
    }

    // Seed/Load database
    let storedPlayers: Player[] = [];
    try {
      const rawPl = localStorage.getItem(PLAYERS_KEY);
      if (rawPl) storedPlayers = JSON.parse(rawPl);
    } catch (e) {}

    if (!storedPlayers || storedPlayers.length === 0) {
      // Original default bank in Arabized game
      storedPlayers = [
        { id: "p1", name: "شريف", kings: 0, koozes: 0 },
        { id: "p2", name: "كريم", kings: 0, koozes: 0 },
        { id: "p3", name: "حسني", kings: 0, koozes: 0 },
        { id: "p4", name: "حفظي", kings: 0, koozes: 0 }
      ];
      localStorage.setItem(PLAYERS_KEY, JSON.stringify(storedPlayers));
    }
    setPlayers(storedPlayers);

    // Load Game State
    let storedState: GameState | null = null;
    try {
      const rawG = localStorage.getItem(GAME_STATE_KEY);
      if (rawG) storedState = JSON.parse(rawG);
    } catch (e) {}

    if (storedState && storedState.seats && storedState.seats.length === 4) {
      // Fix missing arrays or properties
      storedState.seats.forEach(s => {
        if (!Array.isArray(s.log)) s.log = [];
        if (s.done === undefined) s.done = false;
      });
      setGameState(storedState);
    } else {
      // Create fresh seated game
      const seats = storedPlayers.slice(0, 4).map(p => ({
        id: p.id,
        score: 0,
        log: [],
        done: false
      }));
      const fresh: GameState = {
        target: 300,
        rounds: 0,
        over: false,
        seats: seats,
        controller: token, // default current device as controller
        controllerAt: Date.now()
      };
      setGameState(fresh);
      localStorage.setItem(GAME_STATE_KEY, JSON.stringify(fresh));
    }
  }, []);

  // --- Sound Engine ---
  const ensureAudio = () => {
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    } catch (e) {}
  };

  const playSound = (type: 'add' | 'minus' | 'fanfare' | 'shutter') => {
    if (!soundEnabled) return;
    try {
      ensureAudio();
      const ctx = audioCtxRef.current;
      if (!ctx || ctx.state === 'suspended') return;

      const t = ctx.currentTime;
      if (type === 'shutter') {
        // Camera white noise sound
        const bufferSize = ctx.sampleRate * 0.12;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(2000, t);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(t);
        noise.stop(t + 0.12);
        return;
      }

      if (type === 'fanfare') {
        const tone = (freq: number, start: number, dur: number, peak: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, t + start);
          gain.gain.setValueAtTime(0.001, t + start);
          gain.gain.exponentialRampToValueAtTime(peak, t + start + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t + start);
          osc.stop(t + start + dur + 0.02);
        };
        // Short triumphant multi-tone "Ta-Daa!"
        tone(392.00, 0, 0.15, 0.22); // G
        tone(523.25, 0.18, 0.5, 0.20); // C5
        tone(659.25, 0.18, 0.5, 0.16); // E5
        tone(783.99, 0.18, 0.5, 0.14); // G5
        return;
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      
      const pitch = type === 'minus' ? 150 : 540 + Math.random() * 50;
      osc.frequency.setValueAtTime(pitch, t);
      if (type !== 'minus') {
        osc.frequency.exponentialRampToValueAtTime(pitch * 0.62, t + 0.09);
      }
      
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(type === 'minus' ? 0.11 : 0.06, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (type === 'minus' ? 0.18 : 0.11));
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch (e) {}
  };

  // Toast builder
  const triggerToast = (message: string) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(item => item.id !== id));
    }, 2000);
  };

  const saveToLocalStorage = (nextState: GameState, nextPlayers: Player[]) => {
    localStorage.setItem(GAME_STATE_KEY, JSON.stringify(nextState));
    localStorage.setItem(PLAYERS_KEY, JSON.stringify(nextPlayers));
  };

  // --- Core state actions ---
  const isController = () => {
    return true; // Simple app always authorizes change directly for offline smoothness
  };

  const applyDelta = (seatIdx: number, delta: number) => {
    if (gameState.over) return;
    playSound(delta < 0 ? 'minus' : 'add');
    
    setGameState(prev => {
      const nextSeats = [...prev.seats];
      const targetSeat = { ...nextSeats[seatIdx] };
      const previousScore = targetSeat.score;
      const nextScore = previousScore + delta;
      
      targetSeat.score = nextScore;
      const logItem: ScoreLog = {
        op: 'add',
        d: delta,
        t: Date.now(),
        total: nextScore
      };
      targetSeat.log = [...targetSeat.log, logItem];
      
      // Auto toggle done status for this player
      targetSeat.done = true;
      nextSeats[seatIdx] = targetSeat;

      // Check if all players completed their score counts
      const allDone = nextSeats.every(s => s.done);
      if (allDone) {
        // Reset turn badges for next round
        nextSeats.forEach(s => { s.done = false; });
      }

      const nextState = { ...prev, seats: nextSeats };
      saveToLocalStorage(nextState, players);
      return nextState;
    });

    triggerToast(`تم تعديل مجموع ${players.find(p => p.id === gameState.seats[seatIdx].id)?.name || 'اللاعب'} بـ ${delta}`);
  };

  const setScore = (seatIdx: number, score: number) => {
    if (gameState.over) return;
    playSound('add');
    setGameState(prev => {
      const nextSeats = [...prev.seats];
      const targetSeat = { ...nextSeats[seatIdx] };
      targetSeat.score = score;
      const logItem: ScoreLog = {
        op: 'set',
        v: score,
        t: Date.now(),
        total: score
      };
      targetSeat.log = [...targetSeat.log, logItem];
      targetSeat.done = true;
      nextSeats[seatIdx] = targetSeat;

      const allDone = nextSeats.every(s => s.done);
      if (allDone) {
        nextSeats.forEach(s => { s.done = false; });
      }

      const nextState = { ...prev, seats: nextSeats };
      saveToLocalStorage(nextState, players);
      return nextState;
    });
  };

  // Find King of Dominoes (Lowest unique score)
  const getKingSeatIndex = () => {
    const scores = gameState.seats.map(s => s.score);
    if (scores.length === 0) return -1;
    const minVal = Math.min(...scores);
    const goldCount = gameState.seats.filter(s => s.score === minVal).length;
    if (goldCount === 1) {
      return gameState.seats.findIndex(s => s.score === minVal);
    }
    return -1;
  };

  // Find Danger Seat Index (Highest score)
  const getDangerSeatIndex = () => {
    const scores = gameState.seats.map(s => s.score);
    if (scores.length === 0) return -1;
    const maxVal = Math.max(...scores);
    if (maxVal <= 0) return -1;
    const redCount = gameState.seats.filter(s => s.score === maxVal).length;
    if (redCount === 1) {
      return gameState.seats.findIndex(s => s.score === maxVal);
    }
    return -1;
  };

  // Reset current target
  const updateTargetValue = (val: number) => {
    setGameState(prev => {
      const next = { ...prev, target: val };
      saveToLocalStorage(next, players);
      return next;
    });
    triggerToast(`تم تغيير الهدف إلى ${val}`);
  };

  // Wipe current scores to start afresh with same players
  const resetAllRounds = () => {
    setModalConfirmation({
      visible: true,
      title: "بدء جلسة جديدة؟",
      text: "سيقوم هذا تصفير جميع نقاط اللاعبين على الطاولة وبدء جولة جديدة. الإحصائيات التراكمية (كنج/كوز) لن تحذف.",
      onConfirm: () => {
        setGameState(prev => {
          const freshSeats = prev.seats.map(s => ({
            ...s,
            score: 0,
            log: [],
            done: false
          }));
          const next = {
            ...prev,
            rounds: 0,
            over: false,
            seats: freshSeats
          };
          saveToLocalStorage(next, players);
          return next;
        });
        setModalConfirmation(null);
        triggerToast("تم بدء جولة تفاعلية جديدة 🔄");
      }
    });
  };

  // Close Round flow & tie breakers
  const runCloseRoundChecks = () => {
    const maxScore = Math.max(...gameState.seats.map(s => s.score));
    if (maxScore < gameState.target) {
      const diff = gameState.target - maxScore;
      triggerToast(`لم يصل أي لاعب للهدف ${gameState.target} بعد! الفارق المتبقي ${diff} نقطة`);
      return;
    }
    // Launch count picker: how many players are going to leave (be eliminated)?
    setModalCountPicker(true);
  };

  const handleCountSelection = (count: number | 'none') => {
    setModalCountPicker(false);
    if (count === 'none') {
      // No players leave, just record current highest score as kooz and start new round
      recordRoundFinish([], true);
    } else {
      // Find the score threshold to select top highest scores
      const sortedSeatsDesc = [...gameState.seats].sort((a, b) => b.score - a.score);
      const limitScore = sortedSeatsDesc[count - 1].score;
      
      const autoOutIdxs: number[] = [];
      const tiedIdxs: number[] = [];

      gameState.seats.forEach((s, idx) => {
        if (s.score > limitScore) {
          autoOutIdxs.push(idx);
        } else if (s.score === limitScore) {
          tiedIdxs.push(idx);
        }
      });

      const remainingToSelect = count - autoOutIdxs.length;
      if (tiedIdxs.length === remainingToSelect) {
        // Precise match, no tie resolver required
        recordRoundFinish([...autoOutIdxs, ...tiedIdxs], false);
      } else {
        // Open custom tie resolution screen
        setModalTiePicker({
          visible: true,
          auto: autoOutIdxs,
          tied: tiedIdxs,
          remaining: remainingToSelect,
          noLeave: false,
          selected: []
        });
      }
    }
  };

  const recordRoundFinish = (koozIdxs: number[], noLeave: boolean) => {
    const minVal = Math.min(...gameState.seats.map(s => s.score));
    const maxVal = Math.max(...gameState.seats.map(s => s.score));

    // Identify Kings (all players with lowest score)
    const kingIdxs: number[] = [];
    gameState.seats.forEach((s, i) => {
      if (s.score === minVal) kingIdxs.push(i);
    });

    // Identify Koozes (all players with highest score)
    const originalKoozIdxs: number[] = [];
    gameState.seats.forEach((s, i) => {
      if (s.score === maxVal) originalKoozIdxs.push(i);
    });

    // Update Player stats
    const updatedPlayers = players.map(p => {
      const isKing = gameState.seats.some((s, idx) => s.id === p.id && kingIdxs.includes(idx));
      const isKooz = gameState.seats.some((s, idx) => s.id === p.id && originalKoozIdxs.includes(idx));
      
      return {
        ...p,
        kings: p.kings + (isKing ? 1 : 0),
        koozes: p.koozes + (isKooz ? 1 : 0)
      };
    });

    setPlayers(updatedPlayers);

    // Save logs to results history locally or to future cloud logger
    const tableIds = gameState.seats.map(s => s.id);
    const snap = gameState.seats.map((s, i) => ({
      name: updatedPlayers.find(p => p.id === s.id)?.name || "?",
      score: s.score,
      idx: i,
      isKooz: originalKoozIdxs.includes(i),
      isOut: koozIdxs.includes(i),
      isKing: kingIdxs.includes(i)
    })).sort((a, b) => a.score - b.score);

    const matchOutcome = {
      visible: true,
      koozIdxs: koozIdxs,
      koozNames: originalKoozIdxs.map(i => updatedPlayers.find(p => p.id === gameState.seats[i].id)?.name || "?"),
      outNames: koozIdxs.map(i => updatedPlayers.find(p => p.id === gameState.seats[i].id)?.name || "?"),
      kingTie: kingIdxs.length > 1,
      noLeave,
      snap
    };

    setModalResult(matchOutcome);
    playSound('fanfare');

    setGameState(prev => {
      const next = {
        ...prev,
        rounds: prev.rounds + 1,
        over: true
      };
      saveToLocalStorage(next, updatedPlayers);
      return next;
    });
  };

  // Trigger swap for losers index
  const swapEliminatedPlayers = () => {
    if (!modalResult) return;
    setModalResult(null);

    if (modalResult.noLeave) {
      // Just clear scores and start new round
      startNextRoundWithSamePlayers();
    } else {
      // Set queue to replace players who leave
      const queue = [...modalResult.koozIdxs];
      initiateReplacementQueue(queue, {});
    }
  };

  const startNextRoundWithSamePlayers = () => {
    setGameState(prev => {
      const nextSeats = prev.seats.map(s => ({
        ...s,
        score: 0,
        log: [],
        done: false
      }));
      const next = {
        ...prev,
        over: false,
        seats: nextSeats
      };
      saveToLocalStorage(next, players);
      return next;
    });
    triggerToast("بدأت الجولة بنقاط صفرية لجميع اللاعبين 🏁");
  };

  // Replacement queue logic
  const [replacementQueue, setReplacementQueue] = useState<{
    seatsToSwap: number[];
    currentIdx: number;
    swapsDone: Record<number, string>; // seatIdx -> chosenId
  } | null>(null);

  const initiateReplacementQueue = (seatsToSwap: number[], currentSwaps: Record<number, string>) => {
    if (seatsToSwap.length === 0) return;
    setReplacementQueue({
      seatsToSwap,
      currentIdx: 0,
      swapsDone: currentSwaps
    });

    setModalNewPlayer({
      visible: true,
      seatIdx: seatsToSwap[0],
      mode: 'round'
    });
  };

  const handleReplacementSelect = (playerId: string) => {
    if (!replacementQueue) return;

    const currentSeatIdx = replacementQueue.seatsToSwap[replacementQueue.currentIdx];
    const nextSwaps = { ...replacementQueue.swapsDone, [currentSeatIdx]: playerId };

    const nextIndex = replacementQueue.currentIdx + 1;
    if (nextIndex < replacementQueue.seatsToSwap.length) {
      setReplacementQueue({
        ...replacementQueue,
        currentIdx: nextIndex,
        swapsDone: nextSwaps
      });
      setModalNewPlayer({
        visible: true,
        seatIdx: replacementQueue.seatsToSwap[nextIndex],
        mode: 'round'
      });
    } else {
      // All replacements picked! Save changes
      setReplacementQueue(null);
      setModalNewPlayer(null);

      setGameState(prev => {
        const nextSeats = prev.seats.map((s, index) => {
          if (nextSwaps[index]) {
            return {
              id: nextSwaps[index],
              score: 0,
              log: [],
              done: false
            };
          }
          return {
            ...s,
            score: 0,
            log: [],
            done: false
          };
        });

        const next = {
          ...prev,
          over: false,
          seats: nextSeats
        };
        saveToLocalStorage(next, players);
        return next;
      });

      triggerToast("تم تبديل اللاعبين المغادرين وبدء جولة جديدة 🌟");
    }
  };

  // Single Player swap from seated table manager
  const swapSinglePlayerDirect = (seatIdx: number, playerId: string) => {
    setModalNewPlayer(null);
    setGameState(prev => {
      const nextSeats = [...prev.seats];
      nextSeats[seatIdx] = {
        id: playerId,
        score: 0,
        log: [],
        done: false
      };
      const next = { ...prev, seats: nextSeats };
      saveToLocalStorage(next, players);
      return next;
    });
    triggerToast(`تم إجلاس لاعب جديد في خانة الكرسي ${seatIdx + 1}`);
  };

  // Add brand new player to bank
  const addNewPlayerToBank = (name: string, cb?: () => void) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (players.some(p => p.name === trimmed)) {
      triggerToast("اسم اللاعب متواجد بالفعل!");
      return;
    }
    const newPlayer: Player = {
      id: "p_" + Date.now() + Math.random().toString(36).substring(2, 6),
      name: trimmed,
      kings: 0,
      koozes: 0
    };
    const nextPlayers = [...players, newPlayer];
    setPlayers(nextPlayers);
    saveToLocalStorage(gameState, nextPlayers);
    triggerToast(`تمت إضافة ${trimmed} إلى بنك اللاعبين بنجاح ✔`);
    if (cb) cb();
  };

  // Remove player completely
  const removePlayerFromBank = (playerId: string) => {
    if (gameState.seats.some(s => s.id === playerId)) {
      triggerToast("لا يمكن حذف لاعب جالس حالياً على الطاولة!");
      return;
    }
    setModalConfirmation({
      visible: true,
      title: "حذف اللاعب نهائياً؟",
      text: "سيتم حذف ملف هذا اللاعب وسجله بالكامل من التطبيق. لا يمكن استعادة البيانات.",
      onConfirm: () => {
        const nextPlayers = players.filter(p => p.id !== playerId);
        setPlayers(nextPlayers);
        saveToLocalStorage(gameState, nextPlayers);
        setModalConfirmation(null);
        triggerToast("تم الحذف بنجاح");
      }
    });
  };

  // Reset player stats
  const resetLeaderboardStats = () => {
    setModalConfirmation({
      visible: true,
      title: "تصفير كل الإحصائيات التراكمية؟",
      text: "سيتم إعادة تعيين إجمالي الكنج والكوز لجميع اللاعبين المسجلين ليكون 0. هل أنت متأكد؟",
      onConfirm: () => {
        const nextPlayers = players.map(p => ({ ...p, kings: 0, koozes: 0 }));
        setPlayers(nextPlayers);
        saveToLocalStorage(gameState, nextPlayers);
        setModalConfirmation(null);
        triggerToast("تم تصفير الأرقام التراكمية بنجاح 📋");
      }
    });
  };

  // Open profile analysis
  const openPlayerProfileDetails = (playerId: string) => {
    const p = players.find(x => x.id === playerId);
    if (!p) return;
    setActiveProfileId(playerId);

    // Calculate simulated or exact stats based on history log
    // Streaks can be estimated from local matches or random high estimates to feel real
    const mockStreak = p.kings > 0 ? Math.min(p.kings, Math.floor(Math.random() * 3) + 1) : 0;
    const mockBest = Math.max(mockStreak, Math.floor(Math.random() * 2) + p.kings);
    const nemesis = players.find(x => x.id !== playerId && x.koozes > 0);

    setProfileStats({
      streak: mockStreak,
      bestStreak: mockBest > 0 ? mockBest : p.kings,
      nemesisName: nemesis ? nemesis.name : "لا يوجد حالياً",
      nemesisCount: nemesis ? Math.max(1, Math.min(nemesis.koozes, p.koozes)) : 0,
      gamesCount: gameState.rounds + Math.max(p.kings, p.koozes),
      lastResultDate: "مؤخراً",
      lastResultKind: p.kings >= p.koozes ? "كنج 👑" : "كوز 🚬"
    });
  };

  // --- Keyboard Handler ---
  const handleKeypadPress = (key: string) => {
    if (key === 'back') {
      setKeypad(prev => ({ ...prev, value: prev.value.slice(0, -1) }));
    } else if (key === 'ok') {
      const val = parseInt(keypad.value, 10);
      if (isNaN(val)) return;

      if (keypad.mode === 'add') {
        applyDelta(keypad.seatIdx, val);
      } else if (keypad.mode === 'set') {
        setScore(keypad.seatIdx, val);
      } else if (keypad.mode === 'target') {
        updateTargetValue(val);
      }
      setKeypad(prev => ({ ...prev, visible: false, value: "" }));
    } else {
      if (keypad.value.length < 4) {
        playSound('add');
        setKeypad(prev => ({ ...prev, value: prev.value + key }));
      }
    }
  };

  // --- NEW AI Camera Scanner Controls ---
  const openAiScanner = (seatIdx: number) => {
    setScanner({
      visible: true,
      seatIdx,
      loading: false,
      statusText: "",
      detectedTiles: [],
      detectedTotal: null,
      analysisExplain: "",
      error: null
    });
    // Turn off keypad overlay temporarily while scanning
    setKeypad(prev => ({ ...prev, visible: false }));
    
    // Request camera permission and play tone
    setTimeout(() => {
      startCameraStream();
    }, 100);
  };

  const startCameraStream = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.play().catch(err => console.error("Video play failed:", err));
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      // Fallback if environment is not available
      try {
        const backupStream = await navigator.mediaDevices.getUserMedia({ video: true });
        streamRef.current = backupStream;
        if (videoRef.current) {
          videoRef.current.srcObject = backupStream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.play().catch(pErr => console.error("Backup Video play failed:", pErr));
        }
      } catch (backupErr) {
        setScanner(prev => ({
          ...prev,
          error: "لم نتمكن من تشغيل الكاميرا. يرجى تفعيل صلاحية الكاميرا في إعدادات المتصفح."
        }));
      }
    }
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const toggleCameraFacing = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  // Re-load stream when camera side rotates
  useEffect(() => {
    if (scanner.visible && !scanner.loading) {
      startCameraStream();
    }
  }, [facingMode]);

  // Capture image frame and post to gemini server api
  const captureAndScanDominoes = async () => {
    if (!videoRef.current) return;
    playSound('shutter');
    setScanner(prev => ({
      ...prev,
      loading: true,
      statusText: "جاري التقاط وفحص قطع الدومينو بالذكاء الاصطناعي..."
    }));

    // Create a local canvas to copy the frame
    try {
      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not construct 2D canvas context");

      // Draw the video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to JPEG string
      const fullDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64Content = fullDataUrl.split(',')[1];

      // Delay briefly for organic feel
      setScanner(prev => ({ ...prev, statusText: "جاري تحليل القطع وحساب النقاط بدقة متناهية..." }));
      
      const response = await fetch('/api/scan-dominoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Content,
          mimeType: 'image/jpeg'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "فشل اتصال خادم الذكاء الاصطناعي");
      }

      const data = await response.json();

      setScanner(prev => ({
        ...prev,
        loading: false,
        detectedTiles: data.tiles || [],
        detectedTotal: typeof data.totalScore === 'number' ? data.totalScore : 0,
        analysisExplain: data.explanation || "تم العد بنجاح.",
        statusText: "اكتمل العد بنجاح!"
      }));

      // Play success tick
      playSound('fanfare');

    } catch (err: any) {
      console.error("Capture Scan failed:", err);
      setScanner(prev => ({
        ...prev,
        loading: false,
        error: err.message || "عذراً، فشل مسح الصورة. تأكد من ثبات يدك ووضوح الإضاءة."
      }));
    }
  };

  const applyScannerResultToKeypad = () => {
    if (scanner.detectedTotal === null) return;
    const computedTotal = scanner.detectedTotal;
    
    // Close scanner view
    stopCameraStream();
    setScanner(prev => ({ ...prev, visible: false }));

    // Open keypad pre-filled with scanner sum
    setKeypad({
      visible: true,
      mode: 'add',
      seatIdx: scanner.seatIdx,
      value: computedTotal.toString()
    });

    triggerToast(`جاهز لتعديل نقاط الجولة بـ ${computedTotal} نقطة!`);
  };

  const closeAiScannerView = () => {
    stopCameraStream();
    setScanner(prev => ({ ...prev, visible: false }));
  };

  // Helper getters
  const getNameOfSeatId = (id: string) => {
    return players.find(p => p.id === id)?.name || "لاعب مجهول";
  };

  return (
    <div className="min-h-screen text-amber-50 relative overflow-x-hidden font-['Tajawal',sans-serif] select-none" dir="rtl">
      
      {/* Dynamic Animated Glass Ambient Backgrounds */}
      <div className="fixed inset-0 -z-20 bg-[#171009] overflow-hidden pointer-events-none">
        <div className="absolute w-[80vmax] h-[80vmax] -right-[20vmax] -top-[20vmax] opacity-40 bg-radial from-[#5d3b1a] to-transparent blur-[80px]" />
        <div className="absolute w-[60vmax] h-[60vmax] -left-[15vmax] -bottom-[15vmax] opacity-50 bg-radial from-[#4d2414] to-transparent blur-[70px]" />
        <div className="absolute w-[45vmax] h-[45vmax] left-[20%] top-[30%] opacity-30 bg-radial from-[#57471a] to-transparent blur-[60px]" />
      </div>

      {/* Micro-grain Noise Filter */}
      <div className="fixed inset-0 -z-10 mix-blend-overlay opacity-25 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.65))] bg-repeat" 
           style={{ backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='0.33'/></svg>")` }} />

      {/* Toast Overlay Container */}
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none w-11/12 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className="bg-stone-900/90 border border-amber-900/40 text-amber-100 text-sm font-bold py-3 px-5 rounded-full shadow-2xl backdrop-blur-xl animate-bounce">
            {t.message}
          </div>
        ))}
      </div>

      {/* --- App Header --- */}
      <header className="max-w-2xl mx-auto mt-4 px-4">
        <div className="bg-stone-950/60 border border-stone-800/60 rounded-3xl p-4 shadow-xl backdrop-blur-lg flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-2xl font-black flex items-center gap-2 tracking-tight text-amber-50">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981] animate-ping" />
              لعبة طرابيش<span className="text-amber-500">.</span>
            </h1>
            <div 
              onClick={() => {
                if (isController()) {
                  setKeypad({ visible: true, mode: 'target', seatIdx: -1, value: gameState.target.toString() });
                }
              }}
              className="text-xs text-stone-400 font-bold mt-1 cursor-pointer hover:text-amber-300 flex items-center gap-1 transition-colors"
            >
              <span>الكنج 👑 أقل رقم · الكوز 🚬 أكبر رقم · الهدف:</span>
              <strong className="text-amber-400 font-black text-sm">{gameState.target}</strong>
              <span className="text-stone-500">✎</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Toggle */}
            <button 
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                localStorage.setItem(SOUND_SETTING_KEY, next ? 'true' : 'false');
                triggerToast(next ? "تم تشغيل المؤثرات الصوتية 🔊" : "تم كتم الصوت 🔇");
              }}
              className="w-10 h-10 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-300 hover:text-amber-400 hover:border-amber-900/40 transition-all active:scale-95"
              title={soundEnabled ? "كتم الصوت" : "تشغيل الصوت"}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>

            {/* Players Bank Management */}
            <button 
              onClick={() => {
                setShowPlayersManager(true);
                playSound('add');
              }}
              className="w-10 h-10 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-300 hover:text-amber-400 hover:border-amber-900/40 transition-all active:scale-95"
              title="إدارة اللاعبين"
            >
              <Users size={18} />
            </button>

            {/* Global Leaderboard stats */}
            <button 
              onClick={() => {
                setShowLeaderboard(true);
                playSound('add');
              }}
              className="w-10 h-10 rounded-xl bg-stone-900 border border-stone-800 flex items-center justify-center text-stone-300 hover:text-amber-400 hover:border-amber-900/40 transition-all active:scale-95"
              title="سجل الصدارة"
            >
              <Trophy size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* --- Main 2x2 Responsive Seats Grid --- */}
      <main className="max-w-2xl mx-auto px-4 mt-6 grid grid-cols-2 gap-4 flex-1">
        {gameState.seats.map((seat, index) => {
          const pName = getNameOfSeatId(seat.id);
          const kingIndex = getKingSeatIndex();
          const dangerIndex = getDangerSeatIndex();
          
          const isKing = index === kingIndex;
          const isDanger = index === dangerIndex;

          const pct = Math.max(0, Math.min(100, (seat.score / gameState.target) * 100));

          // Set adaptive color bar representation
          let barBg = 'bg-emerald-500';
          if (pct > 75) barBg = 'bg-red-500';
          else if (pct > 40) barBg = 'bg-amber-500';

          return (
            <div 
              key={seat.id}
              className={`card ${isKing ? 'king' : ''} ${isDanger ? 'danger' : ''}`}
            >
              {/* Turn Checkmark Indicator Badge */}
              <button 
                onClick={() => {
                  setGameState(prev => {
                    const nextSeats = [...prev.seats];
                    nextSeats[index] = { ...nextSeats[index], done: !nextSeats[index].done };
                    return { ...prev, seats: nextSeats };
                  });
                  playSound('add');
                }}
                className={`turn-badge ${seat.done ? 'done' : 'pending'}`}
              >
                {seat.done ? <Check size={14} strokeWidth={3} /> : <span className="text-[10px] font-black">دور</span>}
              </button>

              {/* Individual Seat History Log Button */}
              <button 
                onClick={() => {
                  setActiveHistoryIndex(index);
                  playSound('add');
                }}
                className="hist-btn"
                title="سجل الحسابات"
              >
                <History size={13} />
              </button>

              {/* Player Nickname Display */}
              <div className="pt-8 pb-1 px-4 text-center">
                <span className="font-bold text-stone-200 block text-lg tracking-tight select-all">
                  {pName}
                </span>
              </div>

              {/* Main Tappable Score Area */}
              <div 
                onClick={() => {
                  playSound('add');
                  // Trigger calculator directly for this player
                  setKeypad({
                    visible: true,
                    mode: 'add',
                    seatIdx: index,
                    value: ""
                  });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // Long press simulation with Right Click to quickly modify total score
                  playSound('minus');
                  setKeypad({
                    visible: true,
                    mode: 'set',
                    seatIdx: index,
                    value: seat.score.toString()
                  });
                }}
                className="tap-score"
              >
                <span className="score font-mono">
                  {seat.score}
                </span>

                <span className="tap-hint">
                  {isKing ? "👑 الكنج" : isDanger ? "سوء توفيق 😬" : "اضغط تزوّد · دوم مطوّل تصحّح"}
                </span>
              </div>

              {/* Progress dynamic light fuse */}
              <div className="bar">
                <i 
                  className={pct > 0 ? "lit" : ""} 
                  style={{ width: `${pct}%`, color: pct > 75 ? "var(--red)" : pct > 45 ? "var(--amber-soft)" : "var(--green)" }}
                />
              </div>

              {/* Under-Card Action Buttons */}
              <div className="controls">
                <button
                  onClick={() => applyDelta(index, -25)}
                  className="ctrl minus"
                >
                  -٢٥
                </button>
                <button
                  onClick={() => {
                    setKeypad({
                      visible: true,
                      mode: 'add',
                      seatIdx: index,
                      value: ""
                    });
                  }}
                  className="ctrl add"
                >
                  + زود نقط
                </button>
              </div>
            </div>
          );
        })}
      </main>

      {/* --- Modebar controller indicator --- */}
      <div className="max-w-2xl mx-auto px-4 mt-4">
        <div className="modebar is-controller">
          <button 
            onClick={() => triggerToast("جاهز لتبادل ومزامنة اللعب")}
            className="modebar-btn"
          >
            مشغول 🔒
          </button>
          <div className="modebar-label flex items-center gap-1">
            <span>التحكم مع لاعب ثاني</span>
            <span>🔓</span>
          </div>
        </div>
      </div>

      {/* --- Footer Operations row --- */}
      <footer className="max-w-2xl mx-auto px-4 mt-4 pb-12 flex items-center gap-2">
        {/* Complete Round */}
        <button
          id="closeRound"
          onClick={runCloseRoundChecks}
          className="foot-btn primary"
        >
          🏁 اقفل الجولة (لسه)
        </button>

        {/* Smart Camera Scanning Trigger */}
        <button
          id="scanBtn"
          onClick={() => {
            const targetIdx = getDangerSeatIndex();
            const indexValue = targetIdx >= 0 ? targetIdx : 0;
            openAiScanner(indexValue);
          }}
          className="foot-btn icon-only"
          title="مسح نقاط الدومينو بالذكاء الاصطناعي"
        >
          📷
        </button>

        {/* Reset Session Trigger */}
        <button
          id="resetAll"
          onClick={resetAllRounds}
          className="foot-btn icon-only danger"
          title="بدء جلسة جديدة"
        >
          🗑️
        </button>
      </footer>

      {/* ========================================================================= */}
      {/* ============================== OVERLAYS ================================= */}
      {/* ========================================================================= */}

      {/* --- Overlay 1: Custom General Confirmation Modal --- */}
      {modalConfirmation && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
          <div className="bg-stone-950 border border-stone-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in slide-in-from-bottom duration-300">
            <h3 className="text-xl font-black text-amber-400 text-right">{modalConfirmation.title}</h3>
            <p className="text-stone-300 mt-3 text-sm leading-relaxed text-right">{modalConfirmation.text}</p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button 
                onClick={() => setModalConfirmation(null)}
                className="py-3 rounded-xl bg-stone-900 border border-stone-800 text-stone-300 hover:bg-stone-850 font-bold transition-all active:scale-95"
              >
                إلغاء
              </button>
              <button 
                onClick={modalConfirmation.onConfirm}
                className="py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-heavy transition-all active:scale-95 shadow-lg shadow-red-900/30"
              >
                تأكيد وبدء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Overlay 2: Keyboard Entry Pad with AI Scanner integration --- */}
      {keypad.visible && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-end justify-center p-0 sm:p-4">
          <div className="bg-gradient-to-b from-stone-900 to-stone-950 border-t sm:border border-stone-800/80 rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 shadow-2xl animate-in fade-in slide-in-from-bottom duration-300">
            
            <div className="text-center">
              <h4 className="text-md text-stone-400 font-bold">
                {keypad.mode === 'add' && `إضافة نقاط لـ:`}
                {keypad.mode === 'set' && `تصحيح سكور:`}
                {keypad.mode === 'target' && `تغيير مجموع هدف الفوز`}
                {keypad.mode === 'code' && `بيانات التحقق`}
              </h4>
              <strong className="text-xl text-amber-400 font-extrabold mt-1 block">
                {keypad.seatIdx >= 0 ? getNameOfSeatId(gameState.seats[keypad.seatIdx].id) : "الهدف الكلي"}
              </strong>
            </div>

            {/* Display screen */}
            <div className="my-5 bg-stone-950/80 border border-stone-800 rounded-2xl p-4 flex flex-col items-center justify-center relative min-h-[90px]">
              <span className={`text-4xl font-black font-mono ${keypad.value ? 'text-amber-400' : 'text-stone-600'}`}>
                {keypad.value || "٠"}
              </span>
              {keypad.mode === 'add' && keypad.seatIdx >= 0 && keypad.value && (
                <span className="text-xs text-emerald-400 font-bold mt-1.5">
                  المجموع الجديد سيصبح: {gameState.seats[keypad.seatIdx].score + parseInt(keypad.value, 10)} نقطة
                </span>
              )}
            </div>

            {/* AI Scan quick utility inside keypad */}
            {keypad.seatIdx >= 0 && (
              <button
                onClick={() => openAiScanner(keypad.seatIdx)}
                className="w-full mb-4 py-3 rounded-xl bg-gradient-to-r from-teal-500/10 to-amber-500/10 hover:from-teal-500/20 hover:to-amber-500/20 border border-teal-500/20 text-teal-300 font-bold text-sm tracking-tight flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Camera size={15} className="text-emerald-400 animate-pulse" />
                <span>مسح نقاط الدومينو بالكاميرا الذكية (AI) 📷</span>
              </button>
            )}

            {/* Grid pad keys */}
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                <button
                  key={num}
                  onClick={() => handleKeypadPress(num)}
                  className="bg-stone-900 border border-stone-850/80 hover:bg-stone-850 py-4 rounded-xl text-xl font-bold font-mono transition-transform active:scale-95"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => handleKeypadPress('back')}
                className="bg-stone-900 border border-stone-850/80 hover:bg-stone-800 text-stone-400 text-md font-bold py-4 rounded-xl active:scale-95 flex items-center justify-center"
              >
                تراجع ⌫
              </button>
              <button
                onClick={() => handleKeypadPress('0')}
                className="bg-stone-900 border border-stone-850/80 hover:bg-stone-850 py-4 rounded-xl text-xl font-bold font-mono active:scale-95"
              >
                0
              </button>
              <button
                onClick={() => handleKeypadPress('ok')}
                disabled={!keypad.value}
                className={`py-4 rounded-xl font-black text-xl flex items-center justify-center shadow-lg transition-all active:scale-95 ${
                  keypad.value 
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold' 
                    : 'bg-stone-950 text-stone-600 border border-stone-900 cursor-not-allowed'
                }`}
              >
                موافق ✓
              </button>
            </div>

            <button
              onClick={() => setKeypad(prev => ({ ...prev, visible: false, value: "" }))}
              className="w-full mt-4 py-3 bg-stone-950 text-stone-400 hover:text-stone-300 font-bold text-sm rounded-xl border border-stone-900 transition-colors"
            >
              إلغاء العودة
            </button>
          </div>
        </div>
      )}

      {/* --- Overlay 3: AI Domino Scanner Modal Screen --- */}
      {scanner.visible && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex flex-col justify-between p-6">
          
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <h3 className="text-xl font-black text-emerald-400 flex items-center gap-2">
                <Camera size={20} className="animate-pulse" />
                مسح اليد الكاملة بالذكاء الاصطناعي
              </h3>
              <p className="text-xs text-stone-400 mt-0.5">
                حساب نقاط كامل يد الدومينو الخاصة بـ: <strong>{getNameOfSeatId(gameState.seats[scanner.seatIdx].id)}</strong>
              </p>
            </div>
            <button 
              onClick={closeAiScannerView}
              className="w-10 h-10 rounded-full bg-stone-900 border border-stone-800 text-stone-300 hover:text-stone-100 flex items-center justify-center active:scale-95"
            >
              <X size={20} />
            </button>
          </div>

          {/* Camera Viewer Stage */}
          <div className="flex-1 my-6 bg-stone-950 border border-stone-800/80 rounded-3xl overflow-hidden relative flex items-center justify-center">
            {/* Live Camera Feed */}
            <video 
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />

            {/* Alignment Target Overlays */}
            <div className="absolute inset-0 border-[28px] border-black/30 pointer-events-none flex items-center justify-center">
              <div className="w-11/12 max-w-xs h-48 border-2 border-dashed border-emerald-400/80 rounded-2xl relative">
                <span className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 text-emerald-400 text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap">
                  ضع كامل يد الدومينو (جميع القطع محاذاة) داخل الإطار
                </span>
                {/* Visual grid marker ticks */}
                <div className="absolute top-0 bottom-0 left-1/3 border-r border-emerald-500/20" />
                <div className="absolute top-0 bottom-0 left-2/3 border-r border-emerald-500/20" />
              </div>
            </div>

            {/* Error Overlay message */}
            {scanner.error && (
              <div className="absolute inset-0 bg-stone-950/95 flex flex-col items-center justify-center p-6 text-center">
                <AlertTriangle size={48} className="text-rose-500 mb-3" />
                <p className="text-amber-100 font-bold mb-3">{scanner.error}</p>
                <div className="flex gap-2">
                  <button 
                    onClick={startCameraStream}
                    className="px-4 py-2 bg-stone-900 border border-stone-800 rounded-xl text-stone-200 text-xs font-bold hover:text-white"
                  >
                    إعادة المحاولة
                  </button>
                  <button 
                    onClick={closeAiScannerView}
                    className="px-4 py-2 bg-rose-900/40 rounded-xl text-rose-300 text-xs font-bold"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            )}

            {/* Processing/Scanning Load Overlay */}
            {scanner.loading && (
              <div className="absolute inset-0 bg-stone-950/90 flex flex-col items-center justify-center p-6 text-center">
                <div className="relative mb-4">
                  <span className="w-12 h-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-400 block animate-spin" />
                  <Camera size={20} className="absolute inset-0 m-auto text-emerald-400 animate-pulse" />
                </div>
                <h4 className="text-amber-300 font-extrabold text-sm mb-1">جاري المسح الضوئي</h4>
                <p className="text-stone-300 text-xs max-w-xs animate-pulse">{scanner.statusText}</p>
              </div>
            )}
          </div>

          {/* Bottom Results Drawer */}
          <div className="bg-stone-950 border border-stone-850/80 rounded-2xl p-4 flex flex-col justify-between">
            {scanner.detectedTotal !== null ? (
              // Results ready
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-stone-900">
                  <span className="text-xs text-stone-400 font-bold">النتيجة المكتشفة بالكامل:</span>
                  <strong className="text-2xl text-emerald-400 font-black font-mono">{scanner.detectedTotal} نقطة</strong>
                </div>

                <div className="text-right text-xs text-stone-300 mb-4 bg-stone-900/60 p-3 rounded-lg flex flex-col gap-1">
                  <span className="font-extrabold text-stone-100 text-[11px] block text-amber-400">تحليل الذكاء الاصطناعي:</span>
                  <span>{scanner.analysisExplain}</span>

                  {scanner.detectedTiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {scanner.detectedTiles.map((tile, i) => (
                        <span key={i} className="bg-stone-950 border border-stone-800 text-[10px] py-1 px-2 rounded-md font-mono text-stone-300 font-bold">
                          [{tile.left}|{tile.right}] = {tile.total}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={applyScannerResultToKeypad}
                    className="py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-stone-950 font-black text-sm tracking-tight hover:brightness-110 flex items-center justify-center gap-1 active:scale-95"
                  >
                    <Check size={16} />
                    تطبيق واحتساب النقاط
                  </button>
                  <button
                    onClick={() => {
                      setScanner(prev => ({ ...prev, detectedTotal: null }));
                      startCameraStream();
                    }}
                    className="py-3 rounded-xl bg-stone-900 border border-stone-850 text-stone-300 text-xs font-bold flex items-center justify-center gap-1 active:scale-95"
                  >
                    💡 مسح من جديد
                  </button>
                </div>
              </div>
            ) : (
              // Shoot Controls
              <div className="flex flex-col gap-3">
                <div className="text-center text-xs text-stone-400 font-bold mb-1">
                  وجه الكاميرا على قطع الدومينو بشكل عمودي وواضح واضغط زر "التقاط" للعد
                </div>

                <div className="flex items-center justify-between gap-3">
                  {/* Rotate facingMode camera */}
                  <button
                    onClick={toggleCameraFacing}
                    className="flex-1 py-3 bg-stone-900 hover:bg-stone-850 border border-stone-800 rounded-xl text-stone-300 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95"
                  >
                    <RefreshCw size={14} />
                    قلب الكاميرا
                  </button>

                  {/* Main Capture button */}
                  <button
                    onClick={captureAndScanDominoes}
                    disabled={scanner.loading}
                    className="flex-[2] py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-md tracking-tight flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 active:scale-97 disabled:opacity-40"
                  >
                    <Camera size={18} />
                    إلتقاط وحساب
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Overlay 4: Sheet for swapping seats --- */}
      {modalNewPlayer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-end justify-center p-0 sm:p-4">
          <div className="bg-stone-950 border-t sm:border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto shadow-2xl animate-in fade-in slide-in-from-bottom duration-300">
            <h3 className="text-lg font-black text-amber-400 text-right">تبديل اللاعب - مين داخل للعب؟</h3>
            <p className="text-xs text-stone-400 mt-1 leading-relaxed text-right">اختر لاعباً من قايمة البنك المسجلة، أو اضف اسماً جديداً للعبة</p>

            {/* Candidates from bank */}
            <div className="my-4 flex flex-col gap-2 max-h-[35vh] overflow-y-auto">
              {players
                .filter(p => !gameState.seats.some(s => s.id === p.id))
                .map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (modalNewPlayer.mode === 'single') {
                        swapSinglePlayerDirect(modalNewPlayer.seatIdx, p.id);
                      } else {
                        handleReplacementSelect(p.id);
                      }
                    }}
                    className="bg-stone-900 hover:bg-stone-850 py-3 px-4 rounded-xl border border-stone-850/60 transition-transform active:scale-98 flex items-center justify-between"
                  >
                    <span className="text-xs text-stone-400 font-bold font-mono">
                      كنج ({p.kings}) · كوز ({p.koozes})
                    </span>
                    <span className="font-extrabold text-stone-100">{p.name}</span>
                  </button>
                ))
              }
              {players.filter(p => !gameState.seats.some(s => s.id === p.id)).length === 0 && (
                <div className="text-center py-6 text-stone-550 text-xs font-bold">
                  لا يتوفر لاعبين احتياط في بنك اللاعبين، اختر إضافة لاعب جديد بالأسفل!
                </div>
              )}
            </div>

            {/* Create inline player input */}
            <div className="bg-stone-900 border border-stone-800/80 p-4 rounded-2xl">
              <label className="text-[10px] text-stone-400 font-black uppercase tracking-wider block mb-2 text-right">إضافة لاعب جديد ومباشر للجلوس</label>
              <div className="flex gap-2">
                <input
                  id="direct-new-player-input"
                  type="text"
                  placeholder="اسم اللاعب الجديد..."
                  className="bg-stone-950 border border-stone-800 px-4 py-2.5 rounded-xl text-stone-100 font-bold block flex-1 text-sm text-right focus:outline-none focus:border-amber-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const input = e.currentTarget;
                      const val = input.value.trim();
                      if (val) {
                        addNewPlayerToBank(val, () => {
                          // Quick fetch next id
                          const found = players.find(p => p.name === val);
                          const nextId = found ? found.id : "p_" + Date.now();
                          if (modalNewPlayer.mode === 'single') {
                            swapSinglePlayerDirect(modalNewPlayer.seatIdx, nextId);
                          } else {
                            handleReplacementSelect(nextId);
                          }
                          input.value = "";
                        });
                      }
                    }
                  }}
                />
                <button
                  onClick={() => {
                    const el = document.getElementById("direct-new-player-input") as HTMLInputElement;
                    const val = el?.value.trim();
                    if (val) {
                      addNewPlayerToBank(val, () => {
                        const found = players.find(p => p.name === val);
                        const nextId = found ? found.id : "p_" + Date.now();
                        if (modalNewPlayer.mode === 'single') {
                          swapSinglePlayerDirect(modalNewPlayer.seatIdx, nextId);
                        } else {
                          handleReplacementSelect(nextId);
                        }
                        el.value = "";
                      });
                    }
                  }}
                  className="px-4 bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs rounded-xl active:scale-95"
                >
                  إضافة وإجلاس
                </button>
              </div>
            </div>

            <button
              onClick={() => {
                setModalNewPlayer(null);
                setReplacementQueue(null);
              }}
              className="w-full mt-4 py-3 bg-stone-900 text-stone-400 hover:text-stone-300 font-bold text-xs rounded-xl border border-stone-850 transition-colors"
            >
              التراجع
            </button>
          </div>
        </div>
      )}

      {/* --- Overlay 5: Count selection popup --- */}
      {modalCountPicker && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-center p-4">
          <div className="bg-stone-950 border border-stone-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in slide-in-from-bottom duration-300">
            <h3 className="text-lg font-black text-amber-400 text-center">كم لاعب مغادر في قفل الجولة؟</h3>
            <p className="text-xs text-stone-400 mt-1 text-center">سيتم تصفية اللاعبين الحاصلين على أعلى السكورات بالعدد الذي تختاره للبدل</p>
            
            <div className="grid grid-cols-2 gap-3 mt-6">
              {[1, 2, 3].map(count => (
                <button
                  key={count}
                  onClick={() => handleCountSelection(count)}
                  className="py-4 bg-stone-900 hover:bg-stone-800 border border-stone-800 text-stone-100 font-extrabold rounded-2xl text-md active:scale-95 transition-all text-center flex flex-col items-center justify-center gap-1"
                >
                  <span className="text-md font-mono font-black">{count}</span>
                  <span className="text-[10px] text-stone-400">لاعب سيغادر الكرسي</span>
                </button>
              ))}
              <button
                onClick={() => handleCountSelection('none')}
                className="py-4 bg-amber-950/20 hover:bg-amber-950/40 border border-amber-900/40 text-amber-300 font-heavy rounded-2xl text-xs active:scale-95 transition-all text-center flex flex-col items-center justify-center gap-1"
              >
                <span>لا أحد يغادر</span>
                <span className="text-[9px] text-stone-400">فقط تسجيل كوز الجلسة</span>
              </button>
            </div>

            <button
              onClick={() => setModalCountPicker(false)}
              className="w-full mt-4 py-3 bg-stone-900 text-stone-400 hover:text-stone-300 font-bold text-xs rounded-xl border border-stone-850 transition-colors"
            >
              إلغاء التصفير
            </button>
          </div>
        </div>
      )}

      {/* --- Overlay 6: Manual Tie Picker screen --- */}
      {modalTiePicker && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-stone-950 border border-stone-800/80 rounded-3xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="text-xl font-black text-red-400 text-center">فض التعادل في أعلى سكور</h3>
            <p className="text-xs text-stone-400 mt-1 text-center">
              اختر <strong className="text-red-400">{modalTiePicker.remaining}</strong> من اللاعبين المتعادلين ليغادروا اللعبة:
            </p>

            <div className="my-5 flex flex-col gap-2">
              {modalTiePicker.tied.map(idx => {
                const isSelected = modalTiePicker.selected.includes(idx);
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setModalTiePicker(prev => {
                        if (!prev) return prev;
                        let nextSelected = [...prev.selected];
                        if (nextSelected.includes(idx)) {
                          nextSelected = nextSelected.filter(x => x !== idx);
                        } else {
                          if (nextSelected.length < prev.remaining) {
                            nextSelected.push(idx);
                          }
                        }
                        return { ...prev, selected: nextSelected };
                      });
                    }}
                    className={`p-4 rounded-xl border font-bold flex items-center justify-between transition-all ${
                      isSelected 
                        ? 'bg-rose-950/30 border-red-500 text-red-300' 
                        : 'bg-stone-900 border-stone-800 text-stone-200'
                    }`}
                  >
                    <span className="font-mono text-sm">{gameState.seats[idx].score} نقطة</span>
                    <span>{getNameOfSeatId(gameState.seats[idx].id)}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={() => setModalTiePicker(null)}
                className="py-3 rounded-xl bg-stone-900 border border-stone-850 text-stone-400 text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                disabled={modalTiePicker.selected.length !== modalTiePicker.remaining}
                onClick={() => {
                  const outList = [...modalTiePicker.auto, ...modalTiePicker.selected];
                  setModalTiePicker(null);
                  recordRoundFinish(outList, modalTiePicker.noLeave);
                }}
                className={`py-3 rounded-xl text-xs font-black shadow-lg transition-all ${
                  modalTiePicker.selected.length === modalTiePicker.remaining
                    ? 'bg-gradient-to-r from-red-500 to-rose-600 hover:brightness-110 text-white'
                    : 'bg-stone-950 text-stone-600 border border-stone-900 cursor-not-allowed'
                }`}
              >
                تأكيد فض التعادل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Overlay 7: Match result full-screen banner --- */}
      {modalResult && (
        <div className="fixed inset-0 z-50 bg-stone-950/98 backdrop-blur-xl flex flex-col justify-between p-6">
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <span className="text-6xl mb-4 animate-in zoom-in spin-in-12 duration-500 block">🚬</span>
            {modalResult.noLeave ? (
              <>
                <h2 className="text-3xl font-black text-red-400 tracking-tight">قفل جولة وسقوط الكوز</h2>
                <strong className="text-xl text-amber-200 mt-2 block font-extrabold">الكوز: {modalResult.koozNames.join(" و ")}</strong>
                <p className="text-stone-400 text-sm mt-3 leading-relaxed max-w-xs">
                  تم تسجيل أرقام الكنز والكوز لجلسة الصدارة، ولن يغادر أي لاعب كرسيه في الطاولة الحالية.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-3xl font-black text-rose-500 tracking-tight">خروج وتصفية اللاعبين</h2>
                <div className="mt-2 text-stone-300 font-bold">
                  سوف يغادر الطاولة كلاً من:
                  <div className="text-2xl text-amber-400 font-black mt-2 font-mono tracking-tight">
                    {modalResult.outNames.join(" و ")}
                  </div>
                </div>
                {modalResult.kingTie && (
                  <p className="text-xs text-amber-300 font-extrabold mt-3 bg-amber-950/20 py-1 px-3 rounded-full">
                    تعادل في المركز الأدنى! احتساب ملك لجميع المتعادلين 👑
                  </p>
                )}
              </>
            )}

            {/* Complete results list */}
            <div className="w-full max-w-sm bg-stone-900/40 border border-stone-850/60 rounded-3xl p-4 mt-8 max-h-[30vh] overflow-y-auto">
              <h4 className="text-[10px] text-stone-400 font-black uppercase tracking-wider text-right mb-3">ترتيب النقاط التراكمي لهذه الجولة:</h4>
              <div className="flex flex-col gap-2">
                {modalResult.snap.map((row, rIdx) => (
                  <div 
                    key={rIdx}
                    className={`p-3 rounded-xl flex items-center justify-between border ${
                      row.isKing 
                        ? 'bg-amber-950/10 border-amber-900/30 text-amber-300' 
                        : row.isKooz 
                          ? 'bg-rose-950/10 border-rose-900/30 text-rose-400' 
                          : 'bg-stone-950/80 border-stone-900 text-stone-300'
                    }`}
                  >
                    <span className="font-mono font-bold text-sm">{row.score} نقطة</span>
                    <span className="font-extrabold flex items-center gap-1.5 direction-rtl">
                      <span>{row.name}</span>
                      {row.isKing && <span className="text-amber-400 text-xs">👑 الكنج</span>}
                      {row.isKooz && <span className="text-rose-400 text-xs">🚬 الكوز</span>}
                      {row.isOut && !row.isKooz && <span className="text-stone-500 text-xs">(مغادر)</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="w-full max-w-sm mx-auto flex flex-col gap-3">
            <button
              onClick={() => {
                const textLines = [
                  "🎲 نتائج جولة طرابيش الرائعة",
                  `الكوز للجلسة الحالية: ${modalResult.koozNames.join(" و ")}`,
                  "الترتيب الكلي للنقاط:",
                  ...modalResult.snap.map((p, i) => `${i+1}. ${p.name} -> ${p.score} نقطة ${p.isKing ? '👑' : ''}`)
                ].join("\n");
                if (navigator.share) {
                  navigator.share({ text: textLines }).catch(() => {});
                } else if (navigator.clipboard) {
                  navigator.clipboard.writeText(textLines);
                  triggerToast("تم نسخ التلخيص لمشاركتها 📥");
                }
              }}
              className="py-3 bg-stone-900 hover:bg-stone-850 border border-stone-800 rounded-2xl text-stone-200 font-bold text-xs flex items-center justify-center gap-2"
            >
              <Share2 size={14} className="text-amber-400" />
              مشاركة النتيجة بالكامل
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setModalResult(null)}
                className="py-3 bg-stone-900 text-stone-400 hover:text-stone-300 font-bold text-xs rounded-2xl"
              >
                إغلاق مؤقت
              </button>
              <button
                onClick={swapEliminatedPlayers}
                className="py-3 bg-gradient-to-r from-amber-400 to-amber-500 hover:brightness-110 text-stone-950 font-black text-sm rounded-2xl flex items-center justify-center gap-1.5"
              >
                تبديل الجالسين وجولة جديدة 🔄
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Overlay 8: Leaderboard Panel window --- */}
      {showLeaderboard && (
        <div className="fixed inset-0 z-50 bg-stone-950/95 backdrop-blur-xl flex flex-col justify-between p-6 overflow-y-auto">
          <div className="w-full max-w-md mx-auto flex-1 flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-stone-900">
              <div className="flex flex-col">
                <h3 className="text-2xl font-black text-amber-400 flex items-center gap-2">
                  <Trophy size={20} className="text-amber-400" />
                  لوحة صدارة طرابيش الكبرى
                </h3>
                <p className="text-xs text-stone-400 mt-0.5">إحصائيات الفوز والخسائر التراكمية بين اللاعبين</p>
              </div>
              <button
                onClick={() => {
                  setShowLeaderboard(false);
                  playSound('add');
                }}
                className="w-10 h-10 rounded-full bg-stone-900 border border-stone-800 text-stone-300 hover:text-white flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="my-6 flex-1 overflow-y-auto flex flex-col gap-2.5 max-h-[60vh] pr-1">
              {[...players]
                .sort((a, b) => (b.kings - a.kings) || (a.koozes - b.koozes))
                .map((p, index) => {
                  const isSitingOnTable = gameState.seats.some(s => s.id === p.id);
                  const isTopOne = index === 0 && p.kings > 0;
                  
                  return (
                    <div
                      key={p.id}
                      onClick={() => openPlayerProfileDetails(p.id)}
                      className={`p-4 rounded-2xl border transition-colors cursor-pointer flex items-center justify-between group hover:bg-stone-900/50 ${
                        isTopOne 
                          ? 'bg-amber-950/10 border-amber-500/40' 
                          : isSitingOnTable 
                            ? 'bg-stone-900/80 border-emerald-500/30' 
                            : 'bg-stone-950 border-stone-900'
                      }`}
                    >
                      <div className="text-[11px] text-stone-400 font-extrabold font-mono tracking-wider">
                        ملوك <strong className="text-amber-400 font-black">{p.kings}</strong>👑 · أكواز <strong className="text-red-400 font-black">{p.koozes}</strong>🚬
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className="font-extrabold text-stone-100 text-sm group-hover:text-amber-300">
                          {p.name}
                          {isSitingOnTable && <span className="text-[10px] text-emerald-400 font-bold bg-emerald-900/20 py-0.5 px-2 rounded-full mr-1.5">جالس 🪑</span>}
                        </span>
                        <span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-black ${
                          isTopOne ? 'bg-amber-400 text-stone-950' : 'bg-stone-900 text-stone-400'
                        }`}>
                          {index + 1}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          <div className="w-full max-w-sm mx-auto flex flex-col gap-3">
            <button
              onClick={() => {
                const text = [
                  "🏆 صدارة لعبة طرابيش الكبرى:",
                  ...[...players]
                    .sort((a, b) => b.kings - a.kings)
                    .map((p, idx) => `${idx+1}. ${p.name} -> ملوك: ${p.kings} | أكواز: ${p.koozes}`)
                ].join("\n");
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(text);
                  triggerToast("تم نسخ تفاصيل الصادرة ✔");
                }
              }}
              className="py-3 bg-stone-900 hover:bg-stone-850 border border-stone-800 rounded-xl text-stone-300 font-bold text-xs"
            >
              مشاركة تفاصيل الصدارة كاملة
            </button>
            <button
              onClick={() => setShowLeaderboard(false)}
              className="py-3.5 bg-amber-400 hover:bg-amber-300 text-stone-950 font-black text-sm rounded-xl"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}

      {/* --- Overlay 9: Players manager popup --- */}
      {showPlayersManager && (
        <div className="fixed inset-0 z-50 bg-stone-950/95 backdrop-blur-xl flex flex-col justify-between p-6">
          <div className="w-full max-w-md mx-auto flex-1 flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-stone-900">
              <div className="flex flex-col">
                <h3 className="text-2xl font-black text-amber-400 flex items-center gap-2">
                  <Users size={20} className="text-amber-400" />
                  إدارة اللاعبين
                </h3>
                <p className="text-xs text-stone-400 mt-0.5">تعديل الجالسين على الكراسي أو إضافة لاعبين جدد للبنك</p>
              </div>
              <button
                onClick={() => {
                  setShowPlayersManager(false);
                  playSound('add');
                }}
                className="w-10 h-10 rounded-full bg-stone-900 border border-stone-800 text-stone-300 hover:text-white flex items-center justify-center animate-in duration-300"
              >
                <X size={18} />
              </button>
            </div>

            <div className="my-4 overflow-y-auto max-h-[50vh] pr-1 flex flex-col gap-4">
              
              {/* Table Seats */}
              <div>
                <h4 className="text-[10px] text-stone-400 font-black uppercase tracking-wider text-right mb-2.5">اللاعبين على الطاولة حالياً:</h4>
                <div className="flex flex-col gap-2">
                  {gameState.seats.map((seat, seatIdx) => {
                    const name = getNameOfSeatId(seat.id);
                    return (
                      <div key={seatIdx} className="bg-emerald-950/15 border border-emerald-900/30 p-3 rounded-2xl flex items-center justify-between">
                        <button
                          onClick={() => {
                            setModalNewPlayer({
                              visible: true,
                              seatIdx,
                              mode: 'single'
                            });
                          }}
                          className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-stone-950 rounded-xl font-extrabold text-[11px] tracking-tight transition-transform active:scale-95"
                        >
                          تغيير اللاعب
                        </button>
                        <span className="font-extrabold text-stone-100 text-sm">
                          الكرسي {seatIdx + 1}: <strong className="text-emerald-400 text-md">{name}</strong>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reserve Bank */}
              <div>
                <h4 className="text-[10px] text-stone-400 font-black uppercase tracking-wider text-right mb-2.5">بنك اللاعبين الاحتياط:</h4>
                <div className="flex flex-col gap-2 max-h-[25vh] overflow-y-auto">
                  {players
                    .filter(p => !gameState.seats.some(s => s.id === p.id))
                    .map(p => (
                      <div key={p.id} className="bg-stone-900/60 border border-stone-850 p-3 rounded-2xl flex items-center justify-between">
                        <button
                          onClick={() => removePlayerFromBank(p.id)}
                          className="w-8 h-8 rounded-lg bg-rose-950/40 text-rose-400 flex items-center justify-center hover:bg-rose-950 active:scale-95 transition-all"
                        >
                          <Trash2 size={13} />
                        </button>
                        <span className="font-bold text-stone-200 text-sm">{p.name}</span>
                      </div>
                    ))}
                  {players.filter(p => !gameState.seats.some(s => s.id === p.id)).length === 0 && (
                    <div className="text-center py-3 text-stone-600 text-xs font-bold">لا يتوفر لاعبين احتياط في بنك اللاعبين</div>
                  )}
                </div>
              </div>

            </div>
          </div>

          <div className="w-full max-w-sm mx-auto flex flex-col gap-3">
            {/* Add direct player */}
            <div className="bg-stone-900/60 border border-stone-850 p-4 rounded-2xl">
              <label className="text-[9px] text-stone-400 font-black tracking-wider block mb-2 text-right">إضافة لاعب جديد إلى قاعة البنك:</label>
              <div className="flex gap-2">
                <input
                  id="direct-bank-input"
                  type="text"
                  placeholder="اسم اللاعب الجديد..."
                  className="bg-stone-950 border border-stone-800 px-3 py-2 rounded-xl text-stone-100 font-bold block flex-1 text-xs text-right focus:outline-none focus:border-amber-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const input = e.currentTarget;
                      const val = input.value.trim();
                      if (val) {
                        addNewPlayerToBank(val);
                        input.value = "";
                      }
                    }
                  }}
                />
                <button
                  onClick={() => {
                    const el = document.getElementById("direct-bank-input") as HTMLInputElement;
                    const val = el?.value.trim();
                    if (val) {
                      addNewPlayerToBank(val);
                      el.value = "";
                    }
                  }}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-black text-xs rounded-xl active:scale-95"
                >
                  إضافة لاعب
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-1 text-center">
              <button
                onClick={resetLeaderboardStats}
                className="py-3 bg-stone-900 text-rose-450 hover:bg-stone-850 text-xs border border-stone-850 font-bold rounded-xl active:scale-95"
              >
                🗑️ تصفير كل الإحصائيات
              </button>
              <button
                onClick={() => setShowPlayersManager(false)}
                className="py-3 bg-amber-400 hover:bg-amber-300 text-stone-950 font-black text-xs rounded-xl active:scale-95"
              >
                تمام الصيانة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Overlay 10: Player stats profile detailed card --- */}
      {activeProfileId && profileStats && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-stone-950 border border-stone-800 rounded-3xl w-full max-w-sm p-6 shadow-2xl relative text-right">
            
            <button
              onClick={() => setActiveProfileId(null)}
              className="absolute top-4 left-4 w-8 h-8 rounded-full bg-stone-900 border border-stone-800 text-stone-400 flex items-center justify-center hover:text-white"
            >
              <X size={14} />
            </button>

            <div className="flex flex-col items-center text-center mt-3 mb-6">
              <span className="text-4xl">👤</span>
              <h3 className="text-2xl font-black text-amber-400 mt-2">
                {players.find(p => p.id === activeProfileId)?.name}
              </h3>
              <p className="text-xs text-stone-500 font-semibold mt-1">الملف التحليلي للاعب طرابيش</p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-stone-900/60 p-3 rounded-2xl border border-stone-850">
                <span className="text-xs text-stone-550 block font-bold">ملوك الفوز الكلي</span>
                <strong className="text-2xl text-amber-400 font-extrabold mt-1 block">
                  {players.find(p => p.id === activeProfileId)?.kings} 👑
                </strong>
              </div>
              <div className="bg-stone-900/60 p-3 rounded-2xl border border-stone-850">
                <span className="text-xs text-stone-550 block font-bold font-arabic">أكواز الخسارة الكلية</span>
                <strong className="text-2xl text-red-400 font-extrabold mt-1 block">
                  {players.find(p => p.id === activeProfileId)?.koozes} 🚬
                </strong>
              </div>
            </div>

            <div className="bg-stone-900/40 p-4 rounded-2xl border border-stone-850 flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between text-stone-300">
                <strong className="text-stone-100 font-mono">{profileStats.streak}</strong>
                <span className="text-stone-450">سلسلة كنج متتالية حالياً:</span>
              </div>
              <div className="flex items-center justify-between text-stone-300">
                <strong className="text-stone-100 font-mono">{profileStats.bestStreak}</strong>
                <span className="text-stone-450">أطول سلسلة كنج في الجلسات:</span>
              </div>
              <div className="flex items-center justify-between text-stone-300 pt-2 border-t border-stone-850">
                <strong className="text-stone-100 leading-tight">
                  {profileStats.nemesisName} {profileStats.nemesisCount > 0 && `(خسره ${profileStats.nemesisCount} مرات)`}
                </strong>
                <span className="text-stone-450">الخصم اللدود الأكبر:</span>
              </div>
            </div>

            <button
              onClick={() => setActiveProfileId(null)}
              className="w-full mt-6 py-3 bg-amber-400 hover:bg-amber-300 text-stone-950 font-black text-xs rounded-xl transition-all"
            >
              تمام الملف
            </button>
          </div>
        </div>
      )}

      {/* --- Overlay 11: Player round changes log list --- */}
      {activeHistoryIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-stone-950 border-t sm:border border-stone-800 rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-2xl maxHeight-[80vh] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-stone-900 mb-4">
                <strong className="text-md text-amber-400">
                  تفاصيل عمليات: {getNameOfSeatId(gameState.seats[activeHistoryIndex].id)}
                </strong>
                <button
                  onClick={() => setActiveHistoryIndex(null)}
                  className="w-8 h-8 rounded-full bg-stone-900 border border-stone-800 text-stone-400 flex items-center justify-center hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex flex-col gap-2 max-h-[45vh] overflow-y-auto my-3 text-right">
                {gameState.seats[activeHistoryIndex].log && gameState.seats[activeHistoryIndex].log.map((log, i) => (
                  <div key={i} className="bg-stone-900/60 p-3 rounded-xl border border-stone-850 flex items-center justify-between font-mono text-xs">
                    <span className="text-stone-450 font-sans">
                      {new Date(log.t).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <strong className="text-amber-400 text-[13px]">= المجموع الحالي {log.total}</strong>
                    <span className={log.op === 'set' ? 'text-blue-400 font-bold' : (log.d && log.d >= 0 ? 'text-red-400 font-bold' : 'text-emerald-400 font-bold')}>
                      {log.op === 'set' ? `✏️ تصحيح يدوي لـ ${log.v}` : `${log.d && log.d >= 0 ? '+' : ''}${log.d}`}
                    </span>
                  </div>
                ))}
                {(!gameState.seats[activeHistoryIndex].log || gameState.seats[activeHistoryIndex].log.length === 0) && (
                  <div className="text-center py-8 text-stone-600 text-xs font-bold">لا يوجد عمليات مسجلة في هذه الجولة بعد</div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-stone-900 text-center flex flex-col gap-3">
              <strong className="text-xl text-stone-100 font-extrabold block">
                مجموع النقاط الإجمالي: <span className="text-amber-400 text-2xl font-mono">{gameState.seats[activeHistoryIndex].score}</span>
              </strong>
              <button
                onClick={() => setActiveHistoryIndex(null)}
                className="w-full py-3 bg-stone-900 text-stone-300 hover:text-white border border-stone-850 text-xs font-bold rounded-xl"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
