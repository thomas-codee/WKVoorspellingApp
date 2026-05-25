export type MatchGoal = {
  name: string;
  minute: number;
  penalty?: boolean;
  offset?: number;
};

export type MatchScore = {
  ft: [number, number] | number[];
  ht: [number, number] | number[];
};

export type Match = {
  round: string;
  date: string;
  time: string;
  team1: string;
  team2: string;
  group: string;
  ground: string;
  score?: MatchScore;
  goals1?: MatchGoal[];
  goals2?: MatchGoal[];
};

export type WorldCupData = {
  name: string;
  matches: Match[];
};

export type Player = {
  number: number;
  position_code: string;
  position: string;
  name: string;
  date_of_birth: string;
  age: number;
  caps: number;
  club: string;
};

export type PlayerTeam = {
  team: string;
  coach: string;
  players: Player[];
};

export type WorldCupPlayersData = {
  tournament: string;
  source: string;
  teams_count: number;
  players_count: number;
  teams: PlayerTeam[];
};

export type Prediction = {
  matchId: string;
  score1: number | null;
  score2: number | null;
};

export type TopScorerPick = {
  player: string;
  country: string;
};

export type UserProfile = {
  id: string;
  email?: string | null;
  full_name: string | null;
  avatar_url: string | null;
  has_completed_setup: boolean;
  top_scorer?: string[] | TopScorerPick;
  predictions?: Prediction[];
  points?: number;
};
