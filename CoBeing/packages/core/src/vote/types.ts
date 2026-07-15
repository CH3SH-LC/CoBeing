export interface VoteOption {
  text: string;
  pros?: string;        // 优点
  cons?: string;        // 缺点
  votes: string[];      // 投票者 agentId 列表
}

export interface VoteTopic {
  id: string;
  groupId: string;
  title: string;                    // 投票议题
  options: VoteOption[];
  status: "voting" | "passed" | "rejected" | "arbitrating";
  createdBy: string;                // 发起者 agentId
  createdAt: number;
  deadline: number;                 // 投票截止时间戳
  result?: string;                  // 最终决定描述
}

export type VoteStatus = VoteTopic["status"];
