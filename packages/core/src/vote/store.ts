import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@cobeing/shared";
import type { VoteTopic } from "./types.js";

const log = createLogger("vote-store");

export class VoteStore {
  private votes: VoteTopic[] = [];
  private filePath: string;

  constructor(dataRoot: string) {
    const dir = path.join(dataRoot, "host");
    this.filePath = path.join(dir, "VOTES.json");
    this.load();
  }

  /** 创建投票 */
  create(input: Omit<VoteTopic, "id" | "createdAt" | "status">): VoteTopic {
    const vote: VoteTopic = {
      ...input,
      id: randomUUID(),
      status: "voting",
      createdAt: Date.now(),
    };
    this.votes.push(vote);
    this.save();
    log.info("Vote created: %s (%s)", vote.id, vote.title);
    return vote;
  }

  /** 投票 */
  cast(voteId: string, agentId: string, optionIndex: number): { ok: boolean; error?: string } {
    const vote = this.get(voteId);
    if (!vote) return { ok: false, error: "未找到投票" };
    if (vote.status !== "voting") return { ok: false, error: "投票已结束" };
    if (Date.now() > vote.deadline) {
      vote.status = "arbitrating";
      this.save();
      return { ok: false, error: "投票已截止，需群主仲裁" };
    }

    const option = vote.options[optionIndex];
    if (!option) return { ok: false, error: `选项 ${optionIndex} 不存在` };

    // 移除该 agent 之前的投票（支持改票）
    for (const opt of vote.options) {
      opt.votes = opt.votes.filter(v => v !== agentId);
    }
    option.votes.push(agentId);
    this.save();

    // 检查是否已达成多数
    const totalVotes = vote.options.reduce((s, o) => s + o.votes.length, 0);
    if (totalVotes > 0 && option.votes.length > totalVotes / 2) {
      vote.status = "passed";
      vote.result = option.text;
      this.save();
      log.info("Vote %s passed: %s", vote.id, option.text);
    }

    return { ok: true };
  }

  /** 仲裁：群主或用户做最终决定 */
  arbitrate(voteId: string, decision: string): { ok: boolean; error?: string } {
    const vote = this.get(voteId);
    if (!vote) return { ok: false, error: "未找到投票" };
    vote.status = "arbitrating";
    vote.result = decision;
    this.save();
    log.info("Vote %s arbitrated: %s", vote.id, decision);
    return { ok: true };
  }

  /** 获取单条投票 */
  get(id: string): VoteTopic | undefined {
    return this.votes.find(v => v.id === id);
  }

  /** 列出群组所有投票 */
  listByGroup(groupId: string): VoteTopic[] {
    return this.votes.filter(v => v.groupId === groupId);
  }

  /** 列出所有活跃投票 */
  listActive(): VoteTopic[] {
    return this.votes.filter(v => v.status === "voting" || v.status === "arbitrating");
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return;
      this.votes = JSON.parse(raw);
      // 检查过期投票：已过 deadline 的 voting 状态自动转为 arbitrating
      let changed = false;
      const now = Date.now();
      for (const vote of this.votes) {
        if (vote.status === "voting" && now > vote.deadline) {
          vote.status = "arbitrating";
          changed = true;
        }
      }
      if (changed) this.save();
    } catch (err: any) {
      log.error("Failed to load votes: %s", err.message);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.votes, null, 2), "utf-8");
    } catch (err: any) {
      log.error("Failed to save votes: %s", err.message);
    }
  }
}
