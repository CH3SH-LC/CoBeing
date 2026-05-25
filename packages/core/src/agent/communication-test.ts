/**
 * Agent 通信测试工具
 *
 * 硬编码测试 Agent 间通信通道是否畅通
 * 不通过 LLM，直接程序实现
 */
import type { AgentRegistry } from "./registry.js";
import { createLogger } from "@cobeing/shared";

const logger = createLogger("agent:comm-test");

export interface CommTestResult {
  success: boolean;
  fromAgent: string;
  toAgent: string;
  message: string;
  response: string;
  error?: string;
  duration: number;
}

export class AgentCommTest {
  private registry: AgentRegistry;

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  /**
   * 测试单向通信
   *
   * @param fromId 发送方 Agent ID
   * @param toId 接收方 Agent ID
   * @param testMessage 测试消息
   */
  async testOneWay(
    fromId: string,
    toId: string,
    testMessage: string = "Hello, this is a test message."
  ): Promise<CommTestResult> {
    const fromAgent = this.registry.get(fromId);
    const toAgent = this.registry.get(toId);

    if (!fromAgent) {
      return {
        success: false,
        fromAgent: fromId,
        toAgent: toId,
        message: testMessage,
        response: "",
        error: `Sender agent not found: ${fromId}`,
        duration: 0,
      };
    }

    if (!toAgent) {
      return {
        success: false,
        fromAgent: fromId,
        toAgent: toId,
        message: testMessage,
        response: "",
        error: `Receiver agent not found: ${toId}`,
        duration: 0,
      };
    }

    const startTime = Date.now();

    try {
      // 直接调用 Agent.run()，不通过 LLM
      // 模拟 agent-message 工具的行为
      logger.info("[Test] %s → %s: %s", fromAgent.name, toAgent.name, testMessage);

      // 构造简单的测试提示
      const prompt = `[TEST MESSAGE FROM ${fromAgent.name}]\n\n${testMessage}\n\nPlease respond with: "Received: [original message]"`;

      const response = await toAgent.run(prompt);

      const duration = Date.now() - startTime;

      // 验证响应
      const expectedResponse = `Received: ${testMessage}`;
      const isValid = response.content.includes(expectedResponse) || response.content.includes("Received:");

      logger.info("[Test] Response from %s: %s", toAgent.name, response.content.slice(0, 100));

      return {
        success: isValid,
        fromAgent: fromId,
        toAgent: toId,
        message: testMessage,
        response: response.content,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("[Test] Error: %s", errorMessage);

      return {
        success: false,
        fromAgent: fromId,
        toAgent: toId,
        message: testMessage,
        response: "",
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * 测试双向通信
   */
  async testBidirectional(
    agent1Id: string,
    agent2Id: string
  ): Promise<{
    forward: CommTestResult;
    backward: CommTestResult;
    totalDuration: number;
  }> {
    const startTime = Date.now();

    logger.info("[Test] Testing bidirectional: %s ↔ %s", agent1Id, agent2Id);

    const forward = await this.testOneWay(agent1Id, agent2Id, "Test message from Agent1 to Agent2");
    const backward = await this.testOneWay(agent2Id, agent1Id, "Test message from Agent2 to Agent1");

    const totalDuration = Date.now() - startTime;

    return { forward, backward, totalDuration };
  }

  /**
   * 测试群组广播
   *
   * @param fromId 发送方 Agent ID
   * @param toIds 接收方 Agent ID 列表
   */
  async testBroadcast(
    fromId: string,
    toIds: string[]
  ): Promise<{
    sender: string;
    recipients: string[];
    results: CommTestResult[];
    successCount: number;
    failureCount: number;
    totalDuration: number;
  }> {
    const startTime = Date.now();

    logger.info("[Test] Testing broadcast from %s to %d recipients", fromId, toIds.length);

    const results: CommTestResult[] = [];

    for (const toId of toIds) {
      const result = await this.testOneWay(fromId, toId, `Broadcast test from ${fromId}`);
      results.push(result);
    }

    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    return {
      sender: fromId,
      recipients: toIds,
      results,
      successCount,
      failureCount,
      totalDuration,
    };
  }

  /**
   * 运行完整通信测试套件
   *
   * 测试所有注册 Agent 之间的通信
   */
  async runFullTestSuite(): Promise<{
    agents: string[];
    pairwiseTests: Array<{
      agent1: string;
      agent2: string;
      result: { forward: CommTestResult; backward: CommTestResult };
    }>;
    broadcastTests: Array<{
      sender: string;
      recipients: string[];
      result: { successCount: number; results: CommTestResult[]; totalDuration: number };
    }>;
    summary: {
      totalTests: number;
      passed: number;
      failed: number;
      successRate: number;
    };
  }> {
    const agents = this.registry.list();
    const agentIds = agents.map(a => a.id);

    logger.info("[Test] Running full communication test suite for %d agents", agentIds.length);

    const pairwiseTests: any[] = [];
    const broadcastTests: any[] = [];

    // 两两测试
    for (let i = 0; i < agentIds.length; i++) {
      for (let j = i + 1; j < agentIds.length; j++) {
        const result = await this.testBidirectional(agentIds[i], agentIds[j]);
        pairwiseTests.push({
          agent1: agentIds[i],
          agent2: agentIds[j],
          result,
        });
      }
    }

    // 广播测试（每个 Agent 向其他所有 Agent 发送）
    for (const agentId of agentIds) {
      const recipients = agentIds.filter(id => id !== agentId);
      if (recipients.length > 0) {
        const result = await this.testBroadcast(agentId, recipients);
        broadcastTests.push({
          sender: agentId,
          recipients,
          result,
        });
      }
    }

    // 统计结果
    let totalTests = 0;
    let passed = 0;
    let failed = 0;

    pairwiseTests.forEach(({ result }) => {
      totalTests += 2; // forward + backward
      if (result.forward.success) passed++;
      else failed++;
      if (result.backward.success) passed++;
      else failed++;
    });

    broadcastTests.forEach(({ result }) => {
      totalTests += result.results.length;
      passed += result.successCount;
      failed += result.failureCount;
    });

    return {
      agents: agentIds,
      pairwiseTests,
      broadcastTests,
      summary: {
        totalTests,
        passed,
        failed,
        successRate: totalTests > 0 ? (passed / totalTests) * 100 : 0,
      },
    };
  }

  /**
   * 打印测试报告
   */
  printReport(suiteResult: Awaited<ReturnType<typeof this.runFullTestSuite>>): void {
    console.log("\n=== Agent Communication Test Report ===\n");

    console.log("Agents:");
    suiteResult.agents.forEach(id => {
      const agent = this.registry.get(id);
      console.log(`  - ${agent?.name || id} (${id})`);
    });

    console.log("\nSummary:");
    console.log(`  Total Tests: ${suiteResult.summary.totalTests}`);
    console.log(`  Passed: ${suiteResult.summary.passed}`);
    console.log(`  Failed: ${suiteResult.summary.failed}`);
    console.log(`  Success Rate: ${suiteResult.summary.successRate.toFixed(2)}%`);

    console.log("\nPairwise Tests:");
    suiteResult.pairwiseTests.forEach(({ agent1, agent2, result }) => {
      const a1 = this.registry.get(agent1);
      const a2 = this.registry.get(agent2);
      console.log(`  ${a1?.name || agent1} ↔ ${a2?.name || agent2}:`);
      console.log(`    Forward: ${result.forward.success ? "✓" : "✗"} (${result.forward.duration}ms)`);
      console.log(`    Backward: ${result.backward.success ? "✓" : "✗"} (${result.backward.duration}ms)`);
      if (result.forward.error) console.log(`      Error: ${result.forward.error}`);
      if (result.backward.error) console.log(`      Error: ${result.backward.error}`);
    });

    console.log("\nBroadcast Tests:");
    suiteResult.broadcastTests.forEach(({ sender, recipients, result }) => {
      const s = this.registry.get(sender);
      console.log(`  ${s?.name || sender} → ${recipients.length} recipients:`);
      console.log(`    Success: ${result.successCount}/${result.results.length}`);
      console.log(`    Duration: ${result.totalDuration}ms`);
    });

    console.log("\n=====================================\n");
  }
}
