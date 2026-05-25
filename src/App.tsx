import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Trophy, User, ShieldCheck } from 'lucide-react';
import dayjs from 'dayjs';
import { supabase } from './lib/supabase';
import fallbackData from './data/worldcup2026.json';
import playerData from './data/wc2026_players.json';
import type { Match, Prediction, TopScorerPick, UserProfile, WorldCupData, WorldCupPlayersData } from './types';

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
  if (prediction.score1 === null || prediction.score2 === null || !match.score) {
    return 0;
  }

  let points = 0;
  const actualResult = getResult(match.score);
  const predictedResult = getResult({ ft: [prediction.score1, prediction.score2] });

  if (predictedResult === actualResult) points += 3;
  if (match.score.ft[0] === prediction.score1 && match.score.ft[1] === prediction.score2) points += 5;
  return points;
};

const getActualTopScorer = (matches: Match[]) => {
  const tally = new Map<string, number>();
  matches.forEach((match) => {
    [...(match.goals1 || []), ...(match.goals2 || [])].forEach((goal) => {
      tally.set(goal.name, (tally.get(goal.name) ?? 0) + 1);
    });
  });

  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

function App() {
  const [session, setSession] = useState<any>(null);
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [magicLinkMessage, setMagicLinkMessage] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [topScorers, setTopScorers] = useState<string[]>(['', '', '', '', '']);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadProfileStatus, setLoadProfileStatus] = useState('idle');
  const [saveStatus, setSaveStatus] = useState('idle');
  const [worldcupData, setWorldcupData] = useState<WorldCupData>(fallbackData as WorldCupData);
  const [dataError, setDataError] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const matches = useMemo(
    () => worldcupData.matches.map((match, index) => ({ ...match, id: buildMatchId(match, index) })),
    [worldcupData],
  );

  const initialPredictions = useMemo(
    () => matches.map((match) => ({ matchId: match.id, score1: null, score2: null })),
    [matches],
  );

  const [predictions, setPredictions] = useState<Prediction[]>(initialPredictions);

  const actualTopScorer = useMemo(() => getActualTopScorer(matches), [matches]);

  const actualGoalScorers = useMemo(() => {
    const scorers = new Set<string>();
    matches.forEach((match) => {
      [...(match.goals1 || []), ...(match.goals2 || [])].forEach((goal) => scorers.add(goal.name));
    });
    return scorers;
  }, [matches]);

  const topScorerMatches = useMemo(
    () => topScorers.filter(Boolean).filter((player) => actualGoalScorers.has(player)),
    [topScorers, actualGoalScorers],
  );

  const currentPoints = useMemo(() => {
    const matchPoints = predictions.reduce((sum, prediction) => {
      const match = matches.find((m) => m.id === prediction.matchId);
      return match ? sum + calculatePredictionPoints(prediction, match) : sum;
    }, 0);

    const topScorerPoints = topScorerMatches.length * 5;
    return matchPoints + topScorerPoints;
  }, [predictions, matches, topScorerMatches]);

  const debugInfo = {
    session: session ? { id: session.user?.id, email: session.user?.email } : null,
    profileLoaded,
    loadProfileStatus,
    saveStatus,
    profile: profile ? { id: profile.id, has_completed_setup: profile.has_completed_setup, email: profile.email ?? null } : null,
    predictionsLength: predictions.length,
    predictions: predictions.slice(0, 3),
    topScorers,
    currentPoints,
    saveError,
    feedback,
  };

  const getSupabaseRestHeaders = () => {
    const token = session?.access_token ?? '';
    return {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: token ? `Bearer ${token}` : '',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  };

  const parseJsonSafe = async (response: Response) => {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  };

  const fetchProfileRow = async (userId: string) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`;
    const response = await fetch(url, {
      headers: getSupabaseRestHeaders(),
    });
    const json = await parseJsonSafe(response);
    return { response, json };
  };

  const insertProfileRow = async (payload: Record<string, unknown>) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getSupabaseRestHeaders(),
      body: JSON.stringify(payload),
    });
    const json = await parseJsonSafe(response);
    return { response, json };
  };

  const upsertProfileRow = async (payload: Record<string, unknown>) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?on_conflict=id`;
    const headers = {
      ...getSupabaseRestHeaders(),
      Prefer: 'return=minimal,resolution=merge-duplicates',
    };
    console.log('upsertProfileRow url', url);
    console.log('upsertProfileRow headers', headers);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const json = await parseJsonSafe(response);
    console.log('upsertProfileRow response status', response.status, json);
    return { response, json };
  };

  useEffect(() => {
    if (!profile) return;
    if (!profile.has_completed_setup) {
      setPredictions(initialPredictions);
    }
  }, [initialPredictions, profile]);

  useEffect(() => {
    const fetchLiveSchedule = async () => {
      try {
        const response = await fetch('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json');
        if (!response.ok) {
          throw new Error(`Schedule request failed with ${response.status}`);
        }

        const json = (await response.json()) as WorldCupData;
        setWorldcupData(json);
        setDataError(null);
      } catch (error) {
        console.error('Could not load live schedule:', error);
        setDataError('Live World Cup schedule unavailable. Using local fallback data.');
      }
    };

    fetchLiveSchedule();
  }, []);

  useEffect(() => {
    const initSession = async () => {
      try {
        const {
          data: { session: activeSession },
        } = await supabase.auth.getSession();
        setSession(activeSession);

        if (activeSession?.user?.id) {
          try {
            await loadProfile(activeSession.user.id);
          } catch (error) {
            console.error('Failed to load profile:', error);
            setProfileLoaded(true);
          }
        } else {
          setProfileLoaded(true);
        }
      } catch (error) {
        console.error('Failed to get auth session:', error);
        setSession(null);
        setProfileLoaded(true);
      }
    };

    initSession();
    const { data: listener } = supabase.auth.onAuthStateChange(async (_, newSession) => {
      setSession(newSession);
      if (newSession?.user?.id) {
        setProfileLoaded(false);
        try {
          await loadProfile(newSession.user.id);
        } catch (error) {
          console.error('Failed to load profile on auth change:', error);
          setProfileLoaded(true);
        }
      } else {
        setProfile(null);
        setPredictions(initialPredictions);
        setProfileLoaded(true);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [initialPredictions]);

  useEffect(() => {
    if (!session || profileLoaded) return;
    const fallbackTimer = window.setTimeout(() => {
      console.warn('Profile load fallback triggered: forcing profileLoaded to true');
      if (!profile && session?.user?.id) {
        setProfile({ id: session.user.id, full_name: null, avatar_url: null, has_completed_setup: false });
        setPredictions(initialPredictions);
        setTopScorers(['', '', '', '', '']);
      }
      setProfileLoaded(true);
    }, 8000);

    return () => window.clearTimeout(fallbackTimer);
  }, [session, profileLoaded, profile, initialPredictions]);

  const createInitialProfile = async (userId: string) => {
    setLoadProfileStatus('creating');
    const payload = {
      id: userId,
      email: session?.user?.email ?? null,
      full_name: null,
      avatar_url: null,
      has_completed_setup: false,
      predictions: initialPredictions,
      top_scorer: ['', '', '', '', ''],
      points: 0,
    };

    const { response, json } = await insertProfileRow(payload);
    if (!response.ok) {
      console.error('Unable to create initial profile row:', response.status, json);
      setLoadProfileStatus('create-error');
      setProfile({ id: userId, full_name: null, avatar_url: null, has_completed_setup: false });
      setPredictions(initialPredictions);
      setTopScorers(['', '', '', '', '']);
      setProfileLoaded(true);
      return;
    }

    setLoadProfileStatus('created');
    setProfile(payload as UserProfile);
    setPredictions(initialPredictions);
    setTopScorers(['', '', '', '', '']);
    setProfileLoaded(true);
  };

  const loadProfile = async (userId: string) => {
    setLoadProfileStatus('loading');
    const { response, json } = await fetchProfileRow(userId);
    if (!response.ok) {
      console.error('Supabase profile query failure:', response.status, json);
      await createInitialProfile(userId);
      return;
    }

    if (!json || (Array.isArray(json) && json.length === 0)) {
      await createInitialProfile(userId);
      return;
    }

    const data = Array.isArray(json) ? json[0] : json;
    setLoadProfileStatus('loaded');
    setProfile(data as UserProfile);
    setPredictions((data.predictions as Prediction[]) ?? initialPredictions);

    const savedTopScorers = data.top_scorer;
    if (Array.isArray(savedTopScorers)) {
      setTopScorers(savedTopScorers.slice(0, 5).map((item) => String(item)));
    } else if (savedTopScorers && typeof savedTopScorers === 'object' && 'player' in savedTopScorers) {
      setTopScorers([savedTopScorers.player || '', '', '', '', '']);
    } else {
      setTopScorers(['', '', '', '', '']);
    }
    setProfileLoaded(true);
  };

  const signInWithPassword = async () => {
    setMagicLinkMessage('Bezig met inloggen...');
    const { error } = await supabase.auth.signInWithPassword({ email: userEmail, password: userPassword });
    if (error) {
      setMagicLinkMessage(`Fout: ${error.message}`);
      return;
    }
    setMagicLinkMessage('Inloggen gelukt.');
  };

  const signUpWithEmail = async () => {
    setMagicLinkMessage('Account aanmaken...');
    const { error } = await supabase.auth.signUp({ email: userEmail, password: userPassword });
    if (error) {
      setMagicLinkMessage(`Fout: ${error.message}`);
      return;
    }
    setMagicLinkMessage('Account aangemaakt. Controleer je e-mail als bevestiging nodig is.');
  };

  const signInWithGoogle = async () => {
    setMagicLinkMessage('Doorsturen naar Google...');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) setMagicLinkMessage(`OAuth fout: ${error.message}`);
  };

  const sendMagicLink = async () => {
    setMagicLinkMessage('Link verzenden...');
    const { error } = await supabase.auth.signInWithOtp({ email: userEmail });
    if (error) {
      setMagicLinkMessage(`Fout: ${error.message}`);
      return;
    }
    setMagicLinkMessage('Magic link verzonden. Controleer je inbox.');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setPredictions(initialPredictions);
    setProfileLoaded(false);
  };

  const updatePrediction = (matchId: string, team: 'score1' | 'score2', value: number | null) => {
    setPredictions((current) =>
      current.map((prediction) =>
        prediction.matchId === matchId ? { ...prediction, [team]: value } : prediction,
      ),
    );
  };

  const getMatchStartTime = (match: Match) => {
    const matchTime = match.time?.trim() || '00:00';
    return dayjs(`${match.date} ${matchTime}`);
  };

  const getStageKey = (match: Match) => {
    const round = (match.round || '').toLowerCase();
    const group = (match.group || '').toLowerCase();

    if (round.includes('matchday') || group.includes('group')) return 'group';
    if (round.includes('round of 16') || round.includes('last 16')) return 'round_of_16';
    if (round.includes('quarter')) return 'quarterfinals';
    if (round.includes('semi')) return 'semifinals';
    if (round.includes('final')) return 'final';
    return 'group';
  };

  const getStageCutoff = useMemo(() => {
    const stageStarts = matches.reduce<Record<string, dayjs.Dayjs>>((acc, match) => {
      const stageKey = getStageKey(match);
      const matchStart = getMatchStartTime(match);
      const existing = acc[stageKey];

      if (!existing || matchStart.isBefore(existing)) {
        acc[stageKey] = matchStart;
      }
      return acc;
    }, {});

    return stageStarts;
  }, [matches]);

  const canEditMatch = (match: Match) => {
    const stageKey = getStageKey(match);
    const cutoff = getStageCutoff[stageKey] ?? getMatchStartTime(match);
    return dayjs().isBefore(cutoff);
  };

  const saveSetup = async () => {
    if (!profile) {
      console.error('saveSetup called without profile');
      setFeedback('Kon niet opslaan: profielstatus ontbreekt. Vernieuw de pagina of log uit en opnieuw in.');
      return;
    }

    setSaveStatus('starting');
    setIsSaving(true);
    setSaveError(null);
    setFeedback('Je voorspellingen worden opgeslagen...');

    const payload = {
      id: profile.id,
      email: session?.user?.email ?? profile.email ?? null,
      has_completed_setup: true,
      predictions,
      top_scorer: topScorers,
      points: currentPoints,
    };

    console.log('saveSetup payload', payload);
    console.log('saveSetup session', session);

    try {
      const { response, json } = await upsertProfileRow(payload);
      if (!response.ok) {
        console.error('Unable to save profile setup:', response.status, json);
        throw new Error(`Request failed with status ${response.status}`);
      }

      setSaveStatus('success');
      setProfile((current) => (current ? { ...current, ...payload } : payload as UserProfile));
      setFeedback('Opgeslagen! Je Belisinator-dashboard is bijgewerkt.');
    } catch (error) {
      console.error('Unable to save profile setup:', error);
      const message = error instanceof Error ? error.message : String(error);
      setSaveStatus('error');
      setSaveError(message);
      setFeedback(`Kon niet opslaan: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const renderScoreInput = (matchId: string, team: 'score1' | 'score2', value: number | null, disabled: boolean) => (
    <input
      type="number"
      min={0}
      value={value ?? ''}
      onChange={(event) => {
        if (disabled) return;
        const typed = event.target.value;
        updatePrediction(matchId, team, typed === '' ? null : Number(typed));
      }}
      disabled={disabled}
      className={`w-16 rounded-xl border px-3 py-2 text-right outline-none transition focus:border-electric focus:ring-2 focus:ring-electric/20 ${disabled ? 'border-slate-700 bg-slate-800/60 text-slate-500 cursor-not-allowed' : 'border-slate-700 bg-slate-900/90 text-slate-100'}`}
      aria-label={`Prediction for ${team}`}
    />
  );

  const renderMatchCard = (match: Match & { id: string }) => {
    const prediction = predictions.find((item) => item.matchId === match.id);
    const resultLabel = match.score ? `${match.score.ft[0]} - ${match.score.ft[1]}` : 'Open';

    return (
      <article key={match.id} className="rounded-3xl border border-white/5 bg-white/5 p-4 shadow-glass backdrop-blur-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{match.round} · {match.group}</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-100">{match.team1} vs {match.team2}</h3>
            <p className="text-sm text-slate-400">{dayjs(match.date).format('MMM D')} · {match.time} · {match.ground}</p>
          </div>
          <div className="rounded-3xl bg-slate-950/80 px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.22em] text-slate-300 ring-1 ring-slate-700/80">
            {resultLabel}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
          <div className="grid grid-cols-2 gap-2 justify-center">
            {renderScoreInput(match.id, 'score1', prediction?.score1 ?? null, !canEditMatch(match))}
            {renderScoreInput(match.id, 'score2', prediction?.score2 ?? null, !canEditMatch(match))}
          </div>
          {!canEditMatch(match) ? (
            <div className="rounded-3xl bg-slate-900/80 px-4 py-3 text-sm font-semibold text-orange-300">
              Locked
            </div>
          ) : match.score ? (
            <div className="rounded-3xl bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
              <p className="font-semibold text-slate-100">Actual goals</p>
              <div className="mt-2 space-y-1 text-slate-400">
                {match.goals1?.map((goal) => (
                  <p key={`g1-${goal.name}-${goal.minute}`}>⚽ {goal.name} {goal.minute}&apos;</p>
                ))}
                {match.goals2?.map((goal) => (
                  <p key={`g2-${goal.name}-${goal.minute}`}>⚽ {goal.name} {goal.minute}&apos;</p>
                ))}
                {!match.goals1?.length && !match.goals2?.length && <p>No goals data available</p>}
              </div>
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-8">
        <section className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-slate-950/90 p-8 shadow-glass backdrop-blur-2xl">
          <div className="space-y-6">
            <div className="space-y-3 text-center">
              <div className="inline-flex rounded-full bg-electric/10 p-3 text-electric">
                <User size={22} />
              </div>
              <h1 className="text-3xl font-semibold text-white">Belisinator 9000</h1>
              <p className="text-slate-400">Log in met e-mail om je wedstrijdvoorspellingen op te slaan en bij te houden met je account.</p>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-200">Je e-mail</label>
              <input
                type="email"
                value={userEmail}
                onChange={(event) => setUserEmail(event.target.value)}
                placeholder="naam@voorbeeld.com"
                className="w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-slate-100 outline-none transition focus:border-electric focus:ring-2 focus:ring-electric/20"
              />
            </div>
            <div className="mt-3 grid gap-3">
              <input
                type="password"
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                placeholder="Kies een wachtwoord"
                className="w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-slate-100 outline-none transition focus:border-electric focus:ring-2 focus:ring-electric/20"
              />

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={signInWithPassword}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-3xl bg-electric px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-electric/20 transition hover:brightness-110"
                >
                  Inloggen
                  <ArrowRight size={18} />
                </button>
                <button
                  onClick={signUpWithEmail}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-3xl border border-slate-700 bg-transparent px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-electric/70"
                >
                  Account aanmaken
                </button>
              </div>

              <button
                onClick={signInWithGoogle}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-3xl bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105"
              >
                Inloggen met Google
              </button>

              <button
                onClick={sendMagicLink}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-3xl bg-slate-700/60 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:brightness-105"
              >
                Magic link sturen (fallback)
              </button>
            </div>
            {magicLinkMessage ? <p className="text-sm text-slate-400">{magicLinkMessage}</p> : null}
            <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">
              <p className="font-medium text-slate-100">Setup-opmerking</p>
              <p className="mt-2">Zodra je bent ingelogd kun je je voorspellingen en topscorerkeuze afronden. Een Supabase-profiel houdt je score bij.</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (session && !profileLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/90 p-10 text-center text-slate-200 shadow-glass backdrop-blur-2xl">
          <p className="text-xl font-semibold">Je voorspellingen worden geladen...</p>
          <p className="mt-2 text-sm text-slate-400">Wacht even terwijl we je profiel en voorspellingen ophalen.</p>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/90 p-10 text-center text-slate-200 shadow-glass backdrop-blur-2xl">
          <p className="text-xl font-semibold">Je profiel wordt klaargemaakt…</p>
          <p className="mt-2 text-sm text-slate-400">We initialiseren nog je account voordat je voorspellingen kunt opslaan.</p>
          <p className="mt-4 text-sm text-orange-300">Als dit blijft doorgaan, vernieuw de pagina of log uit en opnieuw in.</p>
        </div>
      </main>
    );
  }

  if (!profile.has_completed_setup) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(100,217,255,0.22),transparent_38%),linear-gradient(180deg,#020617_0%,#070b19_100%)] px-4 py-8 text-slate-100">
        <header className="mx-auto max-w-5xl rounded-[2.5rem] border border-white/10 bg-slate-950/80 p-6 shadow-glass backdrop-blur-xl sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.32em] text-electric/70">Voorspellingscentrum</p>
              <h1 className="mt-3 text-4xl font-semibold text-white">Vergrendel je Belisinator voorspelling</h1>
              <p className="mt-4 max-w-2xl text-slate-300">Vul elke wedstrijdvoorspelling in, kies je topscorer en bouw je ranglijstscores op voordat de wedstrijden beginnen.</p>
            </div>
            <button
              onClick={signOut}
              className="self-start rounded-3xl border border-slate-700 bg-slate-900/90 px-5 py-3 text-sm text-slate-100 transition hover:border-electric/70"
            >
              Uitloggen
            </button>
          </div>
        </header>

        {import.meta.env.DEV ? (
          <div className="mx-auto mt-6 max-w-5xl rounded-3xl border border-slate-700 bg-slate-950/90 p-4 text-sm text-slate-200 shadow-glass">
            <p className="font-semibold text-white">Debug info</p>
            <pre className="mt-3 max-h-72 overflow-auto text-xs text-slate-300">
{JSON.stringify(debugInfo, null, 2)}
            </pre>
          </div>
        ) : null}

        {dataError ? (
          <div className="mx-auto mt-6 max-w-5xl rounded-3xl border border-orange-400/20 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
            {dataError}
          </div>
        ) : null}

        <section className="mx-auto mt-8 grid max-w-5xl gap-6">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
            <h2 className="text-2xl font-semibold text-white">Top 5 scorervoorspelling</h2>
            <p className="mt-2 text-slate-400">Selecteer maximaal 5 spelers uit de selectie van 2026. Elke doelpuntenmaker levert bonuspunten op.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {topScorers.map((value, index) => (
                <label key={`top-scorer-${index}`} className="block rounded-3xl border border-slate-700 bg-slate-900/80 p-4">
                  <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Pick #{index + 1}</span>
                  <input
                    type="text"
                    list="player-suggestions"
                    value={value}
                    onChange={(event) =>
                      setTopScorers((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      )
                    }
                    placeholder="Kylian Mbappé"
                    className="mt-3 w-full bg-transparent text-lg text-white outline-none"
                  />
                </label>
              ))}
            </div>
            <datalist id="player-suggestions">
              {playerSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-electric/70">Wedstrijdoverzicht</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Predict every fixture</h2>
              </div>
              <div className="rounded-3xl bg-slate-900/80 px-4 py-2 text-sm text-slate-300">{matches.length} matches</div>
            </div>
            <div className="mt-6 space-y-4">
              {matches.map((match) => renderMatchCard(match))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-electric/70">Voortgang</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Voltooi je setup</h2>
              </div>
              <button
                onClick={saveSetup}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-3xl bg-electric px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-electric/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Opslaan...' : 'Voorspellingen opslaan'}
                <ArrowRight size={18} />
              </button>
            </div>
            <p className="mt-4 text-slate-400">Je score wordt berekend zodra de werkelijke uitslagen in het schema staan. Sla nu op om je voorspellingen te bewaren.</p>
            {feedback ? <p className="mt-4 rounded-3xl bg-slate-900/80 px-4 py-3 text-sm text-slate-200">{feedback}</p> : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.14),transparent_34%),linear-gradient(180deg,#020617_0%,#060b18_100%)] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="rounded-[2.5rem] border border-white/10 bg-slate-950/80 p-6 shadow-glass backdrop-blur-xl sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.32em] text-electric/70">Leaderboard</p>
              <h1 className="mt-3 text-4xl font-semibold text-white">Belisinator 9000 dashboard</h1>
              <p className="mt-4 max-w-3xl text-slate-300">Volg je toernooiscore, bekijk afgeronde wedstrijden en vergelijk je topscorerkeuze met de werkelijkheid.</p>
            </div>
            <div className="flex flex-col gap-3 rounded-[2rem] bg-slate-900/80 p-5 text-slate-100 shadow-lg shadow-electric/10">
              <span className="text-xs uppercase tracking-[0.28em] text-electric/80">Total score</span>
              <strong className="text-4xl">{currentPoints}</strong>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={saveSetup}
                  disabled={isSaving}
                  className="rounded-3xl bg-electric px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Opslaan...' : 'Voorspellingen opslaan'}
                </button>
                <button
                  onClick={signOut}
                  className="rounded-3xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
                >
                  Uitloggen
                </button>
              </div>
            </div>
          </div>
        </header>

        {feedback ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glass backdrop-blur-xl">
            <p className="text-sm text-slate-200">{feedback}</p>
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-electric/70">Top scorer</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Jouw picks vs werkelijke doelpuntenmakers</h2>
                </div>
                <div className="rounded-3xl bg-slate-900/80 px-4 py-3 text-sm text-slate-300">{actualTopScorer ?? 'In afwachting'}</div>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Jouw picks</p>
                  <div className="mt-3 space-y-2 text-white">
                    {(profile.top_scorer && Array.isArray(profile.top_scorer)
                      ? profile.top_scorer
                      : topScorers
                    ).map((player, index) => (
                      <p key={`${player}-${index}`} className="text-lg font-semibold">{player || `Pick #${index + 1}`}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Correct scorers</p>
                  <p className="mt-3 text-xl font-semibold text-white">{topScorerMatches.length} / {topScorers.length}</p>
                  <p className="mt-1 text-sm text-slate-400">{topScorerMatches.length > 0 ? topScorerMatches.join(', ') : 'Geen gekozen doelpuntenmaker heeft nog gescoord'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-electric" />
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-electric/70">Account</p>
                  <p className="mt-2 text-base text-slate-300">Ingelogd als <span className="font-semibold text-white">{profile.full_name || 'Creator'}</span></p>
                </div>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl bg-slate-900/80 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Voorspelde wedstrijden</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{matches.length}</p>
                </div>
                <div className="rounded-3xl bg-slate-900/80 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Setupstatus</p>
                  <p className="mt-3 text-3xl font-semibold text-white">Voltooid</p>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <Trophy className="text-electric" />
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-electric/70">Ranglijst</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Scoredetails</h2>
                </div>
              </div>
              <div className="mt-6 space-y-3 text-slate-300">
                <div className="flex items-center justify-between rounded-3xl bg-slate-900/80 px-4 py-3">
                  <p>Voorspelde uitslagen</p>
                  <span>{currentPoints - topScorerMatches.length * 5} pts</span>
                </div>
                <div className="flex items-center justify-between rounded-3xl bg-slate-900/80 px-4 py-3">
                  <p>Top scorer bonus</p>
                  <span>{topScorerMatches.length * 5} pts</span>
                </div>
                <div className="rounded-3xl bg-gradient-to-r from-electric to-neon px-4 py-4 text-center text-3xl font-semibold text-slate-950">
                  {currentPoints} pts
                </div>
              </div>
            </div>
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
              <h2 className="text-xl font-semibold text-white">Volgende wedstrijd</h2>
              <p className="mt-3 text-slate-400">Blijf op de hoogte van de laatste voorspellingen en doelpuntenjacht.</p>
              <div className="mt-5 rounded-3xl bg-slate-900/80 p-5">
                <p className="text-sm uppercase tracking-[0.22em] text-electric/70">Volgende wedstrijd</p>
                <p className="mt-3 text-lg font-semibold text-white">{matches[0].team1} vs {matches[0].team2}</p>
                <p className="mt-1 text-sm text-slate-400">{dayjs(matches[0].date).format('MMM D')} · {matches[0].time}</p>
              </div>
            </div>
          </aside>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-electric/70">Wedstrijdenarchief</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Jouw voorspellingen vs uitslagen</h2>
            </div>
            <div className="rounded-3xl bg-slate-900/80 px-4 py-2 text-sm text-slate-300">{matches.filter((match) => match.score).length} voltooid</div>
          </div>
          <div className="mt-6 space-y-4">
            {matches.map((match) => renderMatchCard(match))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
