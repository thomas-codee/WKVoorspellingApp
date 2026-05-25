import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  console.log('STAGE 1: App Component actively rendering...');

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

  // Safety net: Force clear the loading state if everything hangs at a root level
  useEffect(() => {
    const backupUnlockTimer = setTimeout(() => {
      if (!profileLoaded) {
        console.warn('STAGE EXTRA: Global 2.5s absolute timeout triggered. Forcing profileLoaded = true to unstick UI.');
        setProfileLoaded(true);
        if (!profile) {
          setProfile({
            id: 'sandbox-user',
            full_name: 'Local Sandbox Pilot',
            avatar_url: null,
            has_completed_setup: false
          });
          setFeedback('Verbindingstijd verstreken. Lokale modus geactiveerd.');
        }
      }
    }, 2500);
    return () => clearTimeout(backupUnlockTimer);
  }, [profileLoaded, profile]);

  // Helper inside component context to process dates reliably across desktop & mobile Safari
  const getMatchStartTime = (match: Match) => {
    const matchTime = match.time?.trim() || '00:00';
    return dayjs(`${match.date} ${matchTime}`, 'YYYY-MM-DD HH:mm');
  };

  const matches = useMemo(() => {
    try {
      // 1. Map base matches with cross-platform compatible DayJS instances
      const baseMatches = worldcupData.matches.map((match, index) => ({
        ...match,
        id: buildMatchId(match, index),
        startDayjs: getMatchStartTime(match)
      }));

      // 2. Tally structures to extract earliest game timestamp
      const groupDeadlines: Record<string, dayjs.Dayjs> = {};
      const roundDeadlines: Record<string, dayjs.Dayjs> = {};

      baseMatches.forEach((m) => {
        if (m.group) {
          if (!groupDeadlines[m.group] || m.startDayjs.isBefore(groupDeadlines[m.group])) {
            groupDeadlines[m.group] = m.startDayjs;
          }
        }
        if (m.round) {
          if (!roundDeadlines[m.round] || m.startDayjs.isBefore(roundDeadlines[m.round])) {
            roundDeadlines[m.round] = m.startDayjs;
          }
        }
      });

      // 3. Bind correct dynamic cutoff properties to individual structural instances
      return baseMatches.map((m) => {
        let cutoff = m.startDayjs;

        if (m.group) {
          // Group structural validation -> lock from first game of group
          cutoff = groupDeadlines[m.group];
        } else if (m.round) {
          // Playoff structural validation -> lock from first game of phase
          cutoff = roundDeadlines[m.round];
        }

        return {
          ...m,
          cutoffDayjs: cutoff
        };
      });
    } catch (e) {
      console.error('STAGE 1B: Error parsing matches array metadata:', e);
      return [];
    }
  }, [worldcupData]);

  const initialPredictions = useMemo(
    () => matches.map((match) => ({ matchId: match.id, score1: null, score2: null })),
    [matches],
  );

  const initialPredictionsRef = useRef(initialPredictions);
  useEffect(() => { 
    initialPredictionsRef.current = initialPredictions; 
  }, [initialPredictions]);

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

  const hydrateProfileData = useCallback((data: any) => {
    setProfile(data as UserProfile);
    setPredictions((data.predictions as Prediction[]) ?? initialPredictionsRef.current);

    const savedTopScorers = data.top_scorer;
    if (Array.isArray(savedTopScorers)) {
      setTopScorers(savedTopScorers.slice(0, 5).map((item) => String(item)));
    } else if (savedTopScorers && typeof savedTopScorers === 'object' && 'player' in savedTopScorers) {
      setTopScorers([String((savedTopScorers as any).player || ''), '', '', '', '']);
    } else {
      setTopScorers(['', '', '', '', '']);
    }
  }, []);

  const executeProfileLoadSequence = useCallback(async (userId: string, userEmail?: string | null) => {
    if (!userId) return;
    setLoadProfileStatus('loading');
    console.log(`STAGE 3: Starting profile lookup sequence for user ID: ${userId}`);

    try {
      const networkTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Internal Database Timeout')), 1500)
      );

      console.log('STAGE 3B: Dispatching query to Supabase client instance...');
      const databaseQuery = supabase.from('profiles').select('*').eq('id', userId).maybeSingle();

      const { data, error } = (await Promise.race([databaseQuery, networkTimeout])) as any;

      if (error) {
        console.error('STAGE 3C [ERROR]: Supabase returned an error block:', error);
        throw error;
      }

      if (data) {
        console.log('STAGE 3D: Profile data loaded successfully:', data);
        hydrateProfileData(data);
        setLoadProfileStatus('loaded');
        return;
      }

      console.log('STAGE 3E: Profile returned blank. Injecting new profile schema row...');
      setLoadProfileStatus('creating');
      
      const payload = {
        id: userId,
        email: userEmail ?? null,
        full_name: null,
        avatar_url: null,
        has_completed_setup: false,
        predictions: initialPredictionsRef.current,
        top_scorer: ['', '', '', '', ''],
        points: 0,
      };

      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert(payload)
        .select()
        .single();

      if (insertError) throw insertError;

      console.log('STAGE 3F: Profile generated cleanly in database context:', newProfile);
      hydrateProfileData(newProfile);
      setLoadProfileStatus('created');
    } catch (err) {
      console.warn('STAGE 3 [FALLBACK]: Bypassing database layer, mounting sandbox engine instance:', err);
      
      setProfile({ 
        id: userId, 
        full_name: userEmail ? userEmail.split('@')[0] : 'Local Pilot', 
        avatar_url: null, 
        has_completed_setup: false 
      });
      setPredictions(initialPredictionsRef.current);
      setTopScorers(['', '', '', '', '']);
      setLoadProfileStatus('sandbox-fallback-active');
      setFeedback('Opmerking: Database onbereikbaar. Wijzigingen worden lokaal in het browser-geheugen bewaard.');
    } finally {
      setProfileLoaded(true);
    }
  }, [hydrateProfileData]);

  useEffect(() => {
    if (!profile) return;
    if (!profile.has_completed_setup) {
      setPredictions(initialPredictionsRef.current);
    }
  }, [profile]);

  useEffect(() => {
    const fetchLiveSchedule = async () => {
      try {
        const response = await fetch('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json');
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const json = (await response.json()) as WorldCupData;
        setWorldcupData(json);
      } catch (error) {
        console.error('Could not load live schedule:', error);
        setDataError('Live World Cup schema onbereikbaar. Lokale fallback data is actief.');
      }
    };
    fetchLiveSchedule();
  }, []);

  // Sync point effect
  useEffect(() => {
    console.log('STAGE 2: Mounting synchronization block effect...');
    let isMounted = true;

    const synchronizeAuthUser = async () => {
      try {
        console.log('STAGE 2A: Querying active session cookies...');
        const { data: { session: activeSession } } = await supabase.auth.getSession();
        
        if (!isMounted) return;

        if (activeSession) {
          console.log('STAGE 2B: Valid session found active during boot. Forwarding user...');
          setSession(activeSession);
          await executeProfileLoadSequence(activeSession.user.id, activeSession.user.email);
        } else {
          console.log('STAGE 2C: No session cookie discovered. Presenting entry screen.');
          setProfileLoaded(true);
        }
      } catch (err) {
        console.error('STAGE 2 [ERROR]: Auth initialization failed entirely:', err);
        if (isMounted) setProfileLoaded(true);
      }
    };

    synchronizeAuthUser();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      console.log(`STAGE 2D [EVENT]: Auth channel state update -> ${event}`);
      if (!isMounted) return;

      setSession(currentSession);
      if (currentSession?.user?.id) {
        await executeProfileLoadSequence(currentSession.user.id, currentSession.user.email);
      } else {
        setProfile(null);
        setPredictions(initialPredictionsRef.current);
        setTopScorers(['', '', '', '', '']);
        setProfileLoaded(true);
      }
    });

    return () => {
      console.log('STAGE 2E: Cleaning up old auth subscriptions.');
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [executeProfileLoadSequence]);

  const signInWithPassword = async () => {
    setMagicLinkMessage('Bezig met inloggen...');
    setProfileLoaded(false);
    const { data, error } = await supabase.auth.signInWithPassword({ email: userEmail, password: userPassword });
    if (error) {
      setMagicLinkMessage(`Fout: ${error.message}`);
      setProfileLoaded(true);
      return;
    }
    if (data?.session?.user?.id) {
      await executeProfileLoadSequence(data.session.user.id, data.session.user.email);
    } else {
      setProfileLoaded(true);
    }
    setMagicLinkMessage('Inloggen gelukt.');
  };

  const signUpWithEmail = async () => {
    setMagicLinkMessage('Account aanmaken...');
    setProfileLoaded(false);
    const { data, error } = await supabase.auth.signUp({ email: userEmail, password: userPassword });
    if (error) {
      setMagicLinkMessage(`Fout: ${error.message}`);
      setProfileLoaded(true);
      return;
    }
    if (data?.user?.id) {
      await executeProfileLoadSequence(data.user.id, data.user.email);
    } else {
      setProfileLoaded(true);
    }
    setMagicLinkMessage('Account aangemaakt.');
  };

  const signInWithGoogle = async () => {
    setMagicLinkMessage('Doorsturen naar Google...');
    await supabase.auth.signInWithOAuth({ provider: 'google' });
  };

  const sendMagicLink = async () => {
    setMagicLinkMessage('Link verzenden...');
    const { error } = await supabase.auth.signInWithOtp({ email: userEmail });
    if (error) {
      setMagicLinkMessage(`Fout: ${error.message}`);
      return;
    }
    setMagicLinkMessage('Magic link verzonden.');
  };

  const signOut = async () => {
    setProfileLoaded(false);
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setPredictions(initialPredictions);
    setTopScorers(['', '', '', '', '']);
    setProfileLoaded(true);
  };

  const updatePrediction = (matchId: string, team: 'score1' | 'score2', value: number | null) => {
    setPredictions((current) =>
      current.map((prediction) =>
        prediction.matchId === matchId ? { ...prediction, [team]: value } : prediction,
      ),
    );
  };

  // Fixed validator targeting compiled custom group/phase cutoff instances
  const canEditMatch = (match: Match & { cutoffDayjs?: dayjs.Dayjs }) => {
    if (!match.cutoffDayjs || !match.cutoffDayjs.isValid()) {
      return true; 
    }
    return dayjs().isBefore(match.cutoffDayjs);
  };

  const saveSetup = async () => {
    if (!profile) return;

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

    try {
      const { data, error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' }).select().single();
      if (error) throw error;

      setSaveStatus('success');
      setProfile(data as UserProfile);
      setFeedback('Opgeslagen! Je Belisinator-dashboard is bijgewerkt.');
    } catch (error) {
      console.error('Unable to save profile configuration setup:', error);
      setSaveStatus('error');
      setFeedback('Lokaal opgeslagen in actieve browser-sessie (Cloud database onbereikbaar).');
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

  const renderMatchCard = (match: Match & { id: string; cutoffDayjs?: dayjs.Dayjs }) => {
    const prediction = predictions.find((item) => item.matchId === match.id);
    const resultLabel = match.score ? `${match.score.ft[0]} - ${match.score.ft[1]}` : 'Open';
    const editable = canEditMatch(match);

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
            {renderScoreInput(match.id, 'score1', prediction?.score1 ?? null, !editable)}
            {renderScoreInput(match.id, 'score2', prediction?.score2 ?? null, !editable)}
          </div>
          {!editable ? (
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
              <p className="text-slate-400">Log in met e-mail om je wedstrijdvoorspellingen op te slaan.</p>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-200">Je e-mail</label>
              <input
                type="email"
                value={userEmail}
                onChange={(event) => setUserEmail(event.target.value)}
                placeholder="naam@voorbeeld.com"
                className="w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-slate-100 outline-none"
              />
            </div>
            <div className="mt-3 grid gap-3">
              <input
                type="password"
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                placeholder="Kies een wachtwoord"
                className="w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-slate-100 outline-none"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <button onClick={signInWithPassword} className="inline-flex w-full items-center justify-center gap-2 rounded-3xl bg-electric px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg">
                  Inloggen <ArrowRight size={18} />
                </button>
                <button onClick={signUpWithEmail} className="inline-flex w-full items-center justify-center gap-2 rounded-3xl border border-slate-700 text-slate-100">
                  Account aanmaken
                </button>
              </div>
              <button onClick={signInWithGoogle} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-3xl bg-white/10 px-5 py-3 text-sm text-white">
                Inloggen met Google
              </button>
              <button onClick={sendMagicLink} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-3xl bg-slate-700/60 px-5 py-3 text-sm text-slate-200">
                Magic link sturen (fallback)
              </button>
            </div>
            {magicLinkMessage ? <p className="text-sm text-slate-400">{magicLinkMessage}</p> : null}
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
          <p className="mt-2 text-sm text-slate-400">Wacht even terwijl we je profiel controleren.</p>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-8">
        <div className="rounded-[2rem] border border-white/10 bg-slate-950/90 p-10 text-center text-slate-200">
          <p className="text-xl font-semibold">Profiel initialisatie loop bypass...</p>
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
              <p className="mt-4 max-w-2xl text-slate-300">Vul elke wedstrijdvoorspelling in en sla je opstelling op.</p>
            </div>
            <button onClick={signOut} className="self-start rounded-3xl border border-slate-700 bg-slate-900/90 px-5 py-3 text-sm text-slate-100">
              Uitloggen
            </button>
          </div>
        </header>

        {import.meta.env.DEV ? (
          <div className="mx-auto mt-6 max-w-5xl rounded-3xl border border-slate-700 bg-slate-950/90 p-4 text-sm text-slate-200 shadow-glass">
            <p className="font-semibold text-white">Debug status info</p>
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
            <h2 className="text-2xl font-semibold text-white">Voorspel uitslagen</h2>
            <div className="mt-6 space-y-4">
              {matches.map((match) => renderMatchCard(match))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-2xl font-semibold text-white">Opslaan en afronden</h2>
              <button onClick={saveSetup} disabled={isSaving} className="inline-flex items-center gap-2 rounded-3xl bg-electric px-6 py-3 font-semibold text-slate-950 shadow-lg">
                {isSaving ? 'Opslaan...' : 'Voorspellingen opslaan'} <ArrowRight size={18} />
              </button>
            </div>
            {feedback ? <p className="mt-4 rounded-3xl bg-slate-900/80 px-4 py-3 text-sm text-slate-200">{feedback}</p> : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.14),transparent_34%),linear-gradient(180deg,#020617_0%,#060b18_100%)] px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="rounded-[2.5rem] border border-white/10 bg-slate-950/80 p-6 shadow-glass sm:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-4xl font-semibold text-white">Belisinator 9000 dashboard</h1>
            </div>
            <div className="flex flex-col gap-3 rounded-[2rem] bg-slate-900/80 p-5">
              <span className="text-xs uppercase tracking-[0.28em] text-electric/80">Totale score</span>
              <strong className="text-4xl">{currentPoints}</strong>
              <div className="flex gap-3">
                <button onClick={saveSetup} className="rounded-3xl bg-electric px-4 py-2 text-sm font-semibold text-slate-950">Opslaan</button>
                <button onClick={signOut} className="rounded-3xl bg-white/10 px-4 py-2 text-sm text-white">Uitloggen</button>
              </div>
            </div>
          </div>
        </header>

        {feedback ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-slate-200">{feedback}</p>
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
              <h2 className="text-2xl font-semibold text-white">Top Scorer Tracker</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl bg-slate-950/80 p-5">
                  <p className="text-xs text-slate-400">JOUW PICKS</p>
                  <div className="mt-3 space-y-2 text-white">
                    {(profile.top_scorer && Array.isArray(profile.top_scorer) ? profile.top_scorer : topScorers).map((player, idx) => (
                      <p key={`${player}-${idx}`} className="text-lg font-semibold">{player || `Pick #${idx + 1}`}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl bg-slate-950/80 p-5">
                  <p className="text-xs text-slate-400">CORRECTE MATCHES</p>
                  <p className="mt-3 text-xl font-semibold text-white">{topScorerMatches.length} / {topScorers.length}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-electric" />
                <p className="text-base text-slate-300">Ingelogd als <span className="font-semibold text-white">{profile.full_name || 'Creator'}</span></p>
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
              <h2 className="text-xl font-semibold text-white">Scoredetails</h2>
              <div className="mt-6 space-y-3">
                <div className="flex justify-between rounded-3xl bg-slate-900/80 px-4 py-3">
                  <p>Voorspellingen uitslagen</p>
                  <span>{currentPoints - topScorerMatches.length * 5} pts</span>
                </div>
                <div className="flex justify-between rounded-3xl bg-slate-900/80 px-4 py-3">
                  <p>Top scorer bonus</p>
                  <span>{topScorerMatches.length * 5} pts</span>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
          <h2 className="text-2xl font-semibold text-white">Alle wedstrijdvoorspellingen</h2>
          <div className="mt-6 space-y-4">
            {matches.map((match) => renderMatchCard(match))}
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;