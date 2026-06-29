// AI 搜索、棋型评分、分支限制和难度配置的统一常量表。
export const EMPTY = 0;
export const BLOCKED = 2;
export const WINNING_MOVE_SCORE = Number.MAX_SAFE_INTEGER;
export const FORCE_ATTACK_SCORE = 999;
export const DANGEROUS_REPLY_SCORE = 450;
export const URGENT_THREAT_SCORE = 200;
export const SEARCH_DEPTH = 3;
export const MAX_BRANCHES = 5;
export const ROOT_BRANCHES = 8;
export const MAX_TACTICAL_BRANCHES = 16;
export const POSITION_CANDIDATE_LIMIT = 8;
export const POSITION_WEIGHTS = [1, 0.55, 0.35, 0.2, 0.12, 0.08, 0.05, 0.03];
export const SEARCH_WIN_SCORE = 1_000_000_000;
export const QUIESCENCE_DEPTH = 2;
export const QUIESCENCE_BRANCHES = 4;
export const KILL_SEARCH_DEPTH = 2;
export const KILL_BRANCHES = 3;
export const DOUBLE_FOUR_SCORE = 5000;
export const FOUR_THREE_SCORE = 3000;
export const DOUBLE_OPEN_THREE_SCORE = 1400;
export const OPEN_THREE_JUMP_THREE_SCORE = 1100;
export const DOUBLE_JUMP_THREE_SCORE = 900;
export const OPEN_FOUR_SCORE = 999;
export const JUMP_FOUR_SCORE = 800;
export const BLOCKED_FOUR_SCORE = 700;
export const OPEN_THREE_SCORE = 450;
export const JUMP_THREE_SCORE = 180;
export const BLOCKED_THREE_SCORE = 90;
export const OPEN_TWO_SCORE = 60;
export const BLOCKED_TWO_SCORE = 10;

export const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export const EXPERT_THREAT_OPTIONS = {
  depth: 9,
  depths: [3, 5, 7, 9],
  forcingBranches: 12,
  responseBranches: 14,
  defenseBranches: 32,
  forcingScore: OPEN_THREE_SCORE,
  setupScore: BLOCKED_THREE_SCORE,
  setupBranches: 6,
  tenukiBranches: 5,
  sourceBranches: 12,
  responseScore: 100,
  timeLimitMs: 30000,
};

// 专家阶段预算的比例基准。实际每阶段时限会按专家总时限等比例缩放。
export const EXPERT_TIME_BUDGETS = Object.freeze({
  threatDefenseMs: 6200,
  threatSpaceMs: 2000,
  threatAttackMs: 1000,
  scoreSearchMs: 800,
});

export const EXPERT_THREAT_SPACE_OPTIONS = {
  depth: 4,
  setupBranches: 10,
  bridgeBranches: 4,
  bridgeThreatDelta: 6,
  bridgeThreatSources: 8,
  bridgeForcingScore: BLOCKED_FOUR_SCORE,
  responseBranches: 8,
  defenseBranches: 14,
  planLimit: 4,
  setupScore: JUMP_THREE_SCORE,
  forcingScore: OPEN_THREE_SCORE,
  sourceBranches: 12,
};

export const EXPERT_OPENING_MOVE_LIMIT = 12;
export const EXPERT_THREAT_TRIGGER_SCORE = DANGEROUS_REPLY_SCORE;
export const EXPERT_SEARCH_DEPTHS = [1, 2, 3, 4];

export const AI_PROFILES = {
  // 休闲：保留一步胜负判断，以局部评分为主，响应快且会留下可利用的中期空间。
  casual: {
    rootBranches: 5,
    searchDepth: 1,
    useKillAttack: false,
    useKillDefense: false,
  },
  // 进阶：预判一轮攻防，并启用短程杀棋的进攻与拆解。
  advanced: {
    rootBranches: ROOT_BRANCHES,
    searchDepth: SEARCH_DEPTH,
    useKillAttack: true,
    useKillDefense: true,
  },
  // 专家：在进阶能力之上启用开局库、迭代加深和完整威胁空间搜索。
  expert: {
    rootBranches: 10,
    searchDepth: 4,
    useKillAttack: true,
    useKillDefense: true,
    useExpertThreatSearch: true,
    useFirstMoveOpening: true,
    useIterativeSearch: true,
  },
};
