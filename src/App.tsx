import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trophy, BarChart3, Users, TrendingUp, Target, CheckCircle, XCircle, MinusCircle } from 'lucide-react';
import dayjs from 'dayjs';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, BarChart, Bar, Cell
} from 'recharts';
import { supabase } from './lib/supabase';
import fallbackData from './data/worldcup2026.json';
import playerData from './data/wc2026_players.json';
import { GroupsTab } from './GroupsTab';
import type { Match, Prediction, UserProfile, WorldCupData, GroupWithMembers } from './types';

const LINE_COLORS = ['#64d9ff', '#a78bfa', '#f43f5e', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#e2e8f0'];

const playerSuggestions = Array.from(
  new Set(playerData.teams.flatMap((team) => team.players.map((player) => player.name))),
).sort((a, b) => a.localeCompare(b));

const buildMatchId = (match: Match, index: number) => `${match.date}-${match.team1}-${match.team2}-${index}`;

const getResult = (score?: { ft: [number, number] | number[] }) => {
  if (!score) return null;
  if (score.ft.length !== 2) return null;
  const [left, right] = score.ft as [number, number];
  if (left === right) return 'draw';
  return left > right ? 'team1' : 'team2';
};

const calculatePredictionPoints = (prediction: Prediction, match: Match) => {
  if (!prediction || prediction.score1 === null || prediction.score2 === null || !match.score) {
    return 0;
  }
  let points = 0;
  const actualResult = getResult(match.score);
  const predictedResult = getResult({ ft: [prediction.score1, prediction.score2] });
  if (predictedResult === actualResult) points += 3;
  if (match.score.ft[0] === prediction.score1 && match.score.ft[1] === prediction.score2) points += 5;
  return points;
};

// ─── Analyse Tab ──────────────────────────────────────────────────────────────
function AnalyseTab({
  matches,
  predictions,
  topScorers,
  currentPoints,
}: {
  matches: (Match & { id: string; cutoffDayjs?: dayjs.Dayjs })[];
  predictions: Prediction[];
  topScorers: string[];
  currentPoints: number;
}) {
  // Wedstrijden waar een uitslag bekend is
  const playedMatches = useMemo(
    () => matches.filter((m) => m.score && m.score.ft && m.score.ft.length === 2),
    [matches]
  );

  // Per wedstrijd: resultaat van de voorspelling
  const matchResults = useMemo(() => {
    return playedMatches.map((match) => {
      const pred = predictions.find((p) => p.matchId === match.id);
      if (!pred || pred.score1 === null || pred.score2 === null) {
        return { match, pred: null, pts: 0, exactScore: false, correctResult: false, hasPred: false };
      }
      const pts = calculatePredictionPoints(pred, match);
      const exactScore =
        match.score!.ft[0] === pred.score1 && match.score!.ft[1] === pred.score2;
      const correctResult =
        getResult(match.score) === getResult({ ft: [pred.score1, pred.score2] });
      return { match, pred, pts, exactScore, correctResult, hasPred: true };
    });
  }, [playedMatches, predictions]);

  const totalPredicted = matchResults.filter((r) => r.hasPred).length;
  const exactScores = matchResults.filter((r) => r.exactScore).length;
  const correctResults = matchResults.filter((r) => r.correctResult && !r.exactScore).length;
  const wrong = matchResults.filter((r) => r.hasPred && !r.correctResult).length;
  const notPredicted = matchResults.filter((r) => !r.hasPred).length;

  // Topscorer analyse
  const goalTally = useMemo(() => {
    const tally = new Map<string, number>();
    matches.forEach((match) => {
      [...(match.goals1 || []), ...(match.goals2 || [])].forEach((goal) => {
        tally.set(goal.name, (tally.get(goal.name) ?? 0) + 1);
      });
    });
    return tally;
  }, [matches]);

  const topScorerAnalysis = useMemo(() => {
    return topScorers
      .filter(Boolean)
      .map((player) => {
        const goals = goalTally.get(player) ?? 0;
        const pts = goals > 0 ? 5 : 0;
        return { player, goals, pts };
      });
  }, [topScorers, goalTally]);

  const topScorerPoints = topScorerAnalysis.reduce((s, t) => s + t.pts, 0);
  const matchPoints = currentPoints - topScorerPoints;

  // Punten per ronde voor staafgrafiek
  const pointsPerRound = useMemo(() => {
    const roundMap: Record<string, number> = {};
    matchResults.forEach(({ match, pts }) => {
      const key = match.round || 'Overig';
      roundMap[key] = (roundMap[key] ?? 0) + pts;
    });
    return Object.entries(roundMap).map(([round, pts]) => ({ round, pts }));
  }, [matchResults]);

  return (
    <div className="space-y-6">

      {/* Samenvatting kaarten */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Totaal punten', value: currentPoints, color: 'text-electric', icon: <Trophy size={18} /> },
          { label: 'Match punten', value: matchPoints, color: 'text-cyan-400', icon: <Target size={18} /> },
          { label: 'Topscorer punten', value: topScorerPoints, color: 'text-violet-400', icon: <TrendingUp size={18} /> },
          { label: 'Exacte scores', value: exactScores, color: 'text-green-400', icon: <CheckCircle size={18} /> },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glass">
            <div className={`flex items-center gap-2 ${color} mb-2`}>{icon}<span className="text-xs uppercase tracking-widest">{label}</span></div>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Wedstrijd resultaten donut-achtige balk */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Target size={20} className="text-electric" /> Voorspelkwaliteit
        </h2>
        <div className="flex gap-2 h-6 rounded-full overflow-hidden mb-4">
          {exactScores > 0 && (
            <div style={{ flex: exactScores }} className="bg-green-500 transition-all" title="Exact" />
          )}
          {correctResults > 0 && (
            <div style={{ flex: correctResults }} className="bg-cyan-500 transition-all" title="Correct resultaat" />
          )}
          {wrong > 0 && (
            <div style={{ flex: wrong }} className="bg-rose-500/70 transition-all" title="Fout" />
          )}
          {notPredicted > 0 && (
            <div style={{ flex: notPredicted }} className="bg-slate-700 transition-all" title="Niet ingevuld" />
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" />Exact: {exactScores}</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-cyan-500 inline-block" />Correct resultaat: {correctResults}</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-rose-500 inline-block" />Fout: {wrong}</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-slate-600 inline-block" />Niet voorspeld: {notPredicted}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Punten per ronde */}
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 size={20} className="text-electric" /> Punten per ronde
          </h2>
          {pointsPerRound.length > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pointsPerRound} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="round" stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '1rem', borderColor: 'rgba(255,255,255,0.1)' }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Bar dataKey="pts" radius={[8, 8, 0, 0]}>
                    {pointsPerRound.map((_, i) => (
                      <Cell key={i} fill={LINE_COLORS[i % LINE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nog geen verwerkte uitslagen.</p>
          )}
        </div>

        {/* Topscorer analyse */}
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={20} className="text-violet-400" /> Topscorers analyse
          </h2>
          {topScorerAnalysis.length > 0 ? (
            <div className="space-y-3">
              {topScorerAnalysis.map(({ player, goals, pts }, i) => (
                <div key={i} className="flex items-center justify-between rounded-2xl bg-slate-900/60 px-4 py-3 border border-white/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-500 w-4">{i + 1}.</span>
                    <div>
                      <p className="text-sm font-semibold text-slate-200">{player}</p>
                      <p className="text-xs text-slate-500">{goals} doelpunt{goals !== 1 ? 'en' : ''} gescoord</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${pts > 0 ? 'text-violet-400' : 'text-slate-500'}`}>
                      {pts > 0 ? `+${pts} pts` : '0 pts'}
                    </span>
                  </div>
                </div>
              ))}
              {topScorerAnalysis.length === 0 && (
                <p className="text-sm text-slate-400">Geen topscorers ingevuld.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Je hebt nog geen topscorers ingevuld.</p>
          )}
        </div>
      </div>

      {/* Per-wedstrijd detail tabel */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <CheckCircle size={20} className="text-green-400" /> Wedstrijd voor wedstrijd
        </h2>
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {matchResults.length === 0 && (
            <p className="text-sm text-slate-400">Nog geen wedstrijden gespeeld.</p>
          )}
          {matchResults.map(({ match, pred, pts, exactScore, correctResult, hasPred }) => (
            <div key={match.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-2xl bg-slate-900/60 px-4 py-3 border border-white/5">
              <div>
                <p className="text-sm font-semibold text-slate-200">{match.team1} – {match.team2}</p>
                <p className="text-xs text-slate-500">
                  Uitslag: {match.score ? `${match.score.ft[0]}–${match.score.ft[1]}` : '?'}
                  {hasPred && pred && ` · Jouw voorspelling: ${pred.score1}–${pred.score2}`}
                  {!hasPred && ' · Niet voorspeld'}
                </p>
              </div>
              <div>
                {!hasPred ? (
                  <MinusCircle size={18} className="text-slate-600" />
                ) : exactScore ? (
                  <CheckCircle size={18} className="text-green-400" />
                ) : correctResult ? (
                  <CheckCircle size={18} className="text-cyan-400" />
                ) : (
                  <XCircle size={18} className="text-rose-400" />
                )}
              </div>
              <span className={`text-sm font-bold min-w-[3rem] text-right ${pts > 0 ? 'text-electric' : 'text-slate-600'}`}>
                {pts > 0 ? `+${pts}` : '–'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App() {
  const [session, setSession] = useState<any>(null);
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [topScorers, setTopScorers] = useState<string[]>(['', '', '', '', '']);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [worldcupData, setWorldcupData] = useState<WorldCupData>(fallbackData as WorldCupData);
  const [dataSource, setDataSource] = useState<'loading' | 'live' | 'fallback'>('loading');

  useEffect(() => {
    const GITHUB_URL =
      'https://raw.githubusercontent.com/openfootball/world-cup.json/master/2026/worldcup.json';
    fetch(GITHUB_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: WorldCupData) => {
        if (json?.matches?.length) {
          setWorldcupData(json);
          setDataSource('live');
        } else {
          setDataSource('fallback');
        }
      })
      .catch(() => setDataSource('fallback'));
  }, []);

  const [activeTab, setActiveTab] = useState<'voorspellingen' | 'dashboard' | 'analyse' | 'groepen'>('voorspellingen');
  const [userGroups, setUserGroups] = useState<GroupWithMembers[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Backup unlock
  useEffect(() => {
    const t = setTimeout(() => {
      if (!profileLoaded) {
        setProfileLoaded(true);
        if (!profile) {
          setProfile({ id: 'sandbox-user', full_name: 'Local Pilot', avatar_url: null, has_completed_setup: false });
        }
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [profileLoaded, profile]);

  const getMatchStartTime = (match: Match) => {
    const matchTime = match.time?.trim() || '00:00';
    return dayjs(`${match.date} ${matchTime}`, 'YYYY-MM-DD HH:mm');
  };

  const matches = useMemo(() => {
    try {
      const baseMatches = worldcupData.matches.map((match, index) => ({
        ...match,
        id: buildMatchId(match, index),
        startDayjs: getMatchStartTime(match),
      }));
      const sorted = [...baseMatches].sort((a, b) => a.startDayjs.valueOf() - b.startDayjs.valueOf());

      const groupDeadlines: Record<string, dayjs.Dayjs> = {};
      const roundDeadlines: Record<string, dayjs.Dayjs> = {};
      sorted.forEach((m) => {
        if (m.group && (!groupDeadlines[m.group] || m.startDayjs.isBefore(groupDeadlines[m.group]))) {
          groupDeadlines[m.group] = m.startDayjs;
        }
        if (m.round && (!roundDeadlines[m.round] || m.startDayjs.isBefore(roundDeadlines[m.round]))) {
          roundDeadlines[m.round] = m.startDayjs;
        }
      });

      return sorted.map((m) => {
        let cutoff = m.startDayjs;
        if (m.group) cutoff = groupDeadlines[m.group];
        else if (m.round) cutoff = roundDeadlines[m.round];
        return { ...m, cutoffDayjs: cutoff };
      });
    } catch { return []; }
  }, [worldcupData]);

  const initialPredictions = useMemo(
    () => matches.map((match) => ({ matchId: match.id, score1: null, score2: null })),
    [matches],
  );
  const initialPredictionsRef = useRef(initialPredictions);
  useEffect(() => { initialPredictionsRef.current = initialPredictions; }, [initialPredictions]);

  const [predictions, setPredictions] = useState<Prediction[]>(initialPredictions);

  const actualGoalScorers = useMemo(() => {
    const scorers = new Set<string>();
    matches.forEach((m) => [...(m.goals1 || []), ...(m.goals2 || [])].forEach((g) => scorers.add(g.name)));
    return scorers;
  }, [matches]);

  const topScorerMatches = useMemo(
    () => topScorers.filter(Boolean).filter((p) => actualGoalScorers.has(p)),
    [topScorers, actualGoalScorers],
  );

  const currentPoints = useMemo(() => {
    const matchPoints = predictions.reduce((sum, pred) => {
      const match = matches.find((m) => m.id === pred.matchId);
      return match ? sum + calculatePredictionPoints(pred, match) : sum;
    }, 0);
    return matchPoints + topScorerMatches.length * 5;
  }, [predictions, matches, topScorerMatches]);

  const fetchDashboardGroups = useCallback(async (userId: string) => {
    if (!userId || userId === 'sandbox-user') return;
    setLoadingGroups(true);
    try {
      const { data: memberRows } = await supabase.from('group_members').select('group_id').eq('user_id', userId);
      if (!memberRows?.length) { setUserGroups([]); return; }
      const groupIds = memberRows.map((r) => r.group_id);
      const { data: groupData } = await supabase.from('groups').select('*').in('id', groupIds);
      const enriched: GroupWithMembers[] = await Promise.all(
        (groupData ?? []).map(async (group) => {
          const { data: members } = await supabase.from('group_members').select('*, profile:profiles(*)').eq('group_id', group.id);
          return { ...group, members: members ?? [] };
        })
      );
      setUserGroups(enriched);
      if (enriched.length > 0 && !selectedGroupId) setSelectedGroupId(enriched[0].id);
    } catch (err) {
      console.error('Fout bij laden groepen:', err);
    } finally {
      setLoadingGroups(false);
    }
  }, [selectedGroupId]);

  const hydrateProfileData = useCallback((data: any) => {
    setProfile(data as UserProfile);
    setPredictions((data.predictions as Prediction[]) ?? initialPredictionsRef.current);
    const saved = data.top_scorer;
    setTopScorers(Array.isArray(saved) ? saved.slice(0, 5).map(String) : ['', '', '', '', '']);
  }, []);

  const executeProfileLoadSequence = useCallback(async (userId: string, userEmail?: string | null) => {
    if (!userId) return;
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (error) throw error;
      if (data) { hydrateProfileData(data); await fetchDashboardGroups(userId); return; }
      const payload = {
        id: userId, email: userEmail ?? null, full_name: null, avatar_url: null,
        has_completed_setup: false, predictions: initialPredictionsRef.current,
        top_scorer: ['', '', '', '', ''], points: 0,
      };
      const { data: newProfile, error: insertError } = await supabase.from('profiles').insert(payload).select().single();
      if (insertError) throw insertError;
      hydrateProfileData(newProfile);
      await fetchDashboardGroups(userId);
    } catch (err) {
      setProfile({ id: userId, full_name: userEmail ? userEmail.split('@')[0] : 'Pilot', avatar_url: null, has_completed_setup: false });
      setPredictions(initialPredictionsRef.current);
    } finally {
      setProfileLoaded(true);
    }
  }, [hydrateProfileData, fetchDashboardGroups]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (s) { setSession(s); await executeProfileLoadSequence(s.user.id, s.user.email); }
      else setProfileLoaded(true);
    })();
    const { data: listener } = supabase.auth.onAuthStateChange(async (_, s) => {
      if (!mounted) return;
      setSession(s);
      if (s?.user?.id) await executeProfileLoadSequence(s.user.id, s.user.email);
      else { setProfile(null); setProfileLoaded(true); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [executeProfileLoadSequence]);

  useEffect(() => {
    if (profile?.id && (activeTab === 'dashboard' || activeTab === 'groepen')) {
      fetchDashboardGroups(profile.id);
    }
  }, [activeTab, profile?.id, fetchDashboardGroups]);

  const activeGroup = useMemo(() => userGroups.find((g) => g.id === selectedGroupId) || null, [userGroups, selectedGroupId]);

  const chartData = useMemo(() => {
    if (!activeGroup || !matches.length) return [];
    const played = matches.filter((m) => m.score?.ft?.length === 2);
    const totals: Record<string, number> = {};
    activeGroup.members.forEach((m) => { totals[m.user_id] = 0; });
    return played.map((match) => {
      const point: Record<string, any> = { name: `${match.team1.substring(0, 3)}-${match.team2.substring(0, 3)}` };
      activeGroup.members.forEach((member) => {
        const preds = (member.profile?.predictions as Prediction[]) || [];
        const pred = preds.find((p) => p.matchId === match.id);
        if (pred) totals[member.user_id] += calculatePredictionPoints(pred, match);
        const label = member.profile?.full_name || `Speler (${member.user_id.substring(0, 4)})`;
        point[label] = totals[member.user_id];
      });
      return point;
    });
  }, [activeGroup, matches]);

  const canEditMatch = (match: Match & { cutoffDayjs?: dayjs.Dayjs }) => {
    if (!match.cutoffDayjs?.isValid()) return true;
    return dayjs().isBefore(match.cutoffDayjs);
  };

  const updatePrediction = (matchId: string, team: 'score1' | 'score2', value: number | null) => {
    setPredictions((cur) =>
      cur.map((p) => (p.matchId === matchId ? { ...p, [team]: value } : p)),
    );
  };

  const saveSetup = async () => {
    if (!profile) return;
    setIsSaving(true);
    setFeedback('Opslaan...');
    const payload = {
      id: profile.id,
      email: session?.user?.email || null,
      has_completed_setup: true,
      predictions,
      top_scorer: topScorers,
      points: currentPoints,
    };
    try {
      const { data, error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' }).select().single();
      if (error) throw error;
      setProfile(data as UserProfile);
      setFeedback('Opgeslagen!');
      if (profile.id) fetchDashboardGroups(profile.id);
    } catch {
      setFeedback('Fout bij opslaan.');
    } finally {
      setIsSaving(false);
      setTimeout(() => setFeedback(''), 3000);
    }
  };

  const signInWithPassword = async () => {
    setProfileLoaded(false);
    const { data, error } = await supabase.auth.signInWithPassword({ email: userEmail, password: userPassword });
    if (error) { setProfileLoaded(true); return; }
    if (data?.session?.user?.id) await executeProfileLoadSequence(data.session.user.id, data.session.user.email);
  };

  const signUpWithEmail = async () => {
    setProfileLoaded(false);
    const { data, error } = await supabase.auth.signUp({ email: userEmail, password: userPassword });
    if (error) { setProfileLoaded(true); return; }
    if (data?.user?.id) await executeProfileLoadSequence(data.user.id, data.user.email);
  };

  const signOut = async () => {
    setProfileLoaded(false);
    await supabase.auth.signOut();
    setProfile(null); setSession(null); setActiveTab('voorspellingen');
    setSelectedGroupId(''); setUserGroups([]); setProfileLoaded(true);
  };

  const renderScoreInput = (matchId: string, team: 'score1' | 'score2', value: number | null, disabled: boolean) => (
    <input
      type="number" min={0} value={value ?? ''}
      onChange={(e) => { if (disabled) return; const v = e.target.value; updatePrediction(matchId, team, v === '' ? null : Number(v)); }}
      disabled={disabled}
      className={`w-16 rounded-xl border px-3 py-2 text-right outline-none transition focus:border-electric focus:ring-2 focus:ring-electric/20 ${disabled ? 'border-slate-700 bg-slate-800/60 text-slate-500 cursor-not-allowed' : 'border-slate-700 bg-slate-900/90 text-slate-100'}`}
    />
  );

  // Group matches by round for cleaner rendering
  const matchesByRound = useMemo(() => {
    const groups: Record<string, typeof matches> = {};
    matches.forEach((m) => {
      const key = m.round || 'Overig';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });
    return groups;
  }, [matches]);

  const renderMatchCard = (match: Match & { id: string; cutoffDayjs?: dayjs.Dayjs }) => {
    const prediction = predictions.find((p) => p.matchId === match.id);
    const resultLabel = match.score ? `${match.score.ft[0]} – ${match.score.ft[1]}` : null;
    const editable = canEditMatch(match);
    const pts = prediction ? calculatePredictionPoints(prediction, match) : 0;
    const hasResult = !!match.score;

    return (
      <article key={match.id} className="rounded-3xl border border-white/5 bg-white/5 p-4 shadow-glass backdrop-blur-xl">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">{match.group ?? match.round}</p>
            <h3 className="text-base font-semibold text-slate-100 leading-tight">{match.team1} vs {match.team2}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{dayjs(match.date).format('D MMM')} · {match.time}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {hasResult && (
              <span className="rounded-xl bg-slate-950/80 px-3 py-1 text-xs font-bold text-white ring-1 ring-slate-700">{resultLabel}</span>
            )}
            {hasResult && pts > 0 && (
              <span className="rounded-xl bg-electric/20 px-3 py-1 text-xs font-bold text-electric">+{pts} pts</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {renderScoreInput(match.id, 'score1', prediction?.score1 ?? null, !editable)}
          <span className="text-slate-600 text-sm font-bold">–</span>
          {renderScoreInput(match.id, 'score2', prediction?.score2 ?? null, !editable)}
          {!editable && (
            <span className="ml-1 text-xs font-semibold text-orange-400 bg-orange-400/10 px-3 py-1.5 rounded-xl">Gesloten</span>
          )}
        </div>
      </article>
    );
  };

  // ── Login screen ──
  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-8">
        <section className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-slate-950/90 p-8 shadow-glass backdrop-blur-2xl">
          <div className="space-y-6">
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-semibold text-white">Belisinator 9000</h1>
              <p className="text-slate-400">Log in om je voorspellingen te beheren.</p>
            </div>
            <input type="email" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="E-mail" className="w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-white outline-none focus:border-electric" />
            <input type="password" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder="Wachtwoord" className="w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-white outline-none focus:border-electric" />
            <div className="grid gap-2 sm:grid-cols-2">
              <button onClick={signInWithPassword} className="w-full rounded-3xl bg-electric px-5 py-3 font-semibold text-slate-950">Inloggen</button>
              <button onClick={signUpWithEmail} className="w-full rounded-3xl border border-slate-700 px-5 py-3 font-semibold text-slate-100 hover:bg-white/5">Registreren</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ── Loading screen ──
  if (session && !profileLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-xl font-semibold text-slate-200">Laden...</p>
      </main>
    );
  }

  // ── No profile fallback ──
  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-xl font-semibold text-slate-200">Profiel laden mislukt. Probeer opnieuw in te loggen.</p>
      </main>
    );
  }

  // ── Main app ──
  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'voorspellingen', label: 'Voorspellingen' },
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'analyse', label: 'Analyse' },
    { key: 'groepen', label: 'Mijn Groepen' },
  ];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.14),transparent_34%),linear-gradient(180deg,#020617_0%,#060b18_100%)] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header */}
        <header className="rounded-[2.5rem] border border-white/10 bg-slate-950/80 p-6 shadow-glass sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-white">Belisinator 9000</h1>
              <p className="text-sm text-slate-400 mt-1">{profile.full_name || session?.user?.email}</p>
              <p className="text-xs mt-1">
                {dataSource === 'loading' && <span className="text-slate-500">⏳ Wedstrijddata laden...</span>}
                {dataSource === 'live' && <span className="text-green-400">● Live data ({worldcupData.matches.length} wedstrijden)</span>}
                {dataSource === 'fallback' && <span className="text-orange-400">⚠ Offline fallback data</span>}
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-[2rem] bg-slate-900/80 p-5">
              <span className="text-xs uppercase tracking-[0.28em] text-electric/80">Jouw Score</span>
              <strong className="text-4xl text-white">{currentPoints} pts</strong>
              <div className="flex gap-3">
                <button onClick={saveSetup} disabled={isSaving} className="rounded-3xl bg-electric px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
                  {isSaving ? 'Opslaan...' : 'Opslaan'}
                </button>
                <button onClick={signOut} className="rounded-3xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15">Uitloggen</button>
              </div>
              {feedback && <p className="text-xs text-green-400">{feedback}</p>}
            </div>
          </div>
        </header>

        {/* Tab nav */}
        <nav className="flex gap-2 rounded-[2rem] border border-white/10 bg-white/5 p-2 shadow-glass overflow-x-auto">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 min-w-max rounded-[1.5rem] px-4 py-3 text-sm font-semibold transition whitespace-nowrap ${activeTab === key ? 'bg-electric text-slate-950' : 'text-slate-300 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* ── Tab: Voorspellingen ── */}
        {activeTab === 'voorspellingen' && (
          <div className="space-y-8">
            {/* Topscorers sectie */}
            <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
              <h2 className="text-xl font-semibold text-white mb-2 flex items-center gap-2">
                <Trophy size={20} className="text-electric" /> Jouw topscorers
              </h2>
              <p className="text-xs text-slate-400 mb-4">Kies maximaal 5 spelers. Per correcte topscorer: +5 punten.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {topScorers.map((scorer, i) => (
                  <div key={i} className="relative">
                    <input
                      list={`scorers-${i}`}
                      value={scorer}
                      onChange={(e) => {
                        const updated = [...topScorers];
                        updated[i] = e.target.value;
                        setTopScorers(updated);
                      }}
                      placeholder={`Topscorer ${i + 1}`}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-sm text-white outline-none focus:border-electric"
                    />
                    <datalist id={`scorers-${i}`}>
                      {playerSuggestions.map((name) => <option key={name} value={name} />)}
                    </datalist>
                  </div>
                ))}
              </div>
            </section>

            {/* Wedstrijden per ronde */}
            {Object.entries(matchesByRound).map(([round, roundMatches]) => (
              <section key={round} className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
                <h2 className="text-lg font-semibold text-white mb-4">{round}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {roundMatches.map((match) => renderMatchCard(match))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* ── Tab: Dashboard ── */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <section className="grid gap-6 lg:grid-cols-3">
              {/* Grafiek */}
              <div className="lg:col-span-2 rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-2xl font-semibold text-white flex items-center gap-2">
                      <BarChart3 className="text-electric" size={24} /> Puntenverloop
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">Cumulatief per gespeelde wedstrijd</p>
                  </div>
                  {userGroups.length > 0 && (
                    <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}
                      className="rounded-2xl border border-slate-700 bg-slate-900/90 px-4 py-2 text-sm text-white outline-none focus:border-electric">
                      {userGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                </div>
                {activeGroup && chartData.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '1rem', borderColor: 'rgba(255,255,255,0.1)' }} />
                        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                        {activeGroup.members.map((member, i) => {
                          const label = member.profile?.full_name || `Speler (${member.user_id.substring(0, 4)})`;
                          return <Line key={member.user_id} type="monotone" dataKey={label} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />;
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center border border-dashed border-white/5 rounded-2xl">
                    <p className="text-sm text-slate-400">Nog geen wedstrijddata om te tonen.</p>
                  </div>
                )}
              </div>

              {/* Ranglijst */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Users size={20} className="text-electric" /> {activeGroup ? activeGroup.name : 'Stand'}
                </h2>
                {loadingGroups ? (
                  <p className="text-sm text-slate-400">Laden...</p>
                ) : activeGroup ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {[...activeGroup.members]
                      .sort((a, b) => (b.profile?.points ?? 0) - (a.profile?.points ?? 0))
                      .map((member, i) => (
                        <div key={member.user_id} className="flex items-center justify-between rounded-2xl bg-slate-900/60 px-4 py-3 border border-white/5">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-500 w-4">{i + 1}.</span>
                            <span className="text-sm font-semibold text-slate-200">
                              {member.profile?.full_name || 'Anoniem'}
                              {member.user_id === profile.id && <span className="text-xs text-electric ml-1">(jij)</span>}
                            </span>
                          </div>
                          <span className="text-sm font-bold text-electric">{member.profile?.points ?? 0} pts</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Je bent nog geen lid van een poule. Ga naar &apos;Mijn Groepen&apos;.</p>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ── Tab: Analyse ── */}
        {activeTab === 'analyse' && (
          <AnalyseTab
            matches={matches}
            predictions={predictions}
            topScorers={topScorers}
            currentPoints={currentPoints}
          />
        )}

        {/* ── Tab: Groepen ── */}
        {activeTab === 'groepen' && (
          <GroupsTab currentUserId={profile.id} currentPoints={currentPoints} />
        )}

      </div>
    </main>
  );
}

export default App;