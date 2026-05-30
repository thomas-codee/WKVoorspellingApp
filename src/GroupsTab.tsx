import { useEffect, useState, useCallback } from 'react'; // Voeg useCallback toe
import { supabase } from './lib/supabase';
import type { Group, GroupWithMembers, UserProfile } from './types';

export function GroupsTab({ currentUserId, currentPoints }: { currentUserId: string; currentPoints: number }) {
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');

  // Verpak loadGroups in een useCallback om oneindige her-renders te voorkomen
  const loadGroups = useCallback(async () => {
    // EXTRA VEILIGHEID: Als er (nog) geen geldige userId is, voer de query dan niet uit
    if (!currentUserId || currentUserId === 'sandbox-user') {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Haal alle groepen op waar de gebruiker lid van is
      const { data: memberRows, error: memberError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', currentUserId);

      if (memberError) throw memberError;
      if (!memberRows?.length) { setGroups([]); setLoading(false); return; }

      const groupIds = memberRows.map(r => r.group_id);
      const { data: groupData, error: groupError } = await supabase
        .from('groups')
        .select('*')
        .in('id', groupIds);

      if (groupError) throw groupError;

      // Per groep: alle leden + hun profielen ophalen
      const enriched: GroupWithMembers[] = await Promise.all(
        (groupData ?? []).map(async (group) => {
          const { data: members } = await supabase
            .from('group_members')
            .select('*, profile:profiles(*)')
            .eq('group_id', group.id);
          return { ...group, members: members ?? [] };
        })
      );
      
      setGroups(enriched);
    } catch (err: any) {
      console.error('Fout tijdens ophalen groepen:', err);
      setFeedback('Kon groepen niet ophalen. Database initialisatie loopt nog.');
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  // Activeer de effect-hook pas als currentUserId écht gevuld en stabiel is
  useEffect(() => {
    if (currentUserId && currentUserId !== 'sandbox-user') {
      loadGroups();
    }
  }, [currentUserId, loadGroups]);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    const { data: group, error } = await supabase
      .from('groups')
      .insert({ name: newGroupName, created_by: currentUserId })
      .select().single();
    if (error || !group) { setFeedback('Aanmaken mislukt.'); return; }
    // Maker direct als lid toevoegen
    await supabase.from('group_members').insert({ group_id: group.id, user_id: currentUserId });
    setNewGroupName('');
    setFeedback(`Groep "${group.name}" aangemaakt! Invite code: ${group.invite_code}`);
    loadGroups();
  };

  const joinGroup = async () => {
    if (!inviteCode.trim()) return;
    const { data: group } = await supabase
      .from('groups')
      .select('*')
      .eq('invite_code', inviteCode.trim())
      .maybeSingle();
    if (!group) { setFeedback('Ongeldige invite code.'); return; }
    const { error } = await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: currentUserId });
    if (error) { setFeedback('Al lid of fout.'); return; }
    setInviteCode('');
    setFeedback(`Toegetreden tot "${group.name}"!`);
    loadGroups();
  };

  const leaveGroup = async (groupId: string) => {
    await supabase.from('group_members').delete()
      .eq('group_id', groupId).eq('user_id', currentUserId);
    loadGroups();
  };

  // Ranglijst: sorteer leden op punten (uit profiles tabel)
  const renderLeaderboard = (group: GroupWithMembers) => {
    const sorted = [...group.members]
      .sort((a, b) => ((b.profile?.points ?? 0) - (a.profile?.points ?? 0)));
    return sorted.map((member, i) => (
      <div key={member.user_id} className="flex items-center justify-between rounded-3xl bg-slate-900/80 px-4 py-3">
        <span className="text-slate-400 w-6">{i + 1}.</span>
        <span className="flex-1 font-semibold text-white">
          {member.profile?.full_name ?? 'Onbekend'}
          {member.user_id === currentUserId && <span className="ml-2 text-xs text-electric">(jij)</span>}
        </span>
        <span className="font-bold text-electric">{member.profile?.points ?? 0} pts</span>
      </div>
    ));
  };

  return (
    <section className="space-y-6">
      {/* Groep aanmaken / joinen */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
        <h2 className="text-2xl font-semibold text-white">Groepen</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Nieuwe groep aanmaken</p>
            <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
              placeholder="Naam van de groep"
              className="w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-white outline-none" />
            <button onClick={createGroup}
              className="w-full rounded-3xl bg-electric px-4 py-3 font-semibold text-slate-950">
              Aanmaken
            </button>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Groep joinen via code</p>
            <input value={inviteCode} onChange={e => setInviteCode(e.target.value)}
              placeholder="8-cijferige invite code"
              className="w-full rounded-3xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-white outline-none" />
            <button onClick={joinGroup}
              className="w-full rounded-3xl border border-electric/50 px-4 py-3 font-semibold text-electric">
              Joinen
            </button>
          </div>
        </div>
        {feedback && <p className="mt-4 rounded-3xl bg-slate-900/80 px-4 py-3 text-sm text-slate-200">{feedback}</p>}
      </div>

      {/* Groepsoverzicht */}
      {loading ? <p className="text-slate-400">Groepen laden...</p> : groups.length === 0 ? (
        <p className="text-slate-400">Je zit nog niet in een groep. Maak er een aan of join via een code.</p>
      ) : groups.map(group => (
        <div key={group.id} className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glass">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">{group.name}</h3>
              <p className="mt-1 text-xs text-slate-400">
                Invite code: <span className="font-mono text-electric">{group.invite_code}</span>
                <button onClick={() => navigator.clipboard.writeText(group.invite_code)}
                  className="ml-2 text-slate-500 hover:text-white">kopieer</button>
              </p>
            </div>
            <button onClick={() => leaveGroup(group.id)}
              className="rounded-3xl border border-slate-700 px-4 py-2 text-xs text-slate-400 hover:text-red-400">
              Verlaten
            </button>
          </div>
          <div className="mt-5 space-y-2">
            <p className="text-xs uppercase tracking-widest text-slate-400">Ranglijst ({group.members.length} leden)</p>
            {renderLeaderboard(group)}
          </div>
        </div>
      ))}
    </section>
  );
}