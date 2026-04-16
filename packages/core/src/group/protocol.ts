/**
 * GroupProtocol — strategy pattern for group discussion flow
 */
import type { Agent } from "../agent/agent.js";
import type { GroupMessage } from "@myagents/shared";

export abstract class GroupProtocolStrategy {
  abstract pickSpeaker(members: Agent[], history: GroupMessage[], round: number, step: number): Agent | null;
  abstract shouldContinue(totalMessages: number, round: number, maxRounds: number): boolean;
}

export class RoundRobinProtocol extends GroupProtocolStrategy {
  pickSpeaker(members: Agent[], _history: GroupMessage[], _round: number, step: number): Agent | null {
    return members[step % members.length] ?? null;
  }

  shouldContinue(_totalMessages: number, round: number, maxRounds: number): boolean {
    return round < maxRounds;
  }
}

export class FreeFormProtocol extends GroupProtocolStrategy {
  pickSpeaker(members: Agent[], history: GroupMessage[], _round: number, _step: number): Agent | null {
    const lastRoundStart = history.length - (history.length % members.length);
    const spokenThisRound = new Set(history.slice(lastRoundStart).map(m => m.fromAgentId));
    const unspoken = members.filter(m => !spokenThisRound.has(m.id));
    if (unspoken.length > 0) return unspoken[0];
    return members[0];
  }

  shouldContinue(_totalMessages: number, round: number, maxRounds: number): boolean {
    return round < maxRounds;
  }
}

export class ModeratedProtocol extends GroupProtocolStrategy {
  constructor(private moderatorId: string) {
    super();
  }

  pickSpeaker(members: Agent[], _history: GroupMessage[], _round: number, step: number): Agent | null {
    if (step === 0) {
      return members.find(m => m.id === this.moderatorId) ?? members[0];
    }
    const nonMods = members.filter(m => m.id !== this.moderatorId);
    return nonMods[(step - 1) % nonMods.length] ?? null;
  }

  shouldContinue(_totalMessages: number, round: number, maxRounds: number): boolean {
    return round < maxRounds;
  }
}

export function createProtocol(type: string, moderator?: string): GroupProtocolStrategy {
  switch (type) {
    case "round-robin": return new RoundRobinProtocol();
    case "free-form": return new FreeFormProtocol();
    case "moderated": return new ModeratedProtocol(moderator ?? "");
    default: return new RoundRobinProtocol();
  }
}
